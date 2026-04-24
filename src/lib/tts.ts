// High-quality TTS via OpenRouter -> openai/gpt-audio-mini (same voice family as ChatGPT).
// Accepts text, returns MP3 bytes. Chunked at ~3500 chars per request.

export const TTS_VOICES = ["alloy", "echo", "fable", "onyx", "nova", "shimmer", "coral", "sage"] as const;
export type TtsVoice = typeof TTS_VOICES[number];

const MAX_CHARS = 3500;

export type TtsPart = { text: string; startPara: number; endPara: number; paragraphWordCounts: number[] };

function wordCount(s: string): number { return (s.match(/\S+/g) || []).length; }

export function chunkForTts(text: string): TtsPart[] {
  if (!text) return [];
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const parts: TtsPart[] = [];
  let buf: string[] = [];
  let startPara = 0;

  const flush = (endPara: number) => {
    if (!buf.length) return;
    parts.push({
      text: buf.join("\n\n"),
      startPara,
      endPara,
      paragraphWordCounts: buf.map(wordCount),
    });
    buf = [];
  };

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const curLen = buf.reduce((s, b) => s + b.length + 2, 0);
    if (buf.length && curLen + p.length > MAX_CHARS) {
      flush(startPara + buf.length - 1);
      startPara = i;
    }
    if (!buf.length) startPara = i;
    buf.push(p);
  }
  flush(startPara + buf.length - 1);
  return parts;
}

export function partsMeta(text: string): { parts: { startPara: number; endPara: number; paragraphWordCounts: number[] }[]; totalWords: number } {
  const parts = chunkForTts(text);
  const meta = parts.map(({ startPara, endPara, paragraphWordCounts }) => ({ startPara, endPara, paragraphWordCounts }));
  const totalWords = meta.reduce((s, p) => s + p.paragraphWordCounts.reduce((a, b) => a + b, 0), 0);
  return { parts: meta, totalWords };
}

// Return the text (and paragraph word counts) for paragraphs [from..endPara] of the part containing `fromPara`.
export function sliceFromParagraph(text: string, fromPara: number): { text: string; startPara: number; endPara: number; paragraphWordCounts: number[] } | null {
  const parts = chunkForTts(text);
  const part = parts.find((p) => fromPara >= p.startPara && fromPara <= p.endPara);
  if (!part) return null;
  const localStart = fromPara - part.startPara;
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const slice = paragraphs.slice(fromPara, part.endPara + 1);
  return {
    text: slice.join("\n\n"),
    startPara: fromPara,
    endPara: part.endPara,
    paragraphWordCounts: part.paragraphWordCounts.slice(localStart),
  };
}

// Map the OpenAI-flavoured voice ids the Reader UI exposes onto Gemini
// prebuilt voice names. Keeps the existing voice picker working unchanged
// while the backend uses Gemini TTS (the model the Android app already uses).
const GEMINI_VOICE_MAP: Record<TtsVoice, string> = {
  alloy: "Charon",
  onyx: "Orus",
  echo: "Puck",
  fable: "Zephyr",
  nova: "Aoede",
  shimmer: "Kore",
  coral: "Leda",
  sage: "Algenib",
};

// Voice name maps OpenAI 1:1 — no mapping table needed.
// Reader exposes the same set of voice names the API accepts.

// Synthesize `text` with `voice` via OpenAI /v1/audio/speech. Returns MP3 bytes
// ready to send to the browser with Content-Type audio/mpeg. No ffmpeg needed.
// Fixed voice — picker removed. `onyx` = the deepest resonant male voice;
// combined with an instructions prompt on the gpt-4o-mini-tts model we get
// a slow, low, romantic, passionate delivery.
const FIXED_VOICE = "onyx";
const ROMANTIC_INSTRUCTIONS =
  "Read in a warm, deep, intimate tone — low-pitched, unhurried, passionate. " +
  "Speak as if confiding to one listener close by, slower than conversational speech. " +
  "Linger on emphasis words. Take noticeable pauses at punctuation, longer at paragraph breaks. " +
  "Never race. No commentary — read the text verbatim.";

export async function synthesize(text: string, _voice: TtsVoice): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not set");
  // gpt-4o-mini-tts supports the `instructions` param for tone steering.
  // tts-1/tts-1-hd don't — they'd ignore it and sound generic.
  const model = process.env.READER_TTS_MODEL || "gpt-4o-mini-tts";
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 60_000);
  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        voice: FIXED_VOICE,
        input: text,
        instructions: ROMANTIC_INSTRUCTIONS,
        response_format: "mp3",
      }),
      signal: ctl.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`TTS ${res.status}: ${detail.slice(0, 300)}`);
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } finally {
    clearTimeout(to);
  }
}

function wrapWav(pcm: Buffer, sampleRate: number, channels: number, bits: number): Buffer {
  const byteRate = sampleRate * channels * bits / 8;
  const blockAlign = channels * bits / 8;
  const dataSize = pcm.length;
  const buf = Buffer.alloc(44);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);            // fmt chunk size
  buf.writeUInt16LE(1, 20);             // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bits, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  return Buffer.concat([buf, pcm]);
}
