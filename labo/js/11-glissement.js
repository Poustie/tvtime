/* Mon TV Time — Glissement entre onglets */
'use strict';
//////////////////////// Swipe : la page suit le doigt ////////////////////////
// The pages on each side (neighbouring categories, or previous/next episode) are rendered
// in the background into hidden .app-pane elements (clipped to the screen size, scrolled with scrollTop).
// While swiping, the current page and the incoming pane move together (same translateX, edge to edge);
// on release both glide with the same animation and the pane BECOMES the page (no re-render).
// The header (avatar, magnifier, title position) stays anchored: see _anchorStart.
const SWIPE_ROUTES = ['home', 'movies', 'explore', 'friends'];
const _panes = {};           // hash -> { el, y }
let _paneTok = 0, _paneTimer = null;
let _suppressRenderHash = null;
// Largeur exacte de la page (identique pour les deux pages, même si l'écran a une largeur à virgule)
const _W = () => { const a = document.getElementById('app'); return (a && a.getBoundingClientRect().width) || document.documentElement.clientWidth || window.innerWidth; };
const SWIPE_EASE = 'cubic-bezier(.22,1,.36,1)'; // freinage doux type iOS, sans dépassement
function _setX(el, x) {
  el.style.transition = 'none';
  el.style.transform = `translate3d(${x}px, 0, 0)`;
}
// Both pages glide with the very same curve and duration (Web Animations: runs on the compositor).
function _glide(el, x0, x1, dur) {
  const to = `translate3d(${x1}px, 0, 0)`;
  el.style.transition = 'none';
  el.style.transform = to;
  if (el.animate) el.animate([{ transform: `translate3d(${x0}px, 0, 0)` }, { transform: to }], { duration: dur, easing: SWIPE_EASE });
}
// Coupe toute animation encore en cours sur la page (le style final est déjà en place : aucun saut).
function _stopAnims(...els) { els.forEach(e => e && e.getAnimations && e.getAnimations().forEach(a => a.cancel())); }
// Résistance élastique (type iOS) : plus on tire, plus ça résiste, sans jamais dépasser ~la moitié de l'écran.
function _rubber(d) { const W = _W(); return Math.sign(d) * (1 - 1 / (Math.abs(d) * 0.55 / W + 1)) * W; }
function swipeNeighbors() {
  const name = currentRoute().split('/')[0];
  if (SWIPE_ROUTES.includes(name)) {
    const i = SWIPE_ROUTES.indexOf(name);
    return { kind: 'tab', prev: i > 0 ? '#/' + SWIPE_ROUTES[i - 1] : null, next: i < SWIPE_ROUTES.length - 1 ? '#/' + SWIPE_ROUTES[i + 1] : null };
  }
  const nb = name === 'episode' && document.getElementById('app')?._epNb;
  if (nb && nb.key) {
    const h = (e) => e ? '#/episode/' + encodeURIComponent(nb.key) + '/' + e.s + '/' + e.n : null;
    return { kind: 'episode', prev: h(nb.prev), next: h(nb.next) };
  }
  return null;
}
function dropPane(h) { const p = _panes[h]; if (p) { p.el.remove(); delete _panes[h]; } }
// Prepare the neighbouring pages in the background (fresh ones are kept).
function schedulePanes(delay = 400) {
  clearTimeout(_paneTimer);
  const tok = ++_paneTok;
  const nb = swipeNeighbors();
  const want = new Set(nb ? [nb.prev, nb.next].filter(Boolean) : []);
  for (const h of Object.keys(_panes)) {
    const keepTab = SWIPE_ROUTES.includes(h.slice(2)) && _panes[h].el._ver === _dataVer;
    if (!want.has(h) && !keepTab) dropPane(h);
  }
  if (!want.size) return;
  _paneTimer = setTimeout(async () => {
    for (const h of want) {
      if (tok !== _paneTok) return;
      if ((_sw && _sw.locked) || _swBusy) { schedulePanes(delay); return; } // pas pendant un glissement actif
      if (_panes[h] && _panes[h].el._ver === _dataVer) continue;
      await prerenderPane(h, tok);
    }
  }, delay);
}
async function prerenderPane(hash, tok) {
  const [name, ...rest] = hash.slice(2).split('/');
  const fn = routes[name]; if (!fn) return;
  const el = document.createElement('main');
  el.className = 'app-pane';
  document.body.appendChild(el);
  const ver = _dataVer;
  _prerendering++;
  try { await fn(el, rest); } catch { el.remove(); return; } finally { _prerendering--; }
  if (tok !== _paneTok || hash === (location.hash || '#/home')) { el.remove(); return; }
  el._ver = ver;
  dropPane(hash);
  _panes[hash] = { el, y: name === 'episode' ? 0 : (scrollByHash[hash] || 0) };
}
// Shows a prepared pane at its saved scroll position (the pane is clipped to the screen: scrollTop does the job).
function _revealPane(pane) {
  pane.el.scrollTop = pane.y || 0;
  pane.el.style.visibility = 'visible';
}
// The incoming pane becomes the page; the old page stays ready (as a pane) for swiping back. No navigation here.
function _swapPane(oldHash, hash, pane) {
  const old = document.getElementById('app');
  _stopAnims(old, pane.el);
  const oldY = window.scrollY;
  scrollByHash[oldHash] = oldY;
  delete _panes[hash];
  old.removeAttribute('id');
  const el = pane.el;
  el.classList.remove('app-pane', 'sw-anchor'); el.style.cssText = ''; el.scrollTop = 0;
  old.parentNode.insertBefore(el, old);
  el.id = 'app';
  old.style.cssText = ''; old.classList.remove('sw-anchor'); old.classList.add('app-pane');
  document.body.appendChild(old);
  old.scrollTop = oldY;
  _panes[oldHash] = { el: old, y: oldY };
  window.scrollTo(0, pane.y);
}
function _commitPane(hash, pane, kind) {
  _swapPane(location.hash || '#/home', hash, pane);
  _suppressRenderHash = hash;
  if (kind === 'episode') { _navReplace = true; location.replace(hash); } else location.hash = hash;
}

//////////// En-tête ancré : avatar et loupe immobiles, le titre se transforme en fondu enchaîné ////////////
let _ov = null; // calque fixe { root, items: [{ el, role: 'a'|'b'|'both' }] }
function _anchorEnd() {
  if (_ov) { _ov.root.remove(); _ov = null; }
  document.querySelectorAll('.sw-anchor').forEach(n => n.classList.remove('sw-anchor'));
}
function _anchorStart(s) {
  _anchorEnd();
  if (s.nb.kind !== 'tab' || !s.pane) return;
  const app = document.getElementById('app'), pe = s.pane.el;
  const hA = app.querySelector('.page-head'), hB = pe.querySelector('.page-head');
  const tA = hA && hA.querySelector('h1'), tB = hB && hB.querySelector('h1');
  if (!tA || !tB || window.scrollY > 60 || (s.pane.y || 0) > 60) return; // pas d'en-tête visible : les pages glissent normalement
  const keep = app.style.transform; app.style.transform = 'none'; // mesures sans le décalage du glissement
  const root = document.createElement('div'); root.className = 'sw-ov';
  const items = [];
  const place = (c, r, extra) => {
    c.removeAttribute('id'); c.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    c.setAttribute('aria-hidden', 'true'); c.removeAttribute('href');
    c.style.cssText = `position:fixed;margin:0;right:auto;bottom:auto;box-sizing:border-box;left:${r.left}px;top:${r.top}px;${extra || ''}`;
  };
  const aA = hA.querySelector('.acct-btn'), aB = hB.querySelector('.acct-btn');
  const sA = hA.querySelector('.search-btn'), sB = hB.querySelector('.search-btn');
  const sharedAcct = !!(aA && aB), sharedSearch = !!(sA && sB);
  // L'en-tête complet de chaque page (titre, sous-titre, boutons) : fondu enchaîné, sans glisser.
  for (const [h, role] of [[hA, 'a'], [hB, 'b']]) {
    const r = h.getBoundingClientRect();
    const c = h.cloneNode(true);
    place(c, r, `width:${r.width}px;`);
    if (sharedAcct) c.querySelectorAll('.acct-btn').forEach(n => n.style.visibility = 'hidden');
    if (sharedSearch) c.querySelectorAll('.search-btn').forEach(n => n.style.visibility = 'hidden');
    root.appendChild(c); items.push({ el: c, role });
  }
  // Avatar et loupe présents sur les deux pages : une seule copie, immobile et toujours visible.
  for (const src of [sharedAcct && aA, sharedSearch && sA]) {
    if (!src) continue;
    const c = src.cloneNode(true); place(c, src.getBoundingClientRect());
    root.appendChild(c); items.push({ el: c, role: 'both' });
  }
  app.style.transform = keep;
  document.body.appendChild(root);
  app.classList.add('sw-anchor'); pe.classList.add('sw-anchor');
  _ov = { root, items };
  _anchorSet(0, false);
}
// p = avancée du glissement (0 = page actuelle, 1 = page voisine). Le titre sortant s'efface un peu plus vite que l'entrant n'apparaît.
function _anchorSet(p, dur) {
  if (!_ov) return;
  p = Math.max(0, Math.min(1, p));
  const oa = Math.max(0, Math.min(1, 1 - p * 1.25)), ob = Math.max(0, Math.min(1, p * 1.25 - 0.25)); // ~0,4 chacun à mi-course
  for (const it of _ov.items) {
    it.el.style.transition = dur ? `opacity ${dur}ms ${SWIPE_EASE}` : 'none';
    it.el.style.opacity = it.role === 'a' ? oa : it.role === 'b' ? ob : 1;
  }
}

function _swFinish(s, commit) {
  _swBusy = true;
  const app = document.getElementById('app');
  const W = _W(), sign = s.side === 'next' ? -1 : 1;
  const ax = s.ax || 0;
  const appTo = commit ? sign * W : 0;
  // durée selon la vitesse du geste : un petit geste lent = plus posé, un coup de pouce = vif
  const dist = Math.abs(appTo - ax), v = Math.max(Math.abs(s.vx || 0), 0.55);
  const dur = Math.round(Math.max(220, Math.min(420, dist / v * 1.15)));
  _glide(app, ax, appTo, dur);
  if (s.pane) _glide(s.pane.el, -sign * W + ax, commit ? 0 : -sign * W, dur);
  if (_ov) _anchorSet(commit ? 1 : 0, dur);
  setTimeout(() => {
    _stopAnims(app, s.pane && s.pane.el);
    if (commit) _commitPane(s.target, s.pane, s.nb.kind);
    else {
      app.style.transition = ''; app.style.transform = ''; app.style.willChange = '';
      if (s.pane) { s.pane.el.style.cssText = ''; }
    }
    _anchorEnd();
    _swBusy = false;
    const later = _renderLater; _renderLater = null;
    if (later && later === (location.hash || '#/home')) render();
  }, dur + 20);
}
// Navigation instantanée quand la page voisine n'est pas encore prête (aucune animation).
function swipeFallback(side, nb) {
  const target = nb[side]; if (!target) return;
  if (nb.kind === 'episode') { _navReplace = true; location.replace(target); } else location.hash = target;
}
// Same transition as a swipe, started by a button (‹ › on episodes).
function swipeTo(side) {
  if (_swBusy) return;
  const nb = swipeNeighbors(); if (!nb || !nb[side]) return;
  const pane = _panes[nb[side]];
  if (!pane) { swipeFallback(side, nb); return; }
  _revealPane(pane);
  _setX(pane.el, side === 'next' ? _W() : -_W());
  void pane.el.offsetWidth;
  _swFinish({ nb, side, target: nb[side], pane, ax: 0, vx: 0 }, true);
}
function _swDrag(s, dx) {
  const side = dx < 0 ? 'next' : 'prev';
  if (s.pane && s.side !== side) { s.pane.el.style.cssText = ''; _anchorEnd(); } // finger went back past the start
  const target = s.nb[side];
  const pane = (target && _panes[target]) || null;
  const first = !s.pane || s.pane !== pane;
  Object.assign(s, { side, target, pane, dx });
  const app = document.getElementById('app');
  if (!pane) { s.ax = _rubber(dx); _setX(app, s.ax); return; } // nothing on that side: elastic resistance
  if (first) { app.style.willChange = 'transform'; _revealPane(pane); _anchorStart(s); }
  s.ax = dx;
  _setX(app, dx);
  _setX(pane.el, (side === 'next' ? _W() : -_W()) + dx);
  _anchorSet(Math.abs(dx) / _W(), false);
}
document.addEventListener('touchstart', (e) => {
  _sw = null;
  if (_swBusy || e.touches.length !== 1) return;
  const t = e.target;
  if (t.closest && t.closest('#seriesTabs, .cast-list, .exp-row, .genre-chips, .sort-chips, .pv-seasons, .react, input, textarea, select')) return;
  if (document.getElementById('modalRoot') && document.getElementById('modalRoot').children.length) return;
  const nb = swipeNeighbors(); if (!nb) return;
  const x = e.touches[0].clientX, y = e.touches[0].clientY;
  _sw = { x0: x, y0: y, nb, locked: false, side: null, target: null, pane: null, dx: 0, ax: 0, lastX: x, lastT: performance.now(), vx: 0 };
  // Une page voisine manque ou est périmée : on la prépare tout de suite (pas dans 400 ms).
  const stale = (h) => h && !(_panes[h] && _panes[h].el._ver === _dataVer);
  if (stale(nb.prev) || stale(nb.next)) schedulePanes(0);
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  const s = _sw; if (!s) return;
  const x = e.touches[0].clientX, y = e.touches[0].clientY;
  const dx = x - s.x0, dy = y - s.y0;
  if (!s.locked) {
    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
    if (Math.abs(dx) < Math.abs(dy) * 1.3) { _sw = null; return; } // vertical scroll: let the page scroll
    s.locked = true;
    s.x0 = x; // la page part de 0 et suit le doigt, sans sauter des 10 px du seuil
    s.lastX = x; s.lastT = performance.now();
    return;
  }
  if (e.cancelable) e.preventDefault();
  const now = performance.now(), dt = now - s.lastT;
  if (dt > 0) s.vx = 0.6 * s.vx + 0.4 * ((x - s.lastX) / dt);
  s.lastX = x; s.lastT = now;
  _swDrag(s, dx);
}, { passive: false });
document.addEventListener('touchend', () => {
  const s = _sw; _sw = null;
  if (!s || !s.locked) return;
  if (performance.now() - s.lastT > 90) s.vx = 0; // finger held still before release: not a flick
  const fling = Math.abs(s.vx) > 0.45 && Math.sign(s.vx) === Math.sign(s.dx) && Math.abs(s.dx) > 30;
  const go = !!s.target && (Math.abs(s.dx) > _W() * 0.3 || fling);
  if (go && s.pane) _swFinish(s, true);
  else if (go) { _swFinish(s, false); setTimeout(() => swipeFallback(s.side, s.nb), 0); }
  else _swFinish(s, false);
}, { passive: true });
document.addEventListener('touchcancel', () => {
  const s = _sw; _sw = null;
  if (s && s.locked) _swFinish(s, false);
}, { passive: true });


// progressively load posters for visible cards (only when a TMDB key is set)
async function hydratePosters(container, list) {
  if (!hasKey()) return; // fallback titles are already rendered
  const byKey = Object.fromEntries(list.map(s => [s.key, s]));
  const slots = container.querySelectorAll('[data-poster]');
  let i = 0;
  const worker = async () => {
    while (i < slots.length) {
      const slot = slots[i++];
      const sh = byKey[slot.getAttribute('data-poster')];
      if (!sh) continue;
      try {
        const { poster, meta } = await ensurePoster(sh);
        if (poster) slot.insertAdjacentHTML('afterbegin', `<img loading="lazy" src="${IMG(poster)}" alt="">`);
        if (meta && meta.name && !(sh.name && sh.name.trim())) {
          const card = slot.closest('.show-card');
          if (card) {
            const t = card.querySelector('.title'); if (t) t.textContent = meta.name;
            const fb = slot.querySelector('.fallback-title'); if (fb) fb.textContent = meta.name;
          }
        }
        const pc = slot.querySelector('.card-progress');
        if (pc) pc.innerHTML = progressBarHtml(showProgress(sh, meta));
      } catch {}
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}

