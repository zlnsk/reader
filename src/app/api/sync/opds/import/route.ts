import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { q } from "@/lib/db";
import { authenticateSync } from "@/lib/sync-auth";
import { resumeExtractForBook } from "@/lib/resume";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

function registrableDomain(host: string): string {
  // Crude eTLD+1: last two labels. Good enough for .org/.com/.net catalogs.
  const parts = host.toLowerCase().split('.');
  if (parts.length < 2) return host.toLowerCase();
  return parts.slice(-2).join('.');
}

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
const MAX_BYTES = Number(process.env.MAX_UPLOAD_MB || "60") * 1024 * 1024;


function isPrivateAddress(ip: string): boolean {
  // IPv4 private / loopback / link-local / CGNAT / broadcast
  if (net.isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    if (p[0] === 10) return true;
    if (p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT range
    if (p[0] === 0) return true;
    if (p[0] >= 224) return true; // multicast + reserved
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
  if (lower.startsWith('fe80')) return true; // link-local
  // IPv4-mapped IPv6
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice(7);
    if (net.isIPv4(v4)) return isPrivateAddress(v4);
  }
  return false;
}

async function guardHostSSRF(host: string): Promise<string | null> {
  // Reject literal private IPs first (skips DNS).
  if (net.isIP(host)) {
    return isPrivateAddress(host) ? `Host resolves to private address: ${host}` : null;
  }
  try {
    const addrs = await dns.lookup(host, { all: true, verbatim: true });
    for (const a of addrs) {
      if (isPrivateAddress(a.address)) {
        return `Host ${host} resolves to private address ${a.address}`;
      }
    }
    return null;
  } catch (e: any) {
    return `DNS resolution failed for ${host}`;
  }
}

function extFromType(contentType: string | null, urlStr: string): string {
  const ct = (contentType || "").split(";")[0].trim().toLowerCase();
  const byType: Record<string, string> = {
    "application/epub+zip": "epub",
    "application/pdf": "pdf",
    "application/x-mobipocket-ebook": "mobi",
    "application/vnd.amazon.ebook": "azw3",
    "text/plain": "txt",
    "text/html": "html",
    "text/markdown": "md",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/msword": "doc",
    "application/rtf": "rtf",
  };
  if (byType[ct]) return byType[ct];
  const m = urlStr.match(/\.([a-z0-9]{2,5})(?:\?|#|$)/i);
  return m ? m[1].toLowerCase() : "epub";
}

// POST /api/sync/opds/import
// Body: { catalogId, url (acquisition), title?, author? }
export async function POST(req: NextRequest) {
  const auth = await authenticateSync(req);
  if (!auth.ok) return NextResponse.json({ error: auth.msg }, { status: auth.status });
  const body = await req.json().catch(() => ({}));
  const { catalogId, url: acqUrl, title, author } = body || {};
  if (!catalogId || !acqUrl) return NextResponse.json({ error: "Missing catalogId or url" }, { status: 400 });

  const rows = await q<{ url: string; username: string | null; password: string | null }>(
    `SELECT url, username, password FROM opds_catalogs WHERE id = $1 AND owner_email = $2`,
    [catalogId, auth.email]
  );
  if (!rows.length) return NextResponse.json({ error: "Catalog not found" }, { status: 404 });
  const cat = rows[0];

  let target: URL;
  try { target = new URL(String(acqUrl), cat.url); } catch { return NextResponse.json({ error: "Bad url" }, { status: 400 }); }
  try {
    const catUrl = new URL(cat.url);
    if (registrableDomain(target.host) !== registrableDomain(catUrl.host) || target.protocol !== catUrl.protocol) {
      return NextResponse.json({ error: "Cross-origin import blocked" }, { status: 400 });
    }
  } catch { return NextResponse.json({ error: "Bad saved catalog" }, { status: 400 }); }

  const ssrfErr = await guardHostSSRF(target.hostname);
  if (ssrfErr) return NextResponse.json({ error: ssrfErr }, { status: 400 });

  const headers: Record<string, string> = { "Accept": "*/*", "User-Agent": "Reader/OPDS-sync" };
  if (cat.username && cat.password) {
    headers["Authorization"] = "Basic " + Buffer.from(`${cat.username}:${cat.password}`).toString("base64");
  }

  const id = crypto.randomUUID();
  const dir = path.join(UPLOAD_DIR, id);
  await fs.mkdir(dir, { recursive: true });

  await q(
    `INSERT INTO books (id, owner_email, title, author, source_filename, source_path, source_kind, status, status_detail, progress_pct)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'downloading','Starting download',2)`,
    [id, auth.email, title || null, author || null, "pending", path.join(dir, "pending"), "epub"]
  );

  // Fire-and-forget the download + extract. Response returns immediately
  // with the new book id so the client can poll /api/sync/progress for status.
  (async () => {
    const setProgress = (stage: string, pct: number) =>
      q(`UPDATE books SET status_detail = $2, progress_pct = $3 WHERE id = $1`, [id, stage, pct]).catch(() => {});
    try {
      setProgress("Connecting", 5);
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 5 * 60_000);
      const r = await fetch(target.toString(), { headers, signal: ac.signal, redirect: "follow" });
      if (!r.ok || !r.body) { clearTimeout(timer); throw new Error(`Upstream ${r.status}`); }
      const ext = extFromType(r.headers.get("content-type"), target.toString());
      const fname = `book.${ext}`;
      const fpath = path.join(dir, fname);
      const total = Number(r.headers.get("content-length")) || 0;
      if (total && total > MAX_BYTES) { clearTimeout(timer); throw new Error(`File too large: ${total} > ${MAX_BYTES}`); }
      const out = await fs.open(fpath, "w");
      let bytes = 0;
      try {
        const reader = r.body.getReader();
        let lastWrite = Date.now();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > MAX_BYTES) throw new Error("Download exceeds MAX_UPLOAD_MB");
          await out.write(value);
          const now = Date.now();
          if (now - lastWrite > 800) {
            lastWrite = now;
            const pct = total ? Math.floor((bytes / total) * 39) + 10 : 10 + Math.min(35, Math.floor(bytes / (1024 * 1024)) * 2);
            setProgress(total ? `Downloading ${Math.floor((bytes / total) * 100)}%` : `Downloading (${(bytes / 1e6).toFixed(1)} MB)`, pct);
          }
        }
      } finally { await out.close(); clearTimeout(timer); }
      await q(`UPDATE books SET source_filename = $2, source_path = $3, source_kind = $4 WHERE id = $1`,
        [id, fname, fpath, ext]);
      await resumeExtractForBook(id);
    } catch (e: any) {
      console.error("[Reader] sync/opds import failed:", e);
      await q(`UPDATE books SET status = 'failed', error = $2 WHERE id = $1`,
        [id, String(e.message || e).slice(0, 500)]).catch(() => {});
    }
  })().catch((err) => console.error("[Reader] unhandled sync/opds import error:", err));

  return NextResponse.json({ id });
}
