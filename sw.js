/* Service worker: caches the app shell, TMDB posters and TMDB API responses
   so the app loads instantly and works offline (posters stay cached across updates). */
const VERSION = 'montvtime-v134';
const SHELL = 'shell-' + VERSION;
// Caches permanents : sans numéro de version, donc conservés à chaque mise à jour de l'app
const IMG = 'img-v1';
const API = 'api-v1';
const IMG_MAX = 1500; // affiches gardées (les plus anciennes sont supprimées au-delà)
const API_MAX = 400;  // réponses d'API gardées

const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './data.js',
  './seed.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' = on ignore le cache HTTP du navigateur (sinon une vieille app.js pourrait être rangée sous la nouvelle version)
  e.waitUntil(caches.open(SHELL)
    .then((c) => c.addAll(SHELL_ASSETS.map((u) => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

// Doit-on garder ce cache ? Oui : la coquille courante et les caches permanents img-v1 / api-v1.
// Non : les anciennes coquilles shell-… et les anciens img-montvtime-v… / api-montvtime-v…
function keepCache(k) { return k === SHELL || k === IMG || k === API; }

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => !keepCache(k)).map((k) => caches.delete(k))
    ))
      // Ménage des caches permanents à chaque activation (le SW s'arrête souvent avant d'atteindre les compteurs ci-dessous)
      .then(() => Promise.all([
        caches.open(IMG).then((c) => trim(c, IMG_MAX)),
        caches.open(API).then((c) => trim(c, API_MAX)),
      ]).catch(() => {}))
      .then(() => self.clients.claim())
  );
});

// Supprime les entrées les plus anciennes (keys() est dans l'ordre d'ajout) au-delà de max
async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

// Mise en cache sans jamais bloquer la réponse (quota plein, erreur d'écriture…) + ménage de temps en temps
function putQuietly(cache, key, res, max) {
  cache.put(key, res).then(() => { if (Math.random() < 0.03) return trim(cache, max); }).catch(() => {});
}

// Affiches : cache d'abord. Sinon on les télécharge nous-mêmes en CORS (réponse lisible, res.ok fiable)
async function imageFirst(req) {
  const cache = await caches.open(IMG);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  let res = null;
  try { res = await fetch(req.url, { mode: 'cors', credentials: 'omit' }); } catch (_) { /* repli ci-dessous */ }
  if (res && res.ok) { putQuietly(cache, req.url, res.clone(), IMG_MAX); return res; }
  return fetch(req); // repli normal, sans mise en cache
}

// API TMDB : réseau d'abord (l'app a son propre cache) ; le cache ne sert que hors-ligne
async function networkFirst(req) {
  const cache = await caches.open(API);
  let res;
  try { res = await fetch(req); } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
  if (res && res.ok) putQuietly(cache, req, res.clone(), API_MAX);
  return res;
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const fetchP = fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
  return hit || fetchP;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // never cache the local persistence API
  if (url.pathname.startsWith('/api/')) return;

  // Affiches TMDB -> cache permanent, cache d'abord
  if (url.hostname === 'image.tmdb.org') {
    e.respondWith(imageFirst(req));
    return;
  }
  // API TMDB -> réseau d'abord
  if (url.hostname === 'api.themoviedb.org') {
    e.respondWith(networkFirst(req));
    return;
  }
  // Fichiers de l'app (même origine) -> périmé d'abord. Tout le reste (Supabase…) n'est PAS intercepté.
  if (url.origin === self.location.origin) {
    e.respondWith(staleWhileRevalidate(req, SHELL));
  }
});
