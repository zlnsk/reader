import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentEmail } from "@/lib/user";
import { checkCsrf } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrf = checkCsrf(req);
  if (csrf) return csrf;
  const email = await currentEmail();
  const { id } = await params;
  await q(`DELETE FROM opds_catalogs WHERE id = $1 AND owner_email = $2`, [id, email]);
  return NextResponse.json({ ok: true });
}
