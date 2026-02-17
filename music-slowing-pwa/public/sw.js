const CACHE_NAME = "music-slowing-shell-v1";
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.json",
  "/worklets/peak-meter-worklet.js",
  "/icons/icon-192.svg",
  "/icons/icon-512.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const network = await fetch(req);
          const cache = await caches.open(CACHE_NAME);
          cache.put("/index.html", network.clone());
          return network;
        } catch {
          const cached = await caches.match("/index.html");
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) {
        event.waitUntil(updateCache(req));
        return cached;
      }

      try {
        const network = await fetch(req);
        if (network.ok && network.type === "basic") {
          const cache = await caches.open(CACHE_NAME);
          cache.put(req, network.clone());
        }
        return network;
      } catch {
        return cached || Response.error();
      }
    })()
  );
});

async function updateCache(request) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic") {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
  } catch {
    // Keep old cache when offline/fetch fails.
  }
}
