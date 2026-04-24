import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { authenticateSync } from "@/lib/sync-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /api/sync/opds/catalogs/[id]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateSync(req);
  if (!auth.ok) return NextResponse.json({ error: auth.msg }, { status: auth.status });
  const { id } = await params;
  await q(`DELETE FROM opds_catalogs WHERE id = $1 AND owner_email = $2`, [id, auth.email]);
  return NextResponse.json({ ok: true });
}
