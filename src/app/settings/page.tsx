import Link from "next/link";
import { q } from "@/lib/db";
import { requirePageEmail } from "@/lib/user";
import AppNav from "@/components/AppNav";
import KindleSettingsClient from "./KindleSettingsClient";

export const dynamic = "force-dynamic";

type Item = { href: string; label: string; desc: string };

export default async function SettingsPage() {
  const email = await requirePageEmail();
  const prefsRows = await q<{ json: any }>(
    `SELECT json FROM prefs WHERE owner_email = $1`,
    [email]
  );
  const kindleEmail: string = (prefsRows[0]?.json?.kindleEmail as string) || "";

  const archived = await q<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM books WHERE owner_email = $1 AND archived = true`,
    [email]
  );
  const archivedCount = archived[0]?.c ?? 0;

  const items: Item[] = [
    { href: "/search", label: "Discover", desc: "Search LibGen, browse OPDS, or upload files." },
    { href: "/opds-client", label: "OPDS catalogs", desc: "Browse external OPDS catalogs (Calibre, Standard Ebooks, Gutenberg…) and import into your library." },
    { href: "/settings/app-passwords", label: "App passwords", desc: "Create passwords for e-reader apps (KOReader, Thorium, Moon+ Reader) so they can read your library over OPDS." },
    { href: "/archived", label: `Archived books${archivedCount ? ` (${archivedCount})` : ""}`, desc: "Books you've finished or set aside." },
  ];

  return (
    <>
      <AppNav active="settings" email={email} showResume={false} />
      <div className="page" style={{ maxWidth: 860 }}>
        <section style={{ padding: "40px 0 24px", borderBottom: "1px solid var(--line)", marginBottom: 32 }}>
          <div className="mono" style={{ marginBottom: 12 }}>Account · Settings</div>
          <h1 className="display" style={{ fontSize: "clamp(36px, 4vw, 52px)" }}>Your Reader, your way.</h1>
          <p style={{ fontSize: 15, color: "var(--ink-2)", maxWidth: 560, marginTop: 12 }}>
            Signed in as <strong>{email}</strong>. Typography and theme live in the reader's Aa button — everything else is here.
          </p>
        </section>

        <KindleSettingsClient initialEmail={kindleEmail} />

        <ul className="settings-list">
          {items.map((it) => (
            <li key={it.href}>
              <Link href={it.href}>
                <div className="s-ttl">{it.label}</div>
                <div className="s-desc">{it.desc}</div>
              </Link>
            </li>
          ))}
        </ul>

        <div style={{ marginTop: 48, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link href="/" className="btn btn-outline">← Back to library</Link>
          <a href="/Reader/api/auth/logout" className="btn btn-ghost">Sign out</a>
        </div>
      </div>
    </>
  );
}
