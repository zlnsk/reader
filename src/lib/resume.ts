import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { q } from "@/lib/db";
import { extract } from "@/lib/extract";
import { rebuildWithFrontMatter } from "@/lib/ai";

function normKey(title: string | null, author: string | null): string | null {
  const t = (title || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!t) return null;
  const a = (author || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `${t}|${a}`;
}

// Run the same extract + DB update pipeline that /api/libgen/download/route.ts
// executes after the file lands. Safe to call for any book whose source_path
// points at an intact downloaded file.
export async function resumeExtractForBook(id: string): Promise<void> {
  const rows = await q<{ id: string; source_path: string; source_filename: string; owner_email: string }>(
    `SELECT id, source_path, source_filename, owner_email FROM books WHERE id = $1`,
    [id]
  );
  const b = rows[0];
  if (!b) throw new Error(`Book ${id} not found`);
  const stat = await fs.stat(b.source_path).catch(() => null);
  if (!stat || stat.size <= 0) throw new Error(`Source file missing or empty for ${id}`);

  // Byte-level dedup against prior uploads/downloads. If a matching row exists
  // already, soft-mark this one as duplicate and bail before extract work.
  const fileBuf = await fs.readFile(b.source_path);
  const contentHash = crypto.createHash("sha256").update(fileBuf).digest("hex");
  const preDup = await q<{ id: string; title: string | null }>(
    `SELECT id, title FROM books
     WHERE owner_email = $1 AND id <> $2 AND content_hash = $3 AND duplicate_of IS NULL
     LIMIT 1`,
    [b.owner_email, id, contentHash]
  );
  if (preDup.length) {
    await q(
      `UPDATE books SET status = 'duplicate', status_detail = 'Already in library', progress_pct = 100, duplicate_of = $2, content_hash = $3 WHERE id = $1`,
      [id, preDup[0].id, contentHash]
    );
    try { await fs.rm(path.dirname(b.source_path), { recursive: true, force: true }); } catch (e) { console.warn("[Reader] cleanup failed:", path.dirname(b.source_path), String(e)); }
    await q(`DELETE FROM chapters WHERE book_id = $1`, [id]);
    return;
  }

  await q(
    `UPDATE books SET status = 'extracting', status_detail = 'Resuming extract', progress_pct = 50, content_hash = $2 WHERE id = $1`,
    [id, contentHash]
  );
  try {
    const out = await extract(b.source_path, b.source_filename, undefined);
    out.chapters = await rebuildWithFrontMatter({
      title: out.title || b.source_filename.replace(/\.[^.]+$/, ""),
      author: out.author || null,
      chapters: out.chapters,
    });

    const finalTitle = out.title || b.source_filename.replace(/\.[^.]+$/, "");
    const finalAuthor = out.author || null;
    const takKey = normKey(finalTitle, finalAuthor);
    const fullText = out.chapters.map((c) => c.paragraphs.join("\n\n")).join("\n\n");
    const textHash = crypto.createHash("sha256").update(fullText).digest("hex");

    // Post-extract dedup: catches same content under different container (e.g.
    // libgen epub of a book the user previously uploaded as pdf). Mirrors the
    // behavior in /api/upload/route.ts.
    const dup = await q<{ id: string; title: string | null }>(
      `SELECT id, title FROM books
       WHERE owner_email = $1 AND id <> $2 AND duplicate_of IS NULL
         AND ( (title_author_key IS NOT NULL AND title_author_key = $3)
            OR (text_hash IS NOT NULL AND text_hash = $4) )
       LIMIT 1`,
      [b.owner_email, id, takKey, textHash]
    );
    if (dup.length) {
      await q(
        `UPDATE books SET status = 'duplicate', status_detail = 'Already in library', progress_pct = 100, duplicate_of = $2, title_author_key = $3, text_hash = $4 WHERE id = $1`,
        [id, dup[0].id, takKey, textHash]
      );
      try { await fs.rm(path.dirname(b.source_path), { recursive: true, force: true }); } catch (e) { console.warn("[Reader] cleanup failed:", path.dirname(b.source_path), String(e)); }
      await q(`DELETE FROM chapters WHERE book_id = $1`, [id]);
      return;
    }

    await q(
      `UPDATE books SET title = COALESCE($2, title), author = COALESCE($3, author), word_count = $4, source_kind = $5, cover_path = $6, title_author_key = $7, text_hash = $8 WHERE id = $1`,
      [id, out.title || null, out.author || null, out.wordCount, out.kind, out.coverPath || null, takKey, textHash]
    );
    // Wipe any partial chapters from a prior failed pass, then re-insert.
    await q(`DELETE FROM chapters WHERE book_id = $1`, [id]);
    for (let i = 0; i < out.chapters.length; i++) {
      const c = out.chapters[i];
      const text = c.paragraphs.join("\n\n");
      await q(
        `INSERT INTO chapters (book_id, idx, title, text, word_count) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (book_id, idx) DO UPDATE SET title = EXCLUDED.title, text = EXCLUDED.text, word_count = EXCLUDED.word_count`,
        [id, i, c.title || null, text, (text.match(/\S+/g) || []).length]
      );
    }
    await q(`UPDATE books SET status = 'ready', error = NULL, progress_pct = 100 WHERE id = $1`, [id]);
  } catch (e: any) {
    await q(`UPDATE books SET status = 'failed', error = $2 WHERE id = $1`, [id, String(e.message || e).slice(0, 500)]);
    throw e;
  }
}
