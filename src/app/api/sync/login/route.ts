import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, scryptSync } from "node:crypto";
import { q } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function verifyScrypt(plain: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "hex");
  const expected = Buffer.from(parts[5], "hex");
  try {
    const got = scryptSync(plain, salt, expected.length, { N, r, p });
    if (got.length !== expected.length) return false;
    return timingSafeEqual(got, expected);
  } catch { return false; }
}

/**
 * Mobile client login. Validates email + app-password and, on success,
 * returns a base64(email:password) string which the client stores and
 * sends as `Authorization: Bearer <token>` on subsequent /api/sync/*
 * calls. The server re-validates that token on every request (no session
 * table), so rotating the app password instantly revokes the device.
 */
export async function POST(req: NextRequest) {
  const proxySecret = process.env.PROXY_SECRET;
  if (proxySecret) {
    const got = req.headers.get("x-proxy-secret") || "";
    if (got !== proxySecret) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!email || !password) return NextResponse.json({ error: "Missing credentials" }, { status: 400 });

  const rows = await q<{ id: string; password_hash: string }>(
    `SELECT id, password_hash FROM app_passwords WHERE owner_email = $1`,
    [email]
  );
  let matched = false;
  for (const row of rows) {
    if (verifyScrypt(password, row.password_hash)) {
      q(`UPDATE app_passwords SET last_used_at = now() WHERE id = $1`, [row.id]).catch(() => {});
      matched = true;
      break;
    }
  }
  if (!matched) return NextResponse.json({ error: "Invalid email or app password" }, { status: 401 });

  const token = Buffer.from(`${email}:${password}`, "utf8").toString("base64");
  return NextResponse.json({ email, token });
}
