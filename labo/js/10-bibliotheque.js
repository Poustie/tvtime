/* Mon TV Time — Bibliothèque et genres */
'use strict';
//////////////////////// Library view ////////////////////////
let libFilter = { q: '', kind: 'series', tab: 'watching', movieTab: 'all', sort: 'az', genres: [], movieGenres: [] };
// ---------- Genres (filtres de la Bibliothèque et d'Explorer) ----------
const ANIME = 'Animé'; // pas un genre TMDB : Animation + langue d'origine japonaise
function showTmdbIdOf(sh) { return sh.forcedTmdb || (sh.tvdbId != null ? tmdbCache.map[sh.tvdbId] : null) || null; }
function movieTmdbRec(m) { return (userState.movieTmdb && userState.movieTmdb[m.name]) || (tmdbCache.movies && tmdbCache.movies[m.name]) || null; }
const langOf = (kind, id, meta) => (meta && meta.lang) || (tmdbCache.langs && tmdbCache.langs[kind + ':' + id]) || null;
const withAnime = (g, lang) => (lang === 'ja' && g.includes('Animation') ? [ANIME, ...g] : g);
function showGenres(sh) {
  const m = metaFor(sh); const g = (m && m.genres) || [];
  return withAnime(g, langOf('tv', showTmdbIdOf(sh), m));
}
function movieGenres(m) {
  const r = movieTmdbRec(m); if (!r || !r.id) return [];
  const mm = tmdbCache.movieMeta && tmdbCache.movieMeta[r.id];
  const g = (mm && mm.genres && mm.genres.length) ? mm.genres : ((tmdbCache.movieGenres && tmdbCache.movieGenres[r.id]) || []);
  return withAnime(g, langOf('movie', r.id, mm));
}
// Infos manquantes demandées une seule fois à TMDB puis gardées dans le cache :
// films → genres (+ langue) ; films et séries d'animation → langue d'origine (pour « Animé »).
const _fillRun = {}, _fillTried = new Set(); // _fillTried : déjà demandés pendant cette session (pas de nouvel essai en boucle)
function fillGenreInfo(kind, items, onProgress) {
  if (_fillRun[kind]) return _fillRun[kind];
  if (!hasKey()) return null;
  if (!tmdbCache.movieGenres) tmdbCache.movieGenres = {};
  if (!tmdbCache.langs) tmdbCache.langs = {};
  const ids = new Set();
  for (const it of items) {
    if (kind === 'tv') {
      const id = showTmdbIdOf(it), m = metaFor(it);
      if (id && m && (m.genres || []).includes('Animation') && !langOf('tv', id, m)) ids.add(id);
    } else {
      const r = movieTmdbRec(it); if (!r || !r.id) continue;
      const mm = tmdbCache.movieMeta && tmdbCache.movieMeta[r.id];
      const g = (mm && mm.genres) || tmdbCache.movieGenres[r.id];
      if (!g || (g.includes('Animation') && !langOf('movie', r.id, mm))) ids.add(r.id);
    }
  }
  const todo = [...ids].filter(id => !_fillTried.has(kind + ':' + id)); if (!todo.length) return null;
  todo.forEach(id => _fillTried.add(kind + ':' + id));
  const total = todo.length; let done = 0;
  const worker = async () => {
    while (todo.length) {
      const id = todo.shift();
      try {
        const d = await tmdbFetch(`/${kind}/${id}`);
        if (kind === 'movie') tmdbCache.movieGenres[id] = (d.genres || []).map(g => g.name);
        tmdbCache.langs[kind + ':' + id] = d.original_language || '?';
      } catch {}
      done++;
      if (done % 25 === 0) { scheduleSaveCache(); if (onProgress) onProgress(done, total); }
    }
  };
  _fillRun[kind] = Promise.all([1, 2, 3, 4, 5].map(worker))
    .then(() => { _fillRun[kind] = null; scheduleSaveCache(); if (onProgress) onProgress(total, total); })
    .finally(() => { _fillRun[kind] = null; });
  return _fillRun[kind];
}
// Genres à cocher d'une collection (plusieurs = l'œuvre doit avoir TOUS les genres cochés), avec le nombre d'œuvres restantes :
// [{ id, label, n, ico }] pour la fenêtre « Genres » (openGenreSheet). « Animé » en premier.
function genreEntries(items, genresOf, sel) {
  const cnt = new Map();
  for (const it of items) for (const g of new Set(genresOf(it))) cnt.set(g, (cnt.get(g) || 0) + 1);
  for (const g of sel) if (!cnt.has(g)) cnt.set(g, 0);
  return [...cnt].filter(([g, n]) => n > 0 || sel.includes(g))
    .sort((a, b) => (b[0] === ANIME) - (a[0] === ANIME) || a[0].localeCompare(b[0], 'fr'))
    .map(([g, n]) => ({ id: g, label: g, n, ico: g === ANIME ? '🇯🇵' : '' }));
}
const hasAllGenres = (genresOf, sel) => (it) => { if (!sel.length) return true; const g = genresOf(it); return sel.every(x => g.includes(x)); };
// Explorer : liste des genres TMDB (gardée 30 jours) et recherche « par genre ».
async function tmdbGenreList(kind) {
  const c = tmdbCache.genreLists || (tmdbCache.genreLists = {});
  const e = c[kind];
  if (e && Date.now() - e.at < 30 * 86400e3) return e.list;
  const r = await tmdbFetch(`/genre/${kind}/list`);
  const list = (r.genres || []).filter(g => g.id !== 10767 && g.id !== 10763); // sans talk-shows ni infos
  c[kind] = { at: Date.now(), list }; scheduleSaveCache();
  return list;
}
const GENRE_SORTS = [['pop', 'Populaires'], ['top', 'Mieux notés'], ['new', 'Récents']];
// « Mieux notés » : beaucoup de votes exigés (sinon des nouveautés notées par leurs seuls fans passent devant) ; low = seuil réduit pour les petits genres.
// g = { kind, ids: [genres TMDB, tous exigés], anime }.
function discoverPath(g, sort, page, low) {
  const kind = g.kind;
  const today = new Date().toISOString().slice(0, 10);
  const dateF = kind === 'tv' ? 'first_air_date' : 'primary_release_date';
  const ids = [...new Set([...g.ids, ...(g.anime ? [16] : [])])];
  let q = `/discover/${kind}?page=${page}&include_adult=false`;
  if (ids.length) q += '&with_genres=' + ids.join(',');
  if (g.anime) q += '&with_original_language=ja';
  if (kind === 'tv') q += '&without_genres=10767,10763';
  if (sort === 'top') q += `&sort_by=vote_average.desc&vote_count.gte=${low ? (kind === 'tv' ? 50 : 100) : (kind === 'tv' ? 1000 : 3000)}`;
  else if (sort === 'new') q += `&sort_by=${dateF}.desc&${dateF}.lte=${today}&vote_count.gte=${kind === 'tv' ? 10 : 30}`;
  else q += '&sort_by=popularity.desc';
  return q;
}
let exploreGenreKind = 'tv'; // Séries ou Films dans « Par genre »
let exploreGenre = null;     // genres cochés dans Explorer { kind, ids, names, anime, sort } (gardés au retour d'un aperçu)
let libBackTo = '#/profile'; // d'où l'on arrive dans la Bibliothèque (Mon compte, ou Séries pour « Arrêtées »)
route('library', async (el) => {
  buildModel();
  const shows = Array.from(MODEL.shows.values());
  const allMovies = (DATA.movies || []).concat(userState.customMovies || []);
  el.innerHTML = `
    ${backBtn(libBackTo)}
    <div class="page-head">
      <h1>Bibliothèque</h1>
      <span class="sub" id="libCount"></span>
      <div class="spacer"></div>
      <input class="input" id="libSearch" placeholder="Rechercher…" value="${esc(libFilter.q)}" style="min-width:200px">
    </div>
    <div class="pill-tabs" id="libKind">
      <span class="chip ${libFilter.kind === 'series' ? 'active' : ''}" data-kind="series">${icon('tv')} Séries</span>
      <span class="chip ${libFilter.kind === 'movie' ? 'active' : ''}" data-kind="movie">${icon('film')} Films</span>
    </div>
    <div class="pill-tabs" id="libTabs"></div>
    <div class="pick-bar"><span id="libSort"></span><span id="libGenres"></span><span class="sub" id="libGenreNote"></span></div>
    <div class="grid" id="libGrid"></div>`;

  const LIB_TAB_ICON = { watching: 'play', all: 'library', archived: 'stop', favorites: 'heart', notStarted: 'sparkle', towatch: 'clock', watched: 'check' };
  const seriesTabs = [
    ['watching', 'En cours', s => seriesCategory(s) === 'watching'],
    ['all', 'Tout', () => true],
    ['archived', 'Arrêtées', s => s.archived],
    ['favorites', 'Favoris', s => isFavShow(s)],
    ['notStarted', 'Pas commencées', s => seriesCategory(s) === 'notStarted'], // suivies, jamais démarrées, non arrêtées
  ];
  // Anciens noms d'onglet (valeur gardée en mémoire ou par défaut d'avant) : « Suivies » → En cours, « À voir plus tard » → Pas commencées.
  libFilter.tab = ({ following: 'watching', watchlist: 'notStarted' })[libFilter.tab] || libFilter.tab;
  if (!seriesTabs.some(t => t[0] === libFilter.tab)) libFilter.tab = 'watching';
  const movieTabs = [
    ['all', 'Tout', () => true],
    ['towatch', 'À voir', m => movieStatus(m) === 'towatch'],
    ['watched', 'Vus', m => movieStatus(m) === 'watched'],
    ['favorites', 'Favoris', m => isFavMovie(m)],
  ];

  const tabsEl = el.querySelector('#libTabs');
  function drawTabs() {
    if (!MODEL) buildModel(); // seriesCategory (onglets En cours / Pas commencées) lit le modèle
    const tabs = libFilter.kind === 'movie' ? movieTabs : seriesTabs;
    const source = libFilter.kind === 'movie' ? allMovies : shows;
    const cur = libFilter.kind === 'movie' ? libFilter.movieTab : libFilter.tab;
    tabsEl.innerHTML = tabs.map(([id, label, pred]) => {
      const n = source.filter(pred).length;
      return `<span class="chip ${cur === id ? 'active' : ''}" data-tab="${id}">${LIB_TAB_ICON[id] ? icon(LIB_TAB_ICON[id]) + ' ' : ''}${label} <b class="chip-n">${n}</b></span>`;
    }).join('');
    tabsEl.querySelectorAll('.chip').forEach(c => c.onclick = () => {
      if (libFilter.kind === 'movie') libFilter.movieTab = c.dataset.tab; else libFilter.tab = c.dataset.tab;
      drawTabs(); drawSort(); drawLib();
    });
  }

  el.querySelectorAll('#libKind .chip').forEach(c => c.onclick = () => {
    libFilter.kind = c.dataset.kind;
    el.querySelectorAll('#libKind .chip').forEach(x => x.classList.toggle('active', x.dataset.kind === libFilter.kind));
    drawTabs(); drawSort(); drawLib();
  });
  el.querySelector('#libSearch').oninput = (e) => { libFilter.q = e.target.value; drawLib(); };
  const sortEl = el.querySelector('#libSort');
  const hideScoreSort = () => libFilter.kind === 'movie' && libFilter.movieTab === 'towatch';
  const libSortNow = () => {
    const s = libFilter.sort, isMovie = libFilter.kind === 'movie';
    if (hideScoreSort() && (s === 'best' || s === 'worst')) return 'az';
    if (isMovie && (s === 'lastseen' || s === 'nextair')) return 'az'; // tris réservés aux séries
    return s;
  };
  function drawSort() {
    sortEl.innerHTML = sortBtnHtml('libSortBtn', libSortNow());
    sortEl.querySelector('button').onclick = () => openSortSheet(sortOptionList(hideScoreSort(), libFilter.kind !== 'movie'), libSortNow(), (k) => { libFilter.sort = k; drawSort(); drawLib(); });
  }
  drawSort();

  const genreBox = el.querySelector('#libGenres'), genreNote = el.querySelector('#libGenreNote');
  const genreSelOf = () => (libFilter.kind === 'movie' ? libFilter.movieGenres : libFilter.genres);
  let genreCtx = { list: [], genresOf: () => [] }; // collection courante (déjà filtrée par l'onglet et les genres cochés) pour la fenêtre « Genres »
  const drawGenreChips = (list, genresOf) => {
    genreCtx = { list, genresOf };
    genreBox.innerHTML = genreBtnHtml('libGenreBtn', genreSelOf().length);
    genreBox.querySelector('button').onclick = () => {
      const k = libFilter.kind === 'movie' ? 'movieGenres' : 'genres';
      // Les effectifs sont ceux des œuvres de l'onglet qui restent avec les genres déjà cochés (genreCtx.list) ; les genres cochés restent listés.
      openGenreSheet(genreEntries(genreCtx.list, genreCtx.genresOf, genreSelOf()), genreSelOf(), (sel) => { libFilter[k] = sel; drawLib(); });
    };
  };
  // Genres / langues pas encore connus : récupérés en arrière-plan (une seule fois), puis la page se met à jour.
  const startFill = (kind, items, label) => {
    const grid = el.querySelector('#libGrid');
    const fill = fillGenreInfo(kind, items, (d, t) => {
      if (!grid.isConnected) return;
      if ((libFilter.kind === 'movie') !== (kind === 'movie')) return; // on a changé d'onglet : ce message ne concerne plus cette page
      genreNote.textContent = d < t ? `${label} : ${d}/${t}…` : '';
      if (d >= t && (libFilter.kind === 'movie') === (kind === 'movie')) drawLib();
    });
    if (fill && !genreNote.textContent) genreNote.textContent = label + '…';
    if (!fill) genreNote.textContent = '';
  };
  function drawLib() {
    if (!MODEL) buildModel();
    const grid = el.querySelector('#libGrid');
    const q = libFilter.q.trim().toLowerCase();
    genreNote.textContent = '';
    if (libFilter.kind === 'movie') {
      const pred = movieTabs.find(t => t[0] === libFilter.movieTab)[2];
      let list = allMovies.filter(pred);
      startFill('movie', allMovies, 'Genres des films');
      list = list.filter(hasAllGenres(movieGenres, libFilter.movieGenres));
      drawGenreChips(list, movieGenres);
      if (q) list = list.filter(m => (movieSearchText(m) + ' ' + movieDisplayName(m)).toLowerCase().includes(q));
      list.sort(LIB_SORTERS_MOVIE[libSortNow()] || LIB_SORTERS_MOVIE.az);
      el.querySelector('#libCount').textContent = `${list.length} ${plural(list.length, 'film', 'films')}`;
      if (!list.length) { grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">${emojiIcon('🍿')}</div>Aucun film ici.</div>`; return; }
      grid.innerHTML = list.map(m => movieCardHtml(m)).join('');
      wireMovieButtons(grid);
      hydrateMoviePosters(grid, list);
    } else {
      const pred = seriesTabs.find(t => t[0] === libFilter.tab)[2];
      let list = shows.filter(pred);
      startFill('tv', shows, 'Repérage des animés');
      list = list.filter(hasAllGenres(showGenres, libFilter.genres));
      drawGenreChips(list, showGenres);
      if (q) list = list.filter(s => searchNames(s).some(n => n.includes(q)));
      list.sort(LIB_SORTERS_SHOW[libSortNow()] || LIB_SORTERS_SHOW.az);
      el.querySelector('#libCount').textContent = `${list.length} ${plural(list.length, 'série', 'séries')}`;
      if (!list.length) { grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">${emojiIcon('🍿')}</div>Aucune série ici.</div>`; return; }
      grid.innerHTML = list.map(s => cardHtml(s)).join('');
      grid.querySelectorAll('.show-card').forEach(c => c.onclick = () => openShow(c.dataset.key));
        hydratePosters(grid, list);
    }
  }

  drawTabs();
  drawLib();
});

// Progress of a show: null (nothing to show), or { pct, cls }.
// orange = en cours ; green = tout vu mais suite prévue ; purple = tout vu et terminé.
function showProgress(s, m) {
  const total = airedTotal(m);
  const seen = s.seenKeys.size;
  if (!total || seen <= 0) return null;
  // Série arrêtée : barre rouge (même longueur que la progression).
  if (s.archived) return { pct: Math.max(4, Math.min(100, Math.round(seen / total * 100))), cls: 'red' };
  if (seen >= total) {
    const ended = m.status === 'Ended' || m.status === 'Canceled';
    // Revisionnage : barre « terminée » en fond + progression du nouveau visionnage par-dessus.
    if (isRewatching(s)) {
      const pass = rewatchPass(s);
      if (pass) return { pct: Math.max(4, Math.min(99, Math.round(pass.done / pass.total * 100))), cls: 'rw', base: ended ? 'purple' : 'green' };
    }
    return { pct: 100, cls: ended ? 'purple' : 'green' };
  }
  return { pct: Math.max(4, Math.min(99, Math.round(seen / total * 100))), cls: 'orange' };
}
function progressBarHtml(prog) {
  if (!prog) return '';
  return (prog.base ? `<span class="bar-base ${prog.base}"></span>` : '') + `<span class="bar ${prog.cls}" style="width:${prog.pct}%"></span>`;
}

// Bouton « ⋯ » (toujours visible) : ouvre la feuille d'actions de l'œuvre (voir openCardActions).
const MORE_BTN = '<button type="button" class="card-more" aria-label="Actions"><svg class="ic dots" viewBox="0 0 26 10" aria-hidden="true"><circle cx="4" cy="5" r="2.3"/><circle cx="13" cy="5" r="2.3"/><circle cx="22" cy="5" r="2.3"/></svg></button>';
// Badge doré « ★ 8,1 » (note TMDB déjà en cache, aucune requête) ; vide si la note est inconnue.
function ratingBadgeHtml(v) {
  v = Number(v);
  return v > 0 ? `<span class="badge-rate" title="Note du public">★ ${v.toFixed(1).replace('.', ',')}</span>` : '';
}
const showVote = (s) => { const m = metaFor(s); return m && m.vote; };
function movieVote(m) {
  const rec = tmdbCache.movies && tmdbCache.movies[m.name];
  const mm = rec && rec.id && tmdbCache.movieMeta && tmdbCache.movieMeta[rec.id];
  return mm && mm.vote;
}

function cardHtml(s) {
  const seen = s.seenKeys.size;
  const tag = s.archived ? 'Arrêtée' : '';
  const name = displayName(s);
  const prog = showProgress(s, metaFor(s));
  return `<div class="show-card" data-key="${esc(s.key)}">
    <div class="poster" data-poster="${esc(s.key)}">
      <div class="fallback-title">${esc(name)}</div>
      ${tag ? `<span class="badge-tag">${tag}</span>` : ''}
      ${isPinnedWatching(s) ? `<span class="badge-pin" title="Épinglée">${icon('pin')}</span>` : ''}
      ${ratingBadgeHtml(showVote(s))}
      ${MORE_BTN}
      ${seen ? `<div class="card-progress">${progressBarHtml(prog)}</div>` : ''}
    </div>
    <div class="title">${esc(name)}</div>
    ${seen ? '' : `<div class="meta">Pas encore commencé</div>`}
  </div>`;
}

// Feuille en bas d'écran : style + clics sur le fond ignorés pendant 400 ms (clic fantôme au relâchement d'un appui long).
function sheetStyle(root) {
  const bd = root.querySelector('.backdrop');
  bd.classList.add('sheet-bd');
  const t0 = Date.now();
  bd.addEventListener('click', (e) => { if (Date.now() - t0 < 400) e.stopImmediatePropagation(); }, true);
}
// ---- Feuille d'actions (⋯) : la même depuis la fiche et depuis l'affiche ----
// items = [{ icon, label, sub?, on?, danger?, run }] ; un appui ferme la feuille puis lance run().
function openActionSheet(title, items) {
  showModal(`<h2>${esc(title)}</h2>
    <div class="sheet-list">${items.map((it, i) => `<button type="button" class="sheet-item${it.on ? ' on' : ''}${it.danger ? ' danger' : ''}" data-i="${i}">
      <span class="si-ico">${emojiIcon(it.icon)}</span><span class="si-txt">${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></button>`).join('')}</div>
    <div class="row"><button class="btn ghost" data-close>Fermer</button></div>`,
    (root) => {
      sheetStyle(root);
      root.querySelectorAll('.sheet-item').forEach(b => b.onclick = () => { closeModal(); items[+b.dataset.i].run(); });
    });
}

// ---- Tri et genres : un bouton ouvre une fenêtre du bas (même style que « ⋯ Plus »), plus de pastilles qui défilent sur le côté ----
const SORT_LABELS = { az: 'A → Z', za: 'Z → A', recent: 'Ajout récent', old: 'Ajout ancien', best: 'Mieux notés d’abord', worst: 'Moins bien notés d’abord', lastseen: 'Dernier épisode vu', nextair: 'Prochaine sortie' };
// Tris proposés : « Réaction » masqué pour les films « À voir » (hideScore), tris propres aux séries seulement pour les séries.
function sortOptionList(hideScore, withShowSorts) {
  const keys = ['az', 'za', 'recent', 'old'].concat(hideScore ? [] : ['best', 'worst'], withShowSorts ? ['lastseen', 'nextair'] : []);
  return keys.map(k => [k, SORT_LABELS[k]]);
}
const sortBtnHtml = (id, cur) => `<button type="button" class="pick-btn" id="${id}">${icon('sort')} Trier : ${esc(SORT_LABELS[cur] || SORT_LABELS.az)} <span class="pick-arrow">▾</span></button>`;
const genreBtnHtml = (id, n) => `<button type="button" class="pick-btn${n ? ' on' : ''}" id="${id}">${icon('tag')} Genres${n ? ' (' + n + ')' : ''} <span class="pick-arrow">▾</span></button>`;
// Tri : liste à choix unique ; un appui choisit et ferme. options = [[clé, libellé]].
function openSortSheet(options, cur, onPick) {
  showModal(`<h2>Trier par</h2>
    <div class="sheet-list" role="radiogroup">${options.map(([k, l]) => `<button type="button" role="radio" aria-checked="${k === cur}" class="sheet-item${k === cur ? ' on' : ''}" data-k="${esc(k)}">
      <span class="si-ico">${k === cur ? icon('check') : ''}</span><span class="si-txt">${esc(l)}</span></button>`).join('')}</div>
    <div class="row"><button class="btn ghost" data-close>Fermer</button></div>`,
    (root) => {
      sheetStyle(root);
      root.querySelectorAll('.sheet-item').forEach(b => b.onclick = () => { closeModal(); onPick(b.dataset.k); });
    });
}
// Genres : liste à cocher (plusieurs). entries = [{ id, label, n?, ico? }] ; « Effacer » décoche tout, « OK » applique, fermer sans OK n'applique rien.
function openGenreSheet(entries, selected, onApply, title) {
  let sel = selected.map(String);
  const rows = () => entries.map((e, i) => { const on = sel.includes(String(e.id));
    return `<button type="button" role="checkbox" aria-checked="${on}" class="sheet-item${on ? ' on' : ''}" data-i="${i}"><span class="si-ico">${on ? icon('check') : ''}</span>
      <span class="si-txt">${e.ico ? e.ico + ' ' : ''}${esc(e.label)}</span>${e.n != null ? `<b class="chip-n sheet-n">${e.n}</b>` : ''}</button>`; }).join('');
  showModal(`<h2>${esc(title || 'Genres')}</h2>
    <p class="hint">Cochez plusieurs genres : il faut les avoir tous.</p>
    <div class="sheet-list sheet-scroll" id="gSheetList">${rows()}</div>
    <div class="row"><button class="btn ghost" id="gClear">Effacer</button><button class="btn primary" id="gOk">OK</button></div>`,
    (root) => {
      sheetStyle(root);
      const list = root.querySelector('#gSheetList');
      const paint = () => { const y = list.scrollTop; list.innerHTML = rows(); list.scrollTop = y; };
      list.onclick = (ev) => { const b = ev.target.closest('.sheet-item'); if (!b) return; const id = String(entries[+b.dataset.i].id); sel = sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]; paint(); };
      root.querySelector('#gClear').onclick = () => { sel = []; paint(); };
      root.querySelector('#gOk').onclick = () => { closeModal(); onApply(entries.map(e => e.id).filter(id => sel.includes(String(id))).concat(sel.filter(x => !entries.some(e => String(e.id) === x)))); };
    });
}

// Série : TMDB + fiche (nécessaires pour « Marquer une saison vue » et « Ajouter un épisode » depuis une affiche).
async function showMetaFor(sh) {
  let tmdbId = null, meta = null;
  if (hasKey()) {
    try { tmdbId = overrideShowTmdb(sh) || (sh.tvdbId ? await resolveTmdbId(sh.tvdbId) : null); } catch {}
    if (tmdbId) { try { meta = await getShowMeta(tmdbId); } catch {} }
  }
  return { meta, tmdbId };
}
function confirmStopShow(sh) {
  showModal(`<h2>Arrêter cette série ?</h2>
    <p><strong>${esc(displayName(sh))}</strong> sera rangée dans « ⏹ Arrêtées » et n'apparaîtra plus dans vos catégories${isPinnedWatching(sh) ? ' (son épingle est retirée)' : ''}.</p>
    <div class="row"><button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="archGo">Arrêter</button></div>`,
    (root) => { root.querySelector('#archGo').onclick = () => { closeModal(); toggleArchived(sh); toast('Série arrêtée'); render(); }; });
}
// Liste des actions d'une série. ctx = { meta, tmdbId, page: true } quand la feuille s'ouvre depuis la FICHE : ce qui y est déjà
// visible en bouton (favoris, Mes séries / Épingler, Reprendre) n'est pas répété (règle R1). La feuille d'affiche est complète.
function showActionItems(sh, ctx) {
  const page = !!(ctx && ctx.page), started = sh.seenKeys.size > 0;
  const fav = isFavShow(sh), pin = isPinnedWatching(sh), mine = !!sh.followed;
  const items = [];
  if (!page) items.push({ icon: fav ? '❤️' : '♡', label: fav ? 'Dans mes favoris' : 'Ajouter aux favoris', sub: fav ? 'Toucher pour retirer' : '', on: fav,
    run: () => { toggleFavShow(sh); toast(isFavShow(sh) ? 'Ajoutée aux favoris' : 'Retirée des favoris'); render(); } });
  // Épingler : bouton visible sur la fiche d'une série commencée ; sinon dans la feuille.
  if ((!page || !started) && !sh.archived) items.push({ icon: '📌', label: pin ? 'Épinglée' : 'Épingler', sub: pin ? 'Toucher pour désépingler' : 'Reste dans « En cours » même sans visionnage récent', on: pin,
    run: () => { togglePinWatching(sh); toast(isPinnedWatching(sh) ? 'Série épinglée' : 'Série désépinglée'); render(); } });
  // Mes séries : seulement tant qu'aucun épisode n'est vu (sur la fiche, c'est un bouton visible).
  if (!started && !page && !sh.archived && !sh.custom) items.push({ icon: mine ? '➖' : '＋', label: mine ? 'Retirer de mes séries' : 'Ajouter à mes séries',
    run: () => afterMyShowToggle(sh, toggleMyShow(sh)) });
  items.push({ icon: '📃', label: 'Ajouter à une liste', run: () => openAddToListModal('tv', sh) });
  if (isRewatching(sh)) items.push({ icon: '🔁', label: 'Arrêter le revisionnage', run: () => { if (userState.rewatching) delete userState.rewatching[sh.key]; scheduleSaveState(); toast('Revisionnage arrêté'); render(); } });
  if (sh.archived) { if (!page) items.push({ icon: '▶', label: 'Reprendre la série', run: () => { toggleArchived(sh); toast('Série reprise'); render(); } }); }
  else items.push({ icon: '⏹', label: 'Arrêter la série', sub: 'La range dans « Arrêtées »', run: () => confirmStopShow(sh) });
  items.push({ icon: '➕', label: 'Ajouter un épisode', run: async () => { const c = (ctx && ctx.meta !== undefined) ? ctx : await showMetaFor(sh); addEpisodePrompt(sh, c.meta); } });
  items.push({ icon: '🔍', label: 'Chercher une affiche', run: () => openPosterSearch('tv', sh) });
  if (sh.custom) items.push({ icon: '🗑', label: 'Retirer de ma bibliothèque', danger: true, run: async () => { if (!await askModal(`<h2>Retirer cette série ?</h2><p><strong>${esc(displayName(sh))}</strong> sera retirée de votre bibliothèque (série ajoutée à la main ; ses épisodes vus restent enregistrés).</p>`, 'Annuler', 'Retirer')) return; removeCustomShow(sh.key); toast('Série retirée'); if (location.hash.startsWith('#/show/')) location.hash = '#/home'; render(); } });
  return items;
}
function openShowActions(sh, ctx) { openActionSheet(displayName(sh), showActionItems(sh, ctx)); }

// Film : liste des actions.
// page = true : feuille ouverte depuis la FICHE, qui montre déjà « Je l'ai vu » / « Je l'ai revu » et les favoris en boutons.
// Remet un film dans « À voir » : efface la date de visionnage ET les revisionnages (compteur + dates). Confirmation s'il y en a ;
// le toast « Annuler » restaure tout.
async function putMovieBackToWatch(m) {
  const name = m.name, rw = movieRewatchOf(m);
  if (rw > 0 && !await askModal(`<h2>Remettre dans « À voir » ?</h2><p><strong>${esc(movieDisplayName(m))}</strong> : la date de visionnage et les ${rw} revisionnage${rw > 1 ? 's' : ''} seront effacés (vous pourrez annuler juste après).</p>`, 'Annuler', 'Remettre dans « À voir »')) return;
  const keys = ['movieStatus', 'movieWatchedAt', 'movieRewatch', 'movieRewatchDates'];
  const snap = {};
  for (const k of keys) snap[k] = (userState[k] && name in userState[k]) ? JSON.parse(JSON.stringify(userState[k][name])) : undefined;
  setMovieStatus(name, 'towatch');
  if (!userState.movieRewatch) userState.movieRewatch = {};
  userState.movieRewatch[name] = 0; // 0 explicite : écrase aussi le compteur de l'export TV Time
  if (userState.movieRewatchDates) delete userState.movieRewatchDates[name];
  scheduleSaveState(); render();
  toastUndo('Remis dans « À voir »', () => {
    for (const k of keys) { if (!userState[k]) userState[k] = {}; if (snap[k] === undefined) delete userState[k][name]; else userState[k][name] = snap[k]; }
    scheduleSaveState(); render();
  });
}
function movieActionItems(m, page) {
  const st = movieStatus(m), rw = movieRewatchOf(m), fav = isFavMovie(m);
  const items = [];
  if (st === 'watched') {
    if (!page) items.push({ icon: '🔁', label: 'Je l’ai revu', sub: rw > 0 ? `Vu ${rw + 1} fois` : '', run: () => {
      setMovieRewatch(m.name, rw + 1); render();
      toastUndo(`🔁 ${movieDisplayName(m)} : vu ${rw + 2} fois`, () => { setMovieRewatch(m.name, rw); render(); });
    } });
    if (rw > 0) items.push({ icon: '✏️', label: 'Corriger le nombre de visionnages', run: () => openRewatchStepper(movieDisplayName(m), () => movieRewatchOf(m), (c) => setMovieRewatch(m.name, c), render) });
    items.push({ icon: '↩', label: 'Remettre dans « À voir »', run: () => putMovieBackToWatch(m) });
  } else if (!page) {
    items.push({ icon: '✓', label: 'Je l’ai vu', run: () => { setMovieStatus(m.name, 'watched'); toast('Film marqué comme vu'); render(); } });
  }
  if (!page) items.push({ icon: fav ? '❤️' : '♡', label: fav ? 'Dans mes favoris' : 'Ajouter aux favoris', sub: fav ? 'Toucher pour retirer' : '', on: fav,
    run: () => { toggleFavMovie(m); toast(isFavMovie(m) ? 'Ajouté aux favoris' : 'Retiré des favoris'); render(); } });
  items.push({ icon: '📃', label: 'Ajouter à une liste', run: () => openAddToListModal('movie', m) });
  items.push({ icon: '🔍', label: 'Chercher une affiche', run: () => openPosterSearch('movie', { name: m.name }) });
  if (isCustomMovie(m)) items.push({ icon: '🗑', label: 'Retirer de ma bibliothèque', danger: true, run: async () => { if (!await askModal(`<h2>Retirer ce film ?</h2><p><strong>${esc(movieDisplayName(m))}</strong> sera retiré de votre bibliothèque (film ajouté à la main).</p>`, 'Annuler', 'Retirer')) return; removeCustomMovie(m.name); toast('Film retiré'); if (location.hash.startsWith('#/movie/')) location.hash = '#/movies'; render(); } });
  return items;
}
function openMovieActions(m, page) { openActionSheet(movieDisplayName(m), movieActionItems(m, page)); }

// Ouvre la feuille d'actions d'une affiche (série ou film) : bouton ⋯ ou appui long.
function openCardActions(card) {
  if (card.dataset.mname) {
    const m = (DATA.movies || []).concat(userState.customMovies || []).find(x => x.name === card.dataset.mname);
    if (m) openMovieActions(m);
  } else if (card.dataset.key) {
    buildModel();
    const sh = MODEL.shows.get(card.dataset.key);
    if (sh) openShowActions(sh);
  }
}
// Le bouton ⋯ marche partout (Séries, Films, Bibliothèque, favoris, listes) sans câblage par page.
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('.card-more');
  if (!b) return;
  e.stopPropagation(); e.preventDefault();
  const card = b.closest('.show-card');
  if (card) openCardActions(card);
}, true);

// ---- Tactile : un appui long sur une affiche ouvre la feuille d'actions (raccourci du bouton ⋯) ----
let _lpTimer = null, _lpFired = false;
function _lpCancel() { if (_lpTimer) { clearTimeout(_lpTimer); _lpTimer = null; } }
document.addEventListener('touchstart', (e) => {
  const t = e.target;
  if (t.closest && t.closest('button')) return;          // les boutons gardent leur geste
  const card = t.closest && t.closest('.show-card');
  if (!card || !(card.dataset.key || card.dataset.mname)) return;
  _lpFired = false;
  _lpCancel();
  _lpTimer = setTimeout(() => {
    _lpTimer = null; _lpFired = true;
    _sw = null; // le glissement entre onglets s'arrête : la page ne bouge pas derrière la feuille
    if (navigator.vibrate) { try { navigator.vibrate(12); } catch {} }
    openCardActions(card);
  }, 480);
}, { passive: true });
document.addEventListener('touchmove', _lpCancel, { passive: true });
document.addEventListener('touchend', _lpCancel, { passive: true });
document.addEventListener('touchcancel', _lpCancel, { passive: true });
// Pas de menu natif (« Télécharger l'image »…) sur les affiches
document.addEventListener('contextmenu', (e) => { if (e.target.closest && e.target.closest('.show-card')) e.preventDefault(); });
// Supprime le clic de navigation qui suit immédiatement un appui long.
document.addEventListener('click', (e) => {
  if (!_lpFired) return;
  _lpFired = false;
  const card = e.target.closest && e.target.closest('.show-card');
  if (card && !(e.target.closest && e.target.closest('button'))) { e.stopPropagation(); e.preventDefault(); }
}, true);

