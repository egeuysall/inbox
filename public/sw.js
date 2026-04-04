const CACHE_VERSION = "ibx-shell-v4";
const SHELL_FILES = ["/", "/manifest.webmanifest", "/favicon.ico"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_FILES)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_VERSION) {
            return caches.delete(cacheName);
          }

          return Promise.resolve();
        }),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const responseCopy = response.clone();
          void caches.open(CACHE_VERSION).then((cache) => {
            cache.put(request, responseCopy);
            if (url.pathname === "/") {
              return;
            }
            return cache.put("/", response.clone());
          });
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE_VERSION);
          const cachedPage = await cache.match(request);
          if (cachedPage) {
            return cachedPage;
          }
          const cachedShell = await cache.match("/");
          return cachedShell || new Response("Offline", { status: 503 });
        }),
    );
    return;
  }

  if (
    url.pathname.startsWith("/_next/") ||
    ["script", "style", "font", "image", "manifest"].includes(request.destination)
  ) {
    event.respondWith(
      caches.open(CACHE_VERSION).then((cache) =>
        cache.match(request).then((cached) => {
          const networkFetch = fetch(request)
            .then((response) => {
              if (response.ok) {
                void cache.put(request, response.clone());
              }
              return response;
            })
            .catch(() => null);

          if (cached) {
            void networkFetch;
            return cached;
          }

          return networkFetch.then(
            (response) => response || new Response("Offline", { status: 503 }),
          );
        }),
      ),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.match(request).then((cached) => {
        if (cached) {
          return cached;
        }

        return fetch(request)
          .then((response) => {
            if (response.ok) {
              void cache.put(request, response.clone());
            }
            return response;
          })
          .catch(() => new Response("Offline", { status: 503 }));
      }),
    ),
  );
});
