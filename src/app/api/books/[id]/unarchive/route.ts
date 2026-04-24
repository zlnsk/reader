import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentEmail } from "@/lib/user";
import { checkCsrf, rateLimit, rateLimitResponse } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /Reader/api/books/:id/unarchive
// Clears `archived` so the book returns to the main library. Also clears
// `finished_prompted_at` so if the user later re-reads to the end we prompt
// once more — matches the natural reading loop.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrf = checkCsrf(req);
  if (csrf) return csrf;
  const email = await currentEmail();
  const rl = rateLimit(`${email}:book-archive`, 60, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  const { id } = await params;
  const rows = await q<{ id: string }>(
    `UPDATE books SET archived = false, finished_prompted_at = NULL, updated_at = now()
      WHERE id = $1 AND owner_email = $2 RETURNING id`,
    [id, email]
  );
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, archived: false });
}
