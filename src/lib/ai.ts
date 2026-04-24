import { chatCompletion } from "shared-ai";

export async function cleanupChunk(rawText: string, hint: string): Promise<{ chapters: Array<{ title?: string; paragraphs: string[] }> }> {
  const key = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL_CLEANUP || "anthropic/claude-haiku-4.5";
  if (!key) throw new Error("OPENROUTER_API_KEY not set");

  const system = `You are a careful book typesetter. Given raw extracted text from a document, clean it and return STRICT JSON of shape:
{"chapters":[{"title":"optional string","paragraphs":["paragraph 1","paragraph 2"]}]}

Rules:
- Keep only: the book title (+ subtitle), the author, a TABLE OF CONTENTS / Índice / Sumário / Spis treści / Sommaire / Inhalt / Indice if present, a Prologue / Prólogo / Prólogo / Prologue / Prolog / Prologo / Prolog / Proloog (or Foreword / Preface / Introduction — the author's own front matter) if it's authored by the actual author of the book, and the main body (first Chapter / Capítulo / Capitolo / Chapitre / Kapitel / Rozdział / Hoofdstuk onward). DROP everything else regardless of the language it's written in: copyright page, ISBN block, dedication page if brief and boilerplate (<5 words), "also by the author" / "del mismo autor" / "do mesmo autor" / "du même auteur" / "vom selben Autor" / "dello stesso autore" lists, publisher address, Library of Congress / Biblioteca Nacional cataloging, printing history, endorsements / reseñas from other authors, epigraphs from *other* works' front matter, translator's notes unless substantive, "About the Publisher" / "Sobre el editor" / "Sobre o editor", marketing copy, preview chapters of other books, back-cover blurbs.
- Keep the Table of Contents (Índice / Sumário / Spis treści / Sommaire / Inhalt / Indice / Inhoudsopgave) as a single paragraph or a list, intact, as a chapter titled "Contents" (always in English regardless of source language — the Reader UI keys on that title). If present.
- Remove running headers, footers, page numbers, and copyright boilerplate.
- Merge hyphenated line-breaks (e.g. "exam-\\nple" -> "example").
- Join lines that belong to the same paragraph; keep paragraph breaks.
- Detect chapter starts from clear cues IN THE BOOK'S OWN LANGUAGE and use them as chapters. Recognise at minimum:
    * English: "Chapter 1", "CHAPTER I", "Prologue", "Preface", "Foreword", "Introduction", "Epilogue", "Part One".
    * Spanish: "Capítulo 1", "CAPÍTULO I", "Prólogo", "Prefacio", "Introducción", "Epílogo", "Parte Primera", "Parte I".
    * Portuguese: "Capítulo 1", "Prólogo", "Prefácio", "Introdução", "Epílogo", "Parte Um".
    * French: "Chapitre 1", "CHAPITRE I", "Prologue", "Préface", "Avant-propos", "Introduction", "Épilogue", "Première partie".
    * German: "Kapitel 1", "KAPITEL I", "Prolog", "Vorwort", "Einleitung", "Einführung", "Nachwort", "Epilog", "Erster Teil".
    * Italian: "Capitolo 1", "CAPITOLO I", "Prologo", "Prefazione", "Introduzione", "Epilogo", "Parte prima".
    * Polish: "Rozdział 1", "ROZDZIAŁ I", "Prolog", "Przedmowa", "Wstęp", "Wprowadzenie", "Epilog", "Część pierwsza".
    * Dutch: "Hoofdstuk 1", "Proloog", "Voorwoord", "Inleiding", "Epiloog", "Deel één".
    * Generic: a standalone centered bold heading, a numeric section (I. II. III.) on its own line, or a line consisting of just a Roman numeral / an Arabic numeral / a chapter-sized decorative glyph.
  Always preserve the chapter heading in the title field USING THE BOOK'S ORIGINAL LANGUAGE AND CAPITALISATION. Do not translate "Capítulo 3" to "Chapter 3".
  If no chapters are detected, put everything in one chapter with no title.
- PRESERVE STRUCTURE using a minimal Markdown subset inside paragraph strings. This is mandatory for any heading visible in the source — do not flatten visual hierarchy into plain prose.
    * A section heading inside a chapter → start the paragraph with "## " (e.g. "## Part One: Awakening").
    * A sub-heading → "### "; a minor label → "#### ".
    * A bulleted list item → "- " at the very start of the paragraph.
    * A numbered list item → "1. " / "2. " at the very start.
    * Emphasis → wrap in **bold** or *italics* when the source was clearly bold/italic.
  One structural element per paragraph string. Plain prose paragraphs have NO leading marker.
  Do not add headings the source doesn't have; only promote existing visual cues (ALL-CAPS lines, centered bold, larger type) to the appropriate level.
  EXAMPLE — if the source chapter "Chapter 3: Hunger" contains a "The Brain on Food" section and a "Key takeaways" subsection with bullets, return:
    {"title":"Chapter 3: Hunger","paragraphs":["## The Brain on Food","When we eat...","### Key takeaways","- Dopamine rises before the bite.","- Satiety lags eight minutes."]}
- RESTORE CONTRACTION APOSTROPHES that were dropped by PDF extraction: "didn t" -> "didn't", "weren t" -> "weren't", "I m" -> "I'm", "it s" -> "it's", "you re" -> "you're", "we ve" -> "we've", etc. Use a typographic apostrophe (\u2019).
- RESTORE POSSESSIVES: "the ship s" -> "the ship's", "it s own" -> "its own" (when possessive, not contraction).
- RESTORE QUOTES that were dropped (pairs of "), leaving plain quotes where ambiguous.
- Collapse multiple spaces to one; fix " ." / " ," to ". " / ", " spacing.
- Drop orphan single-letter accented symbols on their own line (often PDF ligature glitches like "\u00D3\u00D3").
- Fix obvious OCR artefacts (e.g. "rn" -> "m" only when unambiguous) but do NOT rewrite prose.
- Preserve original language. Do not translate.
- Return ONLY JSON, no prose, no markdown fences.`;

  const user = `Hint: ${hint}\n\nRAW TEXT:\n${rawText}`;

  const { content } = await chatCompletion({
    apiKey: key,
    model,
    temperature: 0.1,
    responseFormat: { type: "json_object" },
    appName: "Reader",
    referer: process.env.OPENROUTER_REFERER || "",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  const fallback = { chapters: [{ paragraphs: splitParagraphs(rawText) }] };
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.chapters)) return fallback;
    // Validate shape: each chapter must have a paragraphs array of strings; drop bad entries.
    const chapters: Array<{ title?: string; paragraphs: string[] }> = [];
    for (const ch of parsed.chapters) {
      if (!ch || typeof ch !== "object" || !Array.isArray(ch.paragraphs)) continue;
      const paragraphs = ch.paragraphs.filter((p: unknown): p is string => typeof p === "string");
      if (!paragraphs.length) continue;
      chapters.push(typeof ch.title === "string" ? { title: ch.title, paragraphs } : { paragraphs });
    }
    return chapters.length ? { chapters } : fallback;
  } catch {
    return fallback;
  }
}

export function splitParagraphs(text: string): string[] {
  return text.split(/\n{2,}/).map(p => p.replace(/\s+/g, " ").trim()).filter(Boolean);
}

export function countWords(text: string): number {
  return (text.match(/\S+/g) || []).length;
}

// Deterministic cleanup for common PDF extraction artefacts before/after AI pass.
export function normalizeText(text: string): string {
  let t = text;
  // Strip zero-width + BOM + soft hyphen + replacement char + misc control chars
  t = t.replace(/[\u200B-\u200F\uFEFF\u00AD\uFFFD\u0000-\u0008\u000B-\u001F]/g, "");
  // Expand Latin typography ligatures that pdf-parse passes through literally.
  // These glue words together in the extracted text ("ﬁrst" stays "ﬁrst" and
  // word-level regexes miss it) so expanding restores plain ASCII.
  t = t
    .replace(/\uFB00/g, "ff")
    .replace(/\uFB01/g, "fi")
    .replace(/\uFB02/g, "fl")
    .replace(/\uFB03/g, "ffi")
    .replace(/\uFB04/g, "ffl")
    .replace(/\uFB05/g, "st")
    .replace(/\uFB06/g, "st");
  // Non-breaking / narrow / figure / em/en / ideographic spaces → regular space
  t = t.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");
  // Join hyphen-at-line-end that survived pdf-parse (common in two-column PDFs).
  t = t.replace(/([A-Za-zÀ-ÖØ-öø-ÿ])-\n([a-zà-öø-ÿ])/g, "$1$2");
  // Fix broken contractions: "didn t" -> "didn't", etc.
  const neg = "didn|isn|wasn|weren|haven|hasn|hadn|doesn|don|couldn|wouldn|shouldn|won|aren|mustn|needn|shan|mightn|oughtn";
  t = t.replace(new RegExp(`\\b(${neg})\\s+t\\b`, "gi"), "$1\u2019t");
  // "I m", "I ll", "I ve", "I d"
  t = t.replace(/\b(I|you|we|they|You|We|They)\s+(ll|ve|re|d|m)\b/g, "$1\u2019$2");
  t = t.replace(/\b(he|she|it|He|She|It)\s+(s|d|ll)\b/g, "$1\u2019$2");
  t = t.replace(/\b(that|That|there|There|here|Here|what|What|who|Who|how|How|where|Where|when|When|why|Why|this|This|now|Now|let|Let|its|Its)\s+s\b/g, "$1\u2019s");
  // "it s" as standalone low-case
  t = t.replace(/\b(it|It)\s+(s|d|ll)\b/g, "$1\u2019$2");
  // Fix broken quotes where text has curly artifacts dropped
  t = t.replace(/\s+([,.;:!?])/g, "$1");
  // Fix duplicated punctuation runs from OCR noise (",." or ".,")
  t = t.replace(/([,.;:!?]){2,}/g, "$1");
  // Join hyphenated line breaks already removed earlier, but collapse stray double-space runs
  t = t.replace(/[ \t]{2,}/g, " ");
  // Normalize dash styles: "--", en-dash, em-dash → single "-" (spaces preserved).
  t = t.replace(/-{2,}/g, "-").replace(/[\u2013\u2014]/g, "-");
  // Remove orphan "Ó" / random diacritics not adjacent to letters (common OCR junk on page bullets)
  t = t.replace(/(^|\n)\s*[\u00C0-\u00FF\u0100-\u024F]{1,3}\s*(\n|$)/g, "$1$2");
  // Strip lines that are just page numbers (pdf-parse often preserves them).
  t = t.replace(/(^|\n)\s*\d{1,4}\s*(\n|$)/g, "$1$2");
  // Collapse 3+ consecutive newlines to a double break.
  t = t.replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

// Drop boilerplate paragraphs (copyright pages, ISBN blocks, frontmatter junk).
export function isBoilerplateParagraph(p: string): boolean {
  const t = p.trim();
  if (!t) return true;
  if (t.length < 350 && /\bcopyright\b|©|\(c\)\s*\d{4}|all rights reserved|todos los derechos reservados|todos os direitos reservados|tous droits réservés|alle rechte vorbehalten|tutti i diritti riservati|wszelkie prawa zastrzeżone|alle rechten voorbehouden|no part of this (book|publication)|ninguna parte de (este|esta) (libro|publicación|obra)|nenhuma parte (deste|desta) (livro|publicação|obra)|aucune partie de ce(tte)? (livre|publication|œuvre)|kein teil dieses (buches|werkes)|nessuna parte di questa (pubblicazione|opera)|żadna część tej (książki|publikacji)|printed in (the )?(united states|great britain|usa|u\.s\.a)|impreso en|impresso em|imprimé en|gedruckt in|stampato in|wydrukowano w|first published|isbn[- ]?1?0?[:]?\s*\d|library of congress cataloging|a cip catalog|manufactured in|cataloging-in-publication|cataloguing-in-publication|publisher'?s note|published by|a division of|penguin books|random house|harpercollins|simon\s*&?\s*schuster|printed and bound|typeset in|typeset by|set in \w+ type|printing\s*:?\s*\d+\s*\d+\s*\d+|this book is a work of (non)?fiction|\bp\.\s*cm\b|printing history|distributed by|reprinted by arrangement|electronic edition/i.test(t)) return true;
  // ALL CAPS boilerplate line (common for trademark/legal)
  if (t === t.toUpperCase() && t.length < 200 && /ALL RIGHTS RESERVED|TODOS LOS DERECHOS RESERVADOS|TODOS OS DIREITOS RESERVADOS|TOUS DROITS RÉSERVÉS|ALLE RECHTE VORBEHALTEN|TUTTI I DIRITTI RISERVATI|WSZELKIE PRAWA ZASTRZEŻONE|COPYRIGHT|TRADEMARK|PUBLISHED|PRINTED|FIRST EDITION|PRIMERA EDICIÓN|PREMIÈRE ÉDITION|ERSTAUSGABE/.test(t)) return true;
  // Lone ISBN
  if (/^\s*isbn[- ]?1?[03]?:?\s*[\d\- Xx]+\s*$/i.test(t)) return true;
  // Printing line like "10 9 8 7 6 5 4 3 2 1"
  if (/^(\s*\d+\s*){5,}$/.test(t)) return true;
  return false;
}

export function dropBoilerplate(paragraphs: string[]): string[] {
  return paragraphs.filter((p) => !isBoilerplateParagraph(p));
}

// Chapter-level copyright detection: drops the whole chapter if its title
// or its body is dominated by copyright/legal/front-matter content.
export function isCopyrightChapter(ch: { title?: string; paragraphs: string[] }): boolean {
  const title = (ch.title || "").toLowerCase();
  if (/copyright|derechos (reservados|de autor)|direitos (reservados|autorais)|tous droits réservés|urheberrecht|diritti (riservati|d.autore)|wszelkie prawa zastrzeżone|alle rechten voorbehouden|colophon|legal notice|aviso legal|impressum|imprint|pie de imprenta|publisher.{0,3}note|nota del editor|nota do editor|note de l.éditeur|cataloging|cataloguing|publication data|edition notice|créditos|créditos editoriais/.test(title)) return true;
  const paras = ch.paragraphs || [];
  if (!paras.length) return false;
  // Total chars > 4000 implies real chapter — keep
  const totalChars = paras.reduce((s, p) => s + p.length, 0);
  if (totalChars > 4000) return false;
  // Count paragraphs flagged as boilerplate; if ≥60% of them OR ≥4 hits, drop
  let hits = 0;
  for (const p of paras) if (isBoilerplateParagraph(p)) hits++;
  if (hits >= 4) return true;
  if (hits / paras.length >= 0.6) return true;
  // Strong single-paragraph signal: lone copyright line
  if (paras.length <= 3 && /\bcopyright\b|©|all rights reserved|isbn[- ]?[0-9]/i.test(paras.join(" "))) return true;
  return false;
}

export function dropCopyrightChapters<T extends { title?: string; paragraphs: string[] }>(chapters: T[]): T[] {
  return chapters.filter((c) => !isCopyrightChapter(c));
}


// ---------- Front-matter rebuild (title page / summary / TOC) ----------

/**
 * Drop any residual front-matter chapters the cleanup AI may have kept
 * (title/cover/half-title pages, any existing TOC). We rebuild these
 * deterministically after extraction so every book has the same shape.
 */
export function dropExistingFrontMatter<T extends { title?: string; paragraphs: string[] }>(chapters: T[]): T[] {
  return chapters.filter((c) => {
    const title = (c.title || "").toLowerCase().trim();
    // Contents in many languages. Kept deliberately exact so prose like
    // "brief contents" survives; only standalone TOC titles match.
    if (/^(table of )?contents?$|^índice$|^índice general$|^sumário$|^sumario$|^spis treści$|^sommaire$|^inhalt(sverzeichnis)?$|^inhoudsopgave$|^indice$/.test(title)) return false;
    if (/^(title page|cover|half[- ]title|frontispiece|bastard title|title|cubierta|portada|portadilla|couverture|umschlag|copertina|okładka|cobertura|kaft)$/.test(title)) return false;
    if (/^(dedication|dedicatoria|dédicace|widmung|dedica|dedykacja|dedicatória|opdracht|epigraph|epígrafe|exergue|epigraf|epigraaf|acknowledg(e)?ments?|agradecimientos|agradecimentos|remerciements|danksagung|ringraziamenti|podziękowania|dankwoord|about the (author|translator)|sobre el (autor|traductor)|sobre o (autor|tradutor)|à propos de l.auteur|über den autor|sull.autore|o autorze|over de auteur|also by |del mismo autor|do mesmo autor|du même auteur|vom selben autor|dello stesso autore)/i.test(title)) return false;
    const body = c.paragraphs.join(" ").trim();
    // Tiny chapter whose title is mostly the book itself or front-matter noise
    if (body.length < 200 && /title|cover|dedication|epigraph|cubierta|portada|portadilla|dedicatoria|dedicatória|couverture|umschlag|widmung|dedica|dedika|epígrafe|epigraf/i.test(title)) return false;
    return true;
  });
}

export function buildTitleChapter(title: string, author?: string | null): { title: string; paragraphs: string[] } {
  const paragraphs: string[] = [title.trim()];
  if (author && author.trim()) paragraphs.push(`by ${author.trim()}`);
  return { title: "Title", paragraphs };
}

/**
 * Build a synthetic "Contents" chapter whose single paragraph lists
 * real chapter titles, one per line. The Reader UI already treats any
 * chapter titled /^(table of )?contents?$/i as a clickable TOC that
 * splits on newlines and links each entry to the matching chapter.
 */
export function buildTocChapter(
  bodyChapters: Array<{ title?: string }>
): { title: string; paragraphs: string[] } | null {
  const titles = bodyChapters
    .map((c) => (c.title || "").trim())
    .filter((t) => t.length > 0 && !/^(title|contents|summary|índice|índice general|sumário|sumario|spis treści|sommaire|inhalt|inhaltsverzeichnis|inhoudsopgave|indice|titre|título|titolo|tytuł|titel|resumen|resumo|résumé|zusammenfassung|riassunto|streszczenie|samenvatting)$/i.test(t));
  if (titles.length < 2) return null;
  return { title: "Contents", paragraphs: [titles.join("\n")] };
}

/**
 * One OpenRouter call that reads a digest of the whole book and returns
 * a compact, spoiler-light summary suitable as an opening "Summary" chapter.
 * Returns null on failure — ingest continues without a summary chapter.
 */
export async function summarizeBook(args: {
  title?: string;
  author?: string;
  chapters: Array<{ title?: string; paragraphs: string[] }>;
}): Promise<{ title: string; paragraphs: string[] } | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  const model =
    process.env.OPENROUTER_MODEL_SUMMARY ||
    process.env.OPENROUTER_MODEL_CLEANUP ||
    "anthropic/claude-haiku-4.5";

  const MAX_TOTAL = 64000;
  const MAX_PER_CH = 8000;
  const parts: string[] = [];
  let used = 0;
  for (const c of args.chapters) {
    if (used >= MAX_TOTAL) break;
    const head = c.paragraphs.join("\n\n").slice(0, MAX_PER_CH);
    const slab = (c.title ? `\n\n## ${c.title}\n\n` : "\n\n") + head;
    const take = Math.min(slab.length, MAX_TOTAL - used);
    parts.push(slab.slice(0, take));
    used += take;
  }
  const digest = parts.join("").trim();
  if (!digest) return null;

  const system = `You summarize books for a reader who wants a clear preview before diving in.
Write a concise, well-structured summary of the whole book:
- Begin with a 1-2 sentence overview (what the book is, genre, scope).
- Follow with 5-10 sentences covering: the central argument or plot, the main characters or concepts, key takeaways, and the tone.
- Do NOT include spoilers for fiction beyond what back-cover copy would reveal.
- Plain paragraphs only. No bullet lists, no headings, no markdown. Keep it under 500 words.
- Preserve the book's language.`;

  const user = `Title: ${args.title || "(unknown)"}\nAuthor: ${args.author || "(unknown)"}\n\nBOOK DIGEST:\n${digest}`;

  try {
    const { content: raw } = await chatCompletion({
      apiKey: key,
      model,
      temperature: 0.3,
      appName: "Reader",
      referer: process.env.OPENROUTER_REFERER || "",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const content = (raw || "").trim();
    if (!content) return null;
    let paragraphs = content
      .split(/\n{2,}/)
      .map((p: string) => p.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    // Drop redundant leading Markdown heading(s) — the chapter title already says "Summary".
    while (paragraphs.length && /^#{1,6}\s+/.test(paragraphs[0])) paragraphs = paragraphs.slice(1);
    if (!paragraphs.length) return null;
    return { title: "Summary", paragraphs };
  } catch {
    return null;
  }
}


// ---------- Post-cleanup deterministic artifact fixes ----------

// Chapter-heading words that commonly survive as body lines when the AI
// cleanup pass fails to promote them to `title` (all lowercase; accents
// match what we see in real books).
const HEADING_WORD_RE = /^(?:preface|prefacio|prefácio|préface|przedmowa|prefazione|vorwort|voorwoord|prologue|prolog|prólogo|prologo|proloog|foreword|avant-propos|introduction|introducción|introdução|introduzione|einleitung|einführung|inleiding|wst(?:ęp|ep)|wprowadzenie|epilogue|épilogue|epílogo|epilog|epilogo|epiloog|afterword|nachwort|postscript|postscriptum|dedication|dedicatoria|dedicatória|dédicace|widmung|dedica|dedykacja|opdracht|epigraph|epígrafe|exergue|epigraf|epigraaf|appendix|anexo|apéndice|appendice|anhang|załącznik|bijlage|acknowledg(?:e)?ments?|agradecimientos|agradecimentos|remerciements|danksagung|ringraziamenti|podziękowania|dankwoord|chapter\s+[\w.]+|capítulo\s+[\w.]+|capitolo\s+[\w.]+|chapitre\s+[\w.]+|kapitel\s+[\w.]+|rozdział\s+[\w.]+|hoofdstuk\s+[\w.]+|part\s+[\w.]+|parte\s+[\w.]+|partie\s+[\w.]+|teil\s+[\w.]+|część\s+[\w.]+|deel\s+[\w.]+)(?:\s*[:.\-–—]\s*.{1,60})?[.]?$/i;

function stripMarkdownHeadingTokens(s: string): string {
  return s.replace(/^\s*#{1,6}\s+/, "").replace(/^[*_]+|[*_]+$/g, "").trim();
}

function normTitleKey(s: string): string {
  return s.toLowerCase().replace(/[\s.,;:!?—–\-]+/g, " ").trim();
}

/**
 * Drop the first body paragraph when it just echoes the chapter title.
 * pdf-parse keeps the heading line in the body, and AI cleanup often
 * preserves it verbatim alongside moving it to `title` — leaving the
 * reader staring at "Chapter Three" immediately followed by "Chapter Three".
 */
export function stripTitleEcho<T extends { title?: string; paragraphs: string[] }>(chapters: T[]): T[] {
  return chapters.map((ch) => {
    if (!ch.title || !ch.paragraphs.length) return ch;
    const titleKey = normTitleKey(ch.title);
    if (!titleKey) return ch;
    const firstKey = normTitleKey(stripMarkdownHeadingTokens(ch.paragraphs[0]));
    if (firstKey === titleKey) {
      return { ...ch, paragraphs: ch.paragraphs.slice(1) };
    }
    return ch;
  });
}

/**
 * When a chapter has no title but its first paragraph is a short line
 * matching a common heading word (PREFACE, Epilogue, Rozdział 1, …),
 * promote that line to the title so the Reader TOC has something to
 * show and jump to.
 */
export function promoteOrphanHeadings<T extends { title?: string; paragraphs: string[] }>(chapters: T[]): T[] {
  return chapters.map((ch) => {
    if ((ch.title && ch.title.trim()) || !ch.paragraphs.length) return ch;
    const first = stripMarkdownHeadingTokens(ch.paragraphs[0]);
    if (!first || first.length > 80) return ch;
    // Skip prose — real sentences usually end in sentence punctuation or
    // contain mid-line periods (headings rarely do).
    if (/[!?]$/.test(first)) return ch;
    if (/[.][^.]{3,}[.]/.test(first)) return ch;
    if (!HEADING_WORD_RE.test(first)) return ch;
    return { ...ch, title: first, paragraphs: ch.paragraphs.slice(1) };
  });
}

/**
 * Drop any chapter whose body is a bare list of TOC entries, OR whose
 * title matches standalone-TOC names. We synthesise a Contents chapter
 * from real chapter titles, so any residual copy is a duplicate.
 */
export function dropDuplicateToc<T extends { title?: string; paragraphs: string[] }>(chapters: T[]): T[] {
  return chapters.filter((ch) => {
    const t = (ch.title || "").toLowerCase().trim();
    if (/^(table of )?contents?$|^índice(\s+general)?$|^sumário$|^sumario$|^spis treści$|^sommaire$|^inhalt(sverzeichnis)?$|^inhoudsopgave$|^indice$/.test(t)) return false;
    if (ch.paragraphs.length >= 4) {
      const tocLike = ch.paragraphs.filter((p) =>
        /^(?:chapter|capítulo|capitolo|chapitre|kapitel|rozdział|hoofdstuk|part|parte|partie|teil|część|deel)\s+[\w.]+|^[IVXLCM]+\.|^\d+\.\s+\S/i.test(p.trim())
      ).length;
      if (tocLike / ch.paragraphs.length >= 0.75) return false;
    }
    return true;
  });
}

/**
 * Standalone image-caption chapters — EPUB often emits a chapter per
 * image page (frontispiece, plates, figure captions) which we have no
 * image to show and whose single line "Frontispiece of …" just reads
 * as a broken entry in the TOC. Drop tiny, untitled chapters whose
 * content is image-caption-shaped.
 */
export function dropImageCaptionChapter<T extends { title?: string; paragraphs: string[] }>(chapters: T[]): T[] {
  const CAPTION = /^(frontispiece|illustration|figure|fig\.|plate|photo(graph)?|image|map|diagram|portada|ilustración|lámina|figura|figuur|abbildung|tafel|ilustracja|rycina|mapa|tabela|tabla|tableau|tabelle)\b/i;
  return chapters.filter((ch) => {
    const title = (ch.title || "").trim();
    const totalWords = ch.paragraphs.reduce((s, p) => s + (p.match(/\S+/g) || []).length, 0);
    if (totalWords > 25) return true;
    const blob = ch.paragraphs.join(" ").trim();
    if (title && CAPTION.test(title)) return false;
    if (!title && CAPTION.test(blob)) return false;
    // Untitled + very short (≤ 15 words) is almost always junk (plate list,
    // single caption, orphan page number). Keep if it contains a heading
    // marker (ALL CAPS line, or matches HEADING_WORD_RE) — those are real
    // front/back-matter that promoteOrphanHeadings may have already claimed.
    if (!title && totalWords <= 15 && !HEADING_WORD_RE.test(blob)) return false;
    return true;
  });
}

/**
 * Short chapters whose content is just a publisher imprint + city
 * (Carroll & Graf / NEW YORK, Penguin Random House / London, …) are
 * title-page-verso junk that slipped past dropCopyrightChapters.
 */
export function dropPublisherPage<T extends { title?: string; paragraphs: string[] }>(chapters: T[]): T[] {
  const PUB = /penguin|random\s*house|harpercollins|simon\s*&?\s*schuster|doubleday|knopf|farrar\s*,?\s*straus|carroll\s*&\s*graf|vintage|anchor\s*books|bloomsbury|macmillan|norton|oxford\s+university\s+press|cambridge\s+university\s+press|yale\s+university\s+press|university\s+press|little\s*,?\s*brown|houghton\s*mifflin|scribner|basic\s*books|riverhead|viking|crown|putnam|ballantine|bantam|plume|grove\s*press|picador|henry\s+holt|w\.?\s*w\.?\s*norton|pan\s+macmillan|hodder|faber|editorial|ediciones|editora|editore|editori|verlag|wydawnictwo|uitgeverij|gallimard|flammarion|seuil|grasset|actes\s+sud|planeta|anagrama|alfaguara|tusquets|debate|companhia\s+das\s+letras|record|nova\s+fronteira|einaudi|mondadori|feltrinelli|rizzoli|suhrkamp|fischer|rowohlt|piper|hanser|znak|czytelnik|pwn|prószyński|agora/i;
  const CITY = /\b(new\s*york|london|boston|chicago|san\s*francisco|los\s*angeles|toronto|paris|berlin|m[uü]nchen|milano|roma|madrid|barcelona|lisboa|amsterdam|warszawa|krak[oó]w|moskwa)\b/i;
  return chapters.filter((ch) => {
    const totalChars = ch.paragraphs.reduce((s, p) => s + p.length, 0);
    if (totalChars > 600) return true;
    const blob = ch.paragraphs.join(" ");
    if (PUB.test(blob) && CITY.test(blob)) return false;
    // Bare "publisher + maybe city + year + edition" short block
    if (totalChars < 400 && (PUB.test(blob) || /first\s+edition|primera\s+edici[oó]n|premi[eè]re\s+[eé]dition|erstausgabe|prima\s+edizione/i.test(blob))) return false;
    return true;
  });
}

/**
 * Many EPUBs emit each chapter as two (or more) spine items: a short
 * "Chapter N: Subtitle" title page, followed by an untitled XHTML file
 * with the actual body text. The extractor sees these as separate
 * chapters and the TOC ends up with short titled stubs + huge untitled
 * bodies ("Chapter 4 — 5 min" / "Chapter 9 — 86 min"). Merge the pair.
 */
export function mergeTitleStubsWithBodies<T extends { title?: string; paragraphs: string[] }>(chapters: T[]): T[] {
  const wordsOf = (ch: T) => ch.paragraphs.reduce((s, p) => s + (p.match(/\S+/g) || []).length, 0);
  const out: T[] = [];
  let i = 0;
  while (i < chapters.length) {
    const cur = chapters[i];
    const next = i + 1 < chapters.length ? chapters[i + 1] : undefined;
    const curTitle = (cur.title || "").trim();
    const nextTitle = (next && next.title ? next.title : "").trim();
    const curIsTitledStub =
      curTitle.length > 0 &&
      (HEADING_WORD_RE.test(curTitle) || /^\s*\d+\s*[.:\-–—]/.test(curTitle)) &&
      wordsOf(cur) < 200;
    const nextIsUntitledBody = !!next && nextTitle.length === 0 && wordsOf(next) >= 400;
    if (curIsTitledStub && nextIsUntitledBody) {
      out.push({ ...cur, paragraphs: [...cur.paragraphs, ...next!.paragraphs] });
      i += 2;
      continue;
    }
    out.push(cur);
    i += 1;
  }
  return out;
}

// ---------- AI structural analysis (the "understanding" pass) ----------

type StructuralAction = "keep" | "drop" | "merge_next" | "merge_prev" | "promote_first";
type StructuralDecision = { action: StructuralAction; title?: string };

/**
 * One OpenRouter call that looks at the raw chapter list coming out of the
 * extractor and tags each entry with a structural decision. Unlike the
 * regex-based heuristics (which handle obvious cases and fail on creative
 * EPUB structures) this pass lets the model actually read the previews and
 * decide what's a chapter, what's a title stub, what's junk.
 *
 * Returns null on any failure — caller must fall back to deterministic rules.
 */
async function aiStructuralChunk(
  args: {
    title: string;
    author?: string | null;
    chapters: Array<{ title?: string; paragraphs: string[] }>;
    offset: number;
    totalCount: number;
    perChapterWords: number;
  }
): Promise<Map<number, StructuralDecision> | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  const model =
    process.env.OPENROUTER_MODEL_POLISH ||
    process.env.OPENROUTER_MODEL_CLEANUP ||
    "google/gemini-2.5-flash";

  const previews = args.chapters.map((c, i) => {
    const words = c.paragraphs.reduce((s, p) => s + (p.match(/\S+/g) || []).length, 0);
    const body = c.paragraphs.join(" ").replace(/\s+/g, " ").trim();
    const head = body.split(" ").slice(0, args.perChapterWords).join(" ");
    return { idx: args.offset + i, title: (c.title || "").trim(), wordCount: words, preview: head };
  });

  const system = `You analyse a book's raw chapter list (extracted from EPUB spine / PDF text) and decide the structural role of each entry. The book is likely in English, Polish or Spanish — preserve the source language in any titles you emit.

For every chapter, return one decision object { "idx": <n>, "action": <one of keep|drop|merge_next|merge_prev|promote_first>, "title": <optional corrected title> }:

- "keep" — a genuine chapter. If the existing title is missing, wrong, or concatenates a chapter + sub-heading with " • ", supply a cleaner "title".
- "drop" — junk that should not appear in the final TOC. Drop: image captions ("Frontispiece of …", "Figure 3", "Ilustración"), publisher imprints ("Penguin / New York", "Wydawnictwo X"), pure copyright / ISBN pages, duplicated tables of contents, blank pages, book-editorial notes like "Karta redakcyjna".
- "merge_next" — this entry is a short "chapter title page" (the heading plus maybe an epigraph) and its actual body is the next entry. Provide the canonical "title" for the merged chapter. Typical signature: wordCount under ~200, title like "Chapter 3" / "Rozdział 3" / "Capítulo 3", followed by an untitled multi-thousand-word body.
- "merge_prev" — this entry is a continuation of the previous chapter that got split by the extractor. No title or a noise title.
- "promote_first" — the entry has no title and its first paragraph is the actual heading (PREFACE, Prólogo, Wstęp, Epilogue, Acknowledgments, etc.). Provide that heading as "title".

Guardrails:
- Return EXACTLY one decision per input chapter, in the same order, preserving the original idx values.
- Never translate titles — keep Polish titles Polish, Spanish Spanish, English English.
- For a "Chapter N" title stub followed by an untitled body, the stub gets "merge_next" and the body gets "keep". Titles survive from the stub.
- If unsure, prefer "keep" and leave the title unchanged — but if the existing title is empty or noise (e.g. a filename fragment), infer one from the preview.
- Output STRICT JSON: {"decisions":[{"idx":0,"action":"keep","title":"..."}, ...]}. No prose, no markdown.`;

  const user = `Title: ${args.title || "(unknown)"}\nAuthor: ${args.author || "(unknown)"}\nTotal chapter count: ${args.totalCount}\nThis batch covers idx ${args.offset}..${args.offset + args.chapters.length - 1}\n\nCHAPTERS:\n${JSON.stringify(previews)}`;

  try {
    const { content } = await chatCompletion({
      apiKey: key,
      model,
      temperature: 0,
      responseFormat: { type: "json_object" },
      appName: "Reader",
      referer: process.env.OPENROUTER_REFERER || "",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const parsed = JSON.parse(content);
    if (!parsed || !Array.isArray(parsed.decisions)) return null;
    const valid: StructuralAction[] = ["keep", "drop", "merge_next", "merge_prev", "promote_first"];
    const out = new Map<number, StructuralDecision>();
    for (const d of parsed.decisions) {
      if (!d || typeof d.idx !== "number") continue;
      if (!valid.includes(d.action)) continue;
      const title = typeof d.title === "string" && d.title.trim() ? d.title.trim() : undefined;
      out.set(d.idx, { action: d.action as StructuralAction, title });
    }
    return out;
  } catch {
    return null;
  }
}

export async function aiStructuralAnalysis(args: {
  title: string;
  author?: string | null;
  chapters: Array<{ title?: string; paragraphs: string[] }>;
}): Promise<StructuralDecision[] | null> {
  const n = args.chapters.length;
  if (n === 0) return [];
  // Batch analysis for very long books so the model never runs out of
  // output tokens before it reaches the final chapters. 40 entries per
  // call keeps each request ~4-6k tokens on both sides.
  const BATCH = 40;
  const perChapterWords = n <= 40 ? 180 : n <= 120 ? 110 : 80;
  const overall = new Map<number, StructuralDecision>();
  for (let offset = 0; offset < n; offset += BATCH) {
    const slice = args.chapters.slice(offset, Math.min(offset + BATCH, n));
    const got = await aiStructuralChunk({
      title: args.title,
      author: args.author,
      chapters: slice,
      offset,
      totalCount: n,
      perChapterWords,
    });
    if (!got) continue;
    for (const [idx, dec] of got) overall.set(idx, dec);
  }
  if (overall.size === 0) return null;
  const out: StructuralDecision[] = [];
  for (let i = 0; i < n; i++) {
    const d = overall.get(i);
    out.push(d || { action: "keep", title: undefined });
  }
  return out;
}

export function applyStructuralDecisions<T extends { title?: string; paragraphs: string[] }>(
  chapters: T[],
  decisions: StructuralDecision[]
): T[] {
  const out: T[] = [];
  let pending: T | null = null; // carried from merge_next
  for (let i = 0; i < chapters.length; i++) {
    const d = decisions[i] || { action: "keep" };
    let cur: T = chapters[i];
    if (d.action === "drop") continue;
    if (d.action === "promote_first" && cur.paragraphs.length > 0) {
      const newTitle = d.title || stripMarkdownHeadingTokens(cur.paragraphs[0]);
      cur = { ...cur, title: newTitle, paragraphs: cur.paragraphs.slice(1) };
    } else if (d.title && (d.action === "keep" || d.action === "merge_next")) {
      cur = { ...cur, title: d.title };
    }
    if (d.action === "merge_next") {
      pending = pending
        ? ({ ...pending, paragraphs: [...pending.paragraphs, ...cur.paragraphs] } as T)
        : cur;
      continue;
    }
    if (pending) {
      cur = { ...pending, paragraphs: [...pending.paragraphs, ...cur.paragraphs], title: pending.title || cur.title } as T;
      pending = null;
    }
    if (d.action === "merge_prev" && out.length > 0) {
      const last = out[out.length - 1];
      out[out.length - 1] = { ...last, paragraphs: [...last.paragraphs, ...cur.paragraphs] } as T;
      continue;
    }
    out.push(cur);
  }
  if (pending) out.push(pending);
  return out.filter((c) => c.paragraphs.length > 0);
}

export async function rebuildWithFrontMatter(args: {
  title: string;
  author?: string | null;
  chapters: Array<{ title?: string; paragraphs: string[] }>;
}): Promise<Array<{ title?: string; paragraphs: string[] }>> {
  let body = dropExistingFrontMatter(args.chapters);

  // "Understanding" pass — let the LLM classify each chapter before we
  // apply any regex-based surgery. Falls back to deterministic rules if
  // the model is unavailable or returns garbage.
  const decisions = await aiStructuralAnalysis({
    title: args.title,
    author: args.author || undefined,
    chapters: body,
  }).catch(() => null);
  if (decisions && decisions.length === body.length) {
    body = applyStructuralDecisions(body, decisions);
    console.log(`[Reader] ingest: AI structural pass applied ${decisions.length} decisions`);
  } else {
    console.log(`[Reader] ingest: AI structural pass unavailable, using deterministic fallback`);
  }
  // Always run deterministic cleanup after AI — the model handles common
  // cases but can miss tail-of-book sections in long books. Heuristics
  // fill those gaps safely (idempotent on already-clean chapters).
  body = promoteOrphanHeadings(body);
  body = mergeTitleStubsWithBodies(body);
  body = stripTitleEcho(body);
  body = dropDuplicateToc(body);
  body = dropPublisherPage(body);
  body = dropImageCaptionChapter(body);
  body = body.filter((c) => c.paragraphs.length > 0);
  const summary = await summarizeBook({
    title: args.title,
    author: args.author || undefined,
    chapters: body,
  }).catch(() => null);
  const titleCh = buildTitleChapter(args.title, args.author);
  const tocCh = buildTocChapter(body);
  return [
    titleCh,
    ...(summary ? [summary] : []),
    ...(tocCh ? [tocCh] : []),
    ...body,
  ];
}
