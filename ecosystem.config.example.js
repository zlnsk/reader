module.exports = {
  apps: [{
    name: "Reader",
    script: "node_modules/.bin/next",
    args: "start -p 3017 -H 127.0.0.1",
    cwd: "/app",
    watch: false,
    autorestart: true,
    max_restarts: 10,
    max_memory_restart: "512M",
    env: {
      NODE_ENV: "production",
      // Caddy shared secret — generated at deploy
      PROXY_SECRET: "REPLACE_WITH_GENERATED_SECRET",
      NEXT_PUBLIC_APP_URL: "https://apps.example.com/Reader",
      // Shared OTP auth (see <SHARED_MODULES_DIR>/shared-auth)
      OTP_JMAP_URL: "http://127.0.0.1:8080",
      OTP_JMAP_USER: "noreply",
      OTP_JMAP_PASS: "REPLACE_ME",
      OTP_FROM_EMAIL: "noreply@example.com",
      OTP_ALLOWED_EMAILS: "you@example.com",
      OTP_SESSION_SECRET: "REPLACE_WITH_32B_BASE64",
      OTP_SESSION_HOURS: "12",
      // Postgres (per-user books, progress, prefs, audio cache)
      PGHOST: "127.0.0.1",
      PGPORT: "5432",
      PGUSER: "reader",
      PGPASSWORD: "REPLACE_ME",
      PGDATABASE: "reader",
      // OpenRouter for AI cleanup + TTS (routes to anthropic/claude-haiku-4.5 and openai/gpt-audio-mini)
      OPENROUTER_API_KEY: "REPLACE_ME",
      OPENROUTER_MODEL_CLEANUP: "anthropic/claude-haiku-4.5",
      OPENROUTER_MODEL_TTS: "openai/gpt-audio-mini",
      UPLOAD_DIR: "/app/uploads",
      MAX_UPLOAD_MB: "60",
    },
  }],
};
