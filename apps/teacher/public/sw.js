/*
 * MTB Teacher: app-shell service worker (production build only; registered by src/app/pwa.ts).
 *
 * Keeps the app's own files on the phone so the app opens with no signal:
 *   - pages: network first, falling back to the saved shell (index.html), so a fresh deploy is picked up online;
 *   - /assets/* (hashed, never change) and fonts: cache first;
 *   - the manifest and icons: served from the cache, refreshed in the background.
 * API calls (/api/*) are never cached here: the app keeps its own data and an offline outbox in IndexedDB.
 */
const VERSION = "mtb-teacher-shell-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-maskable.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("mtb-teacher-shell-") && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirstShell(request) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put("/index.html", response.clone());
    return response;
  } catch {
    return (await cache.match("/index.html")) || (await cache.match("/")) || Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => hit || Response.error());
  return hit || refresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") event.respondWith(networkFirstShell(request));
  else if (url.pathname.startsWith("/assets/") || /\.(woff2?|ttf)$/.test(url.pathname)) event.respondWith(cacheFirst(request));
  else if (SHELL.includes(url.pathname)) event.respondWith(staleWhileRevalidate(request));
});
