import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { q } from "@/lib/db";
import { currentEmail } from "@/lib/user";
import { checkCsrf, rateLimit, rateLimitResponse } from "@/lib/security";
import { resumeExtractForBook } from "@/lib/resume";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
const MAX_BYTES = Number(process.env.MAX_UPLOAD_MB || "60") * 1024 * 1024;

// Map content-type / URL extension to a file extension the extract
// pipeline recognises.
function extFromType(contentType: string | null, urlStr: string): string {
  const ct = (contentType || "").split(";")[0].trim().toLowerCase();
  const byType: Record<string, string> = {
    "application/epub+zip": "epub",
    "application/pdf": "pdf",
    "application/x-mobipocket-ebook": "mobi",
    "application/vnd.amazon.ebook": "azw3",
    "text/plain": "txt",
    "text/html": "html",
    "text/markdown": "md",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/msword": "doc",
    "application/rtf": "rtf",
  };
  if (byType[ct]) return byType[ct];
  const m = urlStr.match(/\.([a-z0-9]{2,5})(?:\?|#|$)/i);
  return m ? m[1].toLowerCase() : "epub";
}

// POST { catalogId, url (acquisition), title?, author? }
// Streams the remote file into uploads/ and kicks off extract.
export async function POST(req: NextRequest) {
  const csrf = checkCsrf(req);
  if (csrf) return csrf;
  const email = await currentEmail();
  const rl = rateLimit(`${email}:opds-import`, 30, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  const body = await req.json().catch(() => ({}));
  const { catalogId, url: acqUrl, title, author } = body || {};
  if (!catalogId || !acqUrl) return NextResponse.json({ error: "Missing catalogId or url" }, { status: 400 });

  const rows = await q<{ url: string; username: string | null; password: string | null }>(
    `SELECT url, username, password FROM opds_catalogs WHERE id = $1 AND owner_email = $2`,
    [catalogId, email]
  );
  if (!rows.length) return NextResponse.json({ error: "Catalog not found" }, { status: 404 });
  const cat = rows[0];

  let target: URL;
  try { target = new URL(String(acqUrl), cat.url); } catch { return NextResponse.json({ error: "Bad url" }, { status: 400 }); }
  try {
    const catUrl = new URL(cat.url);
    if (target.host !== catUrl.host || target.protocol !== catUrl.protocol) {
      return NextResponse.json({ error: "Cross-origin import blocked" }, { status: 400 });
    }
  } catch { return NextResponse.json({ error: "Bad saved catalog" }, { status: 400 }); }

  const headers: Record<string, string> = {
    "Accept": "*/*",
    "User-Agent": "Reader/OPDS-client",
  };
  if (cat.username && cat.password) {
    headers["Authorization"] = "Basic " + Buffer.from(`${cat.username}:${cat.password}`).toString("base64");
  }

  const id = crypto.randomUUID();
  const dir = path.join(UPLOAD_DIR, id);
  await fs.mkdir(dir, { recursive: true });

  // Insert in downloading state so library polling sees the row immediately.
  await q(
    `INSERT INTO books (id, owner_email, title, author, source_filename, source_path, source_kind, status, status_detail, progress_pct)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'downloading','Starting download',2)`,
    [id, email, title || null, author || null, "pending", path.join(dir, "pending"), "epub"]
  );

  (async () => {
    const setProgress = (stage: string, pct: number) =>
      q(`UPDATE books SET status_detail = $2, progress_pct = $3 WHERE id = $1`, [id, stage, pct]).catch(() => {});
    try {
      setProgress("Connecting", 5);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 5 * 60_000);
      const r = await fetch(target.toString(), { headers, signal: ac.signal, redirect: "follow" });
      if (!r.ok || !r.body) { clearTimeout(timer); throw new Error(`Upstream ${r.status}`); }
      const ext = extFromType(r.headers.get("content-type"), target.toString());
      const fname = `book.${ext}`;
      const fpath = path.join(dir, fname);
      const total = Number(r.headers.get("content-length")) || 0;
      if (total && total > MAX_BYTES) { clearTimeout(timer); throw new Error(`File too large: ${total} > ${MAX_BYTES}`); }
      const out = await fs.open(fpath, "w");
      let bytes = 0;
      try {
        const reader = r.body.getReader();
        let lastWrite = Date.now();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > MAX_BYTES) throw new Error("Download exceeds MAX_UPLOAD_MB");
          await out.write(value);
          const now = Date.now();
          if (now - lastWrite > 800) {
            lastWrite = now;
            const pct = total ? Math.floor((bytes / total) * 39) + 10 : 10 + Math.min(35, Math.floor(bytes / (1024 * 1024)) * 2);
            setProgress(total ? `Downloading ${Math.floor((bytes / total) * 100)}%` : `Downloading (${(bytes / 1e6).toFixed(1)} MB)`, pct);
          }
        }
      } finally { await out.close(); clearTimeout(timer); }
      await q(`UPDATE books SET source_filename = $2, source_path = $3, source_kind = $4 WHERE id = $1`,
        [id, fname, fpath, ext]);
      await resumeExtractForBook(id);
    } catch (e: any) {
      console.error("[Reader] opds import failed:", e);
      await q(`UPDATE books SET status = 'failed', error = $2 WHERE id = $1`,
        [id, String(e.message || e).slice(0, 500)]).catch(() => {});
    }
  })().catch((err) => console.error("[Reader] unhandled opds import error:", err));

  return NextResponse.json({ id });
}
