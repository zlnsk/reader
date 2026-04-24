// Server-side security helpers: CSRF double-submit cookie + per-user in-memory
// sliding-window rate limiter. Both are deliberately tiny so they can live
// inside the Next.js runtime (single PM2 process) without extra infra.
//
// CSRF model (option a):
//   - On every request we make sure a non-HttpOnly cookie `reader_csrf`
//     is set (32 random bytes, hex). If missing, it's minted on first
//     response.
//   - Mutating endpoints require the same value to be echoed in an
//     `X-CSRF-Token` header. Because the cookie is readable by JS on the
//     same origin but not cross-origin, and because cross-origin requests
//     can't set custom headers without a CORS preflight, the attacker
//     cannot forge a valid state-changing request from another site.
//   - We keep session cookie at sameSite=lax (it's what shared-auth sets),
//     so the OTP login redirect flow continues to work.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const CSRF_COOKIE = "reader_csrf";
export const CSRF_HEADER = "x-csrf-token";

function randomToken(): string {
  // 32 bytes hex = 64 chars.
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function ensureCsrfCookie(req: NextRequest, res: NextResponse): NextResponse {
  const existing = req.cookies.get(CSRF_COOKIE)?.value;
  if (existing && /^[a-f0-9]{64}$/.test(existing)) return res;
  const token = randomToken();
  res.cookies.set({
    name: CSRF_COOKIE,
    value: token,
    httpOnly: false, // must be readable by client JS so it can echo into header
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // align with session (12h)
  });
  return res;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Validate CSRF for state-changing requests. Returns null if OK, otherwise
 * a 403 NextResponse the caller should return directly.
 */
export function checkCsrf(req: Request | NextRequest): NextResponse | null {
  // `NextRequest` has cookies; plain `Request` does not. Handle both.
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(/(?:^|;\s*)reader_csrf=([a-f0-9]{64})/);
  const cookieVal = match?.[1];
  const headerVal = req.headers.get(CSRF_HEADER) || req.headers.get("X-CSRF-Token") || "";
  if (!cookieVal || !headerVal || !timingSafeEqual(cookieVal, headerVal)) {
    return NextResponse.json({ error: "CSRF token missing or invalid" }, { status: 403 });
  }
  return null;
}

// ---------- Rate limiting ----------
//
// In-memory sliding window. Keyed on a caller-supplied string (typically
// `${email}:${bucket}`). 60 ops per 60 s is the default we apply to
// progress/prefs/delete endpoints. Numbers are intentionally generous since
// these endpoints are cheap; the goal is just to contain abuse.

type Bucket = { times: number[] };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit = 60, windowMs = 60_000): { ok: true } | { ok: false; retryAfterMs: number } {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) { b = { times: [] }; buckets.set(key, b); }
  // Evict old timestamps.
  const cutoff = now - windowMs;
  let i = 0;
  while (i < b.times.length && b.times[i] < cutoff) i++;
  if (i > 0) b.times.splice(0, i);
  if (b.times.length >= limit) {
    const oldest = b.times[0];
    return { ok: false, retryAfterMs: Math.max(0, windowMs - (now - oldest)) };
  }
  b.times.push(now);
  return { ok: true };
}

// Best-effort periodic eviction. Runs once per ~10 min when the module is
// imported inside a live process; kept lightweight so it's fine in dev too.
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [k, b] of buckets) {
      // Keep only the tail window; drop buckets that went silent entirely.
      const filtered = b.times.filter((t) => t >= cutoff);
      if (filtered.length === 0) buckets.delete(k);
      else b.times = filtered;
    }
  }, 10 * 60_000).unref?.();
}

export function rateLimitResponse(retryAfterMs: number): NextResponse {
  return NextResponse.json(
    { error: "Too many requests" },
    { status: 429, headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) } }
  );
}
