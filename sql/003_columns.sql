-- Backfill migration: columns and tables referenced by the app code that are
-- not created by 001_init.sql. Safe to run repeatedly (all IF NOT EXISTS).
--
-- These were introduced incrementally in routes/components without a
-- companion SQL file, so a clean deployment from 001 alone is missing them.

-- books: extra metadata used by upload / resume / library / sync routes.
ALTER TABLE books ADD COLUMN IF NOT EXISTS status_detail text;
ALTER TABLE books ADD COLUMN IF NOT EXISTS progress_pct int;
ALTER TABLE books ADD COLUMN IF NOT EXISTS cover_path text;
ALTER TABLE books ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE books ADD COLUMN IF NOT EXISTS finished_prompted_at timestamptz;
ALTER TABLE books ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE books ADD COLUMN IF NOT EXISTS text_hash text;
ALTER TABLE books ADD COLUMN IF NOT EXISTS title_author_key text;
ALTER TABLE books ADD COLUMN IF NOT EXISTS duplicate_of uuid REFERENCES books(id) ON DELETE SET NULL;
ALTER TABLE books ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Library page filters on archived; dedupe checks use content_hash and text_hash.
CREATE INDEX IF NOT EXISTS books_owner_archived_idx ON books (owner_email, archived, created_at DESC);
CREATE INDEX IF NOT EXISTS books_content_hash_idx ON books (owner_email, content_hash) WHERE content_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS books_text_hash_idx ON books (owner_email, text_hash) WHERE text_hash IS NOT NULL;

-- audio_cache: per-(book, chapter, part, voice) rendered audio, referenced by
-- /api/tts/[bookId]/[chapterIdx]. Keys guarantee O(1) cache lookups and
-- the ON CONFLICT path in the TTS route.
CREATE TABLE IF NOT EXISTS audio_cache (
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_idx int NOT NULL,
  part_idx int NOT NULL,
  voice text NOT NULL,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (book_id, chapter_idx, part_idx, voice)
);
CREATE INDEX IF NOT EXISTS audio_cache_created_idx ON audio_cache (created_at);
