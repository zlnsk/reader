"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Progress from "@/components/Progress";

const BP = process.env.NEXT_PUBLIC_BASE_PATH || "/Reader";

type Hit = { md5: string; title: string; author?: string; year?: string; language?: string; pages?: string; extension?: string; size?: string };

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [fmt, setFmt] = useState<"epub" | "pdf" | "any">("epub");
  const [hits, setHits] = useState<Hit[]>([]);
  const [formatCounts, setFormatCounts] = useState<Record<string, number>>({});
  const [totalRaw, setTotalRaw] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState<string>("");
  const [status, setStatus] = useState("");
  const router = useRouter();

  async function doSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true); setError(""); setHits([]);
    try {
      const res = await fetch(`${BP}/api/libgen/search?q=${encodeURIComponent(query)}&fmt=${fmt}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Search failed");
      setHits(body.hits || []);
      setFormatCounts(body.formatCounts || {});
      setTotalRaw(body.totalRaw || 0);
      if (!body.hits?.length && body.totalRaw === 0 && (body.note || body.error)) setError(body.note || body.error);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  const [pct, setPct] = useState(0);

  async function pick(h: Hit) {
    setDownloading(h.md5); setStatus("Fetching from LibGen"); setPct(0); setError("");
    try {
      const res = await fetch(`${BP}/api/libgen/download`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ md5: h.md5, title: h.title, author: h.author, extension: h.extension }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Download failed");
      const bookId = body.id;
      setStatus("Preparing");
      for (let i = 0; i < 600; i++) {
        await new Promise(r => setTimeout(r, 1200));
        const s = await fetch(`${BP}/api/books/${bookId}`).then(r => r.json());
        if (s.status === "ready") { router.push(`/book/${bookId}`); return; }
        if (s.status === "failed") throw new Error(s.error || "Extraction failed");
        setStatus(s.status_detail || "Extracting");
        setPct(Number(s.progress_pct || 0));
      }
      throw new Error("Extraction timed out");
    } catch (e: any) { setError(e.message); setDownloading(""); setPct(0); }
  }

  return (
    <main className="app-shell">
      <header style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "1.25rem 1.5rem", maxWidth: 960, margin: "0 auto", width: "100%" }}>
        <a href={BP} className="btn-ghost">← Library</a>
        <h1 style={{ fontSize: "1.1rem", fontWeight: 600, flex: 1 }}>Search LibGen</h1>
      </header>

      <form onSubmit={doSearch} style={{ maxWidth: 720, margin: "0 auto", padding: "0 1.5rem", display: "flex", gap: "0.5rem", width: "100%", flexWrap: "wrap" }}>
        <input
          autoFocus
          placeholder="Title, author, ISBN…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: "0.75rem 1rem", fontSize: "1rem", border: "1px solid color-mix(in srgb, var(--reader-fg) 18%, transparent)", borderRadius: 10, background: "transparent", color: "inherit", fontFamily: "inherit" }}
        />
        <div className="seg" style={{ display: "inline-flex", background: "color-mix(in srgb, var(--reader-fg) 6%, transparent)", borderRadius: 10, padding: 3, alignSelf: "center" }}>
          {(["epub", "pdf", "any"] as const).map((f) => (
            <button key={f} type="button" aria-pressed={fmt === f} onClick={() => setFmt(f)}
              style={{ background: fmt === f ? "var(--reader-bg)" : "none", border: 0, padding: "0.45rem 0.8rem", borderRadius: 8, font: "inherit", color: "inherit", cursor: "pointer", boxShadow: fmt === f ? "0 1px 3px rgba(0,0,0,.12)" : "none", fontWeight: fmt === f ? 500 : 400 }}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>
        <button className="btn-primary" disabled={busy}>{busy ? "Searching…" : "Search"}</button>
      </form>

      {error && <p style={{ maxWidth: 720, margin: "1rem auto", padding: "0 1.5rem", color: "#c0392b" }}>{error}</p>}
      {downloading ? (
        <div style={{ maxWidth: 720, margin: "1.2rem auto", padding: "0 1.5rem" }}>
          <Progress pct={pct} label={status || "Working"} indeterminate={pct === 0} />
        </div>
      ) : null}

      <div style={{ maxWidth: 760, margin: "1.5rem auto 5rem", padding: "0 1rem", width: "100%", display: "flex", flexDirection: "column", gap: "0.65rem" }}>
        {hits.map((h) => {
          const isBusy = downloading === h.md5;
          const extColor: Record<string, string> = {
            epub: "#0ea5a6", pdf: "#b91c1c", djvu: "#9333ea", mobi: "#b45309", azw3: "#b45309", txt: "#525252", fb2: "#2563eb",
          };
          const badgeColor = extColor[h.extension || ""] || "#525252";
          const meta = [h.year, h.language, h.pages && `${h.pages}p`, h.size].filter(Boolean).join(" · ");
          return (
            <div key={h.md5}
              style={{
                background: "color-mix(in srgb, var(--reader-fg) 2%, transparent)",
                border: "1px solid color-mix(in srgb, var(--reader-fg) 10%, transparent)",
                borderRadius: 12,
                padding: "0.9rem 1rem",
                display: "flex", alignItems: "center", gap: "0.9rem",
                opacity: downloading && !isBusy ? 0.45 : 1,
                transition: "opacity 0.15s",
              }}>
              <div style={{
                flexShrink: 0, width: 48, height: 48, borderRadius: 10,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: `color-mix(in srgb, ${badgeColor} 14%, transparent)`,
                color: badgeColor, fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.04em",
                fontFamily: "var(--reader-sans)",
              }}>
                {(h.extension || "?").toUpperCase()}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: "var(--reader-serif)", fontSize: "1.02rem", fontWeight: 500,
                  lineHeight: 1.3, color: "var(--reader-fg)",
                  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                }}>{h.title}</div>
                {h.author ? (
                  <div style={{ fontSize: "0.85rem", color: "var(--reader-muted)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {h.author}
                  </div>
                ) : null}
                {meta ? (
                  <div style={{ fontSize: "0.72rem", color: "var(--reader-muted)", marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
                    {meta}
                  </div>
                ) : null}
              </div>

              <button
                className="btn-primary"
                disabled={!!downloading}
                onClick={() => pick(h)}
                style={{ padding: "0.45rem 1rem", fontSize: "0.85rem", minWidth: 68 }}
              >
                {isBusy ? "…" : "Get"}
              </button>
            </div>
          );
        })}
        {!busy && hits.length === 0 && query && !error && totalRaw > 0 ? (
          <div style={{ textAlign: "center", padding: "2.5rem 1rem", color: "var(--reader-muted)" }}>
            <p style={{ fontFamily: "var(--reader-serif)", fontSize: "1.05rem", marginBottom: "0.8rem" }}>
              No <strong>{fmt.toUpperCase()}</strong> for &ldquo;{query}&rdquo;.
            </p>
            <p style={{ fontSize: "0.9rem", marginBottom: "1rem" }}>
              LibGen has {totalRaw} result{totalRaw === 1 ? "" : "s"} in other formats:
            </p>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", flexWrap: "wrap" }}>
              {Object.entries(formatCounts)
                .filter(([k]) => k !== fmt)
                .sort((a, b) => b[1] - a[1])
                .map(([k, n]) => (
                  <button key={k} className="btn-ghost" onClick={() => { setFmt(k as any); setTimeout(() => doSearch({ preventDefault: () => {} } as any), 0); }}>
                    {k.toUpperCase()} · {n}
                  </button>
                ))}
              <button className="btn-ghost" onClick={() => { setFmt("any"); setTimeout(() => doSearch({ preventDefault: () => {} } as any), 0); }}>
                Any format
              </button>
            </div>
          </div>
        ) : null}
        {!busy && hits.length === 0 && query && !error && totalRaw === 0 ? (
          <p style={{ color: "var(--reader-muted)", textAlign: "center", padding: "3rem 0", fontFamily: "var(--reader-serif)", fontStyle: "italic" }}>
            No results for &ldquo;{query}&rdquo;.
          </p>
        ) : null}
      </div>
    </main>
  );
}
