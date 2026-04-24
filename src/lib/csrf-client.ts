// Client-side helper to read the reader_csrf cookie and echo it on mutating
// fetches. Usage: `import { apiFetch } from "@/lib/csrf-client";`
//
// apiFetch() wraps window.fetch and automatically sets X-CSRF-Token for
// non-GET requests when the cookie is present. GET/HEAD pass through
// unchanged so cached reads aren't disturbed.

export function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)reader_csrf=([a-f0-9]{64})/);
  return m?.[1] ?? null;
}

export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return fetch(input, init);
  const token = readCsrfCookie();
  const headers = new Headers(init?.headers);
  if (token && !headers.has("X-CSRF-Token")) headers.set("X-CSRF-Token", token);
  return fetch(input, { ...init, headers });
}
