import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { authenticateSync } from "@/lib/sync-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/sync/opds/catalogs — list catalogs for the bearer-authed user.
// Password column is never exposed; has_password flag tells the client
// whether creds are stored.
export async function GET(req: NextRequest) {
  const auth = await authenticateSync(req);
  if (!auth.ok) return NextResponse.json({ error: auth.msg }, { status: auth.status });
  const rows = await q<{ id: string; title: string; url: string; username: string | null; has_password: boolean; created_at: string }>(
    `SELECT id, title, url, username, (password IS NOT NULL) AS has_password, created_at
       FROM opds_catalogs WHERE owner_email = $1 ORDER BY created_at DESC`,
    [auth.email]
  );
  return NextResponse.json({ catalogs: rows });
}

// POST — body: { title, url, username?, password? }
export async function POST(req: NextRequest) {
  const auth = await authenticateSync(req);
  if (!auth.ok) return NextResponse.json({ error: auth.msg }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const title = String(body?.title || "").trim().slice(0, 120);
  const url = String(body?.url || "").trim();
  const username = body?.username ? String(body.username).slice(0, 200) : null;
  const password = body?.password ? String(body.password).slice(0, 500) : null;
  if (!title || !url) return NextResponse.json({ error: "Missing title or url" }, { status: 400 });
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error();
  } catch { return NextResponse.json({ error: "Invalid url" }, { status: 400 }); }
  const rows = await q<{ id: string }>(
    `INSERT INTO opds_catalogs (owner_email, title, url, username, password) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [auth.email, title, url, username, password]
  );
  return NextResponse.json({ id: rows[0].id });
}
