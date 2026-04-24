import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { q } from "@/lib/db";
import { extract } from "@/lib/extract";
import { rebuildWithFrontMatter } from "@/lib/ai";
import { rateLimit, rateLimitResponse } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
const MAX_BYTES = Number(process.env.MAX_UPLOAD_MB || "60") * 1024 * 1024;
const COOKIE_NAME = "app_otp_session";
const SESSION_SECRET = process.env.OTP_SESSION_SECRET || "";

async function verifySession(token: string): Promise<string | null> {
  if (!token || !SESSION_SECRET) return null;
  const dot = token.lastIndexOf(".");
  if (dot === -1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const hmac = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const a = Buffer.from(hmac);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (!data.email || !data.expiresAt || Date.now() > data.expiresAt) return null;
    return String(data.email).toLowerCase();
  } catch { return null; }
}

function normKey(title: string | null, author: string | null): string | null {
  const t = (title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!t) return null;
  const a = (author || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `${t}|${a}`;
}


// Cheap magic-byte sanity check. Books come in a small number of container
// formats — PDF starts with %PDF, EPUB/DOCX are ZIP (PK), DOC is OLE (D0 CF 11 E0),
// RTF is {\rtf, MOBI/AZW3 have a 68-byte PDB header with BOOKMOBI at offset 60.
// Everything else we accept is plain text.
function magicBytesOk(buf: Buffer, ext: string): boolean {
  const e = ext.toLowerCase();
  if (e === "pdf") return buf.length >= 4 && buf.slice(0, 4).toString("ascii") === "%PDF";
  if (e === "epub" || e === "docx") {
    return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07);
  }
  if (e === "doc") {
    return buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
  }
  if (e === "rtf") return buf.length >= 5 && buf.slice(0, 5).toString("ascii") === "{\\rtf";
  if (e === "mobi" || e === "azw3") {
    return buf.length >= 68 && (buf.slice(60, 68).toString("ascii") === "BOOKMOBI" || buf.slice(60, 68).toString("ascii") === "TEXtREAd");
  }
  // Text-ish formats: no magic; accept if it parses as UTF-8 and looks printable.
  if (["txt", "md", "html", "htm"].includes(e)) {
    const sample = buf.slice(0, Math.min(buf.length, 4096)).toString("utf8");
    // reject if more than ~3% of characters are binary control bytes
    let ctrl = 0;
    for (let i = 0; i < sample.length; i++) {
      const c = sample.charCodeAt(i);
      if (c < 9 || (c > 13 && c < 32) || c === 127) ctrl++;
    }
    return ctrl / Math.max(1, sample.length) < 0.03;
  }
  // Unknown extension — err on the side of accepting (caller already
  // filters by extension at the UI).
  return true;
}

export async function POST(req: NextRequest) {
  const proxySecret = process.env.PROXY_SECRET;
  if (proxySecret && req.headers.get("x-proxy-secret") !== proxySecret) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const token = req.cookies.get(COOKIE_NAME)?.value || "";
  const email = await verifySession(token);
  if (!email) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  // Cap uploads at 12 / hour / user. A 60 MB file would otherwise let a
  // single account fill the disk in minutes; this is the cheapest defence.
  const rl = rateLimit(`${email}:upload`, 12, 60 * 60_000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: `File too large (> ${process.env.MAX_UPLOAD_MB || 60}MB)` }, { status: 413 });

  const buf = Buffer.from(await file.arrayBuffer());
  const declaredExt = (file.name.match(/\.([a-z0-9]{2,5})$/i)?.[1] || "").toLowerCase();
  if (!magicBytesOk(buf, declaredExt)) {
    return NextResponse.json(
      { error: `File contents don't match its .${declaredExt} extension` },
      { status: 415 },
    );
  }
  const contentHash = crypto.createHash("sha256").update(buf).digest("hex");

  const existingByBytes = await q<{ id: string; title: string | null }>(
    `SELECT id, title FROM books WHERE owner_email = $1 AND content_hash = $2 AND duplicate_of IS NULL LIMIT 1`,
    [email, contentHash]
  );
  if (existingByBytes.length) {
    return NextResponse.json(
      { error: "duplicate", existingId: existingByBytes[0].id, title: existingByBytes[0].title },
      { status: 409 }
    );
  }

  const id = crypto.randomUUID();
  const dir = path.join(UPLOAD_DIR, id);
  await fs.mkdir(dir, { recursive: true });
  const safeName = file.name.replace(/[^\w.\- ]+/g, "_");
  const filePath = path.join(dir, safeName);
  await fs.writeFile(filePath, buf);

  await q(
    `INSERT INTO books (id, owner_email, title, source_filename, source_path, source_kind, status, content_hash) VALUES ($1,$2,$3,$4,$5,$6,'extracting',$7)`,
    [id, email, safeName.replace(/\.[^.]+$/, ""), safeName, filePath, path.extname(safeName).slice(1).toLowerCase() || "txt", contentHash]
  );

  (async () => {
    const setProgress = (stage: string, pct: number) =>
      q(`UPDATE books SET status_detail = $2, progress_pct = $3 WHERE id = $1`, [id, stage, pct]).catch(() => {});
    try {
      await setProgress("Uploaded, queuing", 2);
      const out = await extract(filePath, safeName, file.type || undefined, setProgress);

      const title = out.title || safeName.replace(/\.[^.]+$/, "");
      const author = out.author || null;
      await setProgress("Summarizing", 92);
      out.chapters = await rebuildWithFrontMatter({ title, author, chapters: out.chapters });
      const takKey = normKey(title, author);

      const fullText = out.chapters.map((c) => c.paragraphs.join("\n\n")).join("\n\n");
      const textHash = crypto.createHash("sha256").update(fullText).digest("hex");

      const dup = await q<{ id: string; title: string | null }>(
        `SELECT id, title FROM books
         WHERE owner_email = $1 AND id <> $2 AND duplicate_of IS NULL
           AND ( (title_author_key IS NOT NULL AND title_author_key = $3)
              OR (text_hash IS NOT NULL AND text_hash = $4) )
         LIMIT 1`,
        [email, id, takKey, textHash]
      );

      if (dup.length) {
        await q(
          `UPDATE books SET status = 'duplicate', status_detail = 'Already in library', progress_pct = 100, duplicate_of = $2, title_author_key = $3, text_hash = $4 WHERE id = $1`,
          [id, dup[0].id, takKey, textHash]
        );
        try { await fs.rm(path.dirname(filePath), { recursive: true, force: true }); } catch (e) { console.warn("[Reader] cleanup failed:", path.dirname(filePath), String(e)); }
        await q(`DELETE FROM chapters WHERE book_id = $1`, [id]);
        return;
      }

      await setProgress("Saving chapters", 95);
      await q(`UPDATE books SET title = COALESCE($2, title), author = $3, word_count = $4, source_kind = $5, cover_path = $6, title_author_key = $7, text_hash = $8 WHERE id = $1`,
        [id, out.title || null, out.author || null, out.wordCount, out.kind, out.coverPath || null, takKey, textHash]);
      for (let i = 0; i < out.chapters.length; i++) {
        const c = out.chapters[i];
        const text = c.paragraphs.join("\n\n");
        await q(`INSERT INTO chapters (book_id, idx, title, text, word_count) VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (book_id, idx) DO UPDATE SET title = EXCLUDED.title, text = EXCLUDED.text, word_count = EXCLUDED.word_count`,
          [id, i, c.title || null, text, (text.match(/\S+/g) || []).length]);
      }
      await q(`UPDATE books SET status = 'ready', status_detail = 'Ready', progress_pct = 100, error = NULL WHERE id = $1`, [id]);
    } catch (e: any) {
      console.error("[Reader] extract failed:", e);
      await q(`UPDATE books SET status = 'failed', status_detail = 'Failed', error = $2 WHERE id = $1`, [id, String(e.message || e).slice(0, 500)]).catch((dbErr) => {
        console.error("[Reader] failed to record extract failure:", dbErr);
      });
    }
  })().catch((err) => {
    console.error("[Reader] unhandled background task error:", err);
  });

  return NextResponse.json({ id });
}
