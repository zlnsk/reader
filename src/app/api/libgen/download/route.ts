import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { q } from "@/lib/db";
import { currentEmail } from "@/lib/user";
import { resolveDownloadUrls, downloadWithFallback } from "@/lib/libgen";
import { extract } from "@/lib/extract";
import { resumeExtractForBook } from "@/lib/resume";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
const MAX_BYTES = Number(process.env.MAX_UPLOAD_MB || "60") * 1024 * 1024;

export async function POST(req: NextRequest) {
  const email = await currentEmail();
  const body = await req.json().catch(() => ({}));
  const { md5, title, author, extension } = body || {};
  if (!md5 || !/^[A-F0-9]{32}$/i.test(md5)) return NextResponse.json({ error: "Invalid md5" }, { status: 400 });
  const md5Upper = md5.toUpperCase();

  // Dedup: same libgen entry, same owner, not soft-deleted as a dup. Return
  // the existing id so the client can navigate instead of starting a second
  // download. 'failed' rows are NOT skipped — user may want to retry.
  const existingLibgen = await q<{ id: string; title: string | null; status: string }>(
    `SELECT id, title, status FROM books
     WHERE owner_email = $1 AND libgen_md5 = $2 AND duplicate_of IS NULL AND status <> 'failed'
     LIMIT 1`,
    [email, md5Upper]
  );
  if (existingLibgen.length) {
    return NextResponse.json(
      { error: "duplicate", existingId: existingLibgen[0].id, title: existingLibgen[0].title, status: existingLibgen[0].status },
      { status: 409 }
    );
  }

  const id = crypto.randomUUID();
  const dir = path.join(UPLOAD_DIR, id);
  await fs.mkdir(dir, { recursive: true });
  const ext = String(extension || "pdf").toLowerCase();
  const placeholderName = `book.${ext}`;
  const placeholder = path.join(dir, placeholderName);

  // Insert row in 'downloading' state so client polling sees progress immediately.
  await q(
    `INSERT INTO books (id, owner_email, title, author, source_filename, source_path, source_kind, status, status_detail, progress_pct, libgen_md5)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'downloading','Resolving mirror',2,$8)`,
    [id, email, title || md5, author || null, placeholderName, placeholder, ext, md5Upper]
  );

  // Respond immediately; do download + extract in background.
  // Client polls /api/books/[id] for status updates.
  (async () => {
    const setProgress = (stage: string, pct: number) =>
      q(`UPDATE books SET status_detail = $2, progress_pct = $3 WHERE id = $1`, [id, stage, pct]).catch(() => {});
    try {
      console.log("[Reader] libgen resolving", { md5, id });
      const urls = await resolveDownloadUrls(md5Upper);
      if (!urls.length) throw new Error("Could not resolve download URL from any mirror");
      console.log("[Reader] libgen mirrors resolved", { md5, id, count: urls.length, hosts: urls.map((u) => new URL(u).hostname) });
      await setProgress("Downloading 0%", 10);
      const t0 = Date.now();
      // Throttle DB writes to at most ~once a second and only on integer % change.
      let lastPctWritten = -1;
      let lastWriteAt = 0;
      const saved = await downloadWithFallback(urls, placeholder, MAX_BYTES, {
        stallMs: 20000,
        onMirrorStart: (u, i, total) => {
          console.log("[Reader] libgen trying mirror", { md5, id, host: new URL(u).hostname, i: i + 1, of: total });
          setProgress(`Downloading from ${new URL(u).hostname}`, 10);
        },
        onProgress: ({ pct, bytes, total }) => {
          // Map 0..100% of the download into the 10..49% overall progress band.
          const overall = pct === null
            ? 10 + Math.min(35, Math.floor(bytes / (1024 * 1024)) * 2)
            : 10 + Math.floor((pct * 39) / 100);
          const now = Date.now();
          if (overall !== lastPctWritten && now - lastWriteAt > 800) {
            lastPctWritten = overall;
            lastWriteAt = now;
            const label = pct === null
              ? `Downloading (${(bytes / (1024 * 1024)).toFixed(1)} MB)`
              : `Downloading ${pct}%${total ? ` of ${(total / (1024 * 1024)).toFixed(1)} MB` : ""}`;
            setProgress(label, overall);
          }
        },
      });
      console.log("[Reader] libgen download ok", { md5, id, bytes: saved.bytes, ms: Date.now() - t0, host: new URL(saved.url).hostname });
      const filePath = path.join(dir, saved.filename);
      await q(`UPDATE books SET source_filename = $2, source_path = $3 WHERE id = $1`,
        [id, saved.filename, filePath]);
      await resumeExtractForBook(id);
    } catch (e: any) {
      console.error("[Reader] libgen extract failed:", e);
      await q(`UPDATE books SET status = 'failed', error = $2 WHERE id = $1`, [id, String(e.message || e).slice(0, 500)]).catch((dbErr) => {
        console.error("[Reader] failed to record libgen failure:", dbErr);
      });
    }
  })().catch((err) => {
    console.error("[Reader] unhandled libgen background task error:", err);
  });

  return NextResponse.json({ id });
}
