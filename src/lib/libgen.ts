// LibGen search + download via the *.vg / *.la / *.gl / *.bz mirrors.
// Flow:
//   1) GET https://libgen.vg/index.php?req=...&res=25  (HTML results; each row has /ads.php?md5=<md5>)
//   2) Scrape MD5 + title/author/year/size/ext from the results table.
//   3) Follow /ads.php?md5=... to the "GET" button's direct download URL (cloudflare-storage).
//
// All mirrors are Cloudflare-fronted, reachable from PL ISPs. We try them in order.

const MIRRORS = ["https://libgen.vg", "https://libgen.la", "https://libgen.gl", "https://libgen.bz"];
const UA = "Mozilla/5.0 (Reader/0.2)";

export type LibgenHit = {
  md5: string;
  title: string;
  author?: string;
  year?: string;
  language?: string;
  pages?: string;
  extension?: string;
  size?: string;
  mirror: string;
};

export async function searchLibgen(query: string, format?: string): Promise<{ hits: LibgenHit[]; formatCounts: Record<string, number>; totalRaw: number }> {
  for (const base of MIRRORS) {
    try {
      const url = `${base}/index.php?req=${encodeURIComponent(query)}&res=50`;
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html" }, signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      const html = await res.text();
      const all = parseResults(html, base);
      if (!all.length) continue;
      const formatCounts: Record<string, number> = {};
      for (const h of all) if (h.extension) formatCounts[h.extension] = (formatCounts[h.extension] || 0) + 1;
      const hits = (format && format !== "any") ? all.filter((h) => h.extension === format) : all;
      return { hits, formatCounts, totalRaw: all.length };
    } catch {}
  }
  return { hits: [], formatCounts: {}, totalRaw: 0 };
}

function strip(s: string): string {
  return s
    .replace(/<i>[\s\S]*?<\/i>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

// Quote-aware HTML tokenizer: walks the string and produces a list of tokens
// (text or tagName). Attribute values inside " or ' are ignored for tag detection.
function tokenize(html: string): Array<{ type: "text" | "tag"; value: string; raw?: string }> {
  const out: Array<{ type: "text" | "tag"; value: string }> = [];
  let i = 0;
  let text = "";
  const n = html.length;
  while (i < n) {
    const c = html[i];
    if (c !== "<") { text += c; i++; continue; }
    // Try to parse a tag starting at i
    let j = i + 1;
    // Must be a letter or '/' immediately after '<' to be a real tag
    if (j >= n || !/[a-zA-Z\/!]/.test(html[j])) { text += c; i++; continue; }
    // Find the matching '>' while respecting quotes
    let quote: string | null = null;
    let k = j;
    while (k < n) {
      const ch = html[k];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ">") {
        break;
      }
      k++;
    }
    if (k >= n) { text += c; i++; continue; } // no close — treat as text
    // Capture the raw tag contents (without angle brackets)
    const raw = html.slice(j, k);
    const nameMatch = raw.match(/^\/?([a-zA-Z][a-zA-Z0-9]*)/);
    if (!nameMatch) { text += html.slice(i, k + 1); i = k + 1; continue; }
    if (text) { out.push({ type: "text", value: text }); text = ""; }
    const isClose = raw.startsWith("/");
    out.push({ type: "tag", value: (isClose ? "/" : "") + nameMatch[1].toLowerCase() });
    i = k + 1;
  }
  if (text) out.push({ type: "text", value: text });
  return out;
}

function extractFirstAnchorText(cell: string): string {
  const toks = tokenize(cell);
  let inA = 0;
  let buf = "";
  for (const t of toks) {
    if (t.type === "tag") {
      if (t.value === "a") inA++;
      else if (t.value === "/a") {
        if (inA > 0) { inA--; if (inA === 0 && buf.trim()) break; }
      }
    } else if (inA > 0) {
      buf += t.value;
    }
  }
  if (!buf.trim()) {
    // Fallback: take text of the whole cell
    buf = toks.filter((t) => t.type === "text").map((t) => t.value).join(" ");
  }
  return buf
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, " ")
    .trim();
}

function stripTextOnly(cell: string): string {
  const toks = tokenize(cell);
  return toks
    .filter((t) => t.type === "text")
    .map((t) => t.value)
    .join(" ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, " ")
    .trim();
}

function parseResults(html: string, base: string): LibgenHit[] {
  const hits: LibgenHit[] = [];
  const seen = new Set<string>();
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const row = m[1];
    const md5Match = row.match(/ads\.php\?md5=([a-fA-F0-9]{32})/);
    if (!md5Match) continue;
    const md5 = md5Match[1].toUpperCase();
    if (seen.has(md5)) continue;
    const cells = Array.from(row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((x) => x[1]);
    // libgen.vg layout: [0]title, [1]author, [2]publisher, [3]year, [4]lang, [5]pages, [6]size, [7]ext, [8]links
    if (cells.length < 8) continue;
    const title = extractFirstAnchorText(cells[0]).replace(/\s+$/, "").slice(0, 250);
    if (!title || /^\d+$/.test(title)) continue;
    const author = stripTextOnly(cells[1]) || undefined;
    const publisher = stripTextOnly(cells[2]) || undefined;
    const year = stripTextOnly(cells[3]) || undefined;
    const language = stripTextOnly(cells[4]) || undefined;
    const pagesRaw = stripTextOnly(cells[5]);
    const pages = pagesRaw && pagesRaw !== "0" ? pagesRaw.split("/")[0].trim() : undefined;
    const size = stripTextOnly(cells[6]) || undefined;
    const extension = stripTextOnly(cells[7]).toLowerCase() || undefined;
    if (!extension || !["pdf", "epub", "djvu", "mobi", "azw3", "txt", "fb2"].includes(extension)) continue;
    seen.add(md5);
    hits.push({ md5, title, author, year, pages, language, size, extension, mirror: base });
    void publisher;
  }
  // Rank: epubs first, then pdfs, by year desc
  hits.sort((a, b) => {
    const order = (e?: string) => (e === "epub" ? 0 : e === "pdf" ? 1 : 2);
    const o = order(a.extension) - order(b.extension);
    if (o !== 0) return o;
    return (Number(b.year || 0) || 0) - (Number(a.year || 0) || 0);
  });
  return hits;
}

export async function resolveDownloadUrls(md5: string): Promise<string[]> {
  const urls: string[] = [];
  for (const base of MIRRORS) {
    try {
      const url = `${base}/ads.php?md5=${md5}`;
      const res = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const html = await res.text();
      const candidates: string[] = [];
      const get1 = html.match(/<a[^>]+href="([^"]+)"[^>]*>\s*GET\s*<\/a>/i);
      if (get1) candidates.push(absolute(get1[1], new URL(url)));
      const get2 = html.match(/href="(get\.php\?md5=[^"]+)"/i);
      if (get2) candidates.push(new URL(get2[1], url).toString());
      const get3 = html.match(/href="(https?:\/\/[^"]+\.(?:pdf|epub|djvu|mobi|azw3)(?:\?[^"]*)?)"/i);
      if (get3) candidates.push(get3[1]);
      for (const c of candidates) if (!urls.includes(c)) urls.push(c);
    } catch {}
  }
  return urls;
}

function absolute(href: string, origin: URL): string {
  try { return new URL(href, origin).toString(); } catch { return href; }
}

type FallbackOpts = {
  stallMs: number;
  onMirrorStart?: (url: string, i: number, total: number) => void;
  onProgress?: (p: { pct: number | null; bytes: number; total: number | null }) => void;
};

export async function downloadWithFallback(
  urls: string[],
  dest: string,
  maxBytes: number,
  opts: FallbackOpts,
): Promise<{ bytes: number; filename: string; url: string }> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  let lastErr: unknown = null;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    opts.onMirrorStart?.(url, i, urls.length);
    const ac = new AbortController();
    let stallTimer: ReturnType<typeof setTimeout> = setTimeout(() => ac.abort(), opts.stallMs);
    const bump = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => ac.abort(), opts.stallMs);
    };
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: ac.signal });
      if (!res.ok) { lastErr = new Error(`http ${res.status}`); clearTimeout(stallTimer); continue; }
      const cd = res.headers.get("content-disposition") || "";
      const m = cd.match(/filename\*?=["']?(?:UTF-\d'[^']*')?([^";]+)/i);
      let name = m ? decodeURIComponent(m[1]) : path.basename(new URL(url).pathname) || "book";
      name = name.replace(/[^\w.\- ]+/g, "_").slice(0, 180);
      const totalHeader = res.headers.get("content-length");
      const total = totalHeader ? Number(totalHeader) : null;
      const reader = res.body?.getReader();
      if (!reader) { lastErr = new Error("no body"); clearTimeout(stallTimer); continue; }
      const chunks: Buffer[] = [];
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(Buffer.from(value));
          bytes += value.byteLength;
          bump();
          if (bytes > maxBytes) throw new Error(`File too large: ${bytes} > ${maxBytes}`);
          const pct = total ? Math.floor((bytes / total) * 100) : null;
          opts.onProgress?.({ pct, bytes, total });
        }
      }
      clearTimeout(stallTimer);
      const finalPath = path.join(path.dirname(dest), name);
      await fs.writeFile(finalPath, Buffer.concat(chunks));
      return { bytes, filename: name, url };
    } catch (e) {
      clearTimeout(stallTimer);
      lastErr = e;
    }
  }
  throw new Error(`all mirrors failed: ${String((lastErr as Error)?.message || lastErr)}`);
}
