import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentEmail } from "@/lib/user";
import { checkCsrf, rateLimit, rateLimitResponse } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /Reader/api/books/:id/finish-prompt
// Marks that we've already shown the "finished — archive?" dialog for this
// book so we don't re-prompt on every session. Pure UX state; no side effects.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrf = checkCsrf(req);
  if (csrf) return csrf;
  const email = await currentEmail();
  const rl = rateLimit(`${email}:book-finish-prompt`, 60, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  const { id } = await params;
  const rows = await q<{ id: string }>(
    `UPDATE books SET finished_prompted_at = now() WHERE id = $1 AND owner_email = $2 RETURNING id`,
    [id, email]
  );
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
