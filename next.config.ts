import type { NextConfig } from "next";

// CSP notes:
// - 'self' covers the app's own origin. The app is served under /Reader via Caddy.
// - Inline scripts: Next.js 15/16 injects un-nonced inline <script> bootstrap
//   tags (self.__next_f.push(...), RSC flight payloads, webpack runtime glue)
//   into every streamed HTML response. These are required for React hydration
//   and streaming. There is no built-in nonce support without a custom render
//   pipeline, so we allow 'unsafe-inline' for script-src. We keep the rest of
//   the hardening (X-Frame-Options: DENY, tight img/media/connect, etc.).
//   Follow-up: implement per-request nonces via middleware + custom document
//   to drop 'unsafe-inline' here. Tracked in TODO.
// - Inline styles: permitted for the same reason (Next.js + inline style={}).
// - Cover images come from /Reader/api/books/[id]/cover (same origin). We also
//   allow data: and blob: so CSS fallbacks and object-URL previews work.
// - Audio from /Reader/api/tts/... (same origin) + blob:.
// - Connections (fetch) limited to self.
// - LibGen download requests are server-side only, so no client connect-src
//   entries for external mirrors are needed.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {

  serverExternalPackages: ["shared-auth", "shared-ai", "pg", "pdfjs-dist", "epub2", "mammoth", "adm-zip"],
  basePath: "/Reader",
  env: { NEXT_PUBLIC_BASE_PATH: "/Reader" },
  typescript: { ignoreBuildErrors: true },
  experimental: { serverActions: { bodySizeLimit: "250mb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
