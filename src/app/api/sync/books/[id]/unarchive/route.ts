import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { authenticateSync } from "@/lib/sync-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /Reader/api/sync/books/:id/unarchive  (external-client variant)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateSync(req);
  if (!auth.ok) return NextResponse.json({ error: auth.msg }, { status: auth.status });
  const { id } = await params;
  const rows = await q<{ id: string }>(
    `UPDATE books SET archived = false, finished_prompted_at = NULL, updated_at = now()
      WHERE id = $1 AND owner_email = $2 RETURNING id`,
    [id, auth.email]
  );
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, archived: false });
}
