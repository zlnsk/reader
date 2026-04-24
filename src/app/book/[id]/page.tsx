import { q } from "@/lib/db";
import { requirePageEmail } from "@/lib/user";
import { notFound } from "next/navigation";
import Reader from "@/components/Reader";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const email = await requirePageEmail();
  const books = await q<any>(
    `SELECT id, title, author, status, archived,
            extract(epoch from finished_prompted_at)*1000 AS finished_prompted_at_ms
       FROM books WHERE id = $1 AND owner_email = $2`,
    [id, email]
  );
  if (!books.length) return notFound();
  const book = books[0];
  if (book.status !== "ready") {
    return (
      <main className="page" style={{ textAlign: "center", paddingTop: 96 }}>
        <div className="mono" style={{ marginBottom: 12 }}>Status · {book.status}</div>
        <h1 className="display" style={{ fontSize: "clamp(36px, 4vw, 52px)" }}>
          {book.status === "failed" ? "This book failed to extract." : "Still preparing this book…"}
        </h1>
        <p style={{ fontSize: 15, color: "var(--ink-2)", marginTop: 16 }}>
          {book.status === "failed"
            ? "Try re-uploading or downloading another copy."
            : "We're parsing chapters and generating a cover. Hang tight — this usually takes a minute."}
        </p>
        <div style={{ marginTop: 32 }}>
          <Link href="/" className="btn btn-primary">← Library</Link>
        </div>
      </main>
    );
  }
  const chapters = await q<any>(`SELECT idx, title, text FROM chapters WHERE book_id = $1 ORDER BY idx`, [id]);
  const prefsRows = await q<any>(`SELECT json FROM prefs WHERE owner_email = $1`, [email]);
  const progressRows = await q<any>(`SELECT chapter_idx, paragraph_idx FROM progress WHERE book_id = $1 AND owner_email = $2`, [id, email]);
  return (
    <Reader
      bookId={book.id}
      title={book.title}
      author={book.author}
      chapters={chapters.map((c: any) => ({ idx: c.idx, title: c.title, text: c.text }))}
      initialPrefs={prefsRows[0]?.json || {}}
      initialProgress={progressRows[0] || { chapter_idx: 0, paragraph_idx: 0 }}
      alreadyPrompted={book.finished_prompted_at_ms != null}
    />
  );
}
