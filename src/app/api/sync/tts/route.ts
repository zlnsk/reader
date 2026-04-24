import { NextRequest, NextResponse } from "next/server";
import { authenticateSync } from "@/lib/sync-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Voices exposed by gemini-2.5-flash-preview-tts. Keeping the allowlist tight
// both so we reject typos server-side and so callers can see what's valid.
// See https://ai.google.dev/gemini-api/docs/speech-generation
const ALLOWED_VOICES = new Set([
  "Achird", "Algenib", "Algieba", "Alnilam", "Aoede", "Autonoe",
  "Callirrhoe", "Charon", "Despina", "Enceladus", "Erinome", "Fenrir",
  "Gacrux", "Iapetus", "Kore", "Laomedeia", "Leda", "Orus",
  "Puck", "Pulcherrima", "Rasalgethi", "Sadachbia", "Sadaltager",
  "Schedar", "Sulafat", "Umbriel", "Vindemiatrix", "Zephyr", "Zubenelgenubi",
]);
const ALLOWED_MODELS = new Set([
  "gemini-2.5-flash-preview-tts",
  "gemini-2.5-pro-preview-tts",
]);

// One paragraph is well under this; prevents accidental denial-of-wallet.
const MAX_TEXT_CHARS = 4500;
const MAX_INSTR_CHARS = 500;

// Narration style — front-loaded into the prompt. Gemini TTS responds to
// descriptive cues in the input text the same way a voice actor would to
// stage directions, so we prepend a style note and the prose itself.
const DEFAULT_INSTRUCTIONS =
  "Read the following aloud warmly, unhurried, with the poise of a " +
  "thoughtful literary narrator. Let punctuation land, breathe between " +
  "sentences, and convey emotional investment without theatricality.";

// WAV header for mono 16-bit PCM. Gemini returns raw 24 kHz little-endian
// PCM; Android's MediaPlayer + browser <audio> won't play raw L16, so we
// wrap it in a RIFF/WAVE container before sending.
function wrapPcmAsWav(pcm: Buffer, sampleRate = 24000): Buffer {
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function parseSampleRate(mime: string): number {
  const m = /rate=(\d+)/.exec(mime || "");
  return m ? parseInt(m[1], 10) : 24000;
}

export async function POST(req: NextRequest) {
  const auth = await authenticateSync(req);
  if (!auth.ok) return NextResponse.json({ error: auth.msg }, { status: auth.status });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "TTS not configured" }, { status: 503 });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Missing text" }, { status: 400 });
  if (text.length > MAX_TEXT_CHARS) return NextResponse.json({ error: "Text too long" }, { status: 413 });

  // Charon: informative, measured — a natural fit for a literary narrator.
  const voice = typeof body?.voice === "string" && ALLOWED_VOICES.has(body.voice) ? body.voice : "Charon";
  const model = typeof body?.model === "string" && ALLOWED_MODELS.has(body.model) ? body.model : "gemini-2.5-flash-preview-tts";
  const instructions = typeof body?.instructions === "string"
    ? body.instructions.slice(0, MAX_INSTR_CHARS)
    : DEFAULT_INSTRUCTIONS;

  // Gemini TTS doesn't have a dedicated speed knob yet; we front-load the
  // directive into the prompt instead. The model honours "unhurried" pacing.
  const prompt = instructions ? `${instructions}\n\n${text}` : text;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
      },
    },
  };

  const upstream = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: "TTS upstream failed", status: upstream.status, detail: detail.slice(0, 400) },
      { status: 502 },
    );
  }

  const json = await upstream.json().catch(() => null) as any;
  const part = json?.candidates?.[0]?.content?.parts?.[0];
  const b64: string | undefined = part?.inlineData?.data;
  const mime: string = part?.inlineData?.mimeType ?? "audio/L16;codec=pcm;rate=24000";
  if (!b64) {
    return NextResponse.json(
      { error: "TTS returned no audio", detail: JSON.stringify(json).slice(0, 400) },
      { status: 502 },
    );
  }

  const pcm = Buffer.from(b64, "base64");
  const wav = wrapPcmAsWav(pcm, parseSampleRate(mime));

  return new Response(wav, {
    status: 200,
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": String(wav.length),
      "Cache-Control": "private, max-age=86400",
    },
  });
}
