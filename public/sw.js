// Reader service worker — offline-first for shell & book content
const VERSION = "reader-v14-20260422-progress-queue";
const SHELL_CACHE = `${VERSION}-shell`;
const BOOK_CACHE = `${VERSION}-books`;
const BP = "/Reader";

const SHELL_URLS = [
  `${BP}/`,
  `${BP}/manifest.webmanifest`,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (!url.pathname.startsWith(BP)) return;
  if (url.pathname.startsWith(`${BP}/api/auth`)) return;

  // Book API & page routes — stale-while-revalidate into BOOK_CACHE
  const isBookApi = url.pathname.startsWith(`${BP}/api/books/`);
  const isBookPage = /^\/Reader\/book\/[^/]+$/.test(url.pathname);
  const isLibraryRoot = url.pathname === `${BP}` || url.pathname === `${BP}/`;
  const isStatic = url.pathname.startsWith(`${BP}/_next/static/`) || url.pathname.match(/\.(css|js|woff2?|png|svg|webmanifest)$/);

  // Book pages: network-first to avoid hydration mismatches when JS chunks change between builds.
  // Book API: stale-while-revalidate for offline reading.
  if (isBookPage) {
    event.respondWith(networkFirst(req, BOOK_CACHE));
    return;
  }
  if (isBookApi) {
    event.respondWith(staleWhileRevalidate(req, BOOK_CACHE));
    return;
  }
  if (isStatic) {
    event.respondWith(cacheFirst(req, SHELL_CACHE));
    return;
  }
  if (isLibraryRoot) {
    event.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }

  // Navigation to any other Reader page (e.g. /Reader/search, /Reader/upload,
  // /Reader/settings): try network first, fall back to the cached library
  // shell so offline users see the app instead of the Chrome dino.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok) {
            const cache = await caches.open(SHELL_CACHE);
            cache.put(req, fresh.clone());
          }
          return fresh;
        } catch {
          const cache = await caches.open(SHELL_CACHE);
          const cached = (await cache.match(req)) || (await cache.match(`${BP}/`));
          return cached || new Response("Offline", { status: 503 });
        }
      })()
    );
    return;
  }
});

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return cached || (await network) || new Response("Offline", { status: 503 });
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req).catch(() => null);
  if (res && res.ok) cache.put(req, res.clone());
  return res || new Response("Offline", { status: 503 });
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    return cached || new Response("Offline", { status: 503 });
  }
}

// Message API — precache / purge a book for offline reading.
// The client (LibraryCard) posts { type: "precache-book", bookId } after the
// user asks to save a book offline; we pull down the book page HTML, its
// metadata, and the cover so the Reader page hydrates without network.
self.addEventListener("message", async (event) => {
  const { type, bookId } = event.data || {};
  if (!bookId) return;
  if (type === "precache-book") {
    const cache = await caches.open(BOOK_CACHE);
    const urls = [
      `${BP}/book/${bookId}`,
      `${BP}/api/books/${bookId}`,
      `${BP}/api/books/${bookId}/cover`,
    ];
    const port = event.ports && event.ports[0];
    let done = 0;
    const total = urls.length;
    for (const u of urls) {
      try {
        const res = await fetch(u, { credentials: "include", cache: "no-store" });
        if (res.ok) await cache.put(u, res.clone());
      } catch {}
      done++;
      if (port) port.postMessage({ type: "precache-progress", bookId, done, total });
    }
    if (port) port.postMessage({ type: "precache-done", bookId });
  } else if (type === "purge-book") {
    const cache = await caches.open(BOOK_CACHE);
    for (const u of [
      `${BP}/book/${bookId}`,
      `${BP}/api/books/${bookId}`,
      `${BP}/api/books/${bookId}/cover`,
    ]) {
      try { await cache.delete(u); } catch {}
    }
  }
});
