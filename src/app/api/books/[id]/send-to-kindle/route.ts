import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentEmail } from "@/lib/user";
import { checkCsrf, rateLimit, rateLimitResponse } from "@/lib/security";
import { buildEpub, type EpubChapter } from "@/lib/epub-build";
// @ts-ignore — shared-auth ships as plain JS.
import { sendEmailWithAttachment } from "shared-auth/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const KINDLE_EMAIL_RE = /^[^\s@]+@(?:kindle\.com|free\.kindle\.com)$/i;

/**
 * POST /api/books/:id/send-to-kindle
 *
 * Generates a self-contained EPUB from the book's chapters table and emails
 * it to the user's saved Kindle address. Requires a valid session + CSRF
 * token + kindleEmail set in prefs.
 *
 * Rate-limited to 6 sends / hour / user (Amazon throttles too, but we want
 * cheap pre-filtering before building the EPUB which can run up to several
 * hundred kilobytes).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const csrf = checkCsrf(req);
  if (csrf) return csrf;
  const email = await currentEmail();
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const rl = rateLimit(`${email}:kindle-send`, 6, 60 * 60_000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);

  const { id } = await ctx.params;
  if (!id || typeof id !== "string" || id.length > 64) {
    return NextResponse.json({ error: "Invalid book id" }, { status: 400 });
  }

  const prefsRows = await q<{ json: any }>(
    `SELECT json FROM prefs WHERE owner_email = $1`,
    [email]
  );
  const kindleEmail: string | undefined = prefsRows[0]?.json?.kindleEmail;
  if (!kindleEmail || !KINDLE_EMAIL_RE.test(kindleEmail)) {
    return NextResponse.json(
      { error: "Kindle email not set. Add it in Settings first." },
      { status: 400 }
    );
  }

  const bookRows = await q<{ title: string | null; author: string | null }>(
    `SELECT title, author FROM books WHERE id = $1 AND owner_email = $2 AND archived = false`,
    [id, email]
  );
  if (!bookRows.length) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  const book = bookRows[0];

  const chapterRows = await q<EpubChapter>(
    `SELECT idx, title, text FROM chapters WHERE book_id = $1 ORDER BY idx`,
    [id]
  );
  if (!chapterRows.length) {
    return NextResponse.json({ error: "Book has no chapters yet" }, { status: 409 });
  }

  const epub = await buildEpub({
    id,
    title: book.title,
    author: book.author,
    chapters: chapterRows,
  });

  // Kindle's Send-to-Kindle accepts up to ~50 MB; bail early if we blew past.
  const MAX_BYTES = 45 * 1024 * 1024;
  if (epub.length > MAX_BYTES) {
    return NextResponse.json(
      { error: `Book too large for Send-to-Kindle (${Math.round(epub.length / (1024 * 1024))} MB > 45 MB cap)` },
      { status: 413 }
    );
  }

  const cfg = {
    jmapUrl: process.env.OTP_JMAP_URL,
    jmapUser: process.env.OTP_JMAP_USER,
    jmapPass: process.env.OTP_JMAP_PASS,
    fromEmail: process.env.OTP_FROM_EMAIL,
    fromName: "Reader",
  };
  if (!cfg.jmapUrl || !cfg.jmapUser || !cfg.jmapPass || !cfg.fromEmail) {
    return NextResponse.json({ error: "Mail transport not configured" }, { status: 500 });
  }

  // Amazon's "Send to Kindle" treats the Subject as the delivered title on
  // older Kindles; on newer ones it reads the EPUB metadata. Sending "Convert"
  // as the body (any text works) keeps the email deliverable through stricter
  // spam filters that reject empty bodies.
  const filenameSafe = (book.title || "book")
    .replace(/[^\w .,()'-]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "book";

  try {
    await sendEmailWithAttachment(
      kindleEmail,
      book.title || "Book from Reader",
      `Hello from Reader.\n\nAttached: ${book.title || "(untitled)"}${book.author ? ` by ${book.author}` : ""}.\nThis file was generated from your Reader library on ${new Date().toISOString().slice(0, 10)}.`,
      {
        filename: `${filenameSafe}.epub`,
        content: epub,
        contentType: "application/epub+zip",
      },
      cfg,
    );
  } catch (err: any) {
    console.error("[Reader] send-to-kindle failed:", err?.message || err);
    return NextResponse.json(
      { error: `Send failed: ${err?.message || "unknown"}` },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    kindleEmail,
    bytes: epub.length,
    chapters: chapterRows.length,
  });
}
