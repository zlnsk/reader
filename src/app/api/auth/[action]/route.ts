import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const auth = require("shared-auth");

function clientIP(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const config = auth.getConfig({ basePath: "/Reader", appName: "Reader", authBasePath: "/Reader/api" });
  if (action === "login") return new NextResponse(auth.loginPageHTML(config), { headers: { "Content-Type": "text/html" } });
  if (action === "logout") {
    const fh = req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.host;
    const fp = req.headers.get("x-forwarded-proto") || "https";
    const res = NextResponse.redirect(`${fp}://${fh}/`);
    res.cookies.delete({ name: config.cookieName, path: "/" });
    return res;
  }
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const config = auth.getConfig({ basePath: "/Reader", appName: "Reader", authBasePath: "/Reader/api" });

  if (action === "send-code") {
    const body = await req.json().catch(() => ({}));
    const email = (body.email || "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 });
    const ip = clientIP(req);
    if (config.allowedEmails.length && !config.allowedEmails.includes(email)) {
      console.log(`[shared-auth] [Reader] REJECTED: email=${email} ip=${ip} (not in allowlist)`);
      return NextResponse.json({ ok: true, message: "If this email is authorized, a code has been sent." });
    }
    if (!auth.checkRateLimit("send:" + email, 3, 15 * 60 * 1000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    if (!auth.checkRateLimit("send-ip:" + ip, 10, 15 * 60 * 1000)) return NextResponse.json({ error: "Too many requests from IP." }, { status: 429 });
    const { code } = auth.generateOTP(email);
    await auth.sendOTPEmail(email, code, config);
    console.log(`[shared-auth] [Reader] OTP SENT: email=${email} ip=${ip} time=${new Date().toISOString()}`);
    return NextResponse.json({ ok: true });
  }

  if (action === "verify") {
    const body = await req.json().catch(() => ({}));
    const email = (body.email || "").trim().toLowerCase();
    const code = (body.code || "").trim();
    const ip = clientIP(req);
    if (!email || !code) return NextResponse.json({ error: "Email and code required" }, { status: 400 });
    if (!auth.checkRateLimit("verify:" + email, 5, 15 * 60 * 1000)) return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
    if (!auth.verifyOTP(email, code)) {
      console.log(`[shared-auth] [Reader] VERIFY FAILED: email=${email} ip=${ip}`);
      return NextResponse.json({ error: "Invalid or expired code" }, { status: 401 });
    }
    console.log(`[shared-auth] [Reader] LOGIN OK: email=${email} ip=${ip} time=${new Date().toISOString()}`);
    const token = auth.createSession(email, config.sessionSecret, config.sessionHours);
    const res = NextResponse.json({ ok: true, redirect: config.basePath });
    res.cookies.set({ name: config.cookieName, value: token, httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: config.sessionHours * 60 * 60 });
    return res;
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
