"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

export type NavActive = "library" | "discover" | "settings" | null;

type Theme = "paper" | "sepia" | "dark";
const THEME_KEY = "reader-theme";

function readInitialTheme(): Theme {
  if (typeof window === "undefined") return "paper";
  try {
    const raw = localStorage.getItem(THEME_KEY);
    const coerced = raw === "light" ? "paper" : raw === "solarized" ? "sepia" : raw;
    if (coerced === "paper" || coerced === "sepia" || coerced === "dark") return coerced;
  } catch {}
  return "paper";
}

/**
 * Top navigation shared between Library / Discover / Settings. Keeps the
 * theme switch persistent (localStorage + <html data-theme>) and exposes
 * the ember accent with the current active link underlined.
 */
export default function AppNav({
  active,
  email,
  resumeHref = "/",
  showResume = true,
}: {
  active?: NavActive;
  email?: string | null;
  resumeHref?: string;
  showResume?: boolean;
}) {
  const [theme, setTheme] = useState<Theme>("paper");

  useEffect(() => { setTheme(readInitialTheme()); }, []);

  const applyTheme = useCallback((t: Theme) => {
    setTheme(t);
    try {
      document.documentElement.setAttribute("data-theme", t);
      document.documentElement.style.colorScheme = t === "dark" ? "dark" : "light";
      localStorage.setItem(THEME_KEY, t);
    } catch {}
  }, []);

  const initial = email?.trim()?.[0]?.toUpperCase() || "L";
  const themeLabels: Array<{ t: Theme; label: string }> = [
    { t: "paper", label: "Paper" },
    { t: "sepia", label: "Sepia" },
    { t: "dark", label: "OLED" },
  ];

  return (
    <nav className="nav">
      <div className="nav-inner">
        <Link href="/" className="logo" aria-label="Reader home">
          <span className="logo-mark">R</span>
          <span>Reader</span>
        </Link>
        <div className="nav-links">
          <Link href="/" className={active === "library" ? "active" : ""}>Library</Link>
          <Link href="/search" className={active === "discover" ? "active" : ""}>Discover</Link>
          <Link href="/settings" className={active === "settings" ? "active" : ""}>Settings</Link>
        </div>
        <div className="nav-actions">
          <div className="theme-switch" role="group" aria-label="Colour theme">
            {themeLabels.map(({ t, label }) => (
              <button
                key={t}
                type="button"
                className={theme === t ? "active" : ""}
                onClick={() => applyTheme(t)}
                aria-pressed={theme === t}
                title={label}
              >
                {label}
              </button>
            ))}
          </div>
          {showResume ? (
            <a
              href={resumeHref}
              className="btn btn-primary"
              aria-label="Resume reading"
              onClick={(e) => {
                const BP = process.env.NEXT_PUBLIC_BASE_PATH || "/Reader";
                const href = resumeHref.startsWith(BP) ? resumeHref : BP + (resumeHref.startsWith("/") ? resumeHref : "/" + resumeHref);
                // Force a full navigation — avoids a Next.js client-router
                // quirk where a Link from library to /book/<id> can resolve
                // to a stale route-tree when the book page was loaded in
                // this tab before.
                if (!resumeHref || resumeHref === "/") return;
                e.preventDefault();
                window.location.assign(href);
              }}
            >
              <svg className="icn" viewBox="0 0 24 24" style={{ width: 14, height: 14 }} aria-hidden><path d="M5 4v16l7-4 7 4V4z" /></svg>
              Resume
            </a>
          ) : null}
          <div className="avatar" aria-hidden>{initial}</div>
        </div>
      </div>
    </nav>
  );
}
