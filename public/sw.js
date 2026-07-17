const CACHE_NAME = "safezone-shell-v4";
const APP_SHELL = ["/", "/onboarding", "/caregiver", "/patient", "/manifest.json", "/icon.svg"];

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
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws")) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(async () => {
        return (await caches.match(url.pathname)) || (await caches.match("/"));
      })
    );
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});

self.addEventListener("push", (event) => {
  const payload = event.data
    ? event.data.json()
    : {
        title: "Navora alert",
        body: "The patient device appears to have left the safe zone.",
        data: { url: "/caregiver" }
      };

  event.waitUntil(
    self.registration.showNotification(payload.title || "Navora alert", {
      body: payload.body || "Open Navora for details.",
      icon: "/icon.svg",
      badge: "/icon.svg",
      data: payload.data || { url: "/caregiver" },
      vibrate: [200, 100, 200, 100, 200]
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/caregiver";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const matchingClient = clients.find((client) => client.url.includes(url));

      if (matchingClient) {
        return matchingClient.focus();
      }

      return self.clients.openWindow(url);
    })
  );
});
