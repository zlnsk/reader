import Link from "next/link";
import { q } from "@/lib/db";
import { requirePageEmail } from "@/lib/user";
import LibraryCard from "@/components/LibraryCard";
import UploadBanner from "@/components/UploadBanner";
import AppNav from "@/components/AppNav";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  title: string | null;
  author: string | null;
  status: string;
  word_count: number | null;
  created_at: string;
  updated_at: string;
  chapter_idx: number | null;
  paragraph_idx: number | null;
  progress_updated_at: string | null;
  cover_path: string | null;
  chapter_count: number | null;
  finished_prompted_at_ms: number | null;
};

// Rough reading rate: ~250 words per minute.
const WPM = 250;

function greeting(): { eyebrow: string; line: string } {
  const now = new Date();
  const hour = now.getHours();
  let greet = "Hello";
  if (hour < 5) greet = "Good evening";
  else if (hour < 12) greet = "Good morning";
  else if (hour < 18) greet = "Good afternoon";
  else greet = "Good evening";
  const fmt = new Intl.DateTimeFormat("en", { weekday: "long", day: "numeric", month: "long" });
  return { eyebrow: `Library · ${fmt.format(now)}`, line: greet };
}

function minutesLeft(chapterIdx: number | null, chapterCount: number | null, wordCount: number | null): number | null {
  if (!chapterCount || !wordCount) return null;
  const done = chapterIdx != null ? Math.min(chapterIdx, chapterCount) : 0;
  const remaining = Math.max(0, 1 - done / chapterCount);
  const mins = Math.round((wordCount * remaining) / WPM);
  return mins > 0 ? mins : null;
}

function firstName(email: string | null | undefined): string {
  if (!email) return "friend";
  const local = email.split("@")[0];
  const clean = local.replace(/[._-]+/g, " ").trim();
  if (!clean) return "friend";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export default async function Library({ searchParams }: { searchParams?: Promise<{ new?: string; dup?: string; filter?: string }> }) {
  const sp = (await searchParams) || {};
  const newId = sp.new || null;
  const dupId = sp.dup || null;
  const highlightId = newId || dupId;
  const filter = (sp.filter || "all") as "all" | "reading" | "finished" | "want";

  const email = await requirePageEmail();
  const rows = await q<Row>(
    `SELECT b.id, b.title, b.author, b.status, b.word_count, b.created_at, b.updated_at, b.cover_path,
            p.chapter_idx, p.paragraph_idx, p.updated_at AS progress_updated_at,
            extract(epoch from b.finished_prompted_at)*1000 AS finished_prompted_at_ms,
            (SELECT COUNT(*)::int FROM chapters c WHERE c.book_id = b.id) AS chapter_count
       FROM books b LEFT JOIN progress p ON p.book_id = b.id AND p.owner_email = $1
       WHERE b.owner_email = $1 AND b.archived = false ORDER BY b.created_at DESC`,
    [email]
  );
  const prefsRows = await q<{ json: any }>(
    `SELECT json FROM prefs WHERE owner_email = $1`,
    [email]
  );
  const kindleEnabled: boolean = Boolean(prefsRows[0]?.json?.kindleEmail);

  const archivedCountRows = await q<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM books WHERE owner_email = $1 AND archived = true`,
    [email]
  );
  const archivedCount = archivedCountRows[0]?.c ?? 0;

  const dupTitle = dupId ? rows.find((r) => r.id === dupId)?.title ?? null : null;
  const newTitle = newId ? rows.find((r) => r.id === newId)?.title ?? null : null;

  // Stats + continue-reading hero.
  const totalBooks = rows.length;
  const totalWords = rows.reduce((a, r) => a + (r.word_count || 0), 0);
  const hoursOfReading = Math.max(0, Math.round(totalWords / WPM / 60));
  const inProgress = rows
    .filter((r) => r.status === "ready" && r.chapter_count && ((r.chapter_idx != null && r.chapter_idx > 0 && r.chapter_idx < r.chapter_count) || (r.progress_updated_at != null && (r.paragraph_idx ?? 0) > 0)))
    .sort((a, b) => {
      const at = a.progress_updated_at ? Date.parse(a.progress_updated_at) : 0;
      const bt = b.progress_updated_at ? Date.parse(b.progress_updated_at) : 0;
      return bt - at;
    });
  const cr = inProgress[0] || null;
  const crPct = cr && cr.chapter_count
    ? Math.min(100, Math.round((cr.chapter_idx! / cr.chapter_count) * 100))
    : 0;
  const crMins = cr ? minutesLeft(cr.chapter_idx, cr.chapter_count, cr.word_count) : null;
  const crEta = crMins ? (crMins >= 60 ? `${Math.floor(crMins / 60)}h ${crMins % 60}m` : `${crMins}m`) : null;

  const filtered = rows.filter((r) => {
    if (filter === "reading") return r.status === "ready" && r.chapter_idx != null && r.chapter_idx > 0 && r.chapter_idx < (r.chapter_count ?? 0);
    if (filter === "finished") return r.status === "ready" && r.chapter_count && r.chapter_idx != null && r.chapter_idx >= r.chapter_count;
    if (filter === "want") return r.status === "ready" && (!r.chapter_idx || r.chapter_idx === 0);
    return true;
  });

  const g = greeting();
  const name = firstName(email);

  return (
    <>
      <AppNav active="library" email={email} resumeHref={cr ? `/book/${cr.id}` : "/"} showResume={!!cr} />

      <div className="page">
        {newId ? <UploadBanner kind="new" title={newTitle} /> : null}
        {dupId ? <UploadBanner kind="dup" title={dupTitle} /> : null}

        {rows.length === 0 ? (
          <section className="empty">
            <div style={{ fontSize: 64, lineHeight: 1, marginBottom: 18 }}>📖</div>
            <h2>Your library is empty.</h2>
            <p>Upload an EPUB, PDF, or MOBI — or search LibGen / your OPDS catalogues — and we'll clean it up, break it into chapters, and start rendering it for comfortable reading.</p>
            <div className="empty-actions">
              <Link href="/upload" className="btn btn-primary">Upload a book</Link>
              <Link href="/search" className="btn btn-outline">Discover</Link>
            </div>
          </section>
        ) : (
          <>
            <section className="hero">
              <div>
                <div className="greeting-row">
                  <div className="mono">{g.eyebrow}</div>
                  {totalBooks > 0 ? <div className="streak"><span className="dot" />{totalBooks} {totalBooks === 1 ? "book" : "books"} · ember</div> : null}
                </div>
                <h1 className="greeting">
                  {g.line},<br />
                  <em>{name}.</em>
                </h1>
                <p className="greeting-sub">
                  {cr ? (
                    <>You're <strong>{crPct}%</strong> through <em>{cr.title || "Untitled"}</em>
                    {crEta ? <> — about <strong>{crEta}</strong> of reading left.</> : <>.</>}
                    </>
                  ) : (
                    <>Welcome back. Pick a book below, or head to Discover to add something new.</>
                  )}
                </p>
                <div className="stats">
                  <div className="stat">
                    <div className="v">{totalBooks}<span className="u">books</span></div>
                    <div className="mono">In library</div>
                  </div>
                  <div className="stat">
                    <div className="v">{hoursOfReading}<span className="u">h</span></div>
                    <div className="mono">Content queued</div>
                  </div>
                  <div className="stat">
                    <div className="v">{inProgress.length}</div>
                    <div className="mono">In progress</div>
                  </div>
                  <div className="stat">
                    <div className="v">{archivedCount}</div>
                    <div className="mono">Archived</div>
                  </div>
                </div>
              </div>

              {cr ? (
                <div className="cr-card">
                  {cr.cover_path ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className="photo-cover"
                      src={`/Reader/api/books/${cr.id}/cover`}
                      alt=""
                      loading="eager"
                      decoding="async"
                    />
                  ) : (
                    <div className="photo-ink" />
                  )}
                  <div className="body">
                    <div className="mono">Continue reading</div>
                    <h3 className="ttl">{cr.title || "Untitled"}</h3>
                    <div className="aut">{cr.author || "Unknown author"}{cr.chapter_idx != null && cr.chapter_count ? ` · chapter ${cr.chapter_idx + 1} of ${cr.chapter_count}` : ""}</div>
                    <div className="progress-row">
                      <span>{crPct}%</span>
                      <div className="bar"><div className="bar-fill" style={{ width: `${crPct}%` }} /></div>
                      <span>{crEta ? `${crEta} left` : ""}</span>
                    </div>
                    <Link href={`/book/${cr.id}`} className="resume">
                      <span>Resume reading</span>
                      <span className="arr">→</span>
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="cr-card">
                  <div className="photo-ink" />
                  <div className="body">
                    <div className="mono">Start somewhere</div>
                    <h3 className="ttl">No book in progress.</h3>
                    <div className="aut">Pick a book below, or add one on Discover.</div>
                    <div style={{ height: 24 }} />
                    <Link href="/search" className="resume">
                      <span>Discover books</span>
                      <span className="arr">→</span>
                    </Link>
                  </div>
                </div>
              )}
            </section>

            <div className="sec-head">
              <h2>Your books</h2>
              <div className="tools">
                {(["all", "reading", "finished", "want"] as const).map((f) => (
                  <Link
                    key={f}
                    href={f === "all" ? "/" : `/?filter=${f}`}
                    className={`chip${filter === f ? " active" : ""}`}
                  >
                    {f === "all" ? "All" : f === "reading" ? "Reading" : f === "finished" ? "Finished" : "Want to read"}
                  </Link>
                ))}
              </div>
            </div>

            <div className="book-list" role="list">
              {filtered.map((r, i) => {
                const finished = !!(r.chapter_count && r.chapter_idx != null && r.chapter_idx >= r.chapter_count);
                const mins = minutesLeft(r.chapter_idx, r.chapter_count, r.word_count);
                return (
                  <LibraryCard kindleEnabled={kindleEnabled}
                    key={r.id}
                    id={r.id}
                    index={i}
                    title={r.title}
                    author={r.author}
                    status={r.status}
                    wordCount={r.word_count}
                    chapterIdx={r.chapter_idx}
                    chapterCount={r.chapter_count}
                    hasCover={!!r.cover_path}
                    highlight={r.id === highlightId ? (newId ? "new" : "dup") : null}
                    estimatedMinutes={mins}
                    finished={finished}
                  />
                );
              })}
              {filtered.length === 0 ? (
                <div style={{ padding: "48px 16px", textAlign: "center", color: "var(--ink-2)" }}>
                  Nothing here yet.{" "}
                  <Link href="/" style={{ color: "var(--accent-ink)", fontWeight: 600 }}>Show all</Link>
                </div>
              ) : null}
            </div>

            <div className="sec-head">
              <h2>Quick actions</h2>
              <Link href="/settings" className="mono" style={{ color: "var(--accent-ink)" }}>All settings →</Link>
            </div>
            <div className="collections">
              <Link href="/search" className="coll">
                <div className="stack">
                  <div className="cover" style={{ ["--cover-bg" as any]: "linear-gradient(160deg,#2a1c10,#5a3a1e)" }} />
                  <div className="cover" style={{ ["--cover-bg" as any]: "linear-gradient(160deg,#3D5A6C,#1f3440)" }} />
                  <div className="cover" style={{ ["--cover-bg" as any]: "linear-gradient(160deg,#8B3A3A,#4a1f1f)" }} />
                </div>
                <h3 className="tl">Discover</h3>
                <div className="ct">Search LibGen · 48,000 titles</div>
              </Link>
              <Link href="/opds-client" className="coll">
                <div className="stack">
                  <div className="cover" style={{ ["--cover-bg" as any]: "linear-gradient(160deg,#6B7A4F,#3f4a2a)" }} />
                  <div className="cover" style={{ ["--cover-bg" as any]: "linear-gradient(160deg,#A68A3E,#5a471c)" }} />
                  <div className="cover" style={{ ["--cover-bg" as any]: "linear-gradient(160deg,#C4622A,#6e3212)" }} />
                </div>
                <h3 className="tl">OPDS catalogs</h3>
                <div className="ct">Calibre · Standard Ebooks · Gutenberg</div>
              </Link>
              <Link href="/upload" className="coll">
                <div className="stack">
                  <div className="cover" style={{ ["--cover-bg" as any]: "linear-gradient(160deg,#8B4A6B,#4a2335)" }} />
                  <div className="cover" style={{ ["--cover-bg" as any]: "linear-gradient(160deg,#5E4AE3,#2f2480)" }} />
                  <div className="cover" style={{ ["--cover-bg" as any]: "linear-gradient(160deg,#4A6B8B,#253a50)" }} />
                </div>
                <h3 className="tl">Upload files</h3>
                <div className="ct">EPUB · PDF · MOBI · TXT</div>
              </Link>
              <Link href="/archived" className="coll">
                <div className="stack">
                  <div className="cover" style={{ ["--cover-bg" as any]: "linear-gradient(160deg,#3F7D58,#1f4330)" }} />
                  <div className="cover" style={{ ["--cover-bg" as any]: "linear-gradient(160deg,#C4622A,#6e3212)" }} />
                  <div className="cover" style={{ ["--cover-bg" as any]: "linear-gradient(160deg,#2a1c10,#5a3a1e)" }} />
                </div>
                <h3 className="tl">Archived</h3>
                <div className="ct">{archivedCount} {archivedCount === 1 ? "book" : "books"} · old reads</div>
              </Link>
            </div>
          </>
        )}
      </div>

      <footer className="foot">
        <div className="foot-inner">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="logo-mark">R</span>
            <span style={{ fontFamily: "var(--reader-serif)", fontSize: 18, color: "var(--ink)" }}>Reader</span>
            <span style={{ marginLeft: 16 }}>{email}</span>
          </div>
          <div style={{ display: "flex", gap: 24 }}>
            <Link href="/settings/app-passwords">App passwords</Link>
            <Link href="/archived">Archived</Link>
            <a href="/Reader/api/auth/logout">Sign out</a>
          </div>
        </div>
      </footer>
    </>
  );
}
