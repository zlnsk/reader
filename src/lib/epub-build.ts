// EPUB 3 builder — turns a stored book's chapters into a standards-compliant
// EPUB that Kindle accepts for Send-to-Kindle conversion. Produces a Buffer.
//
// We keep it self-contained: jszip is already a transitive dep via a couple
// of extract paths, no extra install needed. Renderer mirrors the web
// reader's inline-markdown handling (bold / italic / code / links, heading
// levels, bullet + ordered lists) so the output matches what the user sees
// on screen.
import JSZip from "jszip";
import { createWriteStream, promises as fsp } from "fs";
import { tmpdir } from "os";
import { join as pjoin } from "path";
import { randomBytes } from "crypto";

export type EpubChapter = {
  idx: number;
  title: string | null;
  text: string;
};

export type EpubBook = {
  id: string;
  title: string | null;
  author: string | null;
  language?: string;
  chapters: EpubChapter[];
};

// ──────────────────────────────────────────────────────────────────────
// Helpers

function xmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string
  ));
}

function safeId(s: string): string {
  return (s || "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64) || "x";
}

// Cheap inline-markdown -> XHTML converter. Matches the patterns the web
// reader's `renderInlineMd` accepts: **bold**, __bold__, *italic*, _italic_,
// `code`, [label](url). Everything else is emitted as literal text.
const INLINE_RE = /(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(`[^`\n]+`)|(\[[^\]]+\]\([^)]+\))/g;
function inlineToXhtml(text: string): string {
  // Fresh RegExp per invocation — the recursive link-label branch would
  // otherwise clobber the shared /g regex's lastIndex and loop forever,
  // consuming unbounded heap on books that contain Markdown links.
  const re = new RegExp(INLINE_RE.source, 'g');
  const parts: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(xmlEscape(text.slice(last, m.index)));
    const tok = m[0];
    if (tok.startsWith("**") && tok.endsWith("**")) parts.push(`<strong>${xmlEscape(tok.slice(2, -2))}</strong>`);
    else if (tok.startsWith("__") && tok.endsWith("__")) parts.push(`<strong>${xmlEscape(tok.slice(2, -2))}</strong>`);
    else if (tok.startsWith("*") && tok.endsWith("*")) parts.push(`<em>${xmlEscape(tok.slice(1, -1))}</em>`);
    else if (tok.startsWith("_") && tok.endsWith("_")) parts.push(`<em>${xmlEscape(tok.slice(1, -1))}</em>`);
    else if (tok.startsWith("`") && tok.endsWith("`")) parts.push(`<code>${xmlEscape(tok.slice(1, -1))}</code>`);
    else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      if (lm) parts.push(`<a href="${xmlEscape(lm[2])}">${inlineToXhtml(lm[1])}</a>`);
      else parts.push(xmlEscape(tok));
    }
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(xmlEscape(text.slice(last)));
  return parts.join("");
}

type ParaTag = "h2" | "h3" | "h4" | "li-ul" | "li-ol" | "p";

// Walk paragraph chunks and produce XHTML. We intentionally don't try to be
// clever about lists spanning multiple paragraphs: each <li> lives in its
// own <ul>/<ol> block — readers render it identically and we avoid state
// across chunks.
function paragraphsToXhtml(chapterText: string): string {
  const chunks = chapterText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const out: string[] = [];
  for (const raw of chunks) {
    const h = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (h) {
      const level = Math.min(h[1].length + 1, 6); // Shift one down so chapter <h1> can be its title.
      const tag = `h${level}`;
      out.push(`<${tag}>${inlineToXhtml(h[2].trim())}</${tag}>`);
      continue;
    }
    const ul = /^[*\u2022\-]\s+(.*)$/.exec(raw);
    if (ul) {
      out.push(`<ul><li>${inlineToXhtml(ul[1].trim())}</li></ul>`);
      continue;
    }
    const ol = /^(\d+)[.)]\s+(.*)$/.exec(raw);
    if (ol) {
      out.push(`<ol><li>${inlineToXhtml(ol[2].trim())}</li></ol>`);
      continue;
    }
    out.push(`<p>${inlineToXhtml(raw)}</p>`);
  }
  return out.join("\n");
}

// Per-chapter XHTML document. EPUB3 requires polyglot XHTML (XML-valid HTML5).
function chapterXhtml(book: EpubBook, ch: EpubChapter): string {
  const title = ch.title?.trim() || `Chapter ${ch.idx + 1}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${xmlEscape(book.language || "en")}">
<head>
  <meta charset="utf-8" />
  <title>${xmlEscape(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
  <section epub:type="chapter" id="ch${ch.idx}">
    <h1 class="chapter-title">${xmlEscape(title)}</h1>
    ${paragraphsToXhtml(ch.text || "")}
  </section>
</body>
</html>`;
}

function stylesheet(): string {
  return `@namespace epub "http://www.idpf.org/2007/ops";
html { -webkit-hyphens: auto; hyphens: auto; }
body { font-family: "Charter", "Iowan Old Style", Georgia, serif; font-size: 1em; line-height: 1.55; margin: 0 1em; text-align: justify; }
h1.chapter-title { font-family: "Helvetica Neue", "Inter", sans-serif; font-weight: 600; font-size: 1.6em; margin: 2em 0 1em; text-align: left; page-break-before: always; }
h2 { font-size: 1.25em; margin: 1.5em 0 .4em; font-weight: 600; }
h3 { font-size: 1.1em; margin: 1.3em 0 .35em; font-weight: 600; }
h4 { font-size: 1em; margin: 1.2em 0 .3em; font-weight: 600; font-style: italic; }
p { margin: 0 0 0.6em; text-indent: 1.2em; }
p:first-of-type, h1 + p, h2 + p, h3 + p, h4 + p { text-indent: 0; }
ul, ol { margin: 0.5em 1.5em; }
li { margin: 0.2em 0; }
code { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: .92em; }
a { color: #7b3f21; text-decoration: underline; }
em { font-style: italic; }
strong { font-weight: 600; }
`;
}

function contentOpf(book: EpubBook): string {
  const id = safeId(book.id);
  const items = book.chapters.map((ch) =>
    `<item id="ch${ch.idx}" href="ch${ch.idx}.xhtml" media-type="application/xhtml+xml" />`
  ).join("\n    ");
  const spine = book.chapters.map((ch) => `<itemref idref="ch${ch.idx}" />`).join("\n    ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0" xml:lang="${xmlEscape(book.language || "en")}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:${id}</dc:identifier>
    <dc:title>${xmlEscape(book.title || "Untitled")}</dc:title>
    <dc:creator>${xmlEscape(book.author || "Unknown")}</dc:creator>
    <dc:language>${xmlEscape(book.language || "en")}</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="css" href="style.css" media-type="text/css" />
    ${items}
  </manifest>
  <spine>
    <itemref idref="nav" linear="no" />
    ${spine}
  </spine>
</package>`;
}

function navXhtml(book: EpubBook): string {
  const items = book.chapters.map((ch) => {
    const title = ch.title?.trim() || `Chapter ${ch.idx + 1}`;
    return `<li><a href="ch${ch.idx}.xhtml">${xmlEscape(title)}</a></li>`;
  }).join("\n      ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <meta charset="utf-8" />
  <title>Contents</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
      ${items}
    </ol>
  </nav>
</body>
</html>`;
}

function containerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`;
}

export async function buildEpub(book: EpubBook): Promise<Buffer> {
  const zip = new JSZip();
  // mimetype MUST be the first entry and stored uncompressed per EPUB spec.
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", containerXml(), { compression: "DEFLATE" });
  zip.file("OEBPS/content.opf", contentOpf(book), { compression: "DEFLATE" });
  zip.file("OEBPS/nav.xhtml", navXhtml(book), { compression: "DEFLATE" });
  zip.file("OEBPS/style.css", stylesheet(), { compression: "DEFLATE" });
  for (const ch of book.chapters) {
    zip.file(`OEBPS/ch${ch.idx}.xhtml`, chapterXhtml(book, ch), { compression: "DEFLATE" });
  }
  // Stream to a temp file so V8's old-space never holds the full zip at once.
  // For long books (28+ chapters of prose), generateAsync nodebuffer was
  // blowing past 2 GB heap and crashing the Node process mid-send.
  const tmp = pjoin(tmpdir(), `reader-epub-${book.id}-${randomBytes(4).toString("hex")}.epub`);
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(tmp);
    zip
      .generateNodeStream({ type: "nodebuffer", compression: "DEFLATE", streamFiles: true })
      .pipe(out)
      .on("finish", () => resolve())
      .on("error", reject);
    out.on("error", reject);
  });
  try {
    return await fsp.readFile(tmp);
  } finally {
    await fsp.unlink(tmp).catch(() => {});
  }
}
