CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS books (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_email text NOT NULL,
  title text,
  author text,
  source_filename text,
  source_path text,
  source_kind text,
  word_count int,
  status text NOT NULL DEFAULT 'extracting',
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS books_owner_created_idx ON books (owner_email, created_at DESC);

CREATE TABLE IF NOT EXISTS chapters (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  idx int NOT NULL,
  title text,
  text text NOT NULL,
  word_count int,
  UNIQUE (book_id, idx)
);
CREATE INDEX IF NOT EXISTS chapters_book_idx ON chapters (book_id, idx);

CREATE TABLE IF NOT EXISTS progress (
  book_id uuid NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  owner_email text NOT NULL,
  chapter_idx int NOT NULL DEFAULT 0,
  paragraph_idx int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (book_id, owner_email)
);

CREATE TABLE IF NOT EXISTS prefs (
  owner_email text PRIMARY KEY,
  json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
