# Reader

Private reading app. Upload a book (PDF / EPUB / DOCX / TXT / MD), get AI-cleaned text, read it in a beautifully typeset paginated or scroll view, with high-quality TTS narration powered by OpenAI voice models via OpenRouter.

## Features

- **Paginated or scroll reading** with full typography controls (serif/sans fonts, size, line-height, column width, margins, theme, justify, hyphens) — per-user, synced across devices.
- **AI extraction** (PDF text-layer, EPUB, DOCX, TXT/MD) via `pdf-parse`, `epub2`, `mammoth`. Text cleanup via OpenRouter → `anthropic/claude-haiku-4.5`:
  - Restores dropped apostrophes/contractions (`didn t` → `didn't`)
  - Drops publisher front-matter, copyright pages, ISBN blocks, printing history
  - Keeps only: title, TOC, prologue/foreword/preface, main body
- **Covers**: first PDF page via `pdftoppm`; EPUB cover extracted from OPF manifest.
- **High-quality TTS** via OpenRouter → `openai/gpt-audio-mini` (8 voices: `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`, `coral`, `sage`). Audio cached per-chapter-per-voice in Postgres.
  - Starts reading from the paragraph currently visible on screen.
  - Smooth paragraph-level highlighting with a per-paragraph progress underline.
  - Auto-advances through chapters.
- **PWA**: installable, offline-capable (cached app shell + book pages).
- **LibGen search + download** (uses `libgen.vg` / `.la` / `.gl` / `.bz` mirrors, defaults to EPUB).
- **Reading position sync** (paragraph-anchored, survives font/size changes; syncs across laptop & mobile for the same signed-in email).
- **10-book limit per user** with delete from the library.

## Stack

- Next.js 15 (App Router, TypeScript), Tailwind v4
- Postgres 15+
- PM2 process manager
- Caddy reverse proxy (OTP gating via `shared-auth` HMAC session cookie)
- OpenRouter (Anthropic + OpenAI audio)
- `poppler-utils` (PDF cover rendering)

## Deploy

Assumes Debian/Ubuntu with Node 22+, Postgres, Caddy, PM2 and `poppler-utils` installed.

```bash
# 1) Postgres
sudo -u postgres psql -c "CREATE ROLE reader LOGIN PASSWORD '<pg-pass>';"
sudo -u postgres psql -c "CREATE DATABASE reader OWNER reader;"
sudo -u postgres psql -d reader -f sql/001_init.sql

# 2) App
cd ./
cp ecosystem.config.example.js ecosystem.config.js
# Edit ecosystem.config.js and replace every REPLACE_ME value:
#   - PROXY_SECRET (32-byte base64, shared with Caddy)
#   - OTP_SESSION_SECRET (32-byte base64)
#   - OTP_JMAP_* (JMAP mail credentials for sending OTP codes)
#   - PGPASSWORD
#   - OPENROUTER_API_KEY
#   - OTP_ALLOWED_EMAILS (comma-separated)

npm install
# Link the OTP auth module alongside (assumes ../shared-auth exists)
ln -sfn ../shared-auth node_modules/shared-auth
npm run build
pm2 start ecosystem.config.js
pm2 save
```

Caddy snippet (for this app behind a reverse proxy at path `/Reader`):

```caddyfile
@reader path_regexp ^(?i)/Reader(/.*)?$
handle @reader {
  reverse_proxy 127.0.0.1:3017 {
    header_up Host {host}
    header_up X-Forwarded-Host {host}
    header_up X-Forwarded-Proto "https"
    header_up X-Proxy-Secret "<matches PROXY_SECRET>"
  }
}
```

## Routes

| Path | Purpose |
|---|---|
| `/` | Library grid (covers + progress) |
| `/upload` | File upload + extraction progress |
| `/search` | LibGen search + one-click import |
| `/book/[id]` | Reader with typography prefs + TTS |
| `/api/auth/[action]` | OTP email auth (login / verify / send-code / logout) |
| `/api/upload` | Multipart upload → extract pipeline |
| `/api/books/[id]` | Book status + delete |
| `/api/books/[id]/cover` | JPEG/PNG cover |
| `/api/progress` | Save reading position (paragraph-anchored) |
| `/api/prefs` | User typography + TTS voice preferences |
| `/api/tts/[bookId]/[chapterIdx]` | Streaming WAV synthesis (with cache + start-from-paragraph mode) |
| `/api/libgen/search` | LibGen search proxy |
| `/api/libgen/download` | Fetch + extract a LibGen book |

## Schema

See `sql/001_init.sql`.

## License

MIT
