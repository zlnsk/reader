import fs from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { cleanupChunk, splitParagraphs, countWords, normalizeText, dropBoilerplate, dropCopyrightChapters } from "./ai";

export type Chapter = { title?: string; paragraphs: string[] };
export type Extracted = { title?: string; author?: string; chapters: Chapter[]; wordCount: number; kind: string; coverPath?: string };
export type ProgressFn = (stage: string, pct: number) => void;

const MAX_CHARS_PER_CHUNK = 24000;

export function detectKind(filename: string, mime?: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".epub") return "epub";
  if (ext === ".docx") return "docx";
  if (ext === ".md" || ext === ".markdown") return "md";
  if (ext === ".txt") return "txt";
  if (mime?.startsWith("image/")) return "image";
  return "txt";
}

// Hard cap: reject files large enough to reliably OOM the extract pipeline.
// 80MB was chosen after a 118MB EPUB pushed the v8 heap past 3GB during
// DOM/manifest construction. Libgen already refuses >60MB per mirror — this
// is a second line of defense for uploads and OPDS imports.
const EXTRACT_SIZE_CAP_BYTES = Math.max(1, parseInt(process.env.READER_EXTRACT_MAX_MB || "80", 10)) * 1024 * 1024;

// Absolute path to the parse worker. Lives outside Next's build tree on
// purpose so webpack never tries to bundle it — the worker ships untouched
// and can require node_modules (pdfjs-dist, epub2, mammoth) at runtime.
const WORKER_PATH = path.join(process.cwd(), "workers", "ingest-parse-worker.mjs");

type ParseKind = "pdf" | "epub" | "docx" | "txt" | "md";
type ParseRequest = { kind: ParseKind; filePath: string; filename: string; wantCover: boolean };
type ParseOk = { ok: true; result: {
  kind: ParseKind;
  rawText?: string;
  chapters?: Chapter[];
  title?: string;
  author?: string;
  numpages?: number;
  coverPath?: string;
} };
type ParseErr = { ok: false; error: string };
type ParseResponse = ParseOk | ParseErr;

// Run the parse stage in a worker_threads Worker and await its reply. If the
// worker dies (heap OOM, crash, uncaught), reject with a descriptive error —
// the caller's catch returns a proper HTTP error without taking down the
// main Next.js process.
async function runParseWorker(req: ParseRequest): Promise<ParseOk["result"]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, {
      // Cap the worker's own heap so a runaway parse can't eat the whole
      // container. 1.5GB covers the largest realistic PDF + pdfjs overhead
      // but fails fast rather than thrashing.
      resourceLimits: { maxOldGenerationSizeMb: 1536, maxYoungGenerationSizeMb: 128 },
    });
    let settled = false;
    const done = (fn: () => void) => { if (settled) return; settled = true; fn(); worker.terminate().catch(() => {}); };
    worker.once("message", (msg: ParseResponse) => {
      if (msg && msg.ok) done(() => resolve(msg.result));
      else done(() => reject(new Error((msg && (msg as ParseErr).error) || "parse worker returned no result")));
    });
    worker.once("error", (err) => {
      done(() => reject(new Error("parse worker crashed: " + String(err?.message || err))));
    });
    worker.once("exit", (code) => {
      if (!settled) {
        settled = true;
        // Exit code 7 = JS heap OOM in Node worker threads (V8 fatal).
        const hint = code === 7 ? " (heap OOM)" : "";
        reject(new Error("parse worker exited with code " + code + hint + " before returning a result"));
      }
    });
    worker.postMessage(req);
  });
}

export async function extract(filePath: string, filename: string, mime: string | undefined, onProgress?: ProgressFn): Promise<Extracted> {
  const stat = await fs.stat(filePath);
  if (stat.size > EXTRACT_SIZE_CAP_BYTES) {
    throw new Error(`File too large to extract: ${stat.size} bytes exceeds ${EXTRACT_SIZE_CAP_BYTES} bytes cap (raise READER_EXTRACT_MAX_MB if memory allows).`);
  }
  const kind = detectKind(filename, mime);
  const report = onProgress || (() => {});
  report(`Parsing ${kind.toUpperCase()}`, 5);

  if (kind === "image") {
    throw new Error("Unsupported kind: image");
  }

  // All supported kinds are parsed in the worker. The main thread only runs
  // AI cleanup + final shaping — keeps the memory-heavy parse stage isolated.
  const parsed = await runParseWorker({
    kind: kind as ParseKind,
    filePath,
    filename,
    wantCover: kind === "pdf" || kind === "epub",
  });

  if (kind === "epub") {
    // EPUB path already produced structured chapters in the worker; apply the
    // same paragraph-level normalization + boilerplate trim as before.
    const rawChapters = (parsed.chapters || []).map((c) => ({
      title: c.title,
      paragraphs: dropBoilerplate(c.paragraphs.map(normalizeText).filter(Boolean)),
    }));
    const cleaned = dropCopyrightChapters(rawChapters.filter((c) => c.paragraphs.length));
    const title = parsed.title || filename.replace(/\.[^.]+$/, "");
    const author = parsed.author;
    const wc = cleaned.reduce((s, c) => s + c.paragraphs.reduce((a, p) => a + countWords(p), 0), 0);
    report("Finalizing", 95);
    return { title, author, chapters: cleaned, wordCount: wc, kind: "epub", coverPath: parsed.coverPath };
  }

  // PDF / DOCX / TXT / MD: worker returned raw text; main thread drives the
  // AI cleanup pipeline exactly as before (no API or output shape change).
  const raw = parsed.rawText || "";
  let hint: string;
  if (kind === "pdf") hint = `pdf with ${parsed.numpages || "?"} pages`;
  else if (kind === "docx") hint = "docx";
  else hint = kind === "md" ? "markdown source" : "plain text";

  report("Cleaning with AI", 20);
  const cleaned = await cleanupInChunks(raw, hint, report);
  const title = parsed.title || filename.replace(/\.[^.]+$/, "");
  const author = parsed.author;
  const wordCount = cleaned.reduce((s, c) => s + c.paragraphs.reduce((a, p) => a + countWords(p), 0), 0);
  return { title, author, chapters: cleaned, wordCount, kind, coverPath: parsed.coverPath };
}

async function cleanupInChunks(rawIn: string, hint: string, report: ProgressFn = () => {}): Promise<Chapter[]> {
  const raw = normalizeText(rawIn);
  if (raw.length <= MAX_CHARS_PER_CHUNK) {
    report("Cleaning with AI", 40);
    const out = await cleanupChunk(raw, hint);
    for (const ch of out.chapters) ch.paragraphs = dropBoilerplate(ch.paragraphs.map(normalizeText).filter(Boolean));
    report("Finalizing", 95);
    return dropCopyrightChapters(out.chapters.filter((c) => c.paragraphs.length));
  }
  const chunks: string[] = [];
  let i = 0;
  while (i < raw.length) {
    let end = Math.min(i + MAX_CHARS_PER_CHUNK, raw.length);
    if (end < raw.length) {
      const nl = raw.lastIndexOf("\n\n", end);
      if (nl > i + 1000) end = nl;
    }
    chunks.push(raw.slice(i, end));
    i = end;
  }
  const out: Chapter[] = [];
  for (let c = 0; c < chunks.length; c++) {
    report(`Cleaning with AI (${c + 1}/${chunks.length})`, 20 + Math.round(((c) / chunks.length) * 70));
    const r = await cleanupChunk(chunks[c], `${hint} (chunk ${c + 1}/${chunks.length})`);
    out.push(...r.chapters);
  }
  for (const ch of out) ch.paragraphs = dropBoilerplate(ch.paragraphs.map(normalizeText).filter(Boolean));
  // Drop empty chapters that were entirely boilerplate, then drop copyright/legal chapters
  const purged = dropCopyrightChapters(out.filter((c) => c.paragraphs.length));
  out.length = 0; out.push(...purged);
  report("Finalizing", 95);
  return out;
}

// splitParagraphs is re-exported for callers that previously imported it
// transitively from this module's imports; kept to preserve the public surface.
export { splitParagraphs };
