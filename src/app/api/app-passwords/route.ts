import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { q } from "@/lib/db";
import { currentEmail } from "@/lib/user";
import { checkCsrf, rateLimit, rateLimitResponse } from "@/lib/security";
import { hashAppPassword } from "@/lib/opds-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// List the user's app-passwords (metadata only; hashes never leave DB).
export async function GET() {
  const email = await currentEmail();
  const rows = await q<{ id: string; label: string; created_at: string; last_used_at: string | null }>(
    `SELECT id, label, created_at, last_used_at FROM app_passwords WHERE owner_email = $1 ORDER BY created_at DESC`,
    [email]
  );
  return NextResponse.json({ passwords: rows });
}

// Create a new app-password. The generated plaintext is returned once in
// the response body and never stored; client must display it immediately.
export async function POST(req: NextRequest) {
  const csrf = checkCsrf(req);
  if (csrf) return csrf;
  const email = await currentEmail();
  const rl = rateLimit(`${email}:app-pwd-create`, 10, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);
  const body = await req.json().catch(() => ({}));
  const label = String(body?.label || "").trim().slice(0, 80);
  if (!label) return NextResponse.json({ error: "Missing label" }, { status: 400 });
  // 20 random bytes base32-ish (crockford lite) — readable, 32 chars.
  const plain = randomBytes(20).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 32).padEnd(24, "x");
  const hash = hashAppPassword(plain);
  const rows = await q<{ id: string; created_at: string }>(
    `INSERT INTO app_passwords (owner_email, label, password_hash)
     VALUES ($1, $2, $3) RETURNING id, created_at`,
    [email, label, hash]
  );
  return NextResponse.json({
    id: rows[0].id,
    label,
    password: plain,
    createdAt: rows[0].created_at,
  });
}
