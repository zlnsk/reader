import { NextRequest, NextResponse } from "next/server";
import { authenticateSync } from "@/lib/sync-auth";
import { rateLimit, rateLimitResponse } from "@/lib/security";
import { chatCompletion } from "shared-ai";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_PHRASE = 600;
const MAX_CONTEXT = 2000;

// Short-lived dedupe cache: rapid double-clicks on the AI button (and other
// accidental retries within a 60 s window) resolve to the same completion
// instead of burning a new OpenRouter call each time. Keyed on a hash of the
// per-user (email, phrase, context) tuple so different users never share.
type CacheEntry = { answer: string; expires: number };
const g = globalThis as unknown as { __readerAiCache?: Map<string, CacheEntry> };
const cache: Map<string, CacheEntry> = g.__readerAiCache ?? new Map();
g.__readerAiCache = cache;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 500;

function cacheKey(email: string, phrase: string, context: string): string {
  return createHash("sha256").update(`${email}\0${phrase}\0${context}`).digest("hex");
}
function cacheGet(key: string): string | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) { cache.delete(key); return null; }
  return hit.answer;
}
function cacheSet(key: string, answer: string) {
  if (cache.size >= CACHE_MAX) {
    // Evict oldest (insertion order) to keep memory bounded.
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(key, { answer, expires: Date.now() + CACHE_TTL_MS });
}
const SYSTEM =
  "You are a precise dictionary. Given a word or phrase from a book the reader is in the middle of, " +
  "reply in 2-3 short sentences: the meaning, and if it is idiomatic or archaic, note that. Use plain " +
  "language. No preamble. You may use inline markdown (*italic*, **bold**) sparingly.";
const SUMMARY_SYSTEM =
  "You are a thoughtful literary companion. Summarise the named chapter or section of a book in 3-5 " +
  "sentences. Focus on the main argument or narrative beats; avoid plot spoilers beyond the chapter. " +
  "No preamble, plain language, inline markdown sparingly.";

export async function POST(req: NextRequest) {
  const auth = await authenticateSync(req);
  if (!auth.ok) return NextResponse.json({ error: auth.msg }, { status: auth.status });

  // Per-user rate limit — the underlying OpenRouter call costs real money, so
  // cap it well below any realistic human rate. 20 req / minute is ~1 every
  // 3 s, which a reader tapping "Ask" will never exceed.
  const rl = rateLimit(`${auth.email}:ai-explain`, 20, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterMs);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENROUTER_API_KEY not configured" }, { status: 500 });

  let body: { phrase?: string; context?: string } = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const phrase = (body.phrase || "").toString().slice(0, MAX_PHRASE).trim();
  const context = (body.context || "").toString().slice(0, MAX_CONTEXT).trim();
  if (!phrase) return NextResponse.json({ error: "phrase required" }, { status: 400 });

  const key = cacheKey(auth.email, phrase, context);
  const cached = cacheGet(key);
  if (cached) return NextResponse.json({ content: cached, cached: true });

  const isSummary = /^summar(i[sz]e|y)\b/i.test(phrase);
  const user = context ? `Phrase: ${phrase}\n\nContext paragraph: ${context}` : `Phrase: ${phrase}`;

  try {
    const { content } = await chatCompletion({
      apiKey,
      model: "anthropic/claude-haiku-4.5",
      temperature: 0.2,
      maxTokens: isSummary ? 400 : 250,
      appName: "Reader",
      referer: process.env.OPENROUTER_REFERER || "",
      messages: [
        { role: "system", content: isSummary ? SUMMARY_SYSTEM : SYSTEM },
        { role: "user", content: user },
      ],
    });
    const answer = (content || "").trim();
    if (answer) cacheSet(key, answer);
    return NextResponse.json({ content: answer });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "ai error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
