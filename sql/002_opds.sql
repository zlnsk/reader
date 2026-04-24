-- OPDS publishing: per-user app-passwords for HTTP Basic auth from
-- e-reader clients (KOReader, Thorium, Moon+ Reader) that can't do
-- the browser OTP flow. Password is scrypt-hashed; label is user-supplied.
CREATE TABLE IF NOT EXISTS app_passwords (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_email text NOT NULL,
  label text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS app_passwords_owner_idx ON app_passwords (owner_email);

-- OPDS client: saved remote catalogs the user wants to browse from inside
-- the app. Credentials are stored plaintext: this DB is local, single-host,
-- behind PROXY_SECRET + OTP, and the creds already flow through the app
-- unprotected on every browse. Acceptable for personal-use scope.
CREATE TABLE IF NOT EXISTS opds_catalogs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_email text NOT NULL,
  title text NOT NULL,
  url text NOT NULL,
  username text,
  password text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS opds_catalogs_owner_idx ON opds_catalogs (owner_email);
