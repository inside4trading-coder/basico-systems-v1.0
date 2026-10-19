// Service worker del POS: guarda la aplicación para que abra sin conexión.
// Solo cachea lo propio (HTML y /assets); los datos van por Supabase y el POS
// los guarda aparte (src/modules/pos/offline).
const CACHE = "bsys-shell-v1";

// La primera visita carga los assets antes de que este worker controle la
// página: se guardan leyendo el HTML, que los nombra con su hash.
async function precache() {
  const cache = await caches.open(CACHE);
  const res = await fetch("/", { cache: "no-store" });
  const html = await res.clone().text();
  await cache.put("/", res);
  const assets = [...new Set(html.match(/\/assets\/[^"']+\.(?:js|css)/g) ?? [])];
  await cache.addAll([...assets, "/manifest.webmanifest", "/icon-192.png"]);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Páginas: primero la red (versión nueva), si no hay, la última guardada.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) event.waitUntil(precache().catch(() => undefined));
          return res;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  // Archivos con hash en el nombre: no cambian, primero la copia.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
