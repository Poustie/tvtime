/* Mon TV Time — Routeur et navigation */
'use strict';
//////////////////////// Router ////////////////////////
const routes = {};
function route(name, fn) { routes[name] = fn; }
function currentRoute() { return (location.hash || '#/library').slice(2); }
// Navigation history of detail pages, so « ← Retour » always goes to the previous page
// (list → série → acteur → film …) and the list keeps its scroll position.
const DETAIL_ROUTES = ['show', 'movie', 'episode', 'person', 'preview'];
const navStack = [];
let _navReplace = false;   // next navigation replaces the current page (episode → episode)
let _pendingSlideDir = 0;  // slide animation to play on the next render (1 = from the right)
function trackNav(hash, name) {
  if (_navReplace) { _navReplace = false; navStack[Math.max(0, navStack.length - 1)] = hash; return; }
  if (!DETAIL_ROUTES.includes(name)) { navStack.length = 0; navStack.push(hash); return; }
  if (navStack.length > 1 && navStack[navStack.length - 2] === hash) navStack.pop();
  else if (navStack[navStack.length - 1] !== hash) navStack.push(hash);
}
// Going to the page we just came from = a real « back » (keeps browser history in sync).
function navTo(hash) {
  if (navStack.length > 1 && navStack[navStack.length - 2] === hash) history.back();
  else location.hash = hash;
}
// Swap the current page for another one (the current one won't come back with « ← »).
function replaceRoute(hash) {
  _navReplace = true;
  location.replace(hash);
}
document.addEventListener('click', (ev) => {
  const b = ev.target.closest && ev.target.closest('[data-back]');
  if (!b) return;
  ev.preventDefault();
  if (navStack.length > 1) history.back(); else location.hash = b.dataset.back;
});
let lastShowKey = null;   // last opened show key (to auto-scroll to first unseen only on a fresh open)
let homeEditOrder = false; // when true, the Séries section reorder arrows are shown
let seriesTab = 'avoir';   // Séries page sub-tab: 'avoir' (categorised) | 'asuivre' (next episodes)
let exploreQuery = '';     // texte de recherche Explorer mémorisé (restauré au retour d'un aperçu)
const scrollByHash = {};
function openShow(key) {
  scrollByHash[location.hash || '#/home'] = window.scrollY;
  navTo('#/show/' + encodeURIComponent(key));
}
function openMovie(name) {
  scrollByHash[location.hash || '#/movies'] = window.scrollY;
  navTo('#/movie/' + encodeURIComponent(name));
}
// Where the user was on a show page before opening an episode (restored on return).
let showViewRestore = null;
function saveShowView(sh, row) {
  const body = row.closest('.season-body');
  showViewRestore = {
    key: sh.key,
    open: [...document.querySelectorAll('#seasons .season-body')].map(b => !b.classList.contains('collapsed')),
    bodyId: body ? body.id : null, n: row.dataset.n,
    top: row.getBoundingClientRect().top, y: window.scrollY,
  };
}
function openEpisode(showKey, season, n) {
  scrollByHash[location.hash || '#/home'] = window.scrollY;
  navTo('#/episode/' + encodeURIComponent(showKey) + '/' + season + '/' + n);
}
function openPerson(id, name) {
  scrollByHash[location.hash || '#/home'] = window.scrollY;
  navTo('#/person/' + (parseInt(id, 10) || 0) + '/' + encodeURIComponent(name || ''));
}
document.addEventListener('click', (ev) => {
  const c = ev.target.closest && ev.target.closest('.cast-item[data-pname]');
  if (c) openPerson(c.dataset.pid, c.dataset.pname);
});
const BACK_LABELS = { home: 'Séries', library: 'Bibliothèque', upnext: 'Prochains épisodes', explore: 'Explorer', movies: 'Films', lists: 'Listes', stats: 'Statistiques', profile: 'Mon compte', friends: 'Amis', settings: 'Réglages', custom: 'Personnalisation', changelog: 'Notes de version', episode: 'Épisode', preview: 'Aperçu' };
// Label of the page « ← Retour » leads to (fallback = page used when there is no history).
function backLabel(fallback) {
  const prev = navStack.length > 1 ? navStack[navStack.length - 2] : fallback;
  const [name, ...rest] = (prev || '').replace(/^#\//, '').split('/');
  try {
    if (name === 'show') { const sh = MODEL && MODEL.shows.get(decodeURIComponent(rest.join('/'))); if (sh) return displayName(sh); }
    if (name === 'movie') return decodeURIComponent(rest.join('/'));
    if (name === 'person') return decodeURIComponent(rest.slice(1).join('/')) || 'Fiche acteur';
  } catch {}
  return BACK_LABELS[name] || 'Retour';
}
function backBtn(fallback) {
  return `<a class="btn ghost sm back-btn" href="${esc(fallback)}" data-back="${esc(fallback)}">← ${esc(backLabel(fallback))}</a>`;
}

// Basic slide transition when moving from one main category to another.
let _lastTopRoute = null;
function _makeSnapshot() {
  const el = document.getElementById('app');
  const sy = window.scrollY;
  const snap = el.cloneNode(true);
  snap.removeAttribute('id');
  snap.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
  snap.classList.add('page-snap');
  snap.style.transform = `translate(0, ${-sy}px)`;
  document.body.appendChild(snap);
  return { snap, sy };
}
function _runSlide(el, snapObj, dir) {
  const { snap, sy } = snapObj;
  const from = dir > 0 ? '100%' : '-100%';   // new page enters from this side
  const to = dir > 0 ? '-100%' : '100%';     // old page leaves to this side
  const dur = 240;
  el.classList.add('page-anim');
  el.style.transition = 'none';
  el.style.transform = `translateX(${from})`;
  void el.offsetWidth;                        // flush the start position
  el.style.transition = `transform ${dur}ms ease`;
  el.style.transform = 'translateX(0)';
  snap.style.transition = `transform ${dur}ms ease`;
  snap.style.transform = `translate(${to}, ${-sy}px)`;
  setTimeout(() => {
    el.style.transition = ''; el.style.transform = ''; el.classList.remove('page-anim');
    snap.remove();
  }, dur + 40);
}
let _lastRenderedHash = null;
async function render() {
  // Même page redessinée (option cochée, réaction, vu…) : on reste à la même hauteur au lieu de remonter en haut.
  const _hashNow = location.hash || '#/home';
  const _keepY = _hashNow === _lastRenderedHash ? window.scrollY : null;
  _lastRenderedHash = _hashNow;
  document.querySelectorAll('.page-snap').forEach(n => n.remove()); // safety: never leave a frozen page behind
  const [name, ...rest] = currentRoute().split('/');
  trackNav(location.hash || '#/home', name);
  if (name !== 'show' && name !== 'episode') { lastShowKey = null; showViewRestore = null; } // re-opening a show counts as a fresh visit
  // « Mon compte » (profil, bibliothèque, stats, listes, réglages…) n'est plus un onglet : il s'ouvre par l'avatar en haut à droite.
  const navName = name === 'preview' ? 'explore' : (name === 'friend' ? 'friends' : name);
  document.querySelectorAll('.bottom-nav a').forEach(a => a.classList.toggle('active', a.dataset.route === navName));
  // Direction of the slide, only between the four main categories.
  const newTop = SWIPE_ROUTES.includes(name) ? name : null;
  let dir = 0;
  if (_lastTopRoute && newTop && _lastTopRoute !== newTop) {
    dir = SWIPE_ROUTES.indexOf(newTop) > SWIPE_ROUTES.indexOf(_lastTopRoute) ? 1 : -1;
  }
  _lastTopRoute = newTop;
  if (_pendingSlideDir) { dir = _pendingSlideDir; _pendingSlideDir = 0; }
  const el = document.getElementById('app');
  // Page already in place after a swipe: nothing to render (unless its data changed meanwhile).
  if (_suppressRenderHash && _suppressRenderHash === location.hash) {
    _suppressRenderHash = null;
    if (el._ver === _dataVer) { schedulePanes(); return; }
    dir = 0;
  }
  _suppressRenderHash = null;
  dropPane(location.hash || '#/home'); // never keep a hidden copy of the page being rendered
  for (const h in _panes) _panes[h].el.style.cssText = '';
  el.style.transition = ''; el.style.transform = ''; el.classList.remove('page-anim');
  const snapObj = dir !== 0 ? _makeSnapshot() : null;
  const fn = routes[name] || routes['library'];
  const ver = _dataVer;
  if (_keepY != null) el.style.minHeight = el.offsetHeight + 'px'; // la page ne rétrécit pas pendant le redessin
  el.innerHTML = '<div class="loading">Chargement…</div>';
  try { await fn(el, rest); } catch (e) { el.innerHTML = `<div class="empty"><div class="big">⚠️</div>${esc(e.message)}</div>`; }
  el._ver = ver;
  const saved = scrollByHash[location.hash];
  el.style.minHeight = '';
  window.scrollTo(0, _keepY != null ? _keepY : (name !== 'show' && name !== 'movie' && name !== 'episode' && saved ? saved : 0));
  if (snapObj) _runSlide(el, snapObj, dir);
  schedulePanes();
}
window.addEventListener('hashchange', render);

