# reader

> A reading app that respects you, your eyes, and your attention span.

Uploads books. Strips the terrible OCR noise. Reads them to you out loud when you're too tired to read. Syncs progress across devices. No ads, no analytics, no referral URL sneakily stamped on the cover.

---

## What it is

A self-hosted reading stack that takes **PDFs, EPUBs, DOCX, TXT, and Markdown** (or things you pull from **OPDS** / **LibGen**) and turns them into a clean, long-form reading experience. Then optionally reads them to you in the voice of your choosing, because audiobooks are expensive and you have an LLM budget anyway.

- **Ingest** via `pdf-parse`, `epub2`, `mammoth` + LibGen and OPDS clients for books you already have the right to read
- **AI cleanup** via OpenRouter — because raw PDF text looks like it was airdropped from a helicopter into a blender
- **Text-to-speech** via OpenAI's audio API, cached server-side by content-hash so replaying a paragraph doesn't re-bill
- **Send-to-Kindle** over email, because sometimes e-ink is the only place to finish a 900-page Russian novel
- **Offline reading** with IndexedDB + a real service worker — subway tunnels don't interrupt
- **OPDS server + client**: Reader speaks OPDS both ways, so any OPDS-compatible reader on the planet can browse your library, and Reader can browse anyone else's

## Why I wrote it

Kindle wants money. Apple Books is a walled garden with excellent escape-proof doors. Calibre has the UI of an early WinAmp skin. Every mainstream PDF reader now insists on adding "industry-leading AI features" *and* sticking a chatbot in the corner of my novel — I wanted to read, not ask Clippy what happens in chapter four.

So I wrote this. With **tremendous** help from an LLM, to be straight about it. I do not hand-write `pdf-parse` error-handling at 23:00. Nobody should. This is the future; I like this future.

## Design

A **paper-tone palette** — `#FBF7F1` warm page, `#1a1714` deep ink — calibrated not to set fire to your retinas at midnight. **Source Serif 4** for body copy, **JetBrains Mono** for metadata, system-ui for UI chrome. The typographic scale runs 11 → 40 px with 1.6 line-height on body — a measure your English teacher would grudgingly approve.

Every reading preference (typeface, size, line-height, margins, theme) persists per-device. Dark mode is proper dark mode, not `filter: invert(1)` like some apps I will decline to name.

## Security & privacy

- **Your library stays yours.** Postgres on one box, encrypted backups at rest, no CDN, no replication across borders except for the third-party API calls you explicitly trigger.
- **No third-party identifiers.** Exactly one session cookie. App passwords for OPDS clients are scrypt-hashed; main login uses OTP via email magic-code, so there's no long-lived password to lose.
- **DRM-encumbered e-books are unsupported by design.** If you need to strip DRM, that's a decision between you and your lawyer, and it doesn't belong in this codebase.
- **No telemetry. No analytics. No beacons.** The only network traffic leaving your server on a typical read is: nothing. The only traffic on an AI-cleanup or TTS action is: one request to the provider you picked.
- **App passwords can be revoked individually** from the web settings page, so losing a Kindle doesn't mean rotating your whole account.

## Run it

Needs Node 22+, Postgres 17, OpenRouter API key, and an OpenAI key for the audio model. Symlink the `shared-auth` module via `SHARED_MODULES_DIR` (or vendor the module inline — your call).

```bash
cp ecosystem.config.example.js ecosystem.config.js
# fill in the REPLACE_ME values (OPENROUTER_API_KEY, PGPASSWORD, etc.)
npm install
npm run build
npm start
# or: pm2 start ecosystem.config.js
```

Caddy / nginx in front doing TLS + injecting a `X-Proxy-Secret` header is the intended topology. See the example.

## License

MIT. Take it, improve it, don't ship it with trackers.
