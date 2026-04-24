import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { currentEmail } from "@/lib/user";
import { checkCsrf, rateLimit, rateLimitResponse } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Max accepted request body size for POST /api/prefs. Kept generous relative
// to the schema (a few booleans/numbers/strings) but tight enough to reject
// any attempt to stash junk JSON in the DB.
const MAX_BODY_BYTES = 16 * 1024;

// Known pref keys. Unknown keys are dropped silently. Values are coerced to
// the expected type; values that don't match are ignored.
const PREF_SCHEMA: Record<string, "string" | "number" | "boolean"> = {
  theme: "string",
  mode: "string",
  font: "string",
  fontSize: "number",
  lineHeight: "number",
  measure: "number",
  margins: "number",
  justify: "boolean",
  hyphenate: "boolean",
  ttsVoice: "string",
  kindleEmail: "string",
};
const STRING_MAX = 120;

function sanitizePrefs(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const type = PREF_SCHEMA[key];
    if (!type) continue; // drop unknown keys
    if (type === "string") {
      if (typeof val === "string" && val.length <= STRING_MAX) out[key] = val;
    } else if (type === "number") {
      const n = Number(val);
      if (Number.isFinite(n)) out[key] = n;
    } else if (type === "boolean") {
      out[key] = Boolean(val);
    }
  }
  return out;
}

export async function GET() {
  const email = await currentEmail();
  const rows = await q<any>(`SELECT json FROM prefs WHERE owner_email = $1`, [email]);
  return NextResponse.json(rows[0]?.json || {});
}

export async function POST(req: NextRequest) {
  const csrf = checkCsrf(req);
  if (csrf) return csrf;
  const email = await currentEmail();
  const rl = rateLimit(`${email}:prefs`, 60, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);

  // Enforce a hard cap on the request body — reject anything bigger than
  // MAX_BODY_BYTES before we even try to parse JSON.
  const cl = Number(req.headers.get("content-length") || "0");
  if (cl && cl > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  let parsed: unknown = {};
  try { parsed = JSON.parse(raw || "{}"); } catch { parsed = {}; }
  const body = sanitizePrefs(parsed);

  await q(
    `INSERT INTO prefs (owner_email, json, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (owner_email) DO UPDATE SET json = EXCLUDED.json, updated_at = now()`,
    [email, JSON.stringify(body)]
  );
  return NextResponse.json({ ok: true });
}
