import Link from "next/link";
import { q } from "@/lib/db";
import { currentEmail } from "@/lib/user";
import ArchivedCard from "@/components/ArchivedCard";
import AppNav from "@/components/AppNav";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  title: string | null;
  author: string | null;
  word_count: number | null;
  chapter_idx: number | null;
  cover_path: string | null;
  chapter_count: number | null;
};

export default async function Archived() {
  const email = await currentEmail();
  const rows = await q<Row>(
    `SELECT b.id, b.title, b.author, b.word_count, b.cover_path,
            p.chapter_idx,
            (SELECT COUNT(*)::int FROM chapters c WHERE c.book_id = b.id) AS chapter_count
       FROM books b LEFT JOIN progress p ON p.book_id = b.id AND p.owner_email = $1
      WHERE b.owner_email = $1 AND b.archived = true
      ORDER BY b.updated_at DESC`,
    [email]
  );

  return (
    <>
      <AppNav active="settings" email={email} showResume={false} />
      <div className="page">
        <section style={{ padding: "40px 0 24px", borderBottom: "1px solid var(--line)", marginBottom: 32 }}>
          <div className="mono" style={{ marginBottom: 12 }}>Library · Archived</div>
          <h1 className="display" style={{ fontSize: "clamp(36px, 4vw, 52px)" }}>Old reads, quietly kept.</h1>
          <p style={{ fontSize: 15, color: "var(--ink-2)", maxWidth: 520, marginTop: 12 }}>
            {rows.length} {rows.length === 1 ? "book" : "books"} archived. They stay accessible here — unarchive any time to bring them back to the main list.
          </p>
        </section>

        {rows.length === 0 ? (
          <section className="empty">
            <div style={{ fontSize: 56, lineHeight: 1, marginBottom: 18 }}>📚</div>
            <h2>Nothing archived yet.</h2>
            <p>Finish a book and archive it from its menu, or from the reader's end-of-book prompt. It'll live here, out of the way.</p>
            <div className="empty-actions">
              <Link href="/" className="btn btn-primary">Back to library</Link>
            </div>
          </section>
        ) : (
          <div className="book-list" role="list">
            {rows.map((r, i) => (
              <ArchivedCard
                key={r.id}
                id={r.id}
                index={i}
                title={r.title}
                author={r.author}
                wordCount={r.word_count}
                chapterIdx={r.chapter_idx}
                chapterCount={r.chapter_count}
                hasCover={!!r.cover_path}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
