// Atom/OPDS 1.2 feed builder. Hand-rolled so we don't pull a dep.
// All text is XML-escaped; all URLs are already URL-safe.
//
// OPDS 1.2 spec: https://specs.opds.io/opds-1.2.html
// Content types:
//   - Navigation feed:      application/atom+xml;profile=opds-catalog;kind=navigation
//   - Acquisition feed:     application/atom+xml;profile=opds-catalog;kind=acquisition
//   - Acquisition link rel: http://opds-spec.org/acquisition
//   - Image link rel:       http://opds-spec.org/image (+ /image/thumbnail)

export const NAV_TYPE = 'application/atom+xml;profile=opds-catalog;kind=navigation';
export const ACQ_TYPE = 'application/atom+xml;profile=opds-catalog;kind=acquisition';
export const ACQ_REL = 'http://opds-spec.org/acquisition';
export const IMG_REL = 'http://opds-spec.org/image';
export const THUMB_REL = 'http://opds-spec.org/image/thumbnail';

export function xmlEscape(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export type FeedLink = {
  rel: string;
  href: string;
  type?: string;
  title?: string;
};

export type FeedEntry = {
  id: string;
  title: string;
  updated: string;
  authors?: Array<{ name: string }>;
  summary?: string;
  content?: { type: 'text' | 'html'; value: string };
  links: FeedLink[];
  categories?: Array<{ term: string; label?: string }>;
  language?: string;
  published?: string;
};

export type Feed = {
  id: string;
  title: string;
  updated: string;
  subtitle?: string;
  author?: { name: string; uri?: string };
  links: FeedLink[];
  entries: FeedEntry[];
  totalResults?: number;
  itemsPerPage?: number;
  startIndex?: number;
};

export function renderAtom(feed: Feed): string {
  const parts: string[] = [];
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  parts.push(
    `<feed xmlns="http://www.w3.org/2005/Atom" ` +
    `xmlns:dc="http://purl.org/dc/terms/" ` +
    `xmlns:opds="http://opds-spec.org/2010/catalog" ` +
    `xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">`
  );
  parts.push(`<id>${xmlEscape(feed.id)}</id>`);
  parts.push(`<title>${xmlEscape(feed.title)}</title>`);
  if (feed.subtitle) parts.push(`<subtitle>${xmlEscape(feed.subtitle)}</subtitle>`);
  parts.push(`<updated>${xmlEscape(feed.updated)}</updated>`);
  if (feed.author) {
    parts.push(`<author><name>${xmlEscape(feed.author.name)}</name>${feed.author.uri ? `<uri>${xmlEscape(feed.author.uri)}</uri>` : ''}</author>`);
  }
  if (feed.totalResults != null) parts.push(`<opensearch:totalResults>${feed.totalResults}</opensearch:totalResults>`);
  if (feed.itemsPerPage != null) parts.push(`<opensearch:itemsPerPage>${feed.itemsPerPage}</opensearch:itemsPerPage>`);
  if (feed.startIndex != null) parts.push(`<opensearch:startIndex>${feed.startIndex}</opensearch:startIndex>`);
  for (const l of feed.links) parts.push(renderLink(l));
  for (const e of feed.entries) parts.push(renderEntry(e));
  parts.push(`</feed>`);
  return parts.join('\n');
}

function renderLink(l: FeedLink): string {
  const attrs = [
    `rel="${xmlEscape(l.rel)}"`,
    `href="${xmlEscape(l.href)}"`,
    l.type ? `type="${xmlEscape(l.type)}"` : '',
    l.title ? `title="${xmlEscape(l.title)}"` : '',
  ].filter(Boolean).join(' ');
  return `<link ${attrs}/>`;
}

function renderEntry(e: FeedEntry): string {
  const parts: string[] = [];
  parts.push(`<entry>`);
  parts.push(`<id>${xmlEscape(e.id)}</id>`);
  parts.push(`<title>${xmlEscape(e.title)}</title>`);
  parts.push(`<updated>${xmlEscape(e.updated)}</updated>`);
  if (e.published) parts.push(`<published>${xmlEscape(e.published)}</published>`);
  if (e.language) parts.push(`<dc:language>${xmlEscape(e.language)}</dc:language>`);
  for (const a of e.authors || []) parts.push(`<author><name>${xmlEscape(a.name)}</name></author>`);
  for (const c of e.categories || []) {
    const attrs = [`term="${xmlEscape(c.term)}"`, c.label ? `label="${xmlEscape(c.label)}"` : ''].filter(Boolean).join(' ');
    parts.push(`<category ${attrs}/>`);
  }
  if (e.summary) parts.push(`<summary type="text">${xmlEscape(e.summary)}</summary>`);
  if (e.content) parts.push(`<content type="${xmlEscape(e.content.type)}">${xmlEscape(e.content.value)}</content>`);
  for (const l of e.links) parts.push(renderLink(l));
  parts.push(`</entry>`);
  return parts.join('');
}

// MIME type for a book based on file extension. Mirrors the map used by
// /api/books/[id]/original so OPDS clients see the same content-type as the
// byte stream they'll receive.
export function bookMime(ext: string | null | undefined): string {
  const e = (ext || '').toLowerCase().replace(/^\./, '');
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    epub: 'application/epub+zip',
    mobi: 'application/x-mobipocket-ebook',
    azw: 'application/vnd.amazon.ebook',
    azw3: 'application/vnd.amazon.ebook',
    txt: 'text/plain',
    html: 'text/html',
    htm: 'text/html',
    md: 'text/markdown',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    doc: 'application/msword',
    rtf: 'application/rtf',
  };
  return map[e] || 'application/octet-stream';
}

// RFC3339 timestamp from a Date or ISO string or null/undefined.
export function isoOrNow(v: string | Date | null | undefined): string {
  if (!v) return new Date().toISOString();
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}
