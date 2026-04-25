"use client";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { apiFetch } from "@/lib/csrf-client";
import PrefsSheet, { type Prefs, DEFAULT_PREFS } from "./PrefsSheet";
import AudioPlayer, { type Voice } from "./AudioPlayer";
import { attachProgressDrainer, sendProgress } from "@/lib/progress-queue";

const BP = process.env.NEXT_PUBLIC_BASE_PATH || "/Reader";

let _prefsSaveTimer: ReturnType<typeof setTimeout> | null = null;
function savePrefsDebounced(p: Prefs) {
  if (typeof window === "undefined") return;
  if (_prefsSaveTimer) clearTimeout(_prefsSaveTimer);
  _prefsSaveTimer = setTimeout(() => {
    apiFetch(`${BP}/api/prefs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    }).catch(() => {});
  }, 300);
}

// Inline Markdown renderer for body text. Tiny on purpose.
const INLINE_MD_RE = /(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(`[^`\n]+`)|(\[[^\]]+\]\([^)]+\))/g;
function renderInlineMd(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_MD_RE.lastIndex = 0;
  while ((m = INLINE_MD_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**") && tok.endsWith("**")) parts.push(<strong key={parts.length}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("__") && tok.endsWith("__")) parts.push(<strong key={parts.length}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("*") && tok.endsWith("*")) parts.push(<em key={parts.length}>{tok.slice(1, -1)}</em>);
    else if (tok.startsWith("_") && tok.endsWith("_")) parts.push(<em key={parts.length}>{tok.slice(1, -1)}</em>);
    else if (tok.startsWith("`") && tok.endsWith("`")) parts.push(<code key={parts.length}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[")) {
      const lm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      if (lm) parts.push(<a key={parts.length} href={lm[2]} target="_blank" rel="noopener noreferrer">{renderInlineMd(lm[1])}</a>);
      else parts.push(tok);
    }
    last = INLINE_MD_RE.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function classifyParagraph(raw: string): { tag: "h2" | "h3" | "h4" | "li" | "p"; content: string; marker?: string } {
  const t = raw.trim();
  const h = /^(#{1,6})\s+(.*)$/.exec(t);
  if (h) {
    const level = h[1].length;
    const tag = (level <= 1 ? "h2" : level === 2 ? "h3" : "h4") as "h2" | "h3" | "h4";
    return { tag, content: h[2].trim() };
  }
  const ul = /^[*\u2022\-]\s+(.*)$/.exec(t);
  if (ul) return { tag: "li", content: ul[1].trim(), marker: "\u2022" };
  const ol = /^(\d+)[.)]\s+(.*)$/.exec(t);
  if (ol) return { tag: "li", content: ol[2].trim(), marker: ol[1] + "." };
  return { tag: "p", content: raw };
}

type Chapter = { idx: number; title: string | null; text: string };

type Overlay = "none" | "toc" | "prefs" | "ai";

export default function Reader({
  bookId,
  title,
  author,
  chapters,
  initialPrefs,
  initialProgress,
  alreadyPrompted,
}: {
  bookId: string;
  title: string | null;
  author: string | null;
  chapters: Chapter[];
  initialPrefs: Partial<Prefs>;
  initialProgress: { chapter_idx: number; paragraph_idx: number };
  alreadyPrompted?: boolean;
}) {
  const [prefs, setPrefs] = useState<Prefs>({ ...DEFAULT_PREFS, ...initialPrefs });
  const [chapterIdx, setChapterIdx] = useState<number>(clamp(initialProgress.chapter_idx, 0, chapters.length - 1));
  const [pageIdx, setPageIdx] = useState<number>(0);
  const [pageCount, setPageCount] = useState<number>(1);
  const [scrollPct, setScrollPct] = useState<number>(0);
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [ttsOn, setTtsOn] = useState(false);
  const [activePara, setActivePara] = useState<number | null>(null);
  const [activeFrac, setActiveFrac] = useState<number>(0);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [finishOpen, setFinishOpen] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [suppressFinish, setSuppressFinish] = useState<boolean>(!!alreadyPrompted);
  const [aiAnswer, setAiAnswer] = useState<string>("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string>("");
  const [kbHint, setKbHint] = useState(true);

  const chromeTimerRef = useRef<number | null>(null);
  const columnRef = useRef<HTMLDivElement>(null);
  const paragraphIdxRef = useRef<number>(initialProgress.paragraph_idx || 0);
  const pendingRestoreRef = useRef<number | null>(initialProgress.paragraph_idx > 0 ? initialProgress.paragraph_idx : null);
  const aiInputRef = useRef<HTMLInputElement | null>(null);

  // Hide the keyboard hint after a few seconds.
  useEffect(() => {
    const t = window.setTimeout(() => setKbHint(false), 3200);
    return () => window.clearTimeout(t);
  }, []);

  // Keep <html data-theme> in sync with prefs.theme on mount + change. Also
  // persist to localStorage so the next full-page load reads the right theme
  // from the inline <head> script in layout.tsx.
  useEffect(() => {
    const dom = prefs.theme === "dark" ? "dark" : prefs.theme === "sepia" || prefs.theme === "solarized" ? "sepia" : "paper";
    try {
      document.documentElement.setAttribute("data-theme", dom);
      document.documentElement.style.colorScheme = dom === "dark" ? "dark" : "light";
      localStorage.setItem("reader-theme", dom);
    } catch {}
    const b = document.body;
    b.dataset.theme = dom;
    b.dataset.view = "reader";
    b.dataset.justify = String(prefs.justify);
    b.dataset.hyphenate = String(prefs.hyphenate);
    b.dataset.mode = prefs.mode;
    b.dataset.tts = String(ttsOn);
    const r = document.documentElement.style;
    r.setProperty("--reader-font-size", prefs.fontSize + "px");
    r.setProperty("--reader-line-height", String(prefs.lineHeight));
    // Use the CSS `ch` unit directly; it's the current font's "0" width,
    // so no canvas measurement is needed. Canvas measureText returned
    // garbage widths before the webfont loaded, which disabled max-width
    // and broke column centering — that is why text hugged the left edge.
    r.setProperty("--reader-measure", `${prefs.measure}ch`);
    r.setProperty("--reader-margins", prefs.margins + "rem");
    r.setProperty("--reader-serif", prefs.font);
    savePrefsDebounced(prefs);
    return () => { delete b.dataset.view; };
  }, [prefs, ttsOn]);

  const computePages = useCallback(() => {
    const el = columnRef.current;
    if (!el || prefs.mode !== "paginated") return;
    const pages = Math.max(1, Math.ceil(el.scrollHeight / Math.max(1, el.clientHeight)));
    setPageCount(pages);
    setPageIdx((p) => Math.min(p, pages - 1));
  }, [prefs.mode]);

  useEffect(() => {
    computePages();
    const ro = new ResizeObserver(computePages);
    if (columnRef.current) ro.observe(columnRef.current);
    window.addEventListener("resize", computePages);
    return () => { ro.disconnect(); window.removeEventListener("resize", computePages); };
  }, [computePages, chapterIdx, prefs]);

  // Chrome auto-hide on idle.
  const wakeChrome = useCallback(() => {
    setChromeVisible(true);
    if (chromeTimerRef.current) window.clearTimeout(chromeTimerRef.current);
    chromeTimerRef.current = window.setTimeout(() => {
      if (overlay === "none") setChromeVisible(false);
    }, 3200);
  }, [overlay]);
  useEffect(() => {
    wakeChrome();
    const guarded = (e: Event) => {
      const t = e.target as Node | null;
      if (t && columnRef.current?.contains(t)) return;
      wakeChrome();
    };
    const events: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "touchstart", "wheel", "mousemove"];
    events.forEach((e) => window.addEventListener(e, guarded as any, { passive: true } as any));
    return () => {
      events.forEach((e) => window.removeEventListener(e, guarded as any));
      if (chromeTimerRef.current) window.clearTimeout(chromeTimerRef.current);
    };
  }, [wakeChrome]);

  useEffect(() => {
    if (prefs.mode !== "paginated") return;
    const el = columnRef.current;
    if (!el) return;
    el.scrollTo({ top: pageIdx * el.clientHeight, behavior: "auto" });
  }, [pageIdx, chapterIdx, prefs]);

  useEffect(() => {
    if (prefs.mode !== "scroll") return;
    const el = columnRef.current;
    if (!el) return;
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      // When the chapter fits entirely in the viewport there is nothing to
      // scroll; treat the reader as "at the end" so auto-advance can fire.
      setScrollPct(max > 0 ? Math.round((el.scrollTop / max) * 100) : 100);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // Fire once so fit-in-viewport chapters also register 100 on first paint.
    onScroll();
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [prefs.mode, chapterIdx]);

  // Track first visible paragraph for resume.
  useEffect(() => {
    const el = columnRef.current;
    if (!el) return;
    const paras = el.querySelectorAll<HTMLElement>("p[data-p-idx]");
    if (!paras.length) return;
    const io = new IntersectionObserver((entries) => {
      const visible = entries.filter(e => e.isIntersecting).map(e => Number((e.target as HTMLElement).dataset.pIdx));
      if (visible.length) paragraphIdxRef.current = Math.min(...visible);
    }, { root: el, threshold: 0.01 });
    paras.forEach(p => io.observe(p));
    return () => io.disconnect();
  }, [chapterIdx, prefs.mode]);

  // Restore saved paragraph position after layout settles.
  useEffect(() => {
    const target = pendingRestoreRef.current;
    if (target == null) return;
    const el = columnRef.current;
    if (!el) return;
    const t = setTimeout(() => {
      const p = el.querySelector<HTMLElement>(`p[data-p-idx="${target}"]`);
      if (!p) { pendingRestoreRef.current = null; return; }
      if (prefs.mode === "scroll") {
        el.scrollTo({ top: p.offsetTop - 16, behavior: "auto" });
      } else {
        const pageH = Math.max(1, el.clientHeight);
        const page = Math.max(0, Math.floor(p.offsetTop / pageH));
        setPageIdx(page);
      }
      pendingRestoreRef.current = null;
    }, 50);
    return () => clearTimeout(t);
  }, [chapterIdx, pageCount, prefs.mode, prefs.fontSize, prefs.lineHeight, prefs.measure, prefs.margins, prefs.font]);

  // Keep TTS active paragraph visible.
  useEffect(() => {
    if (!ttsOn || activePara == null) return;
    const el = columnRef.current?.querySelector<HTMLElement>(`[data-p-idx="${activePara}"]`);
    if (!el) return;
    if (prefs.mode === "scroll") {
      const parent = columnRef.current!;
      const pRect = parent.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      const relTop = eRect.top - pRect.top;
      if (relTop < 60 || relTop > pRect.height - 160) {
        parent.scrollTo({ top: parent.scrollTop + relTop - pRect.height * 0.3, behavior: "smooth" });
      }
    } else {
      const parent = columnRef.current!;
      const pageH = Math.max(1, parent.clientHeight);
      const page = Math.max(0, Math.floor(el.offsetTop / pageH));
      if (page !== pageIdx) setPageIdx(page);
    }
  }, [activePara, ttsOn, prefs.mode, pageIdx]);

  // Continuous scroll auto-advance: at the end of a non-last chapter, flip
  // to the next chapter and snap to the top. Gives the "continuous reading"
  // flow the user wants without holding every chapter in memory (which OOMs
  // Chrome on long books).
  const scrollAdvanceArmedRef = useRef(false);
  useEffect(() => {
    if (prefs.mode !== "scroll") { scrollAdvanceArmedRef.current = false; return; }
    const el = columnRef.current;
    const fitsInViewport = !!(el && el.scrollHeight <= el.clientHeight + 4);
    if (scrollPct < 96) { scrollAdvanceArmedRef.current = true; return; }
    // Fit-in-viewport chapters never drop below 96% (nothing to scroll),
    // so bypass the armed gate for them — otherwise titles/part markers
    // would sit there forever.
    if (!scrollAdvanceArmedRef.current && !fitsInViewport) return;
    if (chapterIdx >= chapters.length - 1) return;
    const delay = fitsInViewport ? 2200 : 0;
    const handle = window.setTimeout(() => {
      scrollAdvanceArmedRef.current = false;
      setChapterIdx((c) => (c < chapters.length - 1 ? c + 1 : c));
      setScrollPct(0);
      const e2 = columnRef.current;
      if (e2) e2.scrollTo({ top: 0, behavior: "auto" });
    }, delay);
    return () => window.clearTimeout(handle);
  }, [scrollPct, prefs.mode, chapterIdx, chapters.length]);

  // Persist progress — queued in localStorage when offline, drained on reconnect.
  useEffect(() => {
    attachProgressDrainer();
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      sendProgress({
        bookId,
        chapter_idx: chapterIdx,
        paragraph_idx: paragraphIdxRef.current,
      });
    }, 800);
    return () => clearTimeout(t);
  }, [bookId, chapterIdx, pageIdx, scrollPct]);

  function next() {
    if (prefs.mode === "paginated") {
      if (pageIdx + 1 < pageCount) setPageIdx(pageIdx + 1);
      else if (chapterIdx + 1 < chapters.length) { setChapterIdx(chapterIdx + 1); setPageIdx(0); }
    } else {
      if (chapterIdx + 1 < chapters.length) {
        const target = columnRef.current?.querySelector<HTMLElement>(`#chapter-${chapterIdx + 1}`);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }
  function prev() {
    if (prefs.mode === "paginated") {
      if (pageIdx > 0) setPageIdx(pageIdx - 1);
      else if (chapterIdx > 0) { setChapterIdx(chapterIdx - 1); setPageIdx(0); }
    } else {
      if (chapterIdx > 0) {
        const target = columnRef.current?.querySelector<HTMLElement>(`#chapter-${chapterIdx - 1}`);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // If an overlay is open, Esc closes it; otherwise back to library.
      if (e.key === "Escape") {
        if (overlay !== "none") { e.preventDefault(); setOverlay("none"); return; }
        if (finishOpen) { e.preventDefault(); setFinishOpen(false); markPrompted(); return; }
        // Let default Esc behaviour continue (back to library) only if no overlay open.
        window.location.href = BP;
        return;
      }
      if (overlay !== "none" || finishOpen) return;
      const isInputTarget = (e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA";
      if (isInputTarget) return;
      if (e.key === "t" || e.key === "T") { e.preventDefault(); setOverlay((o) => (o === "toc" ? "none" : "toc")); return; }
      if (prefs.mode === "paginated") {
        if (e.key === "ArrowRight" || e.key === " " || e.key === "j" || e.key === "PageDown") { e.preventDefault(); next(); }
        else if (e.key === "ArrowLeft" || e.key === "k" || e.key === "PageUp") { e.preventDefault(); prev(); }
      } else {
        const el = columnRef.current;
        if (!el) return;
        if (e.key === " " || e.key === "PageDown") { e.preventDefault(); el.scrollBy({ top: el.clientHeight * 0.9, behavior: "smooth" }); }
        else if (e.key === "PageUp") { e.preventDefault(); el.scrollBy({ top: -el.clientHeight * 0.9, behavior: "smooth" }); }
        else if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); el.scrollBy({ top: 60, behavior: "smooth" }); }
        else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); el.scrollBy({ top: -60, behavior: "smooth" }); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prefs.mode, overlay, finishOpen, pageIdx, pageCount, chapterIdx, chapters.length]);

  // Close overlay on outside click.
  useEffect(() => {
    if (overlay === "none") return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest(".drawer, .pop, .reader-top, .prog-ribbon")) return;
      setOverlay("none");
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [overlay]);

  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  function onTouchStart(e: React.TouchEvent) {
    const t = e.changedTouches[0];
    touch.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }
  function onTouchEnd(e: React.TouchEvent) {
    if (!touch.current) { touch.current = null; return; }
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.current.x;
    const dy = t.clientY - touch.current.y;
    const dt = Date.now() - touch.current.t;
    // Chapter-turn swipe: horizontal motion dominates vertical, minimum
    // distance 60px (was 40), and fast-ish (under 700ms) so a slow drag
    // while trying to select text does not flip chapters. Works in both
    // scroll and paginated modes — scroll mode previously had no affordance
    // besides the tiny "Next chapter" button at the end of the chapter.
    if (dt < 700 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2.5) {
      if (dx < 0) next(); else prev();
    }
    touch.current = null;
  }

  const chapter = chapters[chapterIdx];
  const paragraphs = useMemo(() => chapter.text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean), [chapter.text]);
  // Continuous-scroll model: pre-split every chapter so scroll mode can
  // render the entire book in one flow without remounting on chapter turn.
  const allChapters = useMemo(() => chapters.map((c, i) => ({
    idx: i,
    title: c.title,
    paragraphs: c.text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean),
  })), [chapters]);
  const titleAlreadyInBody = useMemo(() => {
    if (!chapter.title) return false;
    const norm = (s: string) => s.toLowerCase().replace(/^\s*(chapter|ch\.?)\s*[\divxlcdm]+[:.\s-]*/i, "").replace(/[^a-z0-9]+/g, " ").trim();
    const tn = norm(chapter.title);
    if (!tn) return false;
    const cands = paragraphs.slice(0, 3).filter(p => p.length < 200);
    for (let n = 1; n <= cands.length; n++) {
      const pn = norm(cands.slice(0, n).join(" "));
      if (!pn) continue;
      if (pn === tn) return true;
      if (pn.includes(tn) || tn.includes(pn)) return true;
    }
    return false;
  }, [chapter.title, paragraphs]);
  const isLastChapter = chapterIdx === chapters.length - 1;

  // Continuous-scroll: watch which chapter's heading is nearest the top of
  // the viewport and sync chapterIdx to it. Cheap: one IntersectionObserver
  // keyed on the heading elements; triggers only on entry/exit.
  useEffect(() => {
    const el = columnRef.current;
    if (!el) return;
    // Delay a tick so the new DOM is mounted after a mode switch.
    let cancelled = false;
    const setup = () => {
      if (cancelled) return;
      const nodes = Array.from(el.querySelectorAll<HTMLElement>("[data-chapter-anchor]"));
      if (!nodes.length) return;
      const seen = new Map<number, number>(); // chapter idx -> top offset within el
      const io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.chapterAnchor);
          if (!Number.isFinite(i)) continue;
          if (e.isIntersecting) seen.set(i, (e.target as HTMLElement).offsetTop);
          else seen.delete(i);
        }
        if (!seen.size) return;
        // Pick the visible chapter whose anchor is closest to the current scrollTop.
        const top = el.scrollTop;
        let best = chapterIdx;
        let bestDist = Number.POSITIVE_INFINITY;
        for (const [i, off] of seen) {
          const d = Math.abs(off - top);
          if (d < bestDist) { bestDist = d; best = i; }
        }
        if (best !== chapterIdx) setChapterIdx(best);
      }, { root: el, rootMargin: "-10% 0px -80% 0px", threshold: [0, 1] });
      for (const n of nodes) io.observe(n);
      return () => io.disconnect();
    };
    const t = setTimeout(setup, 50);
    return () => { cancelled = true; clearTimeout(t); };
  }, [prefs.mode, chapters.length, chapterIdx]);

  // Finish detection.
  useEffect(() => {
    if (suppressFinish || finishOpen) return;
    if (!isLastChapter) return;
    const visibleEnd = paragraphIdxRef.current >= Math.max(0, paragraphs.length - 3);
    const paginatedEnd = prefs.mode === "paginated" && pageIdx >= Math.max(0, pageCount - 1);
    const scrollEnd = prefs.mode === "scroll" && scrollPct >= 92;
    if (visibleEnd || paginatedEnd || scrollEnd) setFinishOpen(true);
  }, [isLastChapter, pageIdx, pageCount, scrollPct, paragraphs.length, prefs.mode, suppressFinish, finishOpen]);

  async function markPrompted() {
    setSuppressFinish(true);
    try { await apiFetch(`${BP}/api/books/${bookId}/finish-prompt`, { method: "POST" }); } catch {}
  }

  async function onArchive() {
    setArchiveBusy(true);
    try {
      const res = await apiFetch(`${BP}/api/books/${bookId}/archive`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      await markPrompted();
      window.location.href = BP;
    } catch (err: any) {
      alert(`Archive failed: ${err.message || err}`);
      setArchiveBusy(false);
    }
  }
  function onDismissFinish() { setFinishOpen(false); markPrompted(); }

  function jumpToChapter(i: number) {
    pendingRestoreRef.current = null;
    paragraphIdxRef.current = 0;
    setChapterIdx(i);
    setPageIdx(0);
    setOverlay("none");
    if (prefs.mode === "scroll") {
      // Continuous scroll: smooth-scroll to the chapter anchor so context
      // (previous chapter ending) stays visible above.
      const target = columnRef.current?.querySelector<HTMLElement>(`#chapter-${i}`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      else columnRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      columnRef.current?.scrollTo({ top: 0 });
    }
  }

  const progressPct = prefs.mode === "paginated"
    ? (chapters.length > 1 ? Math.round(((chapterIdx + (pageIdx / Math.max(1, pageCount - 1))) / chapters.length) * 100) : Math.round((pageIdx / Math.max(1, pageCount - 1)) * 100))
    : (chapters.length > 1 ? Math.round(((chapterIdx + scrollPct / 100) / chapters.length) * 100) : scrollPct);

  // AI Explain: uses window.getSelection() or the visible chapter text.
  async function askAi() {
    setOverlay("ai");
    setAiError("");
    setAiBusy(true);
    try {
      const sel = typeof window !== "undefined" ? window.getSelection()?.toString().trim() : "";
      // Server contract: { phrase, context }. For a selection, the phrase is
      // the selected text and context is the surrounding paragraph. With no
      // selection we ask for a chapter summary — the server recognises the
      // "summarize" prefix and swaps to its SUMMARY_SYSTEM prompt.
      const phrase = sel && sel.length > 0
        ? sel
        : `Summarise chapter ${chapterIdx + 1}${chapter.title ? `: ${chapter.title}` : ""}`;
      const context = sel
        ? paragraphs.slice(0, 3).join("\n\n")
        : paragraphs.slice(0, 6).join("\n\n");
      const res = await apiFetch(`${BP}/api/sync/ai/explain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrase, context }),
      });
      if (!res.ok) {
        const txt = await res.text();
        try { const je = JSON.parse(txt); throw new Error(je.error || je.detail || txt); }
        catch { throw new Error(txt || `HTTP ${res.status}`); }
      }
      const j = await res.json();
      setAiAnswer(j.content || j.answer || j.text || j.summary || "");
    } catch (err: any) {
      // Fallback to a short canned placeholder so the popover renders
      // even when the AI backend isn't configured for this env.
      setAiError(err?.message || String(err));
      setAiAnswer("");
    } finally {
      setAiBusy(false);
    }
  }

  const chromeHidden = !chromeVisible && overlay === "none";
  const chapterMeta = chapter.title ? `Chapter ${chapterIdx + 1} · ${chapter.title}` : `Chapter ${chapterIdx + 1}`;

  return (
    <div className="reader-stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* Top chrome */}
      <div className={`reader-top${chromeHidden ? " chrome-hidden" : ""}`}>
        <div className="grp">
          <a href={BP} className="icon-btn" title="Back to library" aria-label="Back to library">
            <svg className="icn" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg>
          </a>
          <button
            type="button"
            className={`icon-btn${overlay === "toc" ? " active" : ""}`}
            onClick={(e) => { e.stopPropagation(); setOverlay((o) => (o === "toc" ? "none" : "toc")); }}
            title="Contents (T)"
            aria-label="Open table of contents"
            aria-pressed={overlay === "toc"}
          >
            <svg className="icn" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" /></svg>
          </button>
        </div>
        <div className="ctr">
          <div className="t">{title || "Untitled"}</div>
          <div className="s">{author ? `${author} · ${chapterMeta}` : chapterMeta}</div>
        </div>
        <div className="grp">
          <button
            type="button"
            className={`icon-btn${ttsOn ? " active" : ""}`}
            onClick={() => setTtsOn((v) => !v)}
            title="Listen"
            aria-label={ttsOn ? "Stop text-to-speech" : "Start text-to-speech"}
            aria-pressed={ttsOn}
          >
            <svg className="icn" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 10v4h3l4 3V7L7 10H4z" />
              <path d="M16 9c1.5 1.2 1.5 4.8 0 6" />
              <path d="M19 6c3 2.5 3 9.5 0 12" />
            </svg>
          </button>
          <button
            type="button"
            className={`icon-btn${overlay === "ai" ? " active" : ""}`}
            onClick={(e) => { e.stopPropagation(); if (overlay === "ai") setOverlay("none"); else askAi(); }}
            title="Ask about this chapter"
            aria-label="Open AI popover"
            aria-pressed={overlay === "ai"}
          >
            <svg className="icn" viewBox="0 0 24 24"><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /></svg>
          </button>
          <button
            type="button"
            className={`icon-btn${overlay === "prefs" ? " active" : ""}`}
            onClick={(e) => { e.stopPropagation(); setOverlay((o) => (o === "prefs" ? "none" : "prefs")); }}
            title="Reading settings"
            aria-label="Open reading settings"
            aria-pressed={overlay === "prefs"}
          >
            <svg className="icn" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 01-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 012.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 012.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z" /></svg>
          </button>
        </div>
      </div>

      {/* Reading canvas */}
      <div
        ref={columnRef}
        className={prefs.mode === "paginated" ? "reader-column" : "reader-scroll"}
        aria-label="reader body"
        onClick={(e) => {
          const cls = (e.target as HTMLElement).className || "";
          if (typeof cls === "string" && (cls.includes("tap-left") || cls.includes("tap-right"))) return;
          if (chromeTimerRef.current) window.clearTimeout(chromeTimerRef.current);
          setChromeVisible((v) => !v);
        }}
      >
        {chapter.title && !titleAlreadyInBody ? <h2>{chapter.title}</h2> : null}
        {(/^(table of )?contents?$/i.test(chapter.title || "")) ? (
          <ul className="reader-toc">
            {(() => {
              const rawLines = paragraphs
                .flatMap((p) => p.split(/\n+|\s\u2022\s/))
                .map((l) => l.trim())
                .filter(Boolean);
              const lines: string[] = [];
              for (let k = 0; k < rawLines.length; k++) {
                const cur = rawLines[k];
                if (/^\d{1,3}\.?$/.test(cur) && k + 1 < rawLines.length) {
                  lines.push(`${cur.replace(/\.?$/, ".")} ${rawLines[k + 1]}`);
                  k++;
                } else {
                  lines.push(cur);
                }
              }
              const norm = (s: string) =>
                s
                  .toLowerCase()
                  .replace(/^\s*(chapter|ch\.?)\s*\d+[:.\s]*/i, "")
                  .replace(/^\s*\d+[.)]\s*/, "")
                  .replace(/[^a-z0-9]+/g, " ")
                  .trim();
              return lines.map((line, i) => {
                const mdLink = /^\[([^\]]+)\]\(#ch-(\d+)\)$/.exec(line);
                let display = line;
                let explicitTarget = -1;
                if (mdLink) {
                  display = mdLink[1];
                  const n = Number(mdLink[2]);
                  const bodyStart = chapters.findIndex(
                    (c) => !/^(title|summary|(table of )?contents?)$/i.test(c.title || "")
                  );
                  if (bodyStart >= 0) explicitTarget = bodyStart + (n - 1);
                }
                const cleaned = display
                  .replace(/\s*\.{2,}\s*\d+\s*$/, "")
                  .replace(/\s+\d+\s*$/, "")
                  .trim();
                const entryN = norm(cleaned);
                let target = explicitTarget;
                if (target < 0 && entryN) {
                  target = chapters.findIndex((c, idx) => {
                    if (idx <= chapterIdx || !c.title) return false;
                    const titleN = norm(c.title);
                    if (!titleN) return false;
                    return (
                      titleN === entryN ||
                      titleN.startsWith(entryN.slice(0, Math.min(entryN.length, 40))) ||
                      entryN.startsWith(titleN.slice(0, Math.min(titleN.length, 40)))
                    );
                  });
                }
                return (
                  <li key={i} data-p-idx={i}>
                    {target >= 0 ? (
                      <a href="#" onClick={(e) => { e.preventDefault(); jumpToChapter(target); }}>{cleaned || line}</a>
                    ) : (
                      <span>{cleaned || line}</span>
                    )}
                  </li>
                );
              });
            })()}
          </ul>
        ) : paragraphs.map((p, i) => {
          const { tag, content, marker } = classifyParagraph(p);
          const cls = ttsOn && activePara === i ? "tts-para-active" : undefined;
          if (tag === "h2") return <h2 key={i} data-p-idx={i} className={cls}>{renderInlineMd(content)}</h2>;
          if (tag === "h3") return <h3 key={i} data-p-idx={i} className={cls}>{renderInlineMd(content)}</h3>;
          if (tag === "h4") return <h4 key={i} data-p-idx={i} className={cls}>{renderInlineMd(content)}</h4>;
          if (tag === "li") return (
            <p key={i} data-p-idx={i} className={`reader-li ${cls ?? ""}`.trim()} style={{ hyphens: prefs.hyphenate ? "auto" : "manual", WebkitHyphens: prefs.hyphenate ? "auto" : "manual" } as React.CSSProperties}>
              <span className="reader-li-marker">{marker}</span>
              <span>{renderInlineMd(content)}</span>
            </p>
          );
          return (
            <p key={i} data-p-idx={i} className={cls} style={{ hyphens: prefs.hyphenate ? "auto" : "manual", WebkitHyphens: prefs.hyphenate ? "auto" : "manual" } as React.CSSProperties}>
              {renderInlineMd(content)}
              {ttsOn && activePara === i ? (
                <span className="tts-para-progress" aria-hidden style={{ ["--frac" as any]: activeFrac.toFixed(3) }} />
              ) : null}
            </p>
          );
        })}
      </div>

      {/* Rails (desktop hover prev/next) */}
      {prefs.mode === "paginated" ? (
        <>
          <div className="rail l" onClick={prev} title="Previous page (←)">
            <div className="rl-arrow">
              <svg className="icn" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" /></svg>
            </div>
          </div>
          <div className="rail r" onClick={next} title="Next page (→)">
            <div className="rl-arrow">
              <svg className="icn" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg>
            </div>
          </div>
          <div className="tap-left" onClick={prev} aria-hidden />
          <div className="tap-right" onClick={next} aria-hidden />
        </>
      ) : null}

      {/* Progress ribbon */}
      <div className={`prog-ribbon${chromeHidden ? " chrome-hidden" : ""}`}>
        <div className="lft">
          <span>Ch {chapterIdx + 1} / {chapters.length}</span>
          {(() => {
            const m = (chapter?.title || "").match(/^\s*(\d+)[.)]/);
            return m ? <span style={{ color: "var(--ink-3)" }}>· book ch {m[1]}</span> : null;
          })()}
          {prefs.mode === "paginated" ? <span style={{ color: "var(--ink-3)" }}>· p {pageIdx + 1} / {pageCount}</span> : null}
        </div>
        <div className="track">
          <div className="fill" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="rgt">
          <span className="eta">{progressPct}%</span>
          <span>read</span>
        </div>
      </div>

      {/* TOC drawer */}
      <aside className={`drawer${overlay === "toc" ? " open" : ""}`} aria-hidden={overlay !== "toc"}>
        <div className="drawer-head">
          <span>Chapters · {chapters.length}</span>
          <button type="button" className="close" aria-label="Close contents" onClick={() => setOverlay("none")}>×</button>
        </div>
        <div className="drawer-body">
          {chapters.map((c, i) => (
            <button
              key={c.idx}
              type="button"
              className={`d-chap${i === chapterIdx ? " current" : ""}`}
              onClick={() => jumpToChapter(i)}
            >
              <span className="n">{roman(i + 1)}</span>
              <div>
                <div className="t">{c.title || `Chapter ${i + 1}`}</div>
                <div className="s">{c.text ? `${Math.max(1, Math.round(c.text.split(/\s+/).length / 250))} min` : ""}</div>
              </div>
              <span className="p">{i === chapterIdx ? "now" : i + 1}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* Settings popover */}
      {overlay === "prefs" ? (
        <PrefsSheet prefs={prefs} onChange={setPrefs} onClose={() => setOverlay("none")} />
      ) : null}

      {/* AI popover */}
      {overlay === "ai" ? (
        <aside
          className="pop open"
          role="dialog"
          aria-label="Ask about this chapter"
          onClick={(e) => e.stopPropagation()}
          style={{
            background: "var(--ink)",
            color: "var(--paper)",
            borderColor: "transparent",
            width: "min(400px, calc(100vw - 32px))",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                background: "var(--accent)",
                color: "var(--overlay-ink-strong)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--reader-serif)",
                fontSize: 16,
              }}
            >✦</div>
            <div>
              <div style={{ fontFamily: "var(--reader-mono)", fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--overlay-ink-muted)" }}>Ask about this chapter</div>
              <div style={{ fontSize: 13, color: "var(--overlay-ink)", marginTop: 2 }}>Grounded in chapter {chapterIdx + 1}</div>
            </div>
          </div>
          {aiBusy ? (
            <div style={{ padding: "20px 0", textAlign: "center", color: "var(--overlay-ink)" }}>Thinking…</div>
          ) : aiError ? (
            <div style={{ fontSize: 13, color: "var(--overlay-error)", padding: "8px 0", lineHeight: 1.5 }}>
              AI is unavailable right now. {aiError}
            </div>
          ) : aiAnswer ? (
            <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--overlay-ink)", marginBottom: 14, whiteSpace: "pre-wrap" }}>{aiAnswer}</p>
          ) : (
            <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--overlay-ink)" }}>Highlight any passage and reopen this to get context-aware notes.</p>
          )}
          <div
            style={{
              display: "flex",
              gap: 8,
              background: "rgba(255,255,255,0.08)",
              borderRadius: 999,
              padding: "4px 4px 4px 14px",
              alignItems: "center",
            }}
          >
            <input
              ref={aiInputRef}
              placeholder="Ask another question…"
              style={{
                flex: 1,
                border: 0,
                background: "transparent",
                color: "var(--paper)",
                font: "inherit",
                fontSize: 13,
                outline: "none",
              }}
              onKeyDown={(e) => { if (e.key === "Enter") askAi(); }}
            />
            <button
              type="button"
              className="btn btn-accent"
              style={{ padding: "8px 14px", fontSize: 12 }}
              onClick={askAi}
              disabled={aiBusy}
            >
              {aiBusy ? "…" : "Ask"}
            </button>
          </div>
        </aside>
      ) : null}

      {/* TTS bar */}
      {ttsOn ? (
        <AudioPlayer
          bookId={bookId}
          chapterIdx={chapterIdx}
          chapterCount={chapters.length}
          startParagraph={paragraphIdxRef.current}
          onChapterChange={(i) => { setChapterIdx(i); setPageIdx(0); setActivePara(null); setActiveFrac(0); }}
          onActiveParagraph={(p, f) => { setActivePara(p); setActiveFrac(f); }}
          initialVoice={(prefs.ttsVoice || "onyx") as Voice}
          onPrefs={(p) => setPrefs((cur) => ({ ...cur, ttsVoice: p.voice }))}
        />
      ) : null}

      {/* KB hint */}
      {kbHint ? (
        <div className="kb-hint vis" aria-hidden>
          <div className="k-grp"><kbd>←</kbd><kbd>→</kbd><span>page</span></div>
          <div className="k-grp"><kbd>Space</kbd><span>next</span></div>
          <div className="k-grp"><kbd>T</kbd><span>contents</span></div>
          <div className="k-grp"><kbd>Esc</kbd><span>library</span></div>
        </div>
      ) : null}

      {/* Finish dialog */}
      {finishOpen ? (
        <div className="dialog-overlay" onClick={onDismissFinish}>
          <div
            className="dialog"
            role="alertdialog"
            aria-modal="true"
            aria-label="Finished book"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>You finished this book.</h3>
            <p>
              Archive <strong>{title || "Untitled"}</strong>? Archived books are hidden from your main library but stay accessible under <em>Library → Archived</em>.
            </p>
            <div className="dialog-actions">
              <button type="button" className="btn btn-ghost" onClick={onDismissFinish} disabled={archiveBusy}>Not now</button>
              <button type="button" className="btn btn-primary" onClick={onArchive} disabled={archiveBusy}>
                {archiveBusy ? "Archiving…" : "Archive"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
function parsePx(s: string) { return parseFloat(s) || 0; }

function roman(n: number): string {
  if (n < 1 || n > 3999) return String(n);
  const table: Array<[number, string]> = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  for (const [v, s] of table) {
    while (n >= v) { out += s; n -= v; }
  }
  return out;
}
