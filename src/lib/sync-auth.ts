import type { NextRequest } from "next/server";
import { timingSafeEqual, scryptSync } from "node:crypto";
import { q } from "@/lib/db";
// Session cookie fallback — the web Reader authenticates via the OTP
// session cookie set by middleware rather than an Authorization header.
// @ts-ignore — shared-auth ships as plain JS (see node_modules/shared-auth)
import { verifySession } from "shared-auth";
// @ts-ignore — plain JS
import { canonicalEmail } from "shared-auth/aliases";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  try { return timingSafeEqual(ab, bb); } catch { return false; }
}

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

async function authenticateAppPassword(email: string, password: string): Promise<boolean> {
  if (!email || !password) return false;
  const rows = await q<{ id: string; password_hash: string }>(
    `SELECT id, password_hash FROM app_passwords WHERE owner_email = $1`,
    [email]
  );
  for (const row of rows) {
    if (verifyScrypt(password, row.password_hash)) {
      // Fire-and-forget bookkeeping; never blocks the request.
      q(`UPDATE app_passwords SET last_used_at = now() WHERE id = $1`, [row.id]).catch(() => {});
      return true;
    }
  }
  return false;
}

export type SyncAuth =
  | { ok: true; email: string }
  | { ok: false; status: number; msg: string };

/**
 * Authenticate a call to /api/sync/*. Accepts either
 *
 *   Authorization: Bearer <READER_API_TOKEN>    (legacy single-user)
 *   Authorization: Bearer base64(email:password) (multi-user app-password)
 *   Authorization: Basic base64(email:password)  (equivalent to above)
 *
 * The app-password flow reuses the existing app_passwords table used by
 * OPDS, so credentials issued at /Reader/settings/app-passwords work here.
 */
export async function authenticateSync(req: NextRequest): Promise<SyncAuth> {
  const proxySecret = process.env.PROXY_SECRET;
  if (proxySecret) {
    const got = req.headers.get("x-proxy-secret") || "";
    if (!safeEqual(got, proxySecret)) return { ok: false, status: 403, msg: "Forbidden" };
  }

  // Accept the app-otp session cookie (used by the web Reader) before
  // requiring a bearer / basic header. This lets browser requests — which
  // already passed through middleware's cookie check — reuse the logged-in
  // identity for server-side calls like /api/sync/ai/explain.
  const sessionCookie = req.cookies.get("app_otp_session")?.value;
  if (sessionCookie) {
    const session = verifySession(sessionCookie, process.env.OTP_SESSION_SECRET || "");
    if (session && session.email) {
      return { ok: true, email: canonicalEmail(String(session.email).toLowerCase()) };
    }
  }

  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader) return { ok: false, status: 401, msg: "Missing Authorization header" };

  // Legacy single-user bearer token.
  const sharedToken = process.env.READER_API_TOKEN;
  const sharedEmail = process.env.READER_API_EMAIL;
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  if (sharedToken && sharedEmail && bearerMatch && safeEqual(bearerMatch[1], sharedToken)) {
    return { ok: true, email: canonicalEmail(sharedEmail.toLowerCase()) };
  }

  // Multi-user app-password flow. We accept the credentials as either
  //   Authorization: Basic <base64(email:password)>
  //   Authorization: Bearer <base64(email:password)>
  // The second form lets the Android client keep using bearer semantics
  // (so one interceptor works across all endpoints).
  let credsB64: string | null = null;
  const basicMatch = authHeader.match(/^Basic\s+(.+)$/i);
  if (basicMatch) credsB64 = basicMatch[1];
  else if (bearerMatch) credsB64 = bearerMatch[1];
  if (!credsB64) return { ok: false, status: 401, msg: "Invalid Authorization" };

  let decoded: string;
  try { decoded = Buffer.from(credsB64, "base64").toString("utf8"); }
  catch { return { ok: false, status: 401, msg: "Invalid credentials encoding" }; }
  const colon = decoded.indexOf(":");
  if (colon === -1) return { ok: false, status: 401, msg: "Invalid credentials format" };
  const email = canonicalEmail(decoded.slice(0, colon).trim().toLowerCase());
  const password = decoded.slice(colon + 1);
  const ok = await authenticateAppPassword(email, password);
  if (!ok) return { ok: false, status: 401, msg: "Invalid email or app password" };
  return { ok: true, email };
}
