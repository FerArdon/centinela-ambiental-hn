const CACHE_NAME = "centinela-shell-v1";
const ARCHIVOS_CASCARON = [
  "./",
  "./index.html",
  "./app.js",
  "./igd.js",
  "./firebase-config.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ARCHIVOS_CASCARON))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(
        nombres
          .filter((n) => n !== CACHE_NAME)
          .map((n) => caches.delete(n))
      )
    )
  );
  self.clients.claim();
});

// Cascarón de la app: cache-first (para que cargue instantáneo y sin
// internet). Todo lo demás (Firestore, Google APIs) se deja pasar
// directo a la red — Firestore ya maneja su propio caso offline.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const esPropio = url.origin === self.location.origin;

  if (!esPropio) return; // deja pasar llamadas a Firebase/Google tal cual

  event.respondWith(
    caches.match(event.request).then((cacheado) => {
      if (cacheado) return cacheado;
      return fetch(event.request).catch(() => caches.match("./index.html"));
    })
  );
});
