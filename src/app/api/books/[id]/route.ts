import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentEmail } from "@/lib/user";
import { checkCsrf, rateLimit, rateLimitResponse } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const email = await currentEmail();
  const rows = await q<any>(`SELECT id, title, author, status, status_detail, progress_pct, error, word_count, duplicate_of FROM books WHERE id = $1 AND owner_email = $2`, [id, email]);
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(rows[0]);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrf = checkCsrf(req);
  if (csrf) return csrf;
  const { id } = await params;
  const email = await currentEmail();
  const rl = rateLimit(`${email}:book-delete`, 60, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  const rows = await q<{ source_path: string | null }>(`SELECT source_path FROM books WHERE id = $1 AND owner_email = $2`, [id, email]);
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await q(`DELETE FROM books WHERE id = $1 AND owner_email = $2`, [id, email]);
  try {
    if (rows[0].source_path) {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      await fs.unlink(rows[0].source_path).catch(() => {});
      await fs.rm(path.dirname(rows[0].source_path), { recursive: true, force: true }).catch(() => {});
    }
  } catch {}
  return NextResponse.json({ ok: true });
}
