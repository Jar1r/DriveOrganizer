// Minimal service worker for PWA installability.
// Pass-through fetch with no caching so deploys propagate immediately.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request).catch(() => new Response("", { status: 504 }))
  );
});
