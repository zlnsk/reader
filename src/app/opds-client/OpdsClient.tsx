"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/csrf-client";

const BP = process.env.NEXT_PUBLIC_BASE_PATH || "/Reader";

type Catalog = { id: string; title: string; url: string; username: string | null; has_password: boolean; created_at: string };
type FeedLink = { rel: string; href: string; type?: string; title?: string };
type Entry = { id: string; title: string; authors: string[]; summary?: string; content?: string; links: FeedLink[] };
type Feed = { title: string; subtitle?: string; links: FeedLink[]; entries: Entry[] };
type Browse = { kind: "atom"; feed: Feed; url: string } | { kind: "opds2-json"; json: any; url: string };

function findHref(links: FeedLink[] | undefined, rel: string): string | undefined {
  return links?.find((l) => l.rel === rel)?.href;
}
function pickAcquisition(links: FeedLink[]): FeedLink | undefined {
  return (
    links.find((l) => l.rel === "http://opds-spec.org/acquisition/open-access") ||
    links.find((l) => l.rel === "http://opds-spec.org/acquisition") ||
    links.find((l) => l.rel.startsWith("http://opds-spec.org/acquisition"))
  );
}
function pickCover(links: FeedLink[]): FeedLink | undefined {
  return (
    links.find((l) => l.rel === "http://opds-spec.org/image/thumbnail") ||
    links.find((l) => l.rel === "http://opds-spec.org/image") ||
    links.find((l) => l.rel === "http://opds-spec.org/cover") ||
    links.find((l) => l.rel === "http://opds-spec.org/thumbnail")
  );
}
function isNavEntry(e: Entry): boolean {
  const hasAcq = e.links.some((l) => l.rel.startsWith("http://opds-spec.org/acquisition"));
  if (hasAcq) return false;
  return e.links.some((l) => (l.type || "").includes("application/atom+xml") || l.rel === "subsection" || l.rel === "http://opds-spec.org/sort/new" || l.rel === "http://opds-spec.org/sort/popular");
}

export default function OpdsClient({ email }: { email: string }) {
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [browse, setBrowse] = useState<Browse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [importing, setImporting] = useState<Record<string, boolean>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ title: "", url: "", username: "", password: "" });

  const loadCatalogs = useCallback(async () => {
    const r = await fetch(`${BP}/api/opds-client/catalogs`);
    const j = await r.json();
    setCatalogs(j.catalogs || []);
  }, []);
  useEffect(() => { loadCatalogs(); }, [loadCatalogs]);

  const active = useMemo(() => catalogs.find((c) => c.id === activeId) || null, [catalogs, activeId]);

  const doBrowse = useCallback(async (catalogId: string, url: string) => {
    setLoading(true); setErr(null); setBrowse(null);
    try {
      const r = await fetch(`${BP}/api/opds-client/browse?catalogId=${encodeURIComponent(catalogId)}&url=${encodeURIComponent(url)}`);
      if (!r.ok) throw new Error((await r.json()).error || r.statusText);
      setBrowse(await r.json());
    } catch (e: any) { setErr(String(e.message || e)); }
    finally { setLoading(false); }
  }, []);

  const openCatalog = useCallback((c: Catalog) => {
    setActiveId(c.id);
    doBrowse(c.id, c.url);
  }, [doBrowse]);

  const onAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const r = await apiFetch(`${BP}/api/opds-client/catalogs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          url: form.url.trim(),
          username: form.username.trim() || null,
          password: form.password || null,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error || r.statusText);
      setAddOpen(false);
      setForm({ title: "", url: "", username: "", password: "" });
      loadCatalogs();
    } catch (e: any) { setErr(String(e.message || e)); }
  };

  const onDelete = async (id: string) => {
    if (!confirm("Remove this catalog?")) return;
    await apiFetch(`${BP}/api/opds-client/catalogs/${id}`, { method: "DELETE" });
    if (activeId === id) { setActiveId(null); setBrowse(null); }
    loadCatalogs();
  };

  const onImport = async (entry: Entry) => {
    if (!active) return;
    const acq = pickAcquisition(entry.links);
    if (!acq) { alert("No downloadable file on this entry."); return; }
    setImporting((s) => ({ ...s, [entry.id]: true }));
    try {
      const r = await apiFetch(`${BP}/api/opds-client/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          catalogId: active.id,
          url: acq.href,
          title: entry.title,
          author: entry.authors.join(", ") || null,
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error || r.statusText);
      alert("Importing. Open Library to watch progress.");
    } catch (e: any) { alert(`Import failed: ${e.message || e}`); }
    finally { setImporting((s) => ({ ...s, [entry.id]: false })); }
  };

  const renderFeed = (feed: Feed, catalogId: string) => {
    const next = findHref(feed.links, "next");
    const prev = findHref(feed.links, "previous");
    const topLinks = (feed.links || []).filter((l) => ["up", "start", "first", "last"].includes(l.rel));
    return (
      <div>
        {topLinks.length > 0 && (
          <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            {topLinks.map((l) => (
              <button key={l.rel + l.href} className="btn-ghost" onClick={() => doBrowse(catalogId, l.href)}>
                {l.title || l.rel}
              </button>
            ))}
          </div>
        )}
        <h3 style={{ margin: "0 0 8px", font: "var(--m3-title-lg)" }}>{feed.title}</h3>
        {feed.subtitle && <div style={{ opacity: 0.7, fontSize: 13, marginBottom: 16 }}>{feed.subtitle}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
          {feed.entries.map((e, idx) => {
            const nav = isNavEntry(e);
            const cover = pickCover(e.links);
            const acq = pickAcquisition(e.links);
            const navLink = nav ? e.links.find((l) => (l.type || "").includes("application/atom+xml")) || e.links[0] : null;
            return (
              <div key={`${e.id}-${idx}`} className="opds-card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {cover && !nav && (
                  <img
                    src={cover.href}
                    alt=""
                    style={{ width: "100%", aspectRatio: "3/4", objectFit: "cover", borderRadius: 8, background: "rgba(0,0,0,0.05)" }}
                    onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                  />
                )}
                <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{e.title}</div>
                {e.authors.length > 0 && <div style={{ fontSize: 12, opacity: 0.7 }}>{e.authors.join(", ")}</div>}
                {(e.summary || e.content) && (
                  <div style={{ fontSize: 12, opacity: 0.65, maxHeight: 60, overflow: "hidden", lineHeight: 1.4 }}>
                    {(e.summary || e.content || "").slice(0, 160)}
                  </div>
                )}
                <div style={{ marginTop: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {nav && navLink && (
                    <button className="btn-ghost" onClick={() => doBrowse(catalogId, navLink.href)}>Open</button>
                  )}
                  {acq && (
                    <button className="btn-primary" onClick={() => onImport(e)} disabled={!!importing[e.id]}>
                      {importing[e.id] ? "Importing…" : "Import"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {(prev || next) && (
          <div style={{ marginTop: 20, display: "flex", gap: 8, justifyContent: "center" }}>
            {prev && <button className="btn-ghost" onClick={() => doBrowse(catalogId, prev)}>← Previous</button>}
            {next && <button className="btn-ghost" onClick={() => doBrowse(catalogId, next)}>Next →</button>}
          </div>
        )}
      </div>
    );
  };

  return (
    <main className="app-shell">
      <header className="lib-header">
        <div className="hero lib-header-title">
          <h1 className="m3-brand-title">OPDS</h1>
          <div className="lib-header-sub">{email}</div>
        </div>
        <div className="lib-header-actions">
          <button className="btn-ghost" onClick={() => setAddOpen((v) => !v)}>
            {addOpen ? "Cancel" : "+ Add catalog"}
          </button>
          <Link href="/settings" className="btn-ghost">Settings</Link>
          <Link href="/" className="btn-ghost">Library</Link>
        </div>
      </header>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "var(--m3-space-4, 16px) var(--m3-space-5, 24px)", width: "100%" }}>
        {addOpen && (
          <form onSubmit={onAdd} className="opds-card" style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 8 }}>
            <input className="opds-input" placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            <input className="opds-input" placeholder="OPDS URL" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} required />
            <input className="opds-input" placeholder="Username (optional)" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            <input className="opds-input" placeholder="Password (optional)" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button type="submit" className="btn-primary">Save</button>
              <span style={{ fontSize: 12, opacity: 0.6 }}>
                Try: https://standardebooks.org/opds, http://opds.gutenberg.org/
              </span>
            </div>
          </form>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 24 }} className="opds-layout">
          <aside>
            <h3 style={{ margin: "0 0 8px", font: "var(--m3-title-md)" }}>Catalogs</h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {catalogs.map((c) => (
                <li key={c.id} style={{ display: "flex", gap: 6 }}>
                  <button
                    className="btn-ghost"
                    style={{ flex: 1, justifyContent: "flex-start", fontWeight: activeId === c.id ? 700 : 400 }}
                    onClick={() => openCatalog(c)}
                  >
                    {c.title}
                  </button>
                  <button className="btn-ghost" style={{ color: "#c33", padding: "0 12px" }} onClick={() => onDelete(c.id)}>×</button>
                </li>
              ))}
              {catalogs.length === 0 && <li style={{ opacity: 0.6, fontSize: 13 }}>No catalogs yet.</li>}
            </ul>
          </aside>

          <section>
            {err && <div style={{ color: "#c33", marginBottom: 12 }}>{err}</div>}
            {loading && <div style={{ opacity: 0.6 }}>Loading…</div>}
            {!loading && browse && active && browse.kind === "atom" && renderFeed(browse.feed, active.id)}
            {!loading && browse && browse.kind === "opds2-json" && (
              <div style={{ opacity: 0.7 }}>OPDS 2.0 JSON feed — rendering not yet supported. Open in browser: <a href={browse.url}>{browse.url}</a></div>
            )}
            {!loading && !browse && <div style={{ opacity: 0.6 }}>Select a catalog on the left, or add one.</div>}
          </section>
        </div>
      </div>
    </main>
  );
}
