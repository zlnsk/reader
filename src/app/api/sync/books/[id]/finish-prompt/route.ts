import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { authenticateSync } from "@/lib/sync-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /Reader/api/sync/books/:id/finish-prompt (external-client variant)
// Marks that the client has already prompted the user about archiving this
// book, so future sessions don't re-ask on the same end-of-book state.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateSync(req);
  if (!auth.ok) return NextResponse.json({ error: auth.msg }, { status: auth.status });
  const { id } = await params;
  const rows = await q<{ id: string }>(
    `UPDATE books SET finished_prompted_at = now() WHERE id = $1 AND owner_email = $2 RETURNING id`,
    [id, auth.email]
  );
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
