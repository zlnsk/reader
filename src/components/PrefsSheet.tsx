"use client";
import { useEffect } from "react";
import { apiFetch } from "@/lib/csrf-client";

const BP = process.env.NEXT_PUBLIC_BASE_PATH || "/Reader";

export type Prefs = {
  font: string;
  fontSize: number;
  lineHeight: number;
  measure: number;
  margins: number;
  /**
   * Stored themes are "light" | "sepia" | "dark" | "solarized" for backward
   * compatibility with the existing /api/prefs payload. The UI labels them
   * Paper / Sepia / OLED and maps "paper" ↔ "light" at read/write time.
   */
  theme: "light" | "paper" | "sepia" | "dark" | "solarized";
  justify: boolean;
  hyphenate: boolean;
  mode: "paginated" | "scroll";
  ttsVoice?: string;
  ttsRate?: number;
};

export const DEFAULT_PREFS: Prefs = {
  font: '"Source Serif 4", "Iowan Old Style", Charter, Georgia, serif',
  fontSize: 19,
  lineHeight: 1.65,
  measure: 62,
  margins: 3,
  theme: "paper",
  justify: false,
  hyphenate: false,
  mode: "paginated",
  ttsVoice: "nova",
  ttsRate: 1.0,
};

// DOM theme values: paper | sepia | dark. `light` / `paper` are aliased.
function toDomTheme(t: Prefs["theme"]): "paper" | "sepia" | "dark" {
  if (t === "dark") return "dark";
  if (t === "sepia" || t === "solarized") return "sepia";
  return "paper";
}

// Three-step scales.
const FONT_SIZE = [16, 19, 23] as const;
const LINE_HEIGHT = [1.45, 1.65, 1.9] as const;
const MEASURE = [52, 62, 78] as const;
const MARGINS = [1.5, 3, 5] as const;
type Step = "S" | "M" | "L";
function pickStep<T extends number>(value: number, scale: readonly [T, T, T]): Step {
  const [s, m, l] = scale;
  const ds = Math.abs(value - s), dm = Math.abs(value - m), dl = Math.abs(value - l);
  if (ds <= dm && ds <= dl) return "S";
  if (dl < dm) return "L";
  return "M";
}
function stepValue<T extends number>(step: Step, scale: readonly [T, T, T]): T {
  return step === "S" ? scale[0] : step === "L" ? scale[2] : scale[1];
}

// Known typeface families the popover exposes as "fcard" options.
const FONTS: Array<{ value: string; label: string; sample: string }> = [
  { value: '"Source Serif 4", "Iowan Old Style", Charter, Georgia, serif', label: "Source Serif", sample: "Aa" },
  { value: '"Inter", system-ui, sans-serif', label: "Inter", sample: "Aa" },
];

export default function PrefsSheet({ prefs, onChange, onClose }: { prefs: Prefs; onChange: (p: Prefs) => void; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(() => {
      apiFetch(`${BP}/api/prefs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(prefs) }).catch(() => {});
      try { localStorage.setItem("reader.prefs", JSON.stringify(prefs)); } catch {}
    }, 300);
    return () => clearTimeout(t);
  }, [prefs]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function set<K extends keyof Prefs>(k: K, v: Prefs[K]) { onChange({ ...prefs, [k]: v }); }

  // When the user picks a theme swatch we also mirror onto <html data-theme>
  // and localStorage — so the reader chrome / library nav stay in sync.
  function pickTheme(t: "paper" | "sepia" | "dark") {
    onChange({ ...prefs, theme: t });
    try {
      document.documentElement.setAttribute("data-theme", t);
      document.documentElement.style.colorScheme = t === "dark" ? "dark" : "light";
      localStorage.setItem("reader-theme", t);
    } catch {}
  }

  const currentDomTheme = toDomTheme(prefs.theme);
  const currentFont = FONTS.find((f) => f.value === prefs.font)?.value || FONTS[0].value;

  return (
    <aside className="pop open" role="dialog" aria-label="Reading preferences" onClick={(e) => e.stopPropagation()}>
      <h4>Theme</h4>
      <div className="row3">
        <button
          type="button"
          className={`swatch sw-light${currentDomTheme === "paper" ? " active" : ""}`}
          onClick={() => pickTheme("paper")}
          aria-pressed={currentDomTheme === "paper"}
        >
          Aa<span className="lbl">Paper</span>
        </button>
        <button
          type="button"
          className={`swatch sw-sepia${currentDomTheme === "sepia" ? " active" : ""}`}
          onClick={() => pickTheme("sepia")}
          aria-pressed={currentDomTheme === "sepia"}
        >
          Aa<span className="lbl">Sepia</span>
        </button>
        <button
          type="button"
          className={`swatch sw-dark${currentDomTheme === "dark" ? " active" : ""}`}
          onClick={() => pickTheme("dark")}
          aria-pressed={currentDomTheme === "dark"}
        >
          Aa<span className="lbl">OLED</span>
        </button>
      </div>

      <h4>Typeface</h4>
      <div className="font-row">
        {FONTS.map((f) => (
          <button
            type="button"
            key={f.label}
            className={`fcard${currentFont === f.value ? " active" : ""}`}
            onClick={() => set("font", f.value)}
            aria-pressed={currentFont === f.value}
          >
            <div className="big" style={{ fontFamily: f.value }}>{f.sample}</div>
            <div className="nm">{f.label}</div>
          </button>
        ))}
      </div>

      <h4>Text size</h4>
      <div className="slider">
        <span className="ism">A</span>
        <input
          type="range"
          min={FONT_SIZE[0]}
          max={FONT_SIZE[2]}
          step={1}
          value={prefs.fontSize}
          onChange={(e) => set("fontSize", Number(e.target.value))}
          aria-label="Text size"
        />
        <span className="isl">A</span>
      </div>

      <h4>Layout</h4>
      <div className="seg" style={{ ["--cols" as any]: 2 }}>
        <button type="button" className={prefs.mode === "paginated" ? "active" : ""} aria-pressed={prefs.mode === "paginated"} onClick={() => set("mode", "paginated")}>Spread</button>
        <button type="button" className={prefs.mode === "scroll" ? "active" : ""} aria-pressed={prefs.mode === "scroll"} onClick={() => set("mode", "scroll")}>Scroll</button>
      </div>

      <h4>Line spacing</h4>
      <div className="seg" style={{ ["--cols" as any]: 3 }}>
        {(["S", "M", "L"] as const).map((s) => {
          const active = pickStep(prefs.lineHeight, LINE_HEIGHT) === s;
          return (
            <button type="button" key={s} className={active ? "active" : ""} aria-pressed={active} onClick={() => set("lineHeight", stepValue(s, LINE_HEIGHT))}>
              {s}
            </button>
          );
        })}
      </div>

      <h4>Column width</h4>
      <div className="seg" style={{ ["--cols" as any]: 3 }}>
        {(["S", "M", "L"] as const).map((s) => {
          const active = pickStep(prefs.measure, MEASURE) === s;
          return (
            <button type="button" key={s} className={active ? "active" : ""} aria-pressed={active} onClick={() => set("measure", stepValue(s, MEASURE))}>
              {s}
            </button>
          );
        })}
      </div>

      <h4>Margins</h4>
      <div className="seg" style={{ ["--cols" as any]: 3 }}>
        {(["S", "M", "L"] as const).map((s) => {
          const active = pickStep(prefs.margins, MARGINS) === s;
          return (
            <button type="button" key={s} className={active ? "active" : ""} aria-pressed={active} onClick={() => set("margins", stepValue(s, MARGINS))}>
              {s}
            </button>
          );
        })}
      </div>

      <h4>Paragraph</h4>
      <div className="seg" style={{ ["--cols" as any]: 2 }}>
        <button type="button" className={!prefs.justify ? "active" : ""} aria-pressed={!prefs.justify} onClick={() => set("justify", false)}>Left</button>
        <button type="button" className={prefs.justify ? "active" : ""} aria-pressed={prefs.justify} onClick={() => set("justify", true)}>Justify</button>
      </div>

      <h4>Hyphenation</h4>
      <div className="seg" style={{ ["--cols" as any]: 2 }}>
        <button type="button" className={!prefs.hyphenate ? "active" : ""} aria-pressed={!prefs.hyphenate} onClick={() => set("hyphenate", false)}>Off</button>
        <button type="button" className={prefs.hyphenate ? "active" : ""} aria-pressed={prefs.hyphenate} onClick={() => set("hyphenate", true)}>On</button>
      </div>

      <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
        <button type="button" onClick={onClose} className="btn btn-ghost" aria-label="Close preferences">Done</button>
      </div>
    </aside>
  );
}
