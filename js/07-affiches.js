/* Mon TV Time — Affiches et recherche d’affiche manuelle */
'use strict';
//////////////////////// Poster helper ////////////////////////
// Manual TMDB match override for a show (chosen via the "search poster" modal).
function overrideShowTmdb(sh) {
  if (sh && sh.forcedTmdb) return sh.forcedTmdb;
  const m = userState.showTmdb || {};
  const v = m[showKey(sh)];
  return (v != null && v !== '') ? v : null;
}
async function ensurePoster(sh) {
  // returns {poster, tmdbId, meta?} using cache; triggers resolve if key present
  if (!hasKey()) return { poster: null, tmdbId: null };
  let tmdbId = overrideShowTmdb(sh);
  if (!tmdbId) {
    if (!sh.tvdbId) return { poster: null, tmdbId: null };
    tmdbId = await resolveTmdbId(sh.tvdbId);
  }
  if (!tmdbId) return { poster: null, tmdbId: null };
  let meta = tmdbCache.shows[tmdbId];
  if (!meta) { try { meta = await getShowMeta(tmdbId); } catch {} }
  return { poster: meta ? meta.poster : null, tmdbId, meta };
}
function posterHtml(sh, posterPath) {
  if (posterPath) return `<img loading="lazy" src="${IMG(posterPath)}" alt="">`;
  return `<div class="fallback-title">${esc(displayName(sh))}</div>`;
}

// Some exported shows have an empty name; fall back to the cached TMDB name, then a placeholder.
function cachedTmdbName(sh) {
  if (sh.tvdbId != null && (sh.tvdbId in tmdbCache.map)) {
    const id = tmdbCache.map[sh.tvdbId];
    const meta = id && tmdbCache.shows[id];
    if (meta && meta.name) return meta.name;
  }
  return '';
}
function displayName(sh) {
  // Préfère le titre TMDB localisé (français) quand il est en cache, sinon le nom importé.
  const fr = cachedTmdbName(sh) || (sh.name && sh.name.trim()) || 'Série sans titre';
  return smallTitle(fr, originalNameOf(sh));
}

//////////////////////// Titres originaux (réglage prefs.titleMode : fr | vo | both) ////////////////////////
const titleMode = () => { const m = (userState.prefs || {}).titleMode; return m === 'vo' || m === 'both' ? m : 'fr'; };
// Titre sur une petite affiche / une liste : « vo » = titre original (si connu), sinon le français.
function smallTitle(fr, vo) { return titleMode() === 'vo' && vo ? vo : fr; }
// Titre d'une fiche : « both » = « Titre FR · Titre VO » (sans doublon si identiques).
function fullTitle(fr, vo) {
  const m = titleMode();
  if (m === 'vo') return vo || fr;
  if (m === 'both' && vo && fr && vo.trim().toLowerCase() !== fr.trim().toLowerCase()) return fr + ' · ' + vo;
  return fr;
}
// Titre original d'une série / d'un film (depuis le cache, sans requête) ; '' si inconnu.
function originalNameOf(sh) {
  if (sh.tvdbId != null && (sh.tvdbId in tmdbCache.map)) {
    const meta = tmdbCache.map[sh.tvdbId] && tmdbCache.shows[tmdbCache.map[sh.tvdbId]];
    if (meta) { if (!('originalName' in meta)) needOriginalTitles(); return meta.originalName || ''; }
  }
  return '';
}
function originalTitleOf(m) {
  const rec = tmdbCache.movies && tmdbCache.movies[m.name];
  if (rec && rec.ot) return rec.ot;
  const id = rec && rec.id, mm = id && tmdbCache.movieMeta && tmdbCache.movieMeta[id];
  if (mm && mm.originalTitle) return mm.originalTitle;
  if (rec && !('ot' in rec)) needOriginalTitles();
  return '';
}
// Complète en arrière-plan, doucement (une requête toutes les 0,5 s, 150 max par session), les titres originaux manquants.
let _otQueued = false, _otCount = 0;
function needOriginalTitles() {
  if (titleMode() === 'fr') return; // titres français : rien à télécharger
  if (_otQueued || !hasKey() || _otCount >= 150) return;
  _otQueued = true;
  setTimeout(async () => {
    const todo = [];
    for (const id of Object.keys(tmdbCache.shows || {})) { const x = tmdbCache.shows[id]; if (x && x.cast && !('originalName' in x)) todo.push(['tv', id, x]); }
    for (const n of Object.keys(tmdbCache.movies || {})) { const r = tmdbCache.movies[n]; if (r && r.id && !('ot' in r)) todo.push(['movie', r.id, r]); }
    for (const [kind, id, rec] of todo) {
      if (_otCount++ >= 150 || titleMode() === 'fr') break; // arrêt si l'utilisateur revient aux titres français
      try {
        const d = await tmdbFetch(`/${kind}/${id}`);
        if (kind === 'tv') rec.originalName = d.original_name || null; else rec.ot = d.original_title || null;
      } catch (e) {
        // 404 (œuvre retirée de TMDB) : marquer comme sans titre original et continuer ; autre erreur (429, hors-ligne) : arrêter
        if (/404/.test(String(e && e.message))) { if (kind === 'tv') rec.originalName = null; else rec.ot = null; continue; }
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    if (todo.length) scheduleSaveCache();
    _otQueued = false;
  }, 3000);
}
// Petit sélecteur de réglage (à placer dans Personnalisation) + branchement.
function titleModePrefHtml() {
  const m = titleMode();
  return `<div class="field"><span>Titres</span><div class="seg" id="titleModeSeg" style="display:flex;gap:6px;flex-wrap:wrap">${[['fr', 'Français'], ['vo', 'Original'], ['both', 'Les deux']].map(([v, l]) => `<button type="button" class="chip ${m === v ? 'active' : ''}" data-tmode="${v}">${l}</button>`).join('')}</div></div>`;
}
function wireTitleModePref(root) {
  const seg = (root || document).querySelector('#titleModeSeg');
  if (!seg) return;
  seg.querySelectorAll('[data-tmode]').forEach(b => b.onclick = () => {
    setPref('titleMode', b.dataset.tmode);
    seg.querySelectorAll('[data-tmode]').forEach(x => x.classList.toggle('active', x === b));
    if (b.dataset.tmode !== 'fr') needOriginalTitles();
    MODEL = null; render();
  });
}
// Titre français d'un film si connu (depuis le cache TMDB), sinon le nom importé.
function movieDisplayName(m) {
  const rec = tmdbCache.movies && tmdbCache.movies[m.name];
  const vo = titleMode() === 'vo' ? originalTitleOf(m) : '';
  if (vo) return vo;
  if (rec && rec.title) return rec.title;
  const id = rec && rec.id;
  if (id && tmdbCache.movieMeta && tmdbCache.movieMeta[id] && tmdbCache.movieMeta[id].title) return tmdbCache.movieMeta[id].title;
  return m.name;
}
// Texte de recherche d'un film : nom importé + titre français + titre original.
function movieSearchText(m) {
  const rec = tmdbCache.movies && tmdbCache.movies[m.name];
  return [m.name, rec && rec.title, originalTitleOf(m)].filter(Boolean).join(' ');
}
function userDisplayName() {
  return (userState.profileName && userState.profileName.trim()) || DATA.user?.name || '';
}
// Names a show can be found by: its stored (export) title AND the cached TMDB
// localized title (e.g. "Murder Mindfully" is also findable as "Les Meurtres zen").
function searchNames(sh) {
  const out = [];
  if (sh.name && sh.name.trim()) out.push(sh.name.toLowerCase());
  const t = cachedTmdbName(sh);
  if (t && t.toLowerCase() !== (sh.name || '').toLowerCase()) out.push(t.toLowerCase());
  const vo = originalNameOf(sh);
  if (vo && !out.includes(vo.toLowerCase())) out.push(vo.toLowerCase());
  else if (!vo) needOriginalTitles();
  return out.length ? out : ['série sans titre'];
}

//////////////////////// Poster search (manual TMDB match) ////////////////////////
// Persist a chosen TMDB match for a show and mirror it into the cache so every
// existing lookup (resolveTmdbId, cachedTmdbName, metaFor) picks it up.
function setShowTmdb(sh, tmdbId) {
  if (!userState.showTmdb) userState.showTmdb = {};
  userState.showTmdb[showKey(sh)] = tmdbId;
  if (sh.tvdbId != null) tmdbCache.map[sh.tvdbId] = tmdbId;
  scheduleSaveState(); scheduleSaveCache();
}
function setMovieTmdb(name, hit) {
  if (!userState.movieTmdb) userState.movieTmdb = {};
  const rec = { id: hit.id, poster: hit.poster_path || hit.poster || null };
  userState.movieTmdb[name] = rec;
  if (!tmdbCache.movies) tmdbCache.movies = {};
  tmdbCache.movies[name] = rec;
  scheduleSaveState(); scheduleSaveCache();
}
// Re-apply saved overrides into the metadata cache at boot (cache may be older).
function applyTmdbOverrides() {
  for (const [k, id] of Object.entries(userState.showTmdb || {})) {
    if (id != null && !String(k).startsWith('n:')) tmdbCache.map[k] = id;
  }
  if (!tmdbCache.movies) tmdbCache.movies = {};
  for (const [name, rec] of Object.entries(userState.movieTmdb || {})) {
    if (rec) tmdbCache.movies[name] = rec;
  }
}

// Shared TMDB search modal. Searches /search/tv or /search/movie and calls
// onPick(hit) when the user selects a result. Returns raw TMDB hit objects.
function tmdbSearchModal({ title, hint, kind, initial, onPick }) {
  if (!hasKey()) { toast('Ajoutez une clé TMDB (Réglages) pour rechercher.'); return; }
  showModal(`
    <h2>${esc(title)}</h2>
    <p class="hint" style="color:var(--muted)">${esc(hint)}</p>
    <div class="modal-fields" style="flex-direction:row;gap:8px">
      <input class="input" id="psQ" style="flex:1" value="${esc(initial || '')}" placeholder="Titre à rechercher…">
      <button class="btn primary" id="psGo">Rechercher</button>
    </div>
    <div id="psResults" class="poster-search"></div>
    <div class="row"><button class="btn ghost" data-close>Fermer</button></div>
  `, (root) => {
    const q = root.querySelector('#psQ');
    const results = root.querySelector('#psResults');
    let hits = [];
    const run = async () => {
      const term = q.value.trim();
      if (!term) return;
      results.innerHTML = `<div class="loading">Recherche…</div>`;
      try {
        const path = kind === 'tv'
          ? `/search/tv?query=${encodeURIComponent(term)}`
          : `/search/movie?query=${encodeURIComponent(term)}`;
        const res = await tmdbFetch(path);
        hits = (res.results || []).slice(0, 12);
        if (!hits.length) { results.innerHTML = `<div class="empty">Aucun résultat.</div>`; return; }
        results.innerHTML = hits.map((h, i) => {
          const t = esc(h.name || h.title || '');
          const date = (h.first_air_date || h.release_date || '').slice(0, 4);
          const img = h.poster_path
            ? `<img loading="lazy" src="${IMG(h.poster_path, 'w185')}" alt="">`
            : `<div class="fallback-title">${t}</div>`;
          return `<button class="ps-hit" data-idx="${i}">
            <div class="ps-poster">${img}</div>
            <div class="ps-name">${t}${date ? ` <span>(${date})</span>` : ''}</div>
          </button>`;
        }).join('');
        results.querySelectorAll('.ps-hit').forEach(b => {
          b.onclick = () => onPick(hits[parseInt(b.dataset.idx, 10)]);
        });
      } catch { results.innerHTML = `<div class="empty">Erreur de recherche.</div>`; }
    };
    root.querySelector('#psGo').onclick = run;
    q.onkeydown = (e) => { if (e.key === 'Enter') run(); };
    q.focus(); q.select();
    if (initial) run();
  });
}

// Search TMDB to fix / choose the poster (manual match) for an existing show/movie.
// kind: 'tv' (pass sh) or 'movie' (pass movie object).
function openPosterSearch(kind, ref) {
  tmdbSearchModal({
    title: 'Chercher une affiche',
    hint: `Sélectionnez le bon ${kind === 'tv' ? 'programme' : 'film'} : l'affiche et le nom seront enregistrés.`,
    kind,
    initial: kind === 'tv' ? displayName(ref) : ref.name,
    onPick: async (hit) => {
      if (kind === 'tv') {
        setShowTmdb(ref, hit.id);
        try { await getShowMeta(hit.id, true); } catch {}
      } else {
        setMovieTmdb(ref.name, hit);
      }
      toast('Affiche enregistrée');
      closeModal(); render();
    },
  });
}

// Add a brand-new show or movie (not in the export) to watch in the future.
function openAddCatalog(kind) {
  tmdbSearchModal({
    title: kind === 'tv' ? 'Ajouter une série' : 'Ajouter un film',
    hint: kind === 'tv'
      ? 'Recherchez une série à regarder plus tard : elle sera ajoutée à vos séries.'
      : 'Recherchez un film à regarder plus tard : il apparaîtra dans « À voir ».',
    kind,
    initial: '',
    onPick: async (hit) => {
      closeModal();
      if (kind !== 'tv') { openMovie(addCustomMovie(hit)); return; }
      const exist = ownedLookup()(Object.assign({}, hit, { media_type: 'tv' })); // déjà dans la bibliothèque : on ouvre sa fiche
      addCustomShow(hit);
      location.hash = exist ? '#/show/' + encodeURIComponent(exist) : '#/home';
      render();
    },
  });
}

function addCustomShow(hit) {
  if (!userState.customShows) userState.customShows = [];
  const own = ownedLookup()(Object.assign({}, hit, { media_type: 'tv' })); // déjà dans la bibliothèque (id TMDB ou même titre)
  if (own) { toast('Déjà dans votre bibliothèque : ' + displayName(MODEL.shows.get(own) || { name: hit.name || '' })); return own; }
  if (userState.customShows.some(c => c.tmdbId === hit.id)) { toast('Série déjà ajoutée'); return 'tmdb:' + hit.id; }
  const cs = { key: 'tmdb:' + hit.id, tmdbId: hit.id, name: hit.name || hit.title || '', poster: hit.poster_path || null, addedAt: new Date().toISOString() };
  userState.customShows.push(cs);
  if (!userState.watchlist) userState.watchlist = {};
  userState.watchlist[cs.key] = true; // ajoutée à mes séries (jamais commencée)
  MODEL = null;
  scheduleSaveState();
  getShowMeta(hit.id, true).catch(() => {}); // prefetch meta (poster, seasons, episodes)
  toast('Ajoutée à mes séries');
  return cs.key;
}
function removeCustomShow(key) {
  if (!userState.customShows) return;
  const keyOf = (c) => c.key || (c.tmdbId ? 'tmdb:' + c.tmdbId : (c.tvdbId != null ? String(c.tvdbId) : 'n:' + c.name));
  const i = userState.customShows.findIndex(c => keyOf(c) === key);
  if (i >= 0) { userState.customShows.splice(i, 1); scheduleSaveState(); }
}
// Returns the name of the movie in the library (the existing one if it was already there).
function addCustomMovie(hit) {
  if (!userState.customMovies) userState.customMovies = [];
  let name = hit.title || hit.name || '';
  const all = (DATA.movies || []).concat(userState.customMovies);
  const idOf = (n) => { const r = (userState.movieTmdb && userState.movieTmdb[n]) || (tmdbCache.movies && tmdbCache.movies[n]); return r && r.id; };
  const hitYear = +movieYear({ releaseDate: hit.release_date || '' }) || 0;
  // Même id TMDB = même film ; même titre = même film sauf si l'id diffère ou si l'année s'écarte de plus d'un an (« Dune » 1984 / 2021).
  const same = all.find(m => {
    const id = idOf(m.name);
    if (hit.id != null && id != null) return id === hit.id;
    if (_normName(m.name) !== _normName(name)) return false;
    const y = +movieYear(m) || 0;
    return !(y && hitYear && Math.abs(y - hitYear) > 1);
  });
  if (same) { toast(`Déjà dans votre bibliothèque : ${movieDisplayName(same)}`); return same.name; }
  // Les films sont repérés par leur nom : un homonyme d'une autre année reçoit son année dans la clé.
  if (all.some(m => m.name === name)) name = hitYear ? `${name} (${hitYear})` : `${name} (${hit.id})`;
  userState.customMovies.push({ name, releaseDate: hit.release_date || '', runtime: null, status: 'towatch', custom: true, addedAt: new Date().toISOString() });
  setMovieTmdb(name, hit); // stores poster + id
  scheduleSaveState();
  toast('Film ajouté à « À voir »');
  return name;
}
function removeCustomMovie(name) {
  if (!userState.customMovies) return;
  const i = userState.customMovies.findIndex(m => m.name === name);
  if (i >= 0) { userState.customMovies.splice(i, 1); scheduleSaveState(); }
}
// A movie is "mine" (deletable) if it lives in my custom list, whatever its flags.
function isCustomMovie(m) { return !!(m && (m.custom || (userState.customMovies || []).some(c => c.name === m.name))); }

// Unified search (button in Séries / Films): finds works already in the library
// AND new results on TMDB. kind: 'tv' | 'movie'.
function openUnifiedSearch(kind) {
  if (!hasKey()) { toast('Ajoutez une clé TMDB (Réglages) pour rechercher.'); return; }
  buildModel();
  const ownedShows = Array.from(MODEL.shows.values());
  const ownedMovies = (DATA.movies || []).concat(userState.customMovies || []);
  showModal(`
    <h2>${kind === 'tv' ? '🔍 Rechercher une série' : '🔍 Rechercher un film'}</h2>
    <p class="hint" style="color:var(--muted)">Retrouvez ${kind === 'tv' ? 'une série' : 'un film'} de votre bibliothèque ou ajoutez-en ${kind === 'tv' ? 'une nouvelle (elle sera ajoutée à vos séries)' : 'un nouveau (il ira dans « À voir »)'}.</p>
    <div class="modal-fields" style="flex-direction:row;gap:8px">
      <input class="input" id="uQ" style="flex:1" placeholder="Titre à rechercher…">
      <button class="btn primary" id="uGo">Rechercher</button>
    </div>
    <div id="uResults" class="unified-search"></div>
    <div class="row"><button class="btn ghost" data-close>Fermer</button></div>
  `, (root) => {
    const q = root.querySelector('#uQ');
    const results = root.querySelector('#uResults');

    const hitCard = (img, name, date, attrs, own) => {
      const t = esc(name);
      const im = img ? `<img loading="lazy" src="${IMG(img, 'w185')}" alt="">` : `<div class="fallback-title">${t}</div>`;
      return `<button class="ps-hit" ${attrs}>
        <div class="ps-poster">${im}</div>
        <div class="ps-name">${t}${date ? ` <span>(${date})</span>` : ''}${own ? `<small class="ps-own">${esc(own)}</small>` : ''}</div>
      </button>`;
    };

    const localMatches = (t) => {
      if (kind === 'tv') return ownedShows.filter(s => searchNames(s).some(n => n.includes(t))).slice(0, 12);
      return ownedMovies.filter(m => _normName(movieSearchText(m) + ' ' + movieDisplayName(m)).includes(_normName(t))).slice(0, 12);
    };

    let hits = [];
    const draw = async (includeTmdb) => {
      const term = q.value.trim();
      if (!term) { results.innerHTML = ''; return; }
      const locals = localMatches(term.toLowerCase());
      let html = '';
      if (locals.length) {
        html += `<div class="ps-section">Déjà dans ma bibliothèque</div><div class="ps-grid">`;
        html += locals.map(it => {
          if (kind === 'tv') {
            const poster = (metaFor(it) || {}).poster || null;
            const m0 = metaFor(it) || {};
            return hitCard(poster, displayName(it), (m0.firstAir || '').slice(0, 4), `data-local-key="${esc(it.key)}"`, ownedState('tv', it.key).txt);
          }
          const rec = (tmdbCache.movies || {})[it.name];
          const mm = (rec && tmdbCache.movieMeta && tmdbCache.movieMeta[rec.id]) || {};
          return hitCard(rec && rec.poster, movieDisplayName(it), movieYear(it) || (mm.release || '').slice(0, 4), `data-local-movie="${esc(it.name)}"`, ownedState('movie', it.name).txt);
        }).join('') + `</div>`;
      }
      html += `<div class="ps-section">Ajouter une nouvelle œuvre</div>`;
      html += includeTmdb ? `<div id="uTmdb"><div class="loading">Recherche…</div></div>`
        : `<div class="hint" style="color:var(--muted);padding:2px">Appuyez sur <b>Entrée</b> pour chercher de nouveaux titres sur TMDB.</div>`;
      results.innerHTML = html;

      results.querySelectorAll('[data-local-key]').forEach(b => b.onclick = () => { closeModal(); openShow(b.getAttribute('data-local-key')); });
      results.querySelectorAll('[data-local-movie]').forEach(b => b.onclick = () => { closeModal(); openMovie(b.getAttribute('data-local-movie')); });

      if (!includeTmdb) return;
      try {
        const path = kind === 'tv' ? `/search/tv?query=${encodeURIComponent(term)}` : `/search/movie?query=${encodeURIComponent(term)}`;
        const res = await tmdbFetch(path);
        const own = ownedLookup();
        const shown = new Set(locals.map(it => kind === 'tv' ? it.key : it.name)); // déjà affichés dans « Déjà dans ma bibliothèque »
        hits = (res.results || []).filter(h => { const k = own(Object.assign({}, h, { media_type: kind })); return !(k && shown.has(k)); }).slice(0, 12);
        const box = results.querySelector('#uTmdb');
        if (!box) return;
        if (!hits.length) { box.innerHTML = `<div class="empty">Aucun résultat.</div>`; return; }
        box.innerHTML = `<div class="ps-grid">` + hits.map((h, i) => {
          const ok = own(Object.assign({}, h, { media_type: kind }));
          return hitCard(h.poster_path, h.name || h.title || '', (h.first_air_date || h.release_date || '').slice(0, 4), `data-add="${i}"`, ok ? ownedState(kind, ok).txt : '');
        }
        ).join('') + `</div>`;
        box.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
          const h = hits[parseInt(b.getAttribute('data-add'), 10)];
          closeModal();
          if (kind === 'tv') {
            const exist = ownedLookup()(Object.assign({}, h, { media_type: 'tv' })); // déjà dans la bibliothèque : sa fiche, pas de doublon
            addCustomShow(h);
            location.hash = exist ? '#/show/' + encodeURIComponent(exist) : '#/home'; render(); return;
          }
          openMovie(addCustomMovie(h));
        });
      } catch { const box = results.querySelector('#uTmdb'); if (box) box.innerHTML = `<div class="empty">Erreur de recherche.</div>`; }
    };

    q.oninput = () => draw(false);
    q.onkeydown = (e) => { if (e.key === 'Enter') draw(true); };
    root.querySelector('#uGo').onclick = () => draw(true);
    q.focus();
  });
}

