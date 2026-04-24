import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { requireOpdsAuth } from "@/lib/opds-auth";
import { buildEpub, type EpubChapter } from "@/lib/epub-build";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function buildDownloadName(title: string | null | undefined, id: string): string {
  const rawTitle = (title || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const cleaned = rawTitle
    .replace(/[^A-Za-z0-9 \-]+/g, "_")
    .replace(/[_ ]{2,}/g, "_")
    .replace(/^[_\- ]+|[_\- ]+$/g, "")
    .trim()
    .slice(0, 120);
  return (cleaned || `book-${id}`) + ".epub";
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOpdsAuth(req);
  if (auth instanceof Response) return auth;
  const { id } = await params;
  if (!id || typeof id !== "string" || id.length > 64) {
    return NextResponse.json({ error: "Invalid book id" }, { status: 400 });
  }

  const rows = await q<{ title: string | null; author: string | null }>(
    `SELECT title, author FROM books WHERE id = $1 AND owner_email = $2`,
    [id, auth.email]
  );
  if (!rows.length) return NextResponse.json({ error: "Book not found" }, { status: 404 });
  const book = rows[0];

  const chapterRows = await q<EpubChapter>(
    `SELECT idx, title, text FROM chapters WHERE book_id = $1 ORDER BY idx`,
    [id]
  );
  if (!chapterRows.length) {
    return NextResponse.json({ error: "Book has no chapters yet" }, { status: 409 });
  }

  const epub = await buildEpub({
    id,
    title: book.title,
    author: book.author,
    chapters: chapterRows,
  });

  return new Response(epub as any, {
    status: 200,
    headers: {
      "Content-Type": "application/epub+zip",
      "Content-Disposition": `attachment; filename="${buildDownloadName(book.title, id)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
