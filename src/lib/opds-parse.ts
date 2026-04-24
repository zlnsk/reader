// Minimal OPDS Atom feed parser. Handles both navigation and acquisition
// feeds. We only need the shape the UI renders — title, summary, cover,
// acquisition URL, and sub-feed links. XML parsed with a regex-based walker
// to avoid adding a dep; good enough for well-formed OPDS 1.2 feeds from
// mainstream servers (Calibre, Koha, Standard Ebooks, Project Gutenberg).
//
// For hostile XML this is not safe. Our use case is user-supplied catalog
// URLs the user trusts enough to add; the worst outcome is "feed doesn't
// render", not a server-side compromise. The fetch happens server-side so
// no SSRF issues beyond the user's intent.

export type ParsedLink = { rel: string; href: string; type?: string; title?: string };
export type ParsedEntry = {
  id: string;
  title: string;
  updated?: string;
  authors: string[];
  summary?: string;
  content?: string;
  links: ParsedLink[];
};
export type ParsedFeed = {
  title: string;
  subtitle?: string;
  updated?: string;
  links: ParsedLink[];
  entries: ParsedEntry[];
  totalResults?: number;
  itemsPerPage?: number;
  startIndex?: number;
};

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function stripCdataAndTags(s: string): string {
  return decodeXmlEntities(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "")).trim();
}

function allBlocks(src: string, tag: string): string[] {
  // Match <tag ...>...</tag> blocks (non-nested, good enough for atom entries).
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

function firstText(src: string, tag: string): string | undefined {
  const m = src.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`));
  return m ? stripCdataAndTags(m[1]) : undefined;
}

function attrs(blockOpeningTag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z:][\w:-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(blockOpeningTag))) out[m[1]] = decodeXmlEntities(m[2]);
  return out;
}

function parseLinks(src: string): ParsedLink[] {
  const re = /<link\b([^>]*)\/?\s*>/g;
  const out: ParsedLink[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const a = attrs(m[1]);
    if (!a.href) continue;
    out.push({ rel: a.rel || "alternate", href: a.href, type: a.type, title: a.title });
  }
  return out;
}

function parseEntry(src: string): ParsedEntry {
  const id = firstText(src, "id") || "";
  const title = firstText(src, "title") || "Untitled";
  const updated = firstText(src, "updated");
  const authors = allBlocks(src, "author").map((b) => firstText(b, "name") || "").filter(Boolean);
  const summary = firstText(src, "summary");
  const content = firstText(src, "content");
  const links = parseLinks(src);
  return { id, title, updated, authors, summary, content, links };
}

export function parseFeed(xml: string, baseUrl: string): ParsedFeed {
  // Strip leading BOM + xml prolog, we don't need them.
  const src = xml.replace(/^\uFEFF/, "");
  // Resolve relative URLs against baseUrl for every link we emit.
  const resolve = (href: string) => {
    try { return new URL(href, baseUrl).toString(); } catch { return href; }
  };
  const feedMatch = src.match(/<feed\b[\s\S]*?>([\s\S]*)<\/feed>/);
  const body = feedMatch ? feedMatch[1] : src;
  const title = firstText(body, "title") || "OPDS";
  const subtitle = firstText(body, "subtitle");
  const updated = firstText(body, "updated");
  // Pull feed-level links before we slice entries out.
  const topLinks = (() => {
    // Only take <link> tags that are not inside <entry>...</entry>.
    const withoutEntries = body.replace(/<entry\b[\s\S]*?<\/entry>/g, "");
    return parseLinks(withoutEntries).map((l) => ({ ...l, href: resolve(l.href) }));
  })();
  const entryBlocks = allBlocks(body, "entry");
  const entries = entryBlocks.map((e) => {
    const p = parseEntry(e);
    p.links = p.links.map((l) => ({ ...l, href: resolve(l.href) }));
    return p;
  });
  const totalResults = Number(firstText(body, "opensearch:totalResults") || "") || undefined;
  const itemsPerPage = Number(firstText(body, "opensearch:itemsPerPage") || "") || undefined;
  const startIndex = Number(firstText(body, "opensearch:startIndex") || "") || undefined;
  return { title, subtitle, updated, links: topLinks, entries, totalResults, itemsPerPage, startIndex };
}

export function pickAcquisitionLink(links: ParsedLink[]): ParsedLink | undefined {
  // Prefer open-access, then generic acquisition. Ignore paid / borrow for now.
  const open = links.find((l) => l.rel === "http://opds-spec.org/acquisition/open-access");
  if (open) return open;
  const gen = links.find((l) => l.rel === "http://opds-spec.org/acquisition");
  if (gen) return gen;
  const anyAcq = links.find((l) => l.rel.startsWith("http://opds-spec.org/acquisition"));
  return anyAcq;
}

export function pickCoverLink(links: ParsedLink[]): ParsedLink | undefined {
  return (
    links.find((l) => l.rel === "http://opds-spec.org/image/thumbnail") ||
    links.find((l) => l.rel === "http://opds-spec.org/image") ||
    links.find((l) => l.rel === "http://opds-spec.org/cover") ||
    links.find((l) => l.rel === "http://opds-spec.org/thumbnail")
  );
}

export function isNavigationEntry(entry: ParsedEntry): boolean {
  // Nav entries have subsection / navigation / start / search-style links with
  // an atom-xml content type, not an acquisition.
  const hasAcq = entry.links.some((l) => l.rel.startsWith("http://opds-spec.org/acquisition"));
  if (hasAcq) return false;
  return entry.links.some((l) => (l.type || "").includes("application/atom+xml") || l.rel === "subsection" || l.rel === "http://opds-spec.org/sort/new" || l.rel === "http://opds-spec.org/sort/popular");
}
