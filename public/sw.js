const CACHE = "fit-chef-static-v1";
const scope = new URL(self.registration.scope);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([
    scope.href, new URL("manifest.webmanifest", scope).href, new URL("icon.svg", scope).href,
  ])));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  if (url.pathname.includes("/api/") || url.pathname.includes("/__/auth/")) return;
  const navigation = request.mode === "navigate";
  if (!navigation && !/\.(?:js|css|wasm|png|svg|webmanifest)$/.test(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE).catch((error) => {
      console.warn("FIT Chef: cache offline non disponibile.", error);
      return null;
    });
    let response;
    try {
      response = await fetch(request);
    } catch {
      const cached = cache && await cache.match(request);
      if (cached) return cached;
      if (navigation && cache) {
        const home = await cache.match(scope.href);
        if (home) return home;
      }
      return new Response("Risorsa non ancora disponibile offline. Apri l'app online prima di riprovare.", {
        status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    if (cache && response.ok && response.type === "basic") {
      await cache.put(request, response.clone()).catch((error) => {
        console.warn("FIT Chef: risorsa non salvata per l'uso offline.", error);
      });
    }
    return response;
  })());
});
