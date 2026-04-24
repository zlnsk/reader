import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { authenticateSync } from "@/lib/sync-auth";
import dns from "node:dns/promises";
import net from "node:net";
import { parseFeed } from "@/lib/opds-parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    if (p[0] >= 224) return true;
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')) return true;
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice(7);
    if (net.isIPv4(v4)) return isPrivateAddress(v4);
  }
  return false;
}

async function guardHostSSRF(host: string): Promise<string | null> {
  if (net.isIP(host)) return isPrivateAddress(host) ? `Host resolves to private address: ${host}` : null;
  try {
    const addrs = await dns.lookup(host, { all: true, verbatim: true });
    for (const a of addrs) if (isPrivateAddress(a.address)) return `Host ${host} resolves to private address ${a.address}`;
    return null;
  } catch { return `DNS resolution failed for ${host}`; }
}

function registrableDomain(host: string): string {
  // Crude eTLD+1: last two labels. Good enough for .org/.com/.net catalogs.
  const parts = host.toLowerCase().split('.');
  if (parts.length < 2) return host.toLowerCase();
  return parts.slice(-2).join('.');
}

// GET /api/sync/opds/browse?catalogId=…&url=…  — fetches the remote OPDS
// feed server-side using stored creds, returns parsed shape. Mirror of the
// cookie-auth /api/opds-client/browse route.
export async function GET(req: NextRequest) {
  const auth = await authenticateSync(req);
  if (!auth.ok) return NextResponse.json({ error: auth.msg }, { status: auth.status });
  const url = new URL(req.url);
  const catalogId = url.searchParams.get("catalogId") || "";
  const target = url.searchParams.get("url") || "";
  if (!catalogId || !target) return NextResponse.json({ error: "Missing catalogId or url" }, { status: 400 });

  const rows = await q<{ url: string; username: string | null; password: string | null }>(
    `SELECT url, username, password FROM opds_catalogs WHERE id = $1 AND owner_email = $2`,
    [catalogId, auth.email]
  );
  if (!rows.length) return NextResponse.json({ error: "Catalog not found" }, { status: 404 });
  const cat = rows[0];

  let targetUrl: URL;
  try { targetUrl = new URL(target, cat.url); } catch { return NextResponse.json({ error: "Bad url" }, { status: 400 }); }
  try {
    const catUrl = new URL(cat.url);
    if (registrableDomain(targetUrl.host) !== registrableDomain(catUrl.host) || targetUrl.protocol !== catUrl.protocol) {
      return NextResponse.json({ error: "Cross-origin browse blocked" }, { status: 400 });
    }
  } catch { return NextResponse.json({ error: "Bad saved catalog" }, { status: 400 }); }

  const ssrfErr = await guardHostSSRF(targetUrl.hostname);
  if (ssrfErr) return NextResponse.json({ error: ssrfErr }, { status: 400 });

  const headers: Record<string, string> = {
    "Accept": "application/atom+xml;profile=opds-catalog, application/atom+xml, application/xml, */*;q=0.1",
    "User-Agent": "Reader/OPDS-sync",
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
