import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
// @ts-ignore — provided by the shared-auth module (see README setup)
import { verifySessionEdge, canonicalEmail } from "shared-auth/edge";

const SESSION_SECRET = process.env.OTP_SESSION_SECRET || "";
const COOKIE_NAME = "app_otp_session";
const BASE_PATH = "/Reader";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const proxySecret = process.env.PROXY_SECRET;
  if (proxySecret) {
    const got = request.headers.get("x-proxy-secret") || "";
    if (got !== proxySecret) return new NextResponse(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
  }
  if (
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.svg" ||
    pathname === "/icon-192.png" ||
    pathname === "/icon-512.png" ||
    pathname === "/apple-icon.svg" ||
    pathname === "/manifest.json" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/sw.js" ||
    pathname === "/privacy"
  ) return NextResponse.next();

  const token = request.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionEdge(token, SESSION_SECRET) : null;
  if (!session) {
    if (pathname.startsWith("/api/") || request.headers.get("accept")?.includes("application/json")) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    const fwdHost = request.headers.get("x-forwarded-host") || request.headers.get("host") || request.nextUrl.host;
    const fwdProto = request.headers.get("x-forwarded-proto") || "https";
    return NextResponse.redirect(`${fwdProto}://${fwdHost}${BASE_PATH}/api/auth/login`);
  }
  const res = NextResponse.next();
  res.headers.set("x-user-email", canonicalEmail(session.email));
  // Mint a CSRF double-submit cookie if missing. Kept non-HttpOnly so client
  // JS can echo it in the X-CSRF-Token header on mutating requests. Runs in
  // the Edge runtime, so we inline the token generation rather than importing
  // from lib/security (which imports NextResponse types — fine here but we
  // keep middleware dependency-free).
  const existingCsrf = request.cookies.get("reader_csrf")?.value;
  if (!existingCsrf || !/^[a-f0-9]{64}$/.test(existingCsrf)) {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    const token = Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join("");
    res.cookies.set({
      name: "reader_csrf",
      value: token,
      httpOnly: false,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
  }
  return res;
}

export const config = {
  matcher: ["/", "/((?!_next/static|_next/image|favicon.ico|icon\\.svg|manifest\\.json|manifest\\.webmanifest|api/upload|api/sync|api/admin|opds/|opds$).*)"],
};
