import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { q } from "@/lib/db";
import { requireOpdsAuth } from "@/lib/opds-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "./uploads");
const UPLOAD_DIR_REAL = (() => {
  try { return fsSync.realpathSync(UPLOAD_DIR); } catch { return UPLOAD_DIR; }
})();

// OPDS clients fetch covers with the same Basic creds, not a session cookie,
// so the regular /api/books/[id]/cover (cookie-protected) won't work.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOpdsAuth(req);
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const rows = await q<{ cover_path: string | null }>(
    `SELECT cover_path FROM books WHERE id = $1 AND owner_email = $2`,
    [id, auth.email]
  );
  if (!rows.length || !rows[0].cover_path) return NextResponse.json({ error: "No cover" }, { status: 404 });
  const p = path.resolve(rows[0].cover_path);
  let real: string;
  try { real = fsSync.realpathSync(p); } catch { return NextResponse.json({ error: "Not found" }, { status: 404 }); }
  if (real !== UPLOAD_DIR_REAL && !real.startsWith(UPLOAD_DIR_REAL + path.sep)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 403 });
  }
  try {
    const buf = await fs.readFile(real);
    const ext = path.extname(real).slice(1).toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return new Response(buf as any, {
      status: 200,
      headers: { "Content-Type": mime, "Cache-Control": "private, max-age=86400" },
    });
  } catch { return NextResponse.json({ error: "Not found" }, { status: 404 }); }
}
