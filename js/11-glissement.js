/* Mon TV Time — Glissement entre onglets */
'use strict';
//////////////////////// Swipe : la page suit le doigt ////////////////////////
// The pages on each side (neighbouring categories, or previous/next episode) are rendered
// in the background into hidden .app-pane elements. While swiping, the current page and the
// incoming pane move together; on release the pane BECOMES the page (no re-render).
const SWIPE_ROUTES = ['home', 'movies', 'explore', 'friends'];
const _panes = {};           // hash -> { el, y }
let _paneTok = 0, _paneTimer = null;
let _suppressRenderHash = null;
const _W = () => window.innerWidth;
function _setX(el, x, y, anim) {
  el.style.transition = anim ? 'transform 240ms cubic-bezier(.2,.75,.3,1)' : 'none';
  el.style.transform = `translate3d(${x}px, ${-(y || 0)}px, 0)`;
}
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
// The incoming pane becomes the page; the old page stays ready for swiping back.
function _commitPane(hash, pane, kind) {
  const old = document.getElementById('app');
  const oldHash = location.hash || '#/home';
  const oldY = window.scrollY;
  scrollByHash[oldHash] = oldY;
  delete _panes[hash];
  old.removeAttribute('id');
  const el = pane.el;
  el.classList.remove('app-pane'); el.style.cssText = '';
  old.parentNode.insertBefore(el, old);
  el.id = 'app';
  old.style.cssText = ''; old.classList.add('app-pane');
  document.body.appendChild(old);
  _panes[oldHash] = { el: old, y: oldY };
  window.scrollTo(0, pane.y);
  _suppressRenderHash = hash;
  if (kind === 'episode') { _navReplace = true; location.replace(hash); } else location.hash = hash;
}
function _swFinish(s, commit) {
  _swBusy = true;
  const app = document.getElementById('app');
  const sign = s.side === 'next' ? -1 : 1;
  _setX(app, commit ? sign * _W() : 0, 0, true);
  if (s.pane) _setX(s.pane.el, commit ? 0 : -sign * _W(), s.pane.y, true);
  setTimeout(() => {
    if (commit) _commitPane(s.target, s.pane, s.nb.kind);
    else {
      app.style.transition = ''; app.style.transform = '';
      if (s.pane) s.pane.el.style.cssText = '';
    }
    _swBusy = false;
  }, 260);
}
// Classic navigation (with the slide animation) when the page on that side isn't ready yet.
function swipeFallback(side, nb) {
  const target = nb[side]; if (!target) return;
  _pendingSlideDir = side === 'next' ? 1 : -1;
  if (nb.kind === 'episode') { _navReplace = true; location.replace(target); } else location.hash = target;
}
// Same transition as a swipe, started by a button (‹ › on episodes).
function swipeTo(side) {
  if (_swBusy) return;
  const nb = swipeNeighbors(); if (!nb || !nb[side]) return;
  const pane = _panes[nb[side]];
  if (!pane) { swipeFallback(side, nb); return; }
  pane.el.style.visibility = 'visible';
  _setX(pane.el, side === 'next' ? _W() : -_W(), pane.y);
  void pane.el.offsetWidth;
  _swFinish({ nb, side, target: nb[side], pane }, true);
}
function _swDrag(s, dx) {
  const side = dx < 0 ? 'next' : 'prev';
  if (s.pane && s.side !== side) s.pane.el.style.cssText = ''; // finger went back past the start
  const target = s.nb[side];
  const pane = (target && _panes[target]) || null;
  Object.assign(s, { side, target, pane, dx });
  const app = document.getElementById('app');
  if (!pane) { _setX(app, dx * 0.3); return; } // nothing ready on that side: elastic resistance
  pane.el.style.visibility = 'visible';
  _setX(app, dx);
  _setX(pane.el, (side === 'next' ? _W() : -_W()) + dx, pane.y);
}
document.addEventListener('touchstart', (e) => {
  _sw = null;
  if (_swBusy || e.touches.length !== 1) return;
  const t = e.target;
  if (t.closest && t.closest('#seriesTabs, .cast-list, .exp-row, .genre-chips, .sort-chips, .pv-seasons, .react, input, textarea, select')) return;
  if (document.getElementById('modalRoot') && document.getElementById('modalRoot').children.length) return;
  const nb = swipeNeighbors(); if (!nb) return;
  const x = e.touches[0].clientX, y = e.touches[0].clientY;
  _sw = { x0: x, y0: y, nb, locked: false, side: null, target: null, pane: null, dx: 0, lastX: x, lastT: performance.now(), vx: 0 };
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
  else if (go) { _swFinish(s, false); swipeFallback(s.side, s.nb); }
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

