// Service worker de la app instalable. Siempre intenta la red primero (los datos de trading deben
// estar frescos) y solo usa la copia guardada si no hay conexión. Nunca guarda llamadas a la API.
const CACHE = "ttx-v20";
const SHELL = ["./", "index.html", "styles.css", "app.js", "config.js", "logo.svg", "icon-192.png", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Solo archivos de la propia app (GET). Supabase, Yahoo, CDNs, etc. van directo a la red.
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r ?? caches.match("index.html"))),
  );
});
