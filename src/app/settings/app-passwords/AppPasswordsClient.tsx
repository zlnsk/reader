"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/csrf-client";

type Pwd = { id: string; label: string; created_at: string; last_used_at: string | null };

const BP = process.env.NEXT_PUBLIC_BASE_PATH || "/Reader";

export default function AppPasswordsClient({ email }: { email: string }) {
  const [list, setList] = useState<Pwd[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [justCreated, setJustCreated] = useState<{ label: string; password: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BP}/api/app-passwords`);
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      setList(j.passwords || []);
    } catch (e: any) { setErr(String(e.message || e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    const trimmed = label.trim();
    if (!trimmed) { setErr("Label required"); return; }
    try {
      const r = await apiFetch(`${BP}/api/app-passwords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed }),
      });
      if (!r.ok) throw new Error((await r.json()).error || r.statusText);
      const j = await r.json();
      setJustCreated({ label: j.label, password: j.password });
      setLabel("");
      load();
    } catch (e: any) { setErr(String(e.message || e)); }
  };

  const onDelete = async (id: string) => {
    if (!confirm("Delete this app password? Clients using it will lose access.")) return;
    try {
      const r = await apiFetch(`${BP}/api/app-passwords/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
      load();
    } catch (e: any) { setErr(String(e.message || e)); }
  };

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const opdsUrl = `${origin}${BP}/opds`;

  return (
    <main className="app-shell">
      <header className="lib-header">
        <div className="hero lib-header-title">
          <h1 className="m3-brand-title">APP PASSWORDS</h1>
          <div className="lib-header-sub">{email}</div>
        </div>
        <div className="lib-header-actions">
          <Link href="/settings" className="btn-ghost">Settings</Link>
          <Link href="/" className="btn-ghost">Library</Link>
        </div>
      </header>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "var(--m3-space-4, 16px) var(--m3-space-5, 24px)", width: "100%", display: "flex", flexDirection: "column", gap: 20 }}>
        <section className="opds-card">
          <h2 className="opds-card-title">OPDS catalog URL</h2>
          <code className="opds-code">{opdsUrl}</code>
          <p className="opds-help">
            Point your OPDS reader (KOReader, Thorium, Moon+ Reader, Aldiko) at the URL above. Sign in with your Reader email ({email}) and an app password below.
          </p>
        </section>

        {justCreated && (
          <section className="opds-card" style={{ borderColor: "rgba(80,160,255,0.6)" }}>
            <h2 className="opds-card-title">New password for &quot;{justCreated.label}&quot;</h2>
            <p className="opds-help" style={{ marginTop: 0 }}>Copy this now. It will not be shown again.</p>
            <code className="opds-code" style={{ fontSize: 15, letterSpacing: 1 }}>{justCreated.password}</code>
            <button className="btn-ghost" style={{ marginTop: 12 }} onClick={() => setJustCreated(null)}>Dismiss</button>
          </section>
        )}

        <form onSubmit={onCreate} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. KOReader on phone)"
            className="opds-input"
            maxLength={80}
          />
          <button type="submit" className="btn-primary">Create</button>
        </form>

        {err && <div style={{ color: "#c33" }}>{err}</div>}

        <section>
          {loading ? <div style={{ opacity: 0.6 }}>Loading…</div> : list.length === 0 ? (
            <div style={{ opacity: 0.6 }}>No app passwords yet. Create one above to enable OPDS access.</div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {list.map((p) => (
                <li key={p.id} className="opds-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{p.label}</div>
                    <div style={{ fontSize: 12, opacity: 0.65 }}>
                      Created {new Date(p.created_at).toLocaleDateString()}
                      {" · "}{p.last_used_at ? `last used ${new Date(p.last_used_at).toLocaleString()}` : "never used"}
                    </div>
                  </div>
                  <button className="btn-ghost" style={{ color: "#c33" }} onClick={() => onDelete(p.id)}>Delete</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
