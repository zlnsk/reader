-- Libgen md5 dedup: stop ingesting the same libgen entry twice per owner.
-- Partial unique index so multiple NULLs (upload / OPDS rows) and soft-deleted
-- duplicate rows (duplicate_of IS NOT NULL) do not collide.
ALTER TABLE books ADD COLUMN IF NOT EXISTS libgen_md5 text;
CREATE UNIQUE INDEX IF NOT EXISTS books_owner_libgenmd5_uidx
  ON books (owner_email, libgen_md5)
  WHERE libgen_md5 IS NOT NULL AND duplicate_of IS NULL;
