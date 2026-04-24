import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentEmail } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /Reader/api/books?archived=false|true|all
// Default: archived=false (active library).
// Used by the web archived-screen client fetch and by any external consumer
// that prefers REST over the server-rendered page.tsx.
export async function GET(req: NextRequest) {
  const email = await currentEmail();
  const url = new URL(req.url);
  const raw = (url.searchParams.get("archived") || "false").toLowerCase();
  let filter = "";
  if (raw === "true") filter = "AND b.archived = true";
  else if (raw === "all") filter = "";
  else filter = "AND b.archived = false";

  const rows = await q<any>(
    `SELECT b.id, b.title, b.author, b.status, b.word_count, b.created_at,
            b.archived, b.cover_path,
            p.chapter_idx, p.paragraph_idx,
            (SELECT COUNT(*)::int FROM chapters c WHERE c.book_id = b.id) AS chapter_count
       FROM books b LEFT JOIN progress p ON p.book_id = b.id AND p.owner_email = $1
      WHERE b.owner_email = $1 ${filter}
      ORDER BY b.created_at DESC`,
    [email]
  );
  return NextResponse.json({
    books: rows.map((r: any) => ({
      id: r.id,
      title: r.title,
      author: r.author,
      status: r.status,
      wordCount: r.word_count,
      archived: r.archived,
      hasCover: !!r.cover_path,
      chapterIdx: r.chapter_idx,
      paragraphIdx: r.paragraph_idx,
      chapterCount: r.chapter_count,
      createdAt: r.created_at,
    })),
  });
}
