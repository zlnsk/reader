"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/csrf-client";

const BP = process.env.NEXT_PUBLIC_BASE_PATH || "/Reader";

/** Archived book row — same shape as LibraryCard but the trailing menu offers
 *  Unarchive / Delete instead of Archive. */
export default function ArchivedCard({
  id,
  index,
  title,
  author,
  wordCount,
  chapterIdx,
  chapterCount,
  hasCover,
}: {
  id: string;
  index: number;
  title: string | null;
  author: string | null;
  wordCount: number | null;
  chapterIdx: number | null;
  chapterCount: number | null;
  hasCover: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [coverOk, setCoverOk] = useState(hasCover);
  const [menuOpen, setMenuOpen] = useState(false);

  async function onUnarchive(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    setMenuOpen(false);
    try {
      const res = await apiFetch(`${BP}/api/books/${id}/unarchive`, { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (err: any) {
      alert(`Unarchive failed: ${err.message}`);
      setBusy(false);
    }
  }

  async function onDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete "${title || "Untitled"}" permanently?`)) return;
    setBusy(true);
    setMenuOpen(false);
    try {
      const res = await apiFetch(`${BP}/api/books/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      router.refresh();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
      setBusy(false);
    }
  }

  const displayTitle = (title || "Untitled").replace(/\s+/g, " ").trim();
  const progressPct = chapterIdx != null && chapterCount
    ? Math.min(100, Math.round((chapterIdx / chapterCount) * 100))
    : 0;
  const pages = wordCount ? Math.max(1, Math.round(wordCount / 250)) : null;
  const numLabel = String(index + 1).padStart(3, "0");

  return (
    <Link
      href={`/book/${id}`}
      className="book-row"
      style={{ opacity: busy ? 0.5 : 0.9 }}
      aria-label={`${displayTitle} (archived)`}
    >
      <span className="n">{numLabel}</span>
      <div
        className="mini-cover cover"
        style={{
          ["--cover-bg" as any]: "linear-gradient(160deg,#3F3A34,#1c1a17)",
          padding: coverOk ? 0 : "6px 4px",
        }}
      >
        {coverOk ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${BP}/api/books/${id}/cover`}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setCoverOk(false)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : null}
      </div>
      <div style={{ minWidth: 0 }}>
        <h3 className="tl" className="trunc-2">
          {displayTitle}
        </h3>
        <div className="at" className="trunc-1">
          {author || ""}{pages ? ` · ${pages} pages` : ""}
        </div>
      </div>
      <div className="prog" aria-label={`${progressPct}% read`}>
        <div className="bar"><div className="bar-fill" style={{ width: `${progressPct}%` }} /></div>
        <span className="p">{progressPct > 0 ? `${progressPct}%` : "—"}</span>
      </div>
      <div className="meta"><span>Archived</span></div>
      <div
        style={{ position: "relative" }}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
      >
        <button
          type="button"
          className="menu"
          aria-label={`Actions for ${displayTitle}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuOpen((v) => !v); }}
        >
          <svg className="icn" viewBox="0 0 24 24"><circle cx="6" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="18" cy="12" r="1" /></svg>
        </button>
        {menuOpen ? (
          <div className="row-menu" role="menu">
            <button type="button" role="menuitem" onClick={onUnarchive} disabled={busy}>Unarchive</button>
            <button type="button" role="menuitem" className="danger" onClick={onDelete} disabled={busy}>Delete permanently…</button>
          </div>
        ) : null}
      </div>
    </Link>
  );
}
