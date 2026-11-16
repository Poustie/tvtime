/* Mon TV Time — État, persistance, clés et aides */
'use strict';
//////////////////////// State ////////////////////////
// userState = durable user edits (persisted to userdata.json)
let userState = {
  tmdbKey: '',
  seenAdd: {},     // key -> {at}
  seenRemove: {},  // key -> true
  ratings: {},     // key -> rating(1-5)
  emotions: {},    // key -> emotionId
  showRatings: {}, // showId -> rating
  watchlist: {},   // showId -> true
  archived: {},    // showId -> true/false override
  customEpisodes: {}, // showKey -> [{s,n,name}] user-added episodes
  homeOrder: ['watching', 'notStarted', 'stale', 'finished'], // order of the Séries sections
  movieStatus: {}, // movieName -> 'watched' | 'towatch' (user override)
  movieWatchedAt: {}, // movieName -> date string (enregistrée quand tu marques un film vu dans l'app)
  movieRatings: {}, // movieName -> rating(1-5) (ma notation d'un film)
  movieEmotions: {}, // movieName -> emotionId (ma réaction à un film ; '' = effacée, override de l'import)
  rewatch: {},     // epKey -> number of rewatches (override of exported count)
  movieRewatch: {}, // movieName -> number of rewatches (override)
  movieProgress: {}, // movieName -> minutes déjà vues (reprise d'un film en cours)
  showTmdb: {},    // showKey -> tmdbId (manual TMDB match / poster override)
  movieTmdb: {},   // movieName -> { id, poster } (manual TMDB match / poster override)
  customShows: [], // [{key,tmdbId,name,poster,addedAt}] shows added by the user (future watch)
  customMovies: [],// [{name,releaseDate,runtime,status,addedAt}] movies added by the user
  pinnedWatching: {}, // showKey -> true : force the show into « En cours » regardless of last-seen date
  rewatching: {}, // showKey -> true : nouveau visionnage en cours d'une série terminée
  rewatchAt: {}, // epKey -> timestamp du dernier « +1 visionnage » (appartenance au revisionnage en cours)
  rewatchDates: {}, // epKey -> [dates « AAAA-MM-JJ HH:MM:SS » de chaque revisionnage]
  movieRewatchDates: {}, // movieName -> [dates de chaque revisionnage]
  rewatchActivity: {}, // showKey -> date "YYYY-MM-DD HH:MM:SS" du dernier revisionnage (tri « En cours »)
  lastBackupAt: null, // date ISO de la dernière sauvegarde exportée
  weeklyBackup: true, // proposer une sauvegarde chaque semaine (mode téléphone)
  backupSnoozeUntil: 0, // « Plus tard » : ne pas reproposer avant ce timestamp
  favShows: {},    // showKey -> true/false : override the imported "favori" flag
  favMovies: {},   // movieName -> true : films favoris
  profileName: '', // nom affiché dans « Bonjour … » (paramétrable, override du nom importé)
  userLists: [],   // [{id,name,shows:[key],movies:[name]}] listes personnalisables
  lists: null,     // null = use baseline lists; else array
  seenChangelog: 0, // id de la dernière note de version vue (pop-up « nouveautés »)
  amoled: true, // fond totalement noir (écrans AMOLED) — activé par défaut
};
// tmdbCache = metadata cache (persisted to tmdb-cache.json)
// Valeurs d'origine de userState : sert à remettre à zéro l'état avant une restauration complète.
const USERSTATE_DEFAULTS = JSON.parse(JSON.stringify(userState));
let tmdbCache = { map: {}, shows: {}, seasons: {}, movies: {}, movieMeta: {}, episodes: {} };

let MODEL = null; // built show model

//////////////////////// Persistence ////////////////////////
// Works in two modes:
//  - PC mode: the PowerShell server answers /api/state & /api/cache -> saved to disk files.
//  - Standalone/PWA mode (phone, static hosting): no server -> saved to IndexedDB on the device.
let serverAvailable = false;

// --- tiny IndexedDB key/value store ---
let _dbPromise = null;
function idbOpen() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((res, rej) => {
    const r = indexedDB.open(LS_NS, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return _dbPromise;
}
async function idbGet(key) {
  try {
    const db = await idbOpen();
    return await new Promise((res) => {
      const req = db.transaction('kv').objectStore('kv').get(key);
      req.onsuccess = () => res(req.result); req.onerror = () => res(undefined);
    });
  } catch { return undefined; }
}
async function idbSet(key, val) {
  try {
    const db = await idbOpen();
    return await new Promise((res) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(val, key);
      tx.oncomplete = () => res(true); tx.onerror = () => res(false); tx.onabort = () => res(false);
    });
  } catch { return false; }
}

// Labo : au premier lancement, copie (lecture seule) des données de l'app normale dans la base du labo.
async function laboCopyFromMain() {
  if (!LABO || await idbGet('userState')) return false;
  const src = await new Promise((res) => { const r = indexedDB.open('montvtime'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onupgradeneeded = () => { r.transaction.abort(); res(null); }; });
  if (!src || !src.objectStoreNames.contains('kv')) { try { src && src.close(); } catch {} return false; }
  const all = await new Promise((res) => {
    const out = {}; const cur = src.transaction('kv').objectStore('kv').openCursor();
    cur.onsuccess = () => { const c = cur.result; if (c) { out[c.key] = c.value; c.continue(); } else res(out); };
    cur.onerror = () => res(out);
  });
  src.close();
  for (const [k, v] of Object.entries(all)) await idbSet(k, v);
  for (const k of ['userState', 'dataOverride']) { try { const v = localStorage.getItem('montvtime_' + k); if (v && !all[k]) localStorage.setItem(LS_NS + '_' + k, v); } catch {} }
  return Object.keys(all).length > 0;
}
async function apiGet(path) {
  try {
    const r = await fetch(path, { cache: 'no-store' });
    if (!r.ok) throw new Error('bad');
    return await r.json();
  } catch { return null; }
}

let saveTimer = null, cacheTimer = null;
let _dataVer = 0;      // bumped on every data change: tells which pages prepared for swiping are stale
let _prerendering = 0; // > 0 while a page is being prepared in the background
let _sw = null, _swBusy = false; // swipe in progress / finishing animation
function scheduleSaveState() {
  if (!_prerendering) {
    _dataVer++;
    if (typeof schedulePanes === 'function' && !_sw && !_swBusy) schedulePanes(1500);
  }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSaveState, 400);
}
// Écriture réelle de l'état (appelée après 0,4 s, ou tout de suite quand l'app passe en arrière-plan).
function flushSaveState() {
  clearTimeout(saveTimer); saveTimer = null;
  if (serverAvailable) {
    // keepalive est limité à 64 Ko par le navigateur (userdata.json ≈ 12 Mo) : seulement pour un petit état
    const body = JSON.stringify(userState);
    fetch('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 60000 }).catch(() => {});
  } else {
    idbSet('userState', userState);
    try { localStorage.setItem(LS_NS + '_userState', JSON.stringify(userState)); } catch {}
  }
}
// App masquée / fermée : si une sauvegarde est en attente, on l'écrit tout de suite.
document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) flushSaveState(); });
window.addEventListener('pagehide', () => { if (saveTimer) flushSaveState(); });
function scheduleSaveCache() {
  clearTimeout(cacheTimer);
  cacheTimer = setTimeout(() => {
    if (serverAvailable) {
      fetch('/api/cache', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(tmdbCache) }).catch(() => {});
    } else {
      idbSet('tmdbCache', tmdbCache);
    }
  }, 800);
}

//////////////////////// Keys & helpers ////////////////////////
const showKey = (s) => s.tvdbId || ('n:' + s.name);
const epKey = (skey, season, number) => `${skey}|${season}|${number}`;
function keyFromRecord(r) {
  const sk = r.showId || ('n:' + r.showName);
  return epKey(sk, r.season, r.number);
}
function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1800);
}
// Message avec un bouton « Annuler » (ex. après un « +1 visionnage » fait par erreur).
function toastUndo(msg, undo) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.innerHTML = `<span>${esc(msg)}</span><button type="button" class="toast-undo">Annuler</button>`;
  t.querySelector('.toast-undo').onclick = () => { clearTimeout(t._h); t.classList.remove('show'); undo(); };
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 4500);
}
// Appui long (ou clic droit) sur un élément. Le clic qui suit un appui long est ignoré.
function onLongPress(el, fn) {
  let timer = null, fired = false;
  const start = () => { fired = false; clearTimeout(timer); timer = setTimeout(() => { fired = true; fn(); }, 500); };
  const cancel = () => clearTimeout(timer);
  el.addEventListener('touchstart', start, { passive: true });
  el.addEventListener('touchend', cancel); el.addEventListener('touchmove', cancel, { passive: true }); el.addEventListener('touchcancel', cancel);
  el.addEventListener('contextmenu', (ev) => { ev.preventDefault(); ev.stopPropagation(); if (!fired) { cancel(); fired = true; fn(); } });
  el.addEventListener('click', (ev) => { if (fired) { fired = false; ev.stopImmediatePropagation(); ev.preventDefault(); } }, true);
}
// Fenêtre « − Vu N fois + » pour corriger le nombre de visionnages. get() = revisionnages (en plus du 1er
// visionnage), set(n) les enregistre, onChange() rafraîchit l'affichage derrière.
function openRewatchStepper(title, get, set, onChange) {
  showModal(`
    <h2 style="margin:0 0 4px">🔁 Visionnages</h2>
    <p class="hint" style="color:var(--muted);margin:0 0 14px">${esc(title)}</p>
    <div class="rw-stepper"><button type="button" class="btn" data-d="-1" aria-label="Un visionnage de moins">−</button><b id="rwCount"></b><button type="button" class="btn" data-d="1" aria-label="Un visionnage de plus">+</button></div>
    <div class="modal-actions" style="margin-top:16px;display:flex;justify-content:flex-end"><button class="btn primary" data-close>Terminé</button></div>`, (root) => {
    const out = root.querySelector('#rwCount');
    const paint = () => { const c = get(); out.textContent = `Vu ${c + 1} fois`; root.querySelector('[data-d="-1"]').disabled = c <= 0; };
    root.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { set(Math.max(0, get() + parseInt(b.dataset.d, 10))); paint(); onChange && onChange(); });
    paint();
  });
}
const esc = (s) => (s == null ? '' : String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));

