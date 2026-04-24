"use client";
import { useEffect, useRef, useState, useCallback } from "react";

const BP = process.env.NEXT_PUBLIC_BASE_PATH || "/Reader";
export const VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer", "coral", "sage"] as const;
export type Voice = typeof VOICES[number];

type PartMeta = { startPara: number; endPara: number; paragraphWordCounts: number[] };

type Props = {
  bookId: string;
  chapterIdx: number;
  chapterCount: number;
  startParagraph: number;
  onChapterChange: (idx: number) => void;
  onActiveParagraph?: (absPara: number | null, fraction: number) => void;
  initialVoice?: Voice;
  onPrefs?: (p: { voice: Voice }) => void;
};

export default function AudioPlayer({ bookId, chapterIdx, chapterCount, startParagraph, onChapterChange, onActiveParagraph, initialVoice = "onyx", onPrefs }: Props) {
  const [voice, setVoice] = useState<Voice>(initialVoice);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [parts, setParts] = useState<PartMeta[]>([]);
  const [partIdx, setPartIdx] = useState(0);
  // currentPartMeta reflects whatever is actually playing right now (may be a custom slice).
  const [currentMeta, setCurrentMeta] = useState<PartMeta | null>(null);
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [dur, setDur] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const retriedSrcsRef = useRef<Set<string>>(new Set());
  const currentUrlRef = useRef<string | null>(null);
  const nextBlobRef = useRef<{ url: string; part: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Replace the <audio> src with a fresh blob URL and revoke the previous one.
  // Browsers keep the old blob alive until revoked even after src reassignment.
  const setAudioSrc = useCallback((url: string) => {
    const prev = currentUrlRef.current;
    currentUrlRef.current = url;
    if (audioRef.current) audioRef.current.src = url;
    if (prev) URL.revokeObjectURL(prev);
  }, []);
  const startParaRef = useRef(startParagraph);
  useEffect(() => { startParaRef.current = startParagraph; }, [startParagraph]);

  useEffect(() => { onPrefs?.({ voice }); }, [voice, onPrefs]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setError(""); setParts([]); setPartIdx(0); setCurrentMeta(null);
      try {
        const res = await fetch(`${BP}/api/tts/${bookId}/${chapterIdx}?meta=1&voice=${voice}`);
        if (!res.ok) throw new Error(`meta ${res.status}`);
        const j = await res.json();
        if (!alive) return;
        setParts(j.parts || []);
      } catch (e: any) { if (alive) setError(e.message); }
    })();
    return () => { alive = false; };
  }, [bookId, chapterIdx, voice]);

  function partForPara(p: number): number {
    for (let i = 0; i < parts.length; i++) if (p >= parts[i].startPara && p <= parts[i].endPara) return i;
    return 0;
  }

  async function fetchPart(part: number, signal: AbortSignal): Promise<{ url: string; meta: PartMeta } | null> {
    const res = await fetch(`${BP}/api/tts/${bookId}/${chapterIdx}?voice=${voice}&part=${part}`, { signal });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `TTS ${res.status}`); }
    const blob = await res.blob();
    return { url: URL.createObjectURL(blob), meta: parts[part] };
  }

  async function fetchFromPara(fromPara: number, signal: AbortSignal): Promise<{ url: string; meta: PartMeta } | null> {
    const res = await fetch(`${BP}/api/tts/${bookId}/${chapterIdx}?voice=${voice}&from=${fromPara}`, { signal });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `TTS ${res.status}`); }
    const blob = await res.blob();
    const startPara = Number(res.headers.get("X-Start-Para") || fromPara);
    const endPara = Number(res.headers.get("X-End-Para") || fromPara);
    let wc: number[] = [];
    try { wc = JSON.parse(res.headers.get("X-Paragraph-Word-Counts") || "[]"); } catch {}
    return { url: URL.createObjectURL(blob), meta: { startPara, endPara, paragraphWordCounts: wc } };
  }

  function stopAll() {
    abortRef.current?.abort();
    abortRef.current = null;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.removeAttribute("src"); audioRef.current.load(); }
    if (currentUrlRef.current) { URL.revokeObjectURL(currentUrlRef.current); currentUrlRef.current = null; }
    if (nextBlobRef.current?.url) { URL.revokeObjectURL(nextBlobRef.current.url); nextBlobRef.current = null; }
    setPlaying(false); setLoading(false);
    onActiveParagraph?.(null, 0);
  }

  const playFromScreen = useCallback(async () => {
    if (!audioRef.current) return;
    if (!parts.length) return;
    stopAll();
    setLoading(true); setPlaying(true); setError("");
    abortRef.current = new AbortController();
    try {
      const targetPara = startParaRef.current;
      const pIdx = partForPara(targetPara);
      const part = parts[pIdx];
      const useCustom = part && targetPara > part.startPara;
      const got = useCustom
        ? await fetchFromPara(targetPara, abortRef.current.signal)
        : await fetchPart(pIdx, abortRef.current.signal);
      if (!got || !audioRef.current) { if (got?.url) URL.revokeObjectURL(got.url); return; }
      setAudioSrc(got.url);
      setCurrentMeta(got.meta);
      setPartIdx(pIdx);
      await audioRef.current.play();
      setLoading(false);
      // prefetch next part (always full cached one after current part)
      const next = pIdx + 1;
      if (next < parts.length) {
        try {
          const n = await fetchPart(next, abortRef.current.signal);
          if (n) nextBlobRef.current = { url: n.url, part: next };
        } catch {}
      }
    } catch (e: any) {
      if (e.name !== "AbortError") setError(e.message);
      setLoading(false); setPlaying(false);
    }
  }, [parts, bookId, chapterIdx, voice]);

  function togglePlay() {
    if (!audioRef.current) return;
    if (playing) { audioRef.current.pause(); setPlaying(false); }
    else if (audioRef.current.src) { audioRef.current.play(); setPlaying(true); }
    else { playFromScreen(); }
  }

  async function onEnded() {
    const next = partIdx + 1;
    if (next < parts.length) {
      if (nextBlobRef.current?.part === next && nextBlobRef.current.url && audioRef.current) {
        const url = nextBlobRef.current.url;
        nextBlobRef.current = null;
        setAudioSrc(url);
        setCurrentMeta(parts[next]);
        setPartIdx(next);
        await audioRef.current.play();
        if (next + 1 < parts.length && abortRef.current) {
          try { const n = await fetchPart(next + 1, abortRef.current.signal); if (n) nextBlobRef.current = { url: n.url, part: next + 1 }; } catch {}
        }
      } else {
        setLoading(true);
        try {
          abortRef.current = abortRef.current || new AbortController();
          const got = await fetchPart(next, abortRef.current.signal);
          if (!got || !audioRef.current) { if (got?.url) URL.revokeObjectURL(got.url); return; }
          setAudioSrc(got.url);
          setCurrentMeta(got.meta);
          setPartIdx(next);
          await audioRef.current.play();
          setLoading(false);
        } catch (e: any) { setError(e.message); setLoading(false); setPlaying(false); }
      }
    } else if (chapterIdx + 1 < chapterCount) {
      onChapterChange(chapterIdx + 1);
      setTimeout(() => playFromScreen(), 500);
    } else {
      stopAll();
    }
  }

  // Smooth paragraph-level highlight via rAF
  useEffect(() => {
    if (!playing || !currentMeta) return;
    let raf = 0;
    const tick = () => {
      const a = audioRef.current;
      if (a && a.duration > 0) {
        const ratio = Math.max(0, Math.min(1, a.currentTime / a.duration));
        const counts = currentMeta.paragraphWordCounts;
        const total = counts.reduce((s, v) => s + v, 0) || 1;
        const targetWords = ratio * total;
        let cum = 0;
        let localIdx = 0;
        for (let i = 0; i < counts.length; i++) {
          if (cum + counts[i] >= targetWords) { localIdx = i; break; }
          cum += counts[i];
          localIdx = i;
        }
        const within = counts[localIdx] ? Math.max(0, Math.min(1, (targetWords - cum) / counts[localIdx])) : 0;
        onActiveParagraph?.(currentMeta.startPara + localIdx, within);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, currentMeta, onActiveParagraph]);

  useEffect(() => { return () => stopAll(); }, []);

  const globalPct = parts.length && currentMeta
    ? Math.round((((partIdx) + ((elapsed || 0) / (dur || 1))) / parts.length) * 100)
    : 0;

  return (
    <div className="tts-bar" role="region" aria-label="Audio player">
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setElapsed((e.target as HTMLAudioElement).currentTime)}
        onDurationChange={(e) => setDur((e.target as HTMLAudioElement).duration || 0)}
        onEnded={onEnded}
        onError={(e) => {
          const a = e.target as HTMLAudioElement;
          // Empty/zero-duration error = we set src="" ourselves on cleanup; ignore.
          if (!a.src || a.src === window.location.href) return;
          const me = a.error;
          const reason =
            me?.code === 1 ? "aborted" :
            me?.code === 2 ? "network dropped mid-stream" :
            me?.code === 3 ? "audio decode failed" :
            me?.code === 4 ? "format not supported or partial download" :
            "unknown";
          // Retry once per src: append a cache-buster and re-fetch.
          const src = a.src;
          if (!retriedSrcsRef.current.has(src)) {
            retriedSrcsRef.current.add(src);
            setError(`Retrying — ${reason}…`);
            // Small delay + fresh URL so Chrome re-requests the resource.
            const u = new URL(src);
            u.searchParams.set("_retry", String(Date.now()));
            setTimeout(() => {
              if (audioRef.current) {
                audioRef.current.src = u.toString();
                audioRef.current.load();
                audioRef.current.play().catch(() => setError(`Audio failed: ${reason}. Tap play to try again.`));
              }
            }, 500);
          } else {
            setError(`Audio failed: ${reason}. Tap play to try again.`);
            setPlaying(false);
            setLoading(false);
          }
        }}
        preload="metadata"
      />
      <div className="tts-row">
        <button className="tts-play" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
          {loading ? (
            <span className="m3-progress-morph" role="progressbar" aria-label="Generating audio..." aria-busy="true" style={{ width: "18px", height: "18px" }} />
          ) : playing ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          )}
        </button>
        <div className="tts-meta">
          <div className="tts-label">
            {error ? <span style={{ color: "var(--m3-error)" }}>Audio error: {error}</span> :
             loading ? "Generating…" :
             playing ? `Reading · ${globalPct}%` :
             parts.length ? "Ready" : "Loading chapter…"}
          </div>
          <div className="tts-progress">
            <div className="tts-progress-fill" style={{ width: `${globalPct}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
