import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentEmail } from "@/lib/user";
import { parseFeed } from "@/lib/opds-parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Fetch a remote OPDS feed server-side, using the stored creds for the
// given catalogId (or anonymous if none). Returns parsed feed as JSON so
// the UI doesn't need its own XML parser. Binary thumbnails are proxied
// via /api/opds-client/image (not implemented yet; UI falls back to
// <img src={remote}> with no creds — OK for public OPDS catalogs).
export async function GET(req: NextRequest) {
  const email = await currentEmail();
  const url = new URL(req.url);
  const catalogId = url.searchParams.get("catalogId") || "";
  const target = url.searchParams.get("url") || "";
  if (!catalogId || !target) return NextResponse.json({ error: "Missing catalogId or url" }, { status: 400 });

  const rows = await q<{ url: string; username: string | null; password: string | null }>(
    `SELECT url, username, password FROM opds_catalogs WHERE id = $1 AND owner_email = $2`,
    [catalogId, email]
  );
  if (!rows.length) return NextResponse.json({ error: "Catalog not found" }, { status: 404 });
  const cat = rows[0];

  // Ensure the target URL belongs to the same origin as the saved catalog,
  // so a compromised cookie can't redirect us to an arbitrary URL.
  let targetUrl: URL;
  try { targetUrl = new URL(target, cat.url); } catch { return NextResponse.json({ error: "Bad url" }, { status: 400 }); }
  try {
    const catUrl = new URL(cat.url);
    if (targetUrl.host !== catUrl.host || targetUrl.protocol !== catUrl.protocol) {
      return NextResponse.json({ error: "Cross-origin browse blocked" }, { status: 400 });
    }
  } catch { return NextResponse.json({ error: "Bad saved catalog" }, { status: 400 }); }

  const headers: Record<string, string> = {
    "Accept": "application/atom+xml;profile=opds-catalog, application/atom+xml, application/xml, */*;q=0.1",
    "User-Agent": "Reader/OPDS-client",
  };
  if (cat.username && cat.password) {
    headers["Authorization"] = "Basic " + Buffer.from(`${cat.username}:${cat.password}`).toString("base64");
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30000);
  try {
    const r = await fetch(targetUrl.toString(), { headers, signal: ac.signal, redirect: "follow" });
    const contentType = r.headers.get("content-type") || "";
    const text = await r.text();
    if (!r.ok) return NextResponse.json({ error: `Upstream ${r.status}`, body: text.slice(0, 500) }, { status: 502 });
    // OPDS 2 (JSON) — pass through as-is. We don't render it yet but the UI
    // can fall through to "unsupported, click to open externally" until we
    // add the JSON renderer.
    if (contentType.includes("application/opds+json") || contentType.includes("application/json")) {
      return NextResponse.json({ kind: "opds2-json", json: safeJson(text), url: targetUrl.toString() });
    }
    const parsed = parseFeed(text, targetUrl.toString());
    return NextResponse.json({ kind: "atom", feed: parsed, url: targetUrl.toString() });
  } catch (e: any) {
    return NextResponse.json({ error: `Fetch failed: ${e.message || e}` }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}
