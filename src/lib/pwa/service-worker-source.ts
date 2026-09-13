/**
 * Service worker-källa (spec §9), serverad av /sw.js med versionen inbakad.
 *
 * Cachepolicyn är en ALLOWLIST. Bara tre saker får ligga i Cache Storage:
 *   1. hashade byggartefakter under /_next/static/ (oföränderliga)
 *   2. ikoner + manifest
 *   3. den statiska offline-sidan (/offline) som visas när en navigering
 *      misslyckas utan nät
 *
 * Aldrig: HTML för inloggade sidor, RSC-payloads, /api/*, auth, admin,
 * redovisning, dokument (offert/faktura/PDF), kundlänkar med token,
 * bilagor. Det som saknas i allowlisten passerar orört – service workern
 * rör då inte requesten alls.
 *
 * Versionering: cachenamnet bär versionen; vid aktivering raderas alla andra
 * versioners cacher. Ny version tar över direkt (skipWaiting + clients.claim).
 *
 * Källan är en sträng med `__SW_VERSION__` som platshållare så att den kan
 * testas i en VM utan webbläsare (service-worker.test.ts) och serveras utan
 * byggsteg.
 */
export const SW_VERSION_PLACEHOLDER = "__SW_VERSION__";

export const SW_SOURCE = String.raw`/* Ferva service worker – version __SW_VERSION__ */
const VERSION = "__SW_VERSION__";
const CACHE = "ferva-" + VERSION;
const OFFLINE_URL = "/offline";
const PRECACHE = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

/* Prefix som ALDRIG cachas eller hanteras av workern. */
const NEVER = [
  "/api/",
  "/auth/",
  "/admin",
  "/redovisning",
  "/offert/",
  "/faktura/",
  "/andring/",
  "/uppdrag-kund/",
  "/sajt/",
  "/inbjudan",
  "/login",
  "/signup",
  "/demo",
  "/_next/data/",
  "/_next/image",
];

/**
 * Klassificera en request. Exporteras på self för test.
 *   "bypass"     – rör inte (network som vanligt)
 *   "static"     – cache-first (hashade artefakter)
 *   "asset"      – stale-while-revalidate (ikoner, manifest)
 *   "navigation" – network-only med offline-sida som reserv
 */
function classify(request, scopeOrigin) {
  if (request.method !== "GET") return "bypass";
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return "bypass";
  }
  if (url.origin !== scopeOrigin) return "bypass";
  const p = url.pathname;
  // RSC/flight-payloads och prefetch är aldrig cachebara – de bär data.
  if (url.searchParams.has("_rsc")) return "bypass";
  const h = request.headers;
  if (h && (h.get("RSC") === "1" || h.get("Next-Router-Prefetch") === "1" || h.get("Next-Router-Segment-Prefetch"))) return "bypass";
  for (const prefix of NEVER) {
    if (p === prefix || p.startsWith(prefix) || p.startsWith(prefix + "/")) return "bypass";
  }
  if (p.startsWith("/_next/static/")) return "static";
  if (p === OFFLINE_URL || p === "/manifest.webmanifest" || p.startsWith("/icons/")) return "asset";
  if (request.mode === "navigate") return "navigation";
  return "bypass";
}
self.__fervaClassify = classify;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("ferva-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || refresh;
}

async function navigationWithFallback(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(CACHE);
    const offline = await cache.match(OFFLINE_URL);
    return offline || new Response("Ingen anslutning.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

self.addEventListener("fetch", (event) => {
  const kind = classify(event.request, self.location.origin);
  if (kind === "bypass") return;
  if (kind === "static") event.respondWith(cacheFirst(event.request));
  else if (kind === "asset") event.respondWith(staleWhileRevalidate(event.request));
  else if (kind === "navigation") event.respondWith(navigationWithFallback(event.request));
});
`;

/** Färdig källa för en given version. */
export function serviceWorkerSource(version: string): string {
  const safe = version.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64) || "dev";
  return SW_SOURCE.split(SW_VERSION_PLACEHOLDER).join(safe);
}
