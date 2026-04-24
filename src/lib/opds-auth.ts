import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { scryptSync, timingSafeEqual, randomBytes } from "node:crypto";
import { q } from "@/lib/db";
// @ts-ignore — plain JS
import { canonicalEmail } from "shared-auth/aliases";

// scrypt params: N=16384, r=8, p=1 — ~50ms on CT 106. Hash stored as
// `scrypt$N$r$p$saltHex$hashHex`. Small cost lets middleware do it inline.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;

export function hashAppPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, SCRYPT_KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${hash.toString("hex")}`;
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

export type OpdsAuth =
  | { ok: true; email: string }
  | { ok: false; status: number; body: any; contentType?: string };

// Parse `Authorization: Basic base64(email:password)` and match against
// app_passwords rows for that email. Returns lowercase email on success.
export async function authenticateOpds(req: NextRequest): Promise<OpdsAuth> {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Basic\s+(.+)$/i);
  if (!m) return { ok: false, status: 401, body: authDocBody(req), contentType: "application/opds-authentication+json" };
  let decoded: string;
  try { decoded = Buffer.from(m[1], "base64").toString("utf8"); } catch { return unauth(req); }
  const colon = decoded.indexOf(":");
  if (colon === -1) return unauth(req);
  const email = canonicalEmail(decoded.slice(0, colon).trim().toLowerCase());
  const password = decoded.slice(colon + 1);
  if (!email || !password) return unauth(req);
  const rows = await q<{ id: string; password_hash: string }>(
    `SELECT id, password_hash FROM app_passwords WHERE owner_email = $1`,
    [email]
  );
  for (const row of rows) {
    if (verifyScrypt(password, row.password_hash)) {
      // Fire-and-forget: stamp last_used_at. Don't block the request.
      q(`UPDATE app_passwords SET last_used_at = now() WHERE id = $1`, [row.id]).catch(() => {});
      return { ok: true, email };
    }
  }
  return unauth(req);
}

function unauth(req: NextRequest): OpdsAuth {
  return { ok: false, status: 401, body: authDocBody(req), contentType: "application/opds-authentication+json" };
}

function authDocBody(req: NextRequest) {
  const base = publicBase(req);
  return {
    id: `${base}/opds/auth`,
    title: "Reader OPDS",
    description: "Sign in with your Reader email + app password. Create app passwords at /Reader/settings/app-passwords.",
    links: [
      { rel: "help", href: `${base}/settings/app-passwords`, type: "text/html" },
    ],
    authentication: [
      {
        type: "http://opds-spec.org/auth/basic",
        labels: { login: "Email", password: "App password" },
      },
    ],
  };
}

// Build a canonical https://host/Reader base URL from forwarded headers.
export function publicBase(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost";
  return `${proto}://${host}/Reader`;
}

export function unauthorizedResponse(a: OpdsAuth & { ok: false }) {
  const headers: Record<string, string> = {
    "WWW-Authenticate": 'Basic realm="Reader OPDS", charset="UTF-8"',
    "Content-Type": a.contentType || "application/json",
  };
  const body = typeof a.body === "string" ? a.body : JSON.stringify(a.body);
  return new Response(body, { status: a.status, headers });
}

// Shortcut: authenticate or return a 401 response.
export async function requireOpdsAuth(req: NextRequest): Promise<{ email: string } | Response> {
  const auth = await authenticateOpds(req);
  if (!auth.ok) return unauthorizedResponse(auth);
  return { email: auth.email };
}
