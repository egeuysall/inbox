const CACHE_VERSION = "ibx-shell-v5";
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

self.addEventListener("push", (event) => {
  const payload = (() => {
    if (!event.data) {
      return null;
    }

    try {
      return event.data.json();
    } catch {
      return {
        body: event.data.text(),
      };
    }
  })();

  const title =
    typeof payload?.title === "string" && payload.title.trim().length > 0
      ? payload.title
      : "ibx reminder";
  const body =
    typeof payload?.body === "string" && payload.body.trim().length > 0
      ? payload.body
      : "A scheduled task is ready.";
  const tag =
    typeof payload?.tag === "string" && payload.tag.trim().length > 0
      ? payload.tag
      : "ibx-task";
  const targetUrl =
    typeof payload?.url === "string" && payload.url.length > 0
      ? payload.url
      : "/?view=today";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      data: {
        url: targetUrl,
      },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data;
  const targetUrl =
    typeof data?.url === "string" && data.url.length > 0
      ? data.url
      : "/?view=today";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          if ("navigate" in client) {
            return client.navigate(targetUrl).then(() => client.focus());
          }
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return undefined;
    }),
  );
});
