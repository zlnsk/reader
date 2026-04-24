// Worker thread: isolates memory-heavy document parsing (PDF / EPUB / DOCX /
// plain text) off the main Next.js process so a malformed or oversized upload
// can only OOM THIS worker — the main server stays up and returns a proper
// error to the client.
//
// Input (via parentPort.postMessage):
//   { kind: 'pdf'|'epub'|'docx'|'txt'|'md', filePath, filename, wantCover }
//
// Output (posted back):
//   { ok: true, result: { kind, rawText?, chapters?, title?, author?, numpages?, coverPath? } }
//   { ok: false, error: string }
//
// PDF is extracted with pdfjs-dist/legacy (Mozilla PDF.js) — pdf-parse@1.1.1
// has been unmaintained since 2021 and is the historical OOM culprit in this
// pipeline.
import { parentPort } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

async function extractPdfText(filePath) {
  // pdfjs-dist legacy ESM build — Node-compatible, no DOM reliance.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const buf = await fs.readFile(filePath);
  // pdfjs mutates the Uint8Array it's given, so hand it a fresh copy.
  const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice();
  const doc = await pdfjs.getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
    isEvalSupported: false,
  }).promise;
  const numpages = doc.numPages;
  let info = null;
  try {
    const meta = await doc.getMetadata();
    info = (meta && meta.info) || null;
  } catch {}
  const parts = [];
  for (let p = 1; p <= numpages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // Each item has .str for the visible text and .hasEOL for line breaks.
    let pageText = '';
    for (const it of content.items) {
      if (typeof it.str === 'string') pageText += it.str;
      if (it.hasEOL) pageText += '\n';
      else pageText += ' ';
    }
    parts.push(pageText);
    // Release per-page resources promptly — PDF.js caches page content
    // aggressively otherwise and can balloon RSS on large books.
    try { page.cleanup(); } catch {}
  }
  try { await doc.cleanup(); } catch {}
  try { await doc.destroy(); } catch {}
  return { text: parts.join('\n\n'), numpages, info };
}

async function tryPdfCover(pdfPath, outPath) {
  try {
    const base = outPath.replace(/\.[^.]+$/, '');
    await exec('pdftoppm', ['-jpeg', '-jpegopt', 'quality=82', '-r', '120', '-f', '1', '-l', '1', '-singlefile', pdfPath, base], { timeout: 45000 });
    const final = base + '.jpg';
    const stat = await fs.stat(final).catch(() => null);
    return stat && stat.size > 0 ? final : null;
  } catch { return null; }
}

async function tryEpubCover(epub, dir) {
  try {
    const meta = epub.metadata || {};
    const manifest = epub.manifest || {};
    let coverId =
      meta.cover ||
      Object.keys(manifest).find((k) => /cover/i.test(k) && /image/i.test(manifest[k]['media-type'] || ''));
    if (!coverId) return null;
    const entry = manifest[coverId];
    const mt = (entry && entry['media-type']) || 'image/jpeg';
    const ext = mt.includes('png') ? 'png' : mt.includes('webp') ? 'webp' : 'jpg';
    const data = await new Promise((res, rej) => epub.getImage(coverId, (e, d) => e ? rej(e) : res(d)));
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (!buf.length) return null;
    const p = path.join(dir, 'cover.' + ext);
    await fs.writeFile(p, buf);
    return p;
  } catch { return null; }
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(p|div|br|h[1-6]|li|tr)[^>]*>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function parseEpub(filePath) {
  const { EPub } = await import('epub2');
  return new Promise((resolve, reject) => {
    const epub = new EPub(filePath);
    epub.on('error', reject);
    epub.on('end', async () => {
      try {
        const flow = epub.flow || [];
        const chapters = [];
        for (let i = 0; i < flow.length; i++) {
          const item = flow[i];
          const html = await new Promise((res, rej) => epub.getChapter(item.id, (e, t) => e ? rej(e) : res(t)));
          const text = htmlToText(html);
          if (!text.trim()) continue;
          const rawTitle = (item.title || '').toString();
          const title = rawTitle.split(/\s*[•·]\s*/)[0].trim() || undefined;
          // Paragraphs split by blank line — main thread will run
          // normalizeText/dropBoilerplate to match prior behavior.
          const paragraphs = text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
          chapters.push({ title, paragraphs });
        }
        const title = (epub.metadata && epub.metadata.title) || undefined;
        const author = (epub.metadata && epub.metadata.creator) || undefined;
        const coverPath = (await tryEpubCover(epub, path.dirname(filePath))) || undefined;
        resolve({ chapters, title, author, coverPath });
      } catch (e) { reject(e); }
    });
    epub.parse();
  });
}

async function parseDocx(filePath) {
  const mammoth = await import('mammoth');
  const { value } = await mammoth.extractRawText({ path: filePath });
  return { text: value };
}

async function handle(msg) {
  const { kind, filePath, filename, wantCover } = msg;
  if (kind === 'pdf') {
    const { text, numpages, info } = await extractPdfText(filePath);
    if (!text.trim() || text.replace(/\s/g, '').length < 200) {
      throw new Error('This PDF appears to be a scan with no text layer. OCR fallback not enabled in v1.');
    }
    let coverPath;
    if (wantCover) {
      coverPath = (await tryPdfCover(filePath, path.join(path.dirname(filePath), 'cover.jpg'))) || undefined;
    }
    const title = (info && info.Title) || undefined;
    const author = (info && info.Author) || undefined;
    return { kind, rawText: text, numpages, coverPath, title, author };
  }
  if (kind === 'epub') {
    const r = await parseEpub(filePath);
    return { kind, chapters: r.chapters, title: r.title, author: r.author, coverPath: r.coverPath };
  }
  if (kind === 'docx') {
    const r = await parseDocx(filePath);
    return { kind, rawText: r.text };
  }
  if (kind === 'txt' || kind === 'md') {
    const text = await fs.readFile(filePath, 'utf8');
    return { kind, rawText: text };
  }
  throw new Error('Unsupported kind: ' + kind);
}

parentPort.on('message', async (msg) => {
  try {
    const result = await handle(msg);
    parentPort.postMessage({ ok: true, result });
  } catch (e) {
    parentPort.postMessage({ ok: false, error: String((e && e.message) || e) });
  }
});
