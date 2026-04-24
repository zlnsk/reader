import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentEmail } from "@/lib/user";
import { checkCsrf, rateLimit, rateLimitResponse } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const csrf = checkCsrf(req);
  if (csrf) return csrf;
  const email = await currentEmail();
  const rl = rateLimit(`${email}:progress`, 60, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  const body = await req.json().catch(() => ({}));
  const { bookId, chapter_idx, paragraph_idx } = body || {};
  if (!bookId || typeof bookId !== "string" || bookId.length > 64) {
    return NextResponse.json({ error: "Missing bookId" }, { status: 400 });
  }
  // Only write progress for books the caller owns. Previously any
  // authenticated user could write progress rows for any book id, which
  // leaked existence (via FK violation vs. success) and polluted the table.
  const own = await q<{ id: string }>(
    `SELECT id FROM books WHERE id = $1 AND owner_email = $2`,
    [bookId, email]
  );
  if (!own.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await q(
    `INSERT INTO progress (book_id, owner_email, chapter_idx, paragraph_idx, updated_at) VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (book_id, owner_email) DO UPDATE SET chapter_idx = EXCLUDED.chapter_idx, paragraph_idx = EXCLUDED.paragraph_idx, updated_at = now()`,
    [bookId, email, Number(chapter_idx) || 0, Number(paragraph_idx) || 0]
  );
  return NextResponse.json({ ok: true });
}
