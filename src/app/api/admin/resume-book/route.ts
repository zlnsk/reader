import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { resumeExtractForBook } from "@/lib/resume";
import { currentEmail } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

function isAdminEmail(email: string): boolean {
  const raw = process.env.ADMIN_EMAILS || "";
  const allow = raw.split(/[,\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
  return allow.includes(email.toLowerCase());
}

export async function POST(req: NextRequest) {
  // 1) Valid OTP session required.
  let email: string;
  try {
    email = await currentEmail();
  } catch {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  // 2) Session email must be in the admin allowlist.
  if (!isAdminEmail(email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // 3) Defense-in-depth: still require the static ADMIN_SECRET header so
  //    cross-site requests from a legitimate admin's browser can't trigger
  //    a resume without the operator also holding the header secret.
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return NextResponse.json({ error: "ADMIN_SECRET not configured" }, { status: 500 });
  const provided = req.headers.get("x-admin-secret") || "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const id: string | undefined = body?.id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  try {
    await resumeExtractForBook(id);
    return NextResponse.json({ ok: true, id, status: "ready" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, id, error: String(e?.message || e) }, { status: 500 });
  }
}
