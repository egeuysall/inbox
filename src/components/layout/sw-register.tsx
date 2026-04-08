"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    const hostname = window.location.hostname;
    const isLocalDevHost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1";
    const shouldRegisterServiceWorker =
      process.env.NODE_ENV === "production" || isLocalDevHost;

    if (!shouldRegisterServiceWorker) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .then(() =>
          caches
            .keys()
            .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
            .catch(() => undefined),
        )
        .catch(() => undefined);
      return;
    }

    void navigator.serviceWorker
      .register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      })
      .then((registration) => registration.update())
      .catch(() => undefined);
  }, []);

  return null;
}
