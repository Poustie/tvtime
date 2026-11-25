/* Mon TV Time — Films : liste et fiche */
'use strict';
//////////////////////// Movies view ////////////////////////
// Effective status of a movie (user override wins over the exported status).
function movieStatus(m) {
  const o = userState.movieStatus && userState.movieStatus[m.name];
  return (o === 'watched' || o === 'towatch') ? o : (m.status || 'towatch');
}
function setMovieStatus(name, status) {
  if (!userState.movieStatus) userState.movieStatus = {};
  const was = userState.movieStatus[name];
  userState.movieStatus[name] = status;
  if (!userState.movieWatchedAt) userState.movieWatchedAt = {};
  if (status === 'watched') {
    if (!userState.movieWatchedAt[name]) userState.movieWatchedAt[name] = new Date().toISOString().slice(0, 19).replace('T', ' ');
    if (userState.movieProgress) delete userState.movieProgress[name]; // film terminé -> plus de reprise
    if (was !== 'watched' && typeof offerMoviePlatform === 'function') offerMoviePlatform(name); // « 📺 Où ? » dans le message du bas
  } else {
    delete userState.movieWatchedAt[name];
  }
  scheduleSaveState();
}
function movieYear(m) {
  const d = m.releaseDate || '';
  const y = /^\d{4}/.exec(d);
  // TV Time writes 1970-01-01 or 0001-01-01 when the date is unknown
  return y && +y[0] > 1880 && !d.startsWith('1970-01-01') ? y[0] : '';
}
// Date used for the "recently added / oldest" library sort.
function showAddedAt(s) { return s.createdAt || ''; }
// Date d'ajout : la vraie (films ajoutés dans l'app) ; les films de l'export TV Time n'ont que la date de visionnage.
function movieAddedAt(m) {
  if (m.addedAt) return m.addedAt;
  const d = movieWatchedOf(m) || m.releaseDate || '';
  const today = new Date().toISOString().slice(0, 10);
  return d > today ? today : d; // une sortie à venir ne passe pas devant un film ajouté aujourd'hui
}
const LIB_SORTERS_SHOW = {
  az: (a, b) => displayName(a).localeCompare(displayName(b)),
  za: (a, b) => displayName(b).localeCompare(displayName(a)),
  recent: (a, b) => String(showAddedAt(b)).localeCompare(String(showAddedAt(a))) || displayName(a).localeCompare(displayName(b)),
  old: (a, b) => String(showAddedAt(a)).localeCompare(String(showAddedAt(b))) || displayName(a).localeCompare(displayName(b)),
  best: (a, b) => byScore(showScore(a), showScore(b), true) || displayName(a).localeCompare(displayName(b)),
  worst: (a, b) => byScore(showScore(a), showScore(b), false) || displayName(a).localeCompare(displayName(b)),
  // Dernier épisode vu : le plus récent d'abord ; séries sans visionnage à la fin.
  lastseen: (a, b) => byDate(a.lastSeenAt, b.lastSeenAt, false) || displayName(a).localeCompare(displayName(b)),
  // Prochaine sortie : date annoncée la plus proche d'abord ; séries sans date à la fin (sans requête : infos déjà en mémoire).
  nextair: (a, b) => byDate(showNextAir(a), showNextAir(b), true) || displayName(a).localeCompare(displayName(b)),
};
// Compare deux dates (texte) ; les dates absentes restent toujours à la fin.
function byDate(x, y, ascending) { if (!x !== !y) return x ? -1 : 1; if (!x) return 0; const a = String(x), b = String(y); return ascending ? a.localeCompare(b) : b.localeCompare(a); }
// Date du prochain épisode annoncé (aujourd'hui ou plus tard), d'après la fiche TMDB déjà en mémoire ; '' si inconnue.
function showNextAir(s) { const m = metaFor(s); return m && m.nextAir && daysFromToday(m.nextAir) >= 0 ? m.nextAir : ''; }
// Tri par réaction (1 à 5) : les œuvres sans réaction restent toujours à la fin.
function byScore(x, y, bestFirst) { if (!x !== !y) return x ? -1 : 1; return bestFirst ? y - x : x - y; }
const movieSortName = (m) => movieDisplayName(m); // tri sur le titre affiché (français)
const LIB_SORTERS_MOVIE = {
  az: (a, b) => movieSortName(a).localeCompare(movieSortName(b)),
  za: (a, b) => movieSortName(b).localeCompare(movieSortName(a)),
  recent: (a, b) => String(movieAddedAt(b)).localeCompare(String(movieAddedAt(a))) || movieSortName(a).localeCompare(movieSortName(b)),
  old: (a, b) => String(movieAddedAt(a)).localeCompare(String(movieAddedAt(b))) || movieSortName(a).localeCompare(movieSortName(b)),
  best: (a, b) => byScore(movieScore(a), movieScore(b), true) || movieSortName(a).localeCompare(movieSortName(b)),
  worst: (a, b) => byScore(movieScore(a), movieScore(b), false) || movieSortName(a).localeCompare(movieSortName(b)),
};
let moviesTab = 'towatch';
let moviesSort = 'az';
route('movies', async (el) => {
  const all = (DATA.movies || []).concat(userState.customMovies || []).slice();
  const toWatch = all.filter(m => movieStatus(m) === 'towatch');
  const watched = all.filter(m => movieStatus(m) === 'watched');
  const list = (moviesTab === 'watched' ? watched : toWatch).slice();
  // Sur l'onglet « À voir », le tri « Réaction » n'a pas de sens (rien n'a été vu) : masqué, tri alphabétique à la place.
  const sortNow = () => (moviesTab === 'towatch' && (moviesSort === 'best' || moviesSort === 'worst')) ? 'az' : moviesSort;
  list.sort(LIB_SORTERS_MOVIE[sortNow()] || LIB_SORTERS_MOVIE.az);

  el.innerHTML = `
    <div class="page-head">
      <h1>Films</h1>${searchBtn('movie')}${acctBtn()}
      <span class="sub">${toWatch.length} à voir · ${watched.length} vus</span>
      <div class="spacer"></div>
      <div id="movSort"></div>
    </div>
    <div class="pill-tabs" id="movTabs">
      <span class="chip ${moviesTab === 'towatch' ? 'active' : ''}" data-mtab="towatch">${icon('film')} À voir (${toWatch.length})</span>
      <span class="chip ${moviesTab === 'watched' ? 'active' : ''}" data-mtab="watched">${icon('check')} Vus (${watched.length})</span>
    </div>
    <div class="grid" id="movGrid"></div>`;

  wireSearchBtn(el);
  const movSort = el.querySelector('#movSort');
  movSort.innerHTML = sortBtnHtml('movSortBtn', sortNow());
  movSort.querySelector('button').onclick = () => openSortSheet(sortOptionList(moviesTab === 'towatch', false), sortNow(), (k) => { moviesSort = k; render(); });

  el.querySelectorAll('#movTabs .chip').forEach(c => c.onclick = () => { moviesTab = c.dataset.mtab; render(); });

  const grid = el.querySelector('#movGrid');
  if (!list.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><div class="big">${emojiIcon('🍿')}</div>${moviesTab === 'watched' ? 'Aucun film vu.' : 'Aucun film à voir.'}</div>`;
    return;
  }
  grid.innerHTML = list.map(m => movieCardHtml(m)).join('');
  wireMovieButtons(grid);
  hydrateMoviePosters(grid, list);
});

//////////////////////// Movie detail ////////////////////////
route('movie', async (el, rest) => {
  const name = decodeURIComponent(rest.join('/'));
  const m = (DATA.movies || []).concat(userState.customMovies || []).find(x => x.name === name);
  if (!m) { el.innerHTML = `<div class="empty">Film introuvable.</div>`; return; }

  let meta = null;
  if (hasKey()) {
    try {
      let rec = (userState.movieTmdb && userState.movieTmdb[name]) || null;
      if (!rec) rec = await resolveMovie(name, movieYear(m));
      if (rec && rec.id) meta = await getMovieMeta(rec.id);
    } catch {}
  }

  const st = movieStatus(m);
  const rw = movieRewatchOf(m);
  const year = movieYear(m);
  const rt = (meta && meta.runtime) || m.runtime;
  const rtStr = rt ? `${Math.floor(rt / 60)}h${String(rt % 60).padStart(2, '0')}` : '';
  const genres = meta ? meta.genres.join(' · ') : '';
  const subBits = [year, rtStr, genres].filter(Boolean).map(esc).join(' · ');
  el.innerHTML = `
    ${backBtn('#/movies')}
    ${immHeroHtml({
      backdrop: meta && meta.backdrop, poster: meta && meta.poster,
      posterHtml: meta && meta.poster ? `<img src="${IMG(meta.poster)}" alt="">` : `<div class="fallback-title">${esc(movieDisplayName(m))}</div>`,
      title: meta && meta.title ? fullTitle(meta.title, meta.originalTitle) : movieDisplayName(m),
      sub: subBits,
      tags: `<span class="chip">${st === 'watched' ? (movieWatchedOf(m) ? '✓ Vu le ' + esc(fmtFull(movieWatchedOf(m))) : '✓ Vu') : '🎬 À voir'}</span>
        ${st === 'watched' && rw > 0 ? `<span class="chip">${icon('repeat')} Vu ${rw + 1} fois</span>` : ''}`,
    })}
    <div class="imm-body">
      ${meta && meta.tagline ? `<div class="imm-tagline">${esc(meta.tagline)}</div>` : ''}
      <div class="detail-actions">
        ${st === 'watched'
          ? `<button class="btn" id="mRw">${icon('repeat')} Je l’ai revu</button>${rw > 0 ? `<button class="btn" id="mRwMinus" title="Retirer un visionnage" aria-label="Retirer un visionnage">−1</button>` : ''}`
          : `<button class="btn primary" id="mToggle">${icon('check')} Je l’ai vu</button>`}
        <button class="btn ${isFavMovie(m) ? 'on' : ''}" id="mFav">${isFavMovie(m) ? icon('heart', 'f') + ' Dans mes favoris' : icon('heart') + ' Ajouter aux favoris'}</button>
        <button class="btn" id="mMore" aria-label="Plus d’actions">${icon('more')} Plus</button>
      </div>
      ${st === 'watched' ? `<div id="pfSlot" class="pf-slot">${pfLineHtml(moviePlatformOf(m.name))}</div>` : ''}
      ${recoByHtml(m.name)}
      ${avisCardHtml({ cls: 'movie-react', score: movieScore(m), locked: st !== 'watched', vote: meta && meta.vote })}
      ${st !== 'watched' && meta && meta.id ? '<div class="appr-slot" id="apprSlot"></div>' : ''}
      ${st !== 'watched' ? `<div class="movie-progress glass imm-card" id="mProgBox">
        <span class="react-label">⏱️ Reprise — j'en suis à</span>
        <div class="mp-row">
          <input type="number" id="mProgH" min="0" ${rt ? `max="${Math.floor(rt / 60)}"` : ''} value="${movieProgressOf(m) ? Math.floor(movieProgressOf(m) / 60) : ''}" placeholder="h"> <span class="mp-unit">h</span>
          <input type="number" id="mProgM" min="0" max="59" value="${movieProgressOf(m) ? movieProgressOf(m) % 60 : ''}" placeholder="min"> <span class="mp-unit">min${rtStr ? ` / ${rtStr}` : ''}</span>
          <button class="btn sm" id="mProgSave">Enregistrer</button>
          ${movieProgressOf(m) ? `<button class="btn sm ghost" id="mProgClear">Effacer</button>` : ''}
        </div>
        <div class="mp-bar">${progressBarHtml(movieCardProgress(m))}</div>
      </div>` : ''}
    </div>
    <div class="detail-tabs">
      <button class="tab active" data-tab="overview">Aperçu</button>
      <button class="tab" data-tab="about">À propos</button>
    </div>
    <div class="tab-panel active" data-panel="overview"><div class="synopsis">${esc(meta ? (meta.overview || 'Pas de résumé disponible.') : 'Ajoutez une clé TMDB (Réglages) pour voir les informations du film.')}</div></div>
    <div class="tab-panel" data-panel="about"><div id="about">${movieAboutHtml(m, meta)}</div></div>
    ${reviewsSectionHtml()}`;

  wireTabs(el);
  const mRec = (userState.movieTmdb && userState.movieTmdb[name]) || (tmdbCache.movies && tmdbCache.movies[name]);
  wireReviews(el, { lk: 'm:' + m.name, work: reviewWorkMovie((meta && meta.id) || (mRec && mRec.id)), seen: st === 'watched', stars: () => movieScore(m), what: 'le film' });
  wireReactPicker(el.querySelector('.movie-react'), () => movieScore(m), (v) => { setMovieScore(m, v); _frRevCache.clear(); }, () => movieStatus(m) === 'watched');
  wireTrailer(el);
  fillRelated(el, 'movie', (meta && meta.id) || (mRec && mRec.id));
  renderAppreciation(el.querySelector('#apprSlot'), 'movie', meta && meta.id, meta);
  const mTog = el.querySelector('#mToggle');
  if (mTog) mTog.onclick = () => { setMovieStatus(m.name, 'watched'); toast('Film marqué comme vu'); render(); };
  el.querySelector('#mFav').onclick = () => { toggleFavMovie(m); toast(isFavMovie(m) ? 'Ajouté aux favoris' : 'Retiré des favoris'); render(); };
  wireRecoBy(el, m.name);
  const pfSlot = el.querySelector('#pfSlot');
  if (pfSlot) pfSlot.onclick = (ev) => {
    if (ev.target.closest('[data-pf]')) openMoviePlatformSheet(m.name, () => { if (pfSlot.isConnected) pfSlot.innerHTML = pfLineHtml(moviePlatformOf(m.name)); });
  };
  el.querySelector('#mMore').onclick = () => openActionSheet(movieDisplayName(m), movieActionItems(m, true).concat(recoActionItems('movie', (meta && meta.id) || (mRec && mRec.id), (meta && meta.title) || movieDisplayName(m), meta && meta.poster)));
  const rwBtn = el.querySelector('#mRw');
  if (rwBtn) rwBtn.onclick = () => {
    const prev = movieRewatchOf(m);
    setMovieRewatch(m.name, prev + 1); render();
    toastUndo(`🔁 ${movieDisplayName(m)} : vu ${prev + 2} fois`, () => { setMovieRewatch(m.name, prev); render(); });
  };
  const rwMinus = el.querySelector('#mRwMinus');
  if (rwMinus) rwMinus.onclick = () => { setMovieRewatch(m.name, movieRewatchOf(m) - 1); render(); toast('Un visionnage retiré'); };
  const progSave = el.querySelector('#mProgSave');
  if (progSave) progSave.onclick = () => {
    const h = parseInt(el.querySelector('#mProgH').value, 10) || 0;
    const mn = parseInt(el.querySelector('#mProgM').value, 10) || 0;
    setMovieProgress(m.name, h * 60 + mn); toast('Progression enregistrée'); render();
  };
  const progClear = el.querySelector('#mProgClear');
  if (progClear) progClear.onclick = () => { setMovieProgress(m.name, 0); toast('Progression effacée'); render(); };
});

function movieCardHtml(m) {
  const st = movieStatus(m);
  const year = movieYear(m);
  const rt = m.runtime ? `${Math.floor(m.runtime / 60)}h${String(m.runtime % 60).padStart(2, '0')}` : '';
  const metaBits = [year, rt].filter(Boolean).join(' · ');
  const rating = movieScore(m) ? `<span class="badge-tag" title="Ma réaction">${reactBadge(movieScore(m))}</span>` : '';
  const rw = movieRewatchOf(m);
  const rwBadge = (st === 'watched' && rw > 0) ? `<span class="badge-count">×${rw + 1}</span>` : '';
  const prog = movieCardProgress(m);
  return `<div class="show-card movie-card" data-mname="${esc(m.name)}">
    <div class="poster" data-mposter="${esc(m.name)}">
      <div class="fallback-title">${esc(movieDisplayName(m))}</div>
      ${rating}
      ${rwBadge}
      ${ratingBadgeHtml(movieVote(m))}
      ${MORE_BTN}
      ${prog ? `<div class="card-progress">${progressBarHtml(prog)}</div>` : ''}
    </div>
    <div class="title">${esc(movieDisplayName(m))}</div>
    <div class="meta">${esc(metaBits || (st === 'watched' ? 'Vu' : 'À voir'))}</div>
  </div>`;
}

function wireMovieButtons(container) {
  container.querySelectorAll('.movie-card').forEach(c => c.onclick = () => openMovie(c.dataset.mname));
}

// Resolve a movie poster from TMDB by name (+year), cached in tmdbCache.movies.
// Best TMDB result for a title: exact title (original or French) first, then the year, then popularity.
const _normTitle = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function pickMovieHit(results, name, year) {
  const n = _normTitle(name);
  let best = null, bestS = -Infinity;
  for (const h of results || []) {
    const t = _normTitle(h.title), o = _normTitle(h.original_title);
    let s = Math.log10((h.vote_count || 0) + 1) * 3;
    if (t === n || o === n) s += 100;
    else if ((t && (t.includes(n) || n.includes(t))) || (o && (o.includes(n) || n.includes(o)))) s += 20;
    const hy = +(h.release_date || '').slice(0, 4);
    if (year && hy && Math.abs(hy - +year) > 5) continue; // another film with the same title
    if (year && hy) { const dy = Math.abs(hy - +year); s += dy === 0 ? 30 : dy === 1 ? 15 : -20; }
    if (s > bestS) { bestS = s; best = h; }
  }
  return best;
}
const MOVIE_RESOLVER = 3; // bump to re-check every cached match once
// strict = relance l'erreur réseau (nettoyage des « introuvables ») ; retryNull = retente un film marqué introuvable.
// « Introuvable » (null) n'est mémorisé que si TMDB a répondu sans résultat, jamais sur une erreur.
async function resolveMovie(name, year, strict, retryNull) {
  if (!tmdbCache.movies) tmdbCache.movies = {};
  const cached = tmdbCache.movies[name];
  // Déjà résolu avec la méthode actuelle OU marqué introuvable -> on garde.
  if ((cached === null && !retryNull) || (cached && 'title' in cached && cached.v === MOVIE_RESOLVER)) return cached;
  try {
    const enc = encodeURIComponent(name);
    let results = (await tmdbFetch(`/search/movie?query=${enc}${year ? '&year=' + year : ''}`)).results || [];
    let hit = pickMovieHit(results, name, year);
    const exact = (h) => h && [h.title, h.original_title].some(x => _normTitle(x) === _normTitle(name));
    if (year && !exact(hit)) {
      results = results.concat(((await tmdbFetch(`/search/movie?query=${enc}`)).results || []).filter(h => !results.some(r => r.id === h.id)));
      hit = pickMovieHit(results, name, year);
    }
    tmdbCache.movies[name] = hit ? { id: hit.id, poster: hit.poster_path || null, title: hit.title || null, ot: hit.original_title || null, v: MOVIE_RESOLVER } : null;
  } catch (e) { if (strict) throw e; return cached === undefined ? null : cached; }
  scheduleSaveCache();
  return tmdbCache.movies[name];
}
// Once per resolver version: re-check in the background every history film matched the old way.
async function refreshMovieMatches() {
  if (!hasKey() || (tmdbCache.movieResolver || 0) >= MOVIE_RESOLVER) return;
  const todo = (DATA.movies || []).filter(m => !(userState.movieTmdb && userState.movieTmdb[m.name]) && !(tmdbCache.movies[m.name] && tmdbCache.movies[m.name].v === MOVIE_RESOLVER));
  let i = 0;
  const worker = async () => { while (i < todo.length) { const m = todo[i++]; try { await resolveMovie(m.name, movieYear(m)); } catch {} } };
  await Promise.all(Array.from({ length: 3 }, worker));
  tmdbCache.movieResolver = MOVIE_RESOLVER;
  scheduleSaveCache();
  reconcileDuplicateMovies();
}

// Nettoyage unique des « introuvables » mémorisés (anciennes erreurs réseau possibles) : on les retente doucement, 3 à la fois
// avec une pause, en arrière-plan. Un « introuvable » n'est remplacé que si TMDB répond ; si le réseau échoue, on recommence au
// prochain démarrage (tmdbCache.nullRetry n'est posé qu'une fois tout vérifié).
const NULL_RETRY = 1;
async function retryNullMatches() {
  if (!hasKey() || (tmdbCache.nullRetry || 0) >= NULL_RETRY) return;
  const items = [];
  for (const k of Object.keys(tmdbCache.map || {})) if (tmdbCache.map[k] === null && !(userState.showTmdb && userState.showTmdb[k] != null)) items.push({ tv: true, k });
  for (const n of Object.keys(tmdbCache.movies || {})) if (tmdbCache.movies[n] === null) items.push({ tv: false, k: n });
  const movies = (DATA.movies || []).concat(userState.customMovies || []);
  let failures = 0, fixed = 0, fixedMovies = 0;
  for (let i = 0; i < items.length && failures < 5; i += 3) {
    await Promise.all(items.slice(i, i + 3).map(async (it) => {
      try {
        if (it.tv) {
          const res = await tmdbFetch(`/find/${it.k}?external_source=tvdb_id`);
          const hit = (res.tv_results && res.tv_results[0]) || null;
          if (hit) { tmdbCache.map[it.k] = hit.id; fixed++; }
        } else {
          const mv = movies.find(x => x.name === it.k);
          const r = await resolveMovie(it.k, mv ? movieYear(mv) : undefined, true, true);
          if (r) { fixed++; fixedMovies++; }
        }
      } catch { failures++; }
    }));
    scheduleSaveCache();
    await new Promise(r => setTimeout(r, 600));
  }
  if (!failures) { tmdbCache.nullRetry = NULL_RETRY; scheduleSaveCache(); }
  if (fixed) { _nextInfo.clear(); if (fixedMovies) reconcileDuplicateMovies(); MODEL = null; console.info(`Nettoyage : ${fixed} « introuvable(s) » retrouvé(s) sur TMDB`); }
}

async function hydrateMoviePosters(container, list) {
  if (!hasKey()) return;
  const byName = Object.fromEntries(list.map(m => [m.name, m]));
  const slots = container.querySelectorAll('[data-mposter]');
  let i = 0;
  const worker = async () => {
    while (i < slots.length) {
      const slot = slots[i++];
      const m = byName[slot.getAttribute('data-mposter')];
      if (!m) continue;
      try {
        const hit = await resolveMovie(m.name, movieYear(m));
        if (hit && hit.poster) slot.insertAdjacentHTML('afterbegin', `<img loading="lazy" src="${IMG(hit.poster)}" alt="">`);
        if (hit && hit.title) {
          const card = slot.closest('.movie-card');
          const shown = smallTitle(hit.title, hit.ot);
          if (card) { const t = card.querySelector('.title'); if (t) t.textContent = shown; }
          const fb = slot.querySelector('.fallback-title'); if (fb) fb.textContent = shown;
        }
      } catch {}
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
}


