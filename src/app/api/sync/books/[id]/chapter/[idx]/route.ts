import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { authenticateSync } from "@/lib/sync-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; idx: string }> }
) {
  const auth = await authenticateSync(req);
  if (!auth.ok) return NextResponse.json({ error: auth.msg }, { status: auth.status });
  const { id, idx } = await params;
  const chIdx = Number(idx);
  if (!Number.isFinite(chIdx) || chIdx < 0) {
    return NextResponse.json({ error: "Invalid chapter index" }, { status: 400 });
  }
  const rows = await q<{ idx: number; title: string | null; text: string }>(
    `SELECT c.idx, c.title, c.text FROM chapters c
     JOIN books b ON b.id = c.book_id
     WHERE b.id = $1 AND b.owner_email = $2 AND c.idx = $3`,
    [id, auth.email, chIdx]
  );
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const r = rows[0];
  return NextResponse.json({ idx: r.idx, title: r.title, text: r.text });
}
