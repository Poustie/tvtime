/* Mon TV Time — Explorer et indice d’appréciation */
'use strict';
//////////////////////// Explorer (rechercher de nouvelles œuvres) ////////////////////////
// Cards of TMDB hits (search results / trends): ✓ if already in the library, ＋ to add, tap = open.
// État d'une œuvre de ma bibliothèque, pour l'étiquette des affiches (Explorer, similaires, filmographie).
// Séries : la catégorie de la page Séries (seriesCategory), avec les mêmes mots.
function ownedState(kind, key) {
  if (kind === 'tv') {
    if (!MODEL) buildModel();
    const sh = MODEL.shows.get(key);
    if (!sh) return { cls: 'st-stale', txt: '📚 Dans ma bibliothèque' };
    if (sh.archived) return { cls: 'st-stopped', txt: '⏹ Arrêtée' };
    if (!sh.seenKeys.size) return sh.followed ? { cls: 'st-towatch', txt: '🆕 Pas commencée' } : { cls: 'st-stale', txt: '📚 Dans ma bibliothèque' };
    const cat = seriesCategory(sh);
    if (cat === 'finished') return { cls: 'st-seen', txt: '✓ Terminée' };
    if (cat === 'watching') return { cls: 'st-watching', txt: '▶ En cours' };
    return { cls: 'st-stale', txt: cat === 'stale' ? '🕰️ Pas vu depuis longtemps' : '📚 Dans ma bibliothèque' };
  }
  const m = (DATA.movies || []).concat(userState.customMovies || []).find(x => x.name === key);
  return m && movieStatus(m) === 'watched' ? { cls: 'st-seen', txt: '✓ Vu' } : { cls: 'st-towatch', txt: '🕒 À voir' };
}
const ownedBadgeHtml = (st) => `<span class="owned-badge ${st.cls}">${st.txt}</span>`;
function expHitsHtml(hits, ownedKey) {
  return hits.map((h, i) => {
    const name = h.name || h.title || '';
    const date = (h.first_air_date || h.release_date || '').slice(0, 4);
    const badge = h.media_type === 'tv' ? '📺 Série' : '🎬 Film';
    const im = h.poster_path ? `<img loading="lazy" src="${IMG(h.poster_path, 'w185')}" alt="">` : `<div class="fallback-title">${esc(name)}</div>`;
    const ok = ownedKey(h), owned = !!ok;
    const st = owned ? ownedState(h.media_type === 'tv' ? 'tv' : 'movie', ok) : null;
    return `<div class="exp-hit${owned ? ' owned ' + st.cls : ''}" data-open="${i}">
      <div class="ps-poster">${im}<span class="badge-tag">${badge}</span>
        ${owned ? ownedBadgeHtml(st) : `<button class="exp-add" data-add="${i}" title="Ajouter à ma bibliothèque" aria-label="Ajouter à ma bibliothèque">＋</button>`}</div>
      <div class="ps-name">${esc(name)}${h.sub ? ` <span>· ${esc(h.sub)}</span>` : (date ? ` <span>(${date})</span>` : '')}</div>
    </div>`;
  }).join('');
}
function wireExpHits(container, hits, ownedKey) {
  container.querySelectorAll('.exp-add').forEach(b => b.onclick = (ev) => {
    ev.stopPropagation();
    const h = hits[parseInt(b.getAttribute('data-add'), 10)];
    const isTv = h.media_type === 'tv';
    const k = isTv ? addCustomShow(h) : addCustomMovie(h);
    const st = ownedState(isTv ? 'tv' : 'movie', k); // le même badge qu'après un rechargement
    b.closest('.exp-hit').classList.add('owned', st.cls);
    b.outerHTML = ownedBadgeHtml(st);
  });
  container.querySelectorAll('.exp-hit').forEach(card => card.onclick = () => {
    const h = hits[parseInt(card.getAttribute('data-open'), 10)];
    const key = ownedLookup()(h); // fresh: the work may have just been added with ＋
    // Already in the library -> open the real tracked page, not a preview.
    if (key && h.media_type === 'tv') { openShow(key); return; }
    if (key && h.media_type === 'movie') { openMovie(key); return; }
    navTo('#/preview/' + (h.media_type === 'tv' ? 'tv' : 'movie') + '/' + h.id);
  });
}
const slimHit = (h, type) => ({ media_type: type, id: h.id, name: h.name, title: h.title, poster_path: h.poster_path, first_air_date: h.first_air_date, release_date: h.release_date });
const slimHits = (r, type) => (r.results || []).filter(h => h.poster_path).slice(0, 20).map(h => slimHit(h, type));
// Seeds for « pour vous »: favourites / well-rated works, most recently watched first.
function recoSeeds(kind) {
  if (kind === 'tv') {
    buildModel();
    const shows = [...MODEL.shows.values()].filter(s => s.seenKeys.size > 0);
    const loved = shows.filter(s => isFavShow(s) || (s.showRating || 0) >= 4);
    const pool = (loved.length >= 3 ? loved : shows).sort((a, b) => (b.lastSeenAt || '').localeCompare(a.lastSeenAt || ''));
    return pool.map(s => ({ id: s.forcedTmdb || (s.tvdbId != null ? tmdbCache.map[s.tvdbId] : null), name: displayName(s) })).filter(x => x.id).slice(0, 5);
  }
  const movies = (DATA.movies || []).concat(userState.customMovies || []).filter(m => movieStatus(m) === 'watched');
  const loved = movies.filter(m => isFavMovie(m) || movieScore(m) >= 4);
  const pool = (loved.length >= 3 ? loved : movies).sort((a, b) => String(movieWatchedOf(b) || '').localeCompare(String(movieWatchedOf(a) || '')));
  const idOf = (m) => { const r = (userState.movieTmdb && userState.movieTmdb[m.name]) || (tmdbCache.movies && tmdbCache.movies[m.name]); return r && r.id; };
  return pool.map(m => ({ id: idOf(m), name: m.name })).filter(x => x.id).slice(0, 5);
}
async function recoHits(kind) {
  const seeds = recoSeeds(kind);
  if (!seeds.length) return [];
  const score = new Map();
  const lists = await Promise.all(seeds.map(s => tmdbFetch(`/${kind}/${s.id}/recommendations`).catch(() => ({ results: [] }))));
  lists.forEach(r => (r.results || []).forEach((h, i) => {
    if (!h.poster_path || (h.vote_count || 0) < 300) return;
    const cur = score.get(h.id) || { h, pts: 0 };
    cur.pts += 20 - Math.min(i, 19);
    score.set(h.id, cur);
  }));
  const own = ownedLookup();
  return [...score.values()].sort((a, b) => b.pts - a.pts).map(x => slimHit(x.h, kind)).filter(h => !own(h)).slice(0, 20);
}
//////////////////////// Indice d'appréciation ////////////////////////
// How much the user liked a work they've seen: { v: 0..1, w: strength of the evidence 0..1 }.
const STAR_LIKE = [null, 0, 0.3, 0.6, 0.85, 1]; // réaction 1 à 5 → « aimé » (mêmes valeurs que EMO_LIKE pour 👎 😐 👍 😮 🤩)
const EMO_LIKE = { '1': 1, '3': 0.85, '8': 0.6, '2': 0.75, '5': 0.7, '4': 0.65, '6': 0.3, '7': 0 };
function blendLiking(parts) {
  const w = parts.reduce((a, p) => a + p.w, 0);
  return w ? { v: parts.reduce((a, p) => a + p.v * p.w, 0) / w, w: Math.min(1, w) } : null;
}
function showLiking(sh) {
  if (!sh.seenKeys.size) return null;
  if (isFavShow(sh)) return { v: 1, w: 1 };
  if (sh.showRating) return { v: STAR_LIKE[sh.showRating], w: 1 };
  const parts = [];
  let sum = 0, n = 0, rewatched = false;
  for (const k of sh.seenKeys) {
    const e = MODEL.emotionMap.get(k); // réaction (et sinon ancienne note ★), comptée une seule fois
    if (e in EMO_LIKE) { sum += EMO_LIKE[e]; n++; } else { const r = MODEL.ratingMap.get(k); if (r) { sum += STAR_LIKE[r]; n++; } }
    if (MODEL.rewatchMap.get(k) > 0) rewatched = true;
  }
  if (n >= 3) parts.push({ v: sum / n, w: Math.min(0.8, n / 12) });
  if (rewatched) parts.push({ v: 0.95, w: 0.8 });
  if (rewatched) { const L = blendLiking(parts); return { v: Math.max(0.85, L.v), w: 1 }; } // revue = bien aimée
  const aired = airedTotal(metaFor(sh));
  const prog = aired ? Math.min(1, sh.seenKeys.size / aired) : null;
  if (prog != null) {
    const idle = daysSince(sh.lastSeenAt);
    if (prog >= 0.9) parts.push({ v: 0.8, w: 0.6 });
    else if (sh.archived) parts.push({ v: prog < 0.5 ? 0.1 : 0.35, w: 0.8 });
    // Not watched for a year: dropped after the first episodes = not liked; left mid-way = unknown (maybe paused).
    else if (idle > 365) parts.push(sh.seenKeys.size <= 3 ? { v: 0.2, w: 0.7 } : { v: 0.55, w: 0.15 });
    else parts.push({ v: 0.65, w: 0.25 });
  }
  return blendLiking(parts);
}
function movieLiking(m) {
  if (movieStatus(m) !== 'watched') return null;
  if (isFavMovie(m)) return { v: 1, w: 1 };
  const rw = movieRewatchOf(m) > 0; // film revu = bien aimé (au moins 85 %)
  const e0 = movieEmotionOf(m); if (SCORE_OF_EMO[e0]) return { v: rw ? Math.max(0.85, EMO_LIKE[e0]) : EMO_LIKE[e0], w: 1 }; // réaction de l'échelle 1 à 5
  if (movieRatingOf(m)) return { v: rw ? Math.max(0.85, STAR_LIKE[movieRatingOf(m)]) : STAR_LIKE[movieRatingOf(m)], w: 1 };
  const parts = [];
  const e = movieEmotionOf(m); if (e in EMO_LIKE) parts.push({ v: EMO_LIKE[e], w: 0.8 });
  if (rw) return { v: Math.max(0.85, (blendLiking(parts) || { v: 0.9 }).v), w: 1 };
  if (!parts.length) parts.push({ v: 0.6, w: 0.2 }); // watched to the end, no opinion given
  return blendLiking(parts);
}
// Library indexed by TMDB id, per kind: id -> { v, w, name, genres }.
function likingIndex() {
  buildModel();
  const idx = { tv: new Map(), movie: new Map() };
  for (const sh of MODEL.shows.values()) {
    const L = showLiking(sh); if (!L) continue;
    const id = sh.forcedTmdb || (sh.tvdbId != null ? tmdbCache.map[sh.tvdbId] : null); if (!id) continue;
    const m = metaFor(sh);
    idx.tv.set(Number(id), { ...L, name: displayName(sh), genres: (m && m.genres) || [] });
  }
  for (const mv of (DATA.movies || []).concat(userState.customMovies || [])) {
    const L = movieLiking(mv); if (!L) continue;
    const r = (userState.movieTmdb && userState.movieTmdb[mv.name]) || (tmdbCache.movies && tmdbCache.movies[mv.name]);
    if (!r || !r.id) continue;
    const mm = tmdbCache.movieMeta && tmdbCache.movieMeta[r.id];
    idx.movie.set(Number(r.id), { ...L, name: (r.title || mv.name), genres: (mm && mm.genres) || [] });
  }
  return idx;
}
// Works close to a given one (TMDB recommendations, completed by « similar »), cached 30 days.
async function getNeighbors(kind, id) {
  if (!tmdbCache.neighbors) tmdbCache.neighbors = {};
  const ck = kind + id;
  const c = tmdbCache.neighbors[ck];
  if (c && Date.now() - c.at < 30 * MS_DAY) return c.list;
  const pick = (r) => (r.results || []).map(h => [h.id, h.name || h.title || '']);
  let list = pick(await tmdbFetch(`/${kind}/${id}/recommendations`));
  if (list.length < 10) {
    const seen = new Set(list.map(x => x[0]));
    try { list = list.concat(pick(await tmdbFetch(`/${kind}/${id}/similar`)).filter(x => !seen.has(x[0]))); } catch {}
  }
  list = list.slice(0, 30);
  tmdbCache.neighbors[ck] = { at: Date.now(), list };
  scheduleSaveCache();
  return list;
}
// Indices d'une œuvre pour l'estimation « chances d'aimer » (exclude = id ignoré, pour les tests sur l'historique).
async function likingFeatures(kind, id, genres, vote, idx, exclude) {
  idx = idx || likingIndex();
  const lib = idx[kind];
  let gSum = 0, gW = 0;
  for (const [lid, L] of lib) if (lid !== exclude) { gSum += L.v * L.w; gW += L.w; }
  const globalMean = gW ? gSum / gW : 0.6;
  // 1. œuvres proches : combien des 10 plus proches vous avez vues, et à quel point vous avez aimé celles vues (20 plus proches)
  let top10 = 0, seenN = 0, nbS = 0, nbW = 0; const liked = [], disliked = [];
  const neigh = await getNeighbors(kind, id);
  neigh.forEach(([nid], i) => {
    if (nid === exclude) return;
    const L = lib.get(nid); if (!L) return;
    seenN++; if (i < 10) top10++;
    if (i < 20) { nbS += L.v * L.w; nbW += L.w; }
    if (L.v >= 0.7) liked.push(L.name); else if (L.v <= 0.35) disliked.push(L.name);
  });
  const nbLike = (nbS + 2 * globalMean) / (nbW + 2); // rapproché de votre moyenne quand peu d'œuvres proches sont vues
  // 2. affinité de genres (rapprochée de votre moyenne quand un genre a peu de données)
  const gStats = {};
  for (const [lid, L] of lib) {
    if (lid === exclude) continue;
    for (const g of L.genres) { const st = gStats[g] || (gStats[g] = { s: 0, w: 0 }); st.s += L.v * L.w; st.w += L.w; }
  }
  const gAff = (genres || []).filter(g => gStats[g]).map(g => (gStats[g].s + 2 * globalMean) / (gStats[g].w + 2));
  const genre = gAff.length ? gAff.reduce((a, b) => a + b, 0) / gAff.length : globalMean;
  // 3. avis du public
  const pub = vote ? Math.max(0, Math.min(1, (vote - 5) / 3.5)) : 0.5;
  return { f: { pub, genre, top10: top10 / 10, nbLike }, evidence: (top10 >= 3 ? 1 : 0) + (vote ? 1 : 0) + (gAff.length ? 1 : 0), seenN, liked, disliked };
}
// Modèles réglés sur votre propre historique (un par type), testés en cachant chaque œuvre à tour de rôle (5 groupes).
// Probabilité = 1 / (1 + e^-(a + Σ c × (indice − moyenne) / écart)).
// Séries (311 avec un avis assez clair) : capacité à classer aimée/pas aimée 0,68 ; annoncé 70-80 % → 77 % en moyenne, < 60 % → 54 %.
//   L'indice « œuvres proches aimées » n'aide pas pour les séries.
// Films (764 vus ; aucun « pas aimé » dans l'historique, donc « aimé » = revu, favori ou 😮/🤩 contre « vu une fois sans avis ») :
//   capacité 0,68 (ancien modèle séries : 0,63) ; annoncé 60-70 % → 68 %, 70-80 % → 74 %, 80-90 % → 82 %.
//   La note du public ne prédit presque rien pour les films ; les films proches que vous avez aimés comptent le plus.
const LIKE_MODELS = {
  tv: { a: 0.925, c: { pub: 0.298, genre: 0.135, top10: 0.217 }, st: { pub: [0.7911, 0.1829], genre: [0.7288, 0.0182], top10: [0.2412, 0.1962] } },
  movie: { a: 1.026, c: { pub: 0.023, genre: 0.061, top10: 0.119, nbLike: 0.151 }, st: { pub: [0.5878, 0.2010], genre: [0.8371, 0.0175], top10: [0.2661, 0.2672], nbLike: [0.8433, 0.0271] } },
};
function likingProb(kind, f) {
  const M = LIKE_MODELS[kind] || LIKE_MODELS.tv;
  const z = Object.keys(M.c).reduce((t, k) => t + M.c[k] * (f[k] - M.st[k][0]) / M.st[k][1], M.a);
  return 1 / (1 + Math.exp(-z));
}
// Estimated chance (0..1) that the user likes a work.
async function predictLiking(kind, id, genres, vote, idx, exclude) {
  const F = await likingFeatures(kind, id, genres, vote, idx, exclude);
  const v = likingProb(kind, F.f);
  return { v, pct: Math.max(5, Math.min(95, Math.round(v * 100))), conf: F.evidence >= 3 ? 'élevée' : (F.evidence === 2 || F.seenN >= 2) ? 'moyenne' : 'faible',
    liked: F.liked.slice(0, 3), disliked: F.disliked.slice(0, 2) };
}
function appreciationHtml(p) {
  const cls = p.pct >= 75 ? 'hi' : p.pct >= 55 ? 'mid' : 'lo';
  const icon = cls === 'hi' ? '💚' : cls === 'mid' ? '🟡' : '🔻';
  const why = [];
  if (p.liked.length) why.push(`Proche de ${p.liked.map(esc).join(', ')} que vous avez aimé${p.liked.length > 1 ? 's' : ''}.`);
  if (p.disliked.length) why.push(`Mais aussi de ${p.disliked.map(esc).join(', ')} que vous avez abandonné${p.disliked.length > 1 ? 's' : ''}.`);
  return `<div class="appr appr-${cls}">
    <div class="appr-main">${icon} <b>${p.pct} %</b> de chances que vous aimiez <span class="appr-conf" title="Estimation d'après vos goûts : œuvres proches que vous avez vues, vos genres et la note du public.">· estimation</span></div>
    ${why.length ? `<div class="appr-why">${why.join(' ')}</div>` : ''}
  </div>`;
}
// Fill a placeholder with the appreciation score of an unseen work (quietly does nothing on error).
async function renderAppreciation(slot, kind, id, meta) {
  if (!slot || !hasKey() || !id) return;
  try {
    const p = await predictLiking(kind, Number(id), meta && meta.genres, meta && meta.vote);
    if (document.body.contains(slot)) slot.innerHTML = appreciationHtml(p);
  } catch {}
}

// Explorer rows shown when the search box is empty (each cached with its own TTL).
// Période « animés de la saison » : du début du trimestre en cours (jan./avr./juil./oct.) à dans 1 mois.
function animeSeasonRange() {
  const now = new Date(), q = Math.floor(now.getMonth() / 3) * 3, iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(new Date(Date.UTC(now.getFullYear(), q, 1))), to: iso(new Date(now.getTime() + 30 * MS_DAY)) };
}
// Animé « de la saison » : un épisode sort pendant la période (début du trimestre → dans 1 mois), et ce n'est pas une série
// sans fin (One Piece, Détective Conan, Doraemon, Pokémon… : plus de 100 épisodes dans la saison ou numéros au-delà de 100).
function isSeasonalAnime(d) {
  if (!d) return true;
  const r = animeSeasonRange(), nx = d.next_episode_to_air, la = d.last_episode_to_air;
  const ep = (nx && nx.air_date && nx.air_date <= r.to) ? nx : (la && la.air_date && la.air_date >= r.from) ? la : null;
  if (!ep) return false;
  const se = (d.seasons || []).find(x => x.season_number === ep.season_number);
  return ep.episode_number <= 100 && !(se && se.episode_count > 100);
}
const EXPLORE_ROWS = [
  { id: 'trTv', title: '🔥 Séries du moment', ttl: 0.5, load: async () => slimHits(await tmdbFetch('/trending/tv/week'), 'tv') },
  { id: 'trMovie', title: '🎬 Films du moment', ttl: 0.5, load: async () => slimHits(await tmdbFetch('/trending/movie/week'), 'movie') },
  { id: 'recoTv', title: '💡 Séries pour vous', ttl: 1, key: () => recoSeeds('tv').map(s => s.id).join(','), load: () => recoHits('tv') },
  { id: 'recoMovie', title: '💡 Films pour vous', ttl: 1, key: () => recoSeeds('movie').map(s => s.id).join(','), load: () => recoHits('movie') },
  { id: 'cinema', title: '🍿 Au cinéma en ce moment', ttl: 0.5, load: async () => slimHits(await tmdbFetch('/movie/now_playing?region=FR'), 'movie') },
  { id: 'soon', title: '📅 Bientôt au cinéma', ttl: 0.5, load: async () => {
    const today = new Date().toISOString().slice(0, 10);
    return ((await tmdbFetch('/movie/upcoming?region=FR')).results || [])
      .filter(h => h.poster_path && (h.release_date || '') > today)
      .sort((a, b) => a.release_date.localeCompare(b.release_date)).slice(0, 20)
      .map(h => ({ ...slimHit(h, 'movie'), sub: fmtFull(h.release_date) }));
  } },
  { id: 'animeSeason', title: '🌸 Animés de la saison', ttl: 1, key: () => animeSeasonRange().from + ':v3', load: async () => {
    const r = animeSeasonRange();
    const q = `/discover/tv?with_genres=16&with_original_language=ja&air_date.gte=${r.from}&air_date.lte=${r.to}&sort_by=popularity.desc`;
    const pages = await Promise.all([1, 2].map(p => tmdbFetch(q + '&page=' + p).catch(() => ({ results: [] }))));
    const seen = new Set();
    const cand = pages.flatMap(pg => pg.results || []).filter(h => h.poster_path && !seen.has(h.id) && seen.add(h.id)).slice(0, 30);
    const keep = await Promise.all(cand.map(h => tmdbFetch('/tv/' + h.id).then(isSeasonalAnime, () => true)));
    return cand.filter((h, i) => keep[i]).slice(0, 20).map(h => slimHit(h, 'tv'));
  } },
  { id: 'allTv', title: '🏆 Séries les plus vues de tous les temps', ttl: 7, load: async () => slimHits(await tmdbFetch('/discover/tv?sort_by=vote_count.desc'), 'tv') },
  { id: 'allMovie', title: '🏆 Films les plus vus de tous les temps', ttl: 7, load: async () => slimHits(await tmdbFetch('/discover/movie?sort_by=vote_count.desc'), 'movie') },
  { id: 'topTv', title: '⭐ Séries les mieux notées', ttl: 7, load: async () => slimHits(await tmdbFetch('/discover/tv?sort_by=vote_average.desc&vote_count.gte=2000'), 'tv') },
  { id: 'topMovie', title: '⭐ Films les mieux notés', ttl: 7, load: async () => slimHits(await tmdbFetch('/discover/movie?sort_by=vote_average.desc&vote_count.gte=5000'), 'movie') },
];
async function exploreRowHits(row) {
  if (!tmdbCache.explore) tmdbCache.explore = {};
  const key = row.key ? row.key() : '';
  const c = tmdbCache.explore[row.id];
  if (c && c.key === key && Date.now() - (c.at || 0) < row.ttl * MS_DAY) return c.hits;
  const hits = await row.load();
  tmdbCache.explore[row.id] = { at: Date.now(), key, hits };
  scheduleSaveCache();
  return hits;
}
route('explore', async (el) => {
  el.innerHTML = `
    <div class="page-head"><h1>Explorer</h1>${acctBtn()}<span class="sub">Rechercher de nouvelles séries et films à ajouter</span></div>
    ${hasKey() ? `<div class="explore-search"><input class="input" id="expQ" placeholder="Rechercher une série ou un film…" autocomplete="off"></div>
    <div class="exp-genres" id="expGenres"></div>
    <div id="expResults" class="explore-results"></div>`
      : needKeyHtml("L'exploration a besoin d'une clé TMDB pour rechercher des séries et des films.")}`;
  if (!hasKey()) return;
  const ownedKey = ownedLookup();
  const input = el.querySelector('#expQ');
  const results = el.querySelector('#expResults');
  input.value = exploreQuery;
  let rowsTok = 0;
  const showTrending = async () => {
    const tok = ++rowsTok;
    const rows = exploreRowsShown();
    results.innerHTML = rows.map(r => `<div class="exp-section" data-row="${r.id}"><h2>${r.title}</h2><div class="exp-row" id="${r.id}"><div class="loading">Chargement…</div></div></div>`).join('');
    await Promise.all(rows.map(async (r) => {
      let hits = [];
      try { hits = await exploreRowHits(r); } catch {}
      if (tok !== rowsTok || input.value.trim().length >= 2) return;
      const sec = results.querySelector(`[data-row="${r.id}"]`);
      if (!sec) return;
      if (!hits.length) { sec.remove(); return; }
      const row = sec.querySelector('.exp-row');
      row.innerHTML = expHitsHtml(hits, ownedKey);
      wireExpHits(row, hits, ownedKey);
    }));
  };
  // Par genre : Séries / Films + un bouton par genre ; toucher un genre affiche ses titres en grille.
  const genresEl = el.querySelector('#expGenres');
  let genreList = []; // genres TMDB du type affiché (pour la fenêtre « Genres »)
  const curGenre = () => (exploreGenre && exploreGenre.kind === exploreGenreKind ? exploreGenre : null);
  const genreCount = () => { const g = curGenre(); return g ? g.ids.length + (g.anime ? 1 : 0) : 0; };
  // Met à jour le bouton « Genres (n) ».
  const paintGenreChips = () => { const box = genresEl.querySelector('#expGenreBtnBox'); if (box) box.innerHTML = genreBtnHtml('expGenreBtn', genreCount()); wireGenreBtn(); };
  const wireGenreBtn = () => { const b = genresEl.querySelector('#expGenreBtn'); if (b) b.onclick = openGenres; };
  const openGenres = () => {
    const kind = exploreGenreKind, g = curGenre();
    const entries = [{ id: 'anime', label: 'Animé', ico: '🇯🇵' }, ...genreList.map(x => ({ id: String(x.id), label: x.name }))];
    const selected = g ? [...(g.anime ? ['anime'] : []), ...g.ids.map(String)] : [];
    openGenreSheet(entries, selected, (sel) => {
      const first = !exploreGenre;
      const ng = g || { kind, ids: [], names: {}, anime: false, sort: (exploreGenre && exploreGenre.sort) || 'pop' };
      ng.anime = sel.includes('anime');
      ng.ids = sel.filter(x => x !== 'anime').map(Number);
      for (const x of genreList) if (ng.ids.includes(x.id)) ng.names[x.id] = x.name;
      ng.low = false;
      exploreGenre = (ng.ids.length || ng.anime) ? ng : null;
      input.value = ''; exploreQuery = '';
      paintGenreChips(); doSearch();
      if (first && exploreGenre) results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };
  const drawGenres = async () => {
    const kind = exploreGenreKind;
    let list = [];
    try { list = await tmdbGenreList(kind); } catch {}
    if (kind !== exploreGenreKind) return;
    genreList = list;
    genresEl.innerHTML = `<div class="genre-head">
      <span class="chip ${kind === 'tv' ? 'active' : ''}" data-gk="tv">📺 Séries</span><span class="chip ${kind === 'movie' ? 'active' : ''}" data-gk="movie">🎬 Films</span>
      <span id="expGenreBtnBox"></span></div>
      <p class="genre-help">Choisissez plusieurs genres pour les combiner (ex. Action + Comédie).</p>`;
    paintGenreChips();
    genresEl.querySelectorAll('[data-gk]').forEach(ch => ch.onclick = () => {
      if (exploreGenreKind === ch.dataset.gk) return;
      exploreGenreKind = ch.dataset.gk;
      const had = !!exploreGenre; exploreGenre = null;
      drawGenres(); if (had) doSearch();
    });
  };
  const showGenre = async () => {
    const tok = ++rowsTok, g = exploreGenre;
    let page = 1, hits = [];
    results.innerHTML = `<div class="genre-results">
      <div class="genre-res-head"><h2>${esc([...(g.anime ? ['Animé'] : []), ...g.ids.map(id => g.names[id])].join(' + '))} · ${g.kind === 'tv' ? 'Séries' : 'Films'}</h2><span class="chip" id="genreClose" title="Revenir à Explorer">✕ Fermer</span></div>
      <div class="pick-bar" id="genreSort"><button type="button" class="pick-btn" id="genreSortBtn">Trier : ${esc((GENRE_SORTS.find(x => x[0] === g.sort) || GENRE_SORTS[0])[1])} <span class="pick-arrow">▾</span></button></div>
      <div class="ps-grid" id="genreGrid"><div class="loading">Chargement…</div></div>
      <div class="genre-more"><button class="btn" id="genreMore" hidden>Voir plus</button></div></div>`;
    const grid = results.querySelector('#genreGrid'), more = results.querySelector('#genreMore');
    results.querySelector('#genreClose').onclick = () => { exploreGenre = null; paintGenreChips(); doSearch(); };
    results.querySelector('#genreSortBtn').onclick = () => openSortSheet(GENRE_SORTS, g.sort, (k) => { if (k === g.sort) return; g.sort = k; g.low = false; showGenre(); });
    const load = async () => {
      more.disabled = true;
      try {
        let r = await tmdbFetch(discoverPath(g, g.sort, page, g.low));
        if (g.sort === 'top' && page === 1 && !g.low && (r.total_results || 0) < 20) { g.low = true; r = await tmdbFetch(discoverPath(g, g.sort, page, true)); }
        if (tok !== rowsTok) return;
        hits = hits.concat((r.results || []).filter(h => h.poster_path).map(h => slimHit(h, g.kind)));
        if (!hits.length) { grid.innerHTML = '<div class="empty">Aucun titre avec tous ces genres à la fois.</div>'; more.hidden = true; return; }
        grid.innerHTML = expHitsHtml(hits, ownedKey);
        wireExpHits(grid, hits, ownedKey);
        more.hidden = page >= Math.min(r.total_pages || 1, 25);
      } catch { if (tok === rowsTok && !hits.length) grid.innerHTML = '<div class="empty">Erreur de chargement.</div>'; }
      more.disabled = false;
    };
    more.onclick = () => { page++; load(); };
    await load();
  };
  drawGenres();
  let seq = 0, deb = null;
  const doSearch = async () => {
    const term = input.value.trim();
    if (term.length < 2 && exploreGenre) { seq++; await showGenre(); return; }
    if (term.length < 2) { seq++; await showTrending(); return; }
    if (exploreGenre) { exploreGenre = null; paintGenreChips(); }
    const my = ++seq;
    rowsTok++;
    results.innerHTML = `<div class="loading">Recherche…</div>`;
    try {
      const res = await tmdbFetch(`/search/multi?query=${encodeURIComponent(term)}`);
      if (my !== seq) return;
      const hits = (res.results || []).filter(h => h.media_type === 'tv' || h.media_type === 'movie').slice(0, 24);
      if (!hits.length) { results.innerHTML = `<div class="empty">Aucun résultat.</div>`; return; }
      results.innerHTML = `<div class="ps-grid">${expHitsHtml(hits, ownedKey)}</div>`;
      wireExpHits(results, hits, ownedKey);
    } catch { if (my === seq) results.innerHTML = `<div class="empty">Erreur de recherche.</div>`; }
  };
  input.oninput = () => { exploreQuery = input.value; clearTimeout(deb); deb = setTimeout(doSearch, 320); };
  await doSearch();
});

// Read-only preview of a TMDB work (from Explorer) — does NOT add it to the library.
route('preview', async (el, rest) => {
  const kind = rest[0];
  const id = parseInt(rest[1], 10);
  el.innerHTML = `${backBtn('#/explore')}<div id="pv"><div class="loading">Chargement de l'aperçu…</div></div>`;
  const pv = el.querySelector('#pv');
  if (!hasKey()) { pv.innerHTML = needKeyHtml("L'aperçu a besoin d'une clé TMDB."); return; }
  try {
    // Already in my library -> show my own page instead of the preview.
    const ownKey = ownedLookup()({ media_type: kind === 'tv' ? 'tv' : 'movie', id });
    if (ownKey) { replaceRoute((kind === 'tv' ? '#/show/' : '#/movie/') + encodeURIComponent(ownKey)); return; }
    if (kind === 'tv') {
      const meta = await getShowMeta(id);
      const genres = meta.genres.join(' · ');
      pv.innerHTML = `
        <div class="detail-hero title-top" style="margin-top:12px">
          <div class="bg" style="${meta.backdrop ? `background-image:url(${IMG(meta.backdrop, 'w780')})` : ''}"></div>
          <div class="inner">
            <h1>${esc(fullTitle(meta.name, meta.originalName))}</h1>
            <div class="poster">${meta.poster ? `<img src="${IMG(meta.poster, 'w342')}" alt="">` : '<div class="ph">📺</div>'}</div>
            <div>
              <div class="sub">${esc((meta.firstAir || '').slice(0, 4))}${meta.status ? ' · ' + esc(statusFr(meta.status)) : ''} ${genres ? '· ' + esc(genres) : ''}</div>
              <div class="tags"><span class="chip">${meta.totalEpisodes || 0} épisode(s)</span>${meta.vote ? `<span class="chip">⭐ ${meta.vote.toFixed(1)}</span>` : ''}</div>
              <div class="appr-slot" id="apprSlot"></div>
              <div class="overview">${esc(meta.overview || '')}</div>
              <div class="detail-actions"><button class="btn primary" id="pvAdd">＋ Ajouter à mes séries</button></div>
            </div>
          </div>
        </div>
        ${meta.seasons.length ? `<div class="pv-seasons">${meta.seasons.map(s => `<span class="chip">Saison ${s.n} · ${s.count} ép.</span>`).join('')}</div>` : ''}
        ${castHtml(meta.cast)}
        ${trailerHtml(meta.trailer)}
        <div class="about">${relatedSlotHtml()}</div>`;
      wireTrailer(pv);
      fillRelated(pv, 'tv', id);
      renderAppreciation(pv.querySelector('#apprSlot'), 'tv', id, meta);
      pv.querySelector('#pvAdd').onclick = () => { addCustomShow({ id, name: meta.name, poster_path: meta.poster }); replaceRoute('#/show/' + encodeURIComponent('tmdb:' + id)); };
    } else {
      const meta = await getMovieMeta(id);
      const genres = meta.genres.join(' · ');
      const rt = meta.runtime;
      pv.innerHTML = `
        <div class="detail-hero title-top" style="margin-top:12px">
          <div class="bg" style="${meta.backdrop ? `background-image:url(${IMG(meta.backdrop, 'w780')})` : ''}"></div>
          <div class="inner">
            <h1>${esc(fullTitle(meta.title, meta.originalTitle))}</h1>
            <div class="poster">${meta.poster ? `<img src="${IMG(meta.poster, 'w342')}" alt="">` : '<div class="ph">🎬</div>'}</div>
            <div>
              <div class="sub">${esc((meta.release || '').slice(0, 4))}${rt ? ' · ' + Math.floor(rt / 60) + 'h' + String(rt % 60).padStart(2, '0') : ''} ${genres ? '· ' + esc(genres) : ''}${meta.vote ? ' · ⭐ ' + meta.vote.toFixed(1) : ''}</div>
              ${meta.tagline ? `<div class="sub" style="font-style:italic;margin-top:4px">${esc(meta.tagline)}</div>` : ''}
              <div class="appr-slot" id="apprSlot"></div>
              <div class="overview">${esc(meta.overview || '')}</div>
              <div class="detail-actions"><button class="btn primary" id="pvAdd">➕ Ajouter à ma bibliothèque</button></div>
            </div>
          </div>
        </div>
        ${castHtml(meta.cast)}
        ${trailerHtml(meta.trailer)}
        <div class="about">${relatedSlotHtml()}</div>`;
      wireTrailer(pv);
      fillRelated(pv, 'movie', id);
      renderAppreciation(pv.querySelector('#apprSlot'), 'movie', id, meta);
      pv.querySelector('#pvAdd').onclick = () => { replaceRoute('#/movie/' + encodeURIComponent(addCustomMovie({ id, title: meta.title, release_date: meta.release, poster_path: meta.poster }))); };
    }
  } catch { pv.innerHTML = `<div class="empty"><div class="big">⚠️</div>Impossible de charger l'aperçu.</div>`; }
});

// Returns (tmdbHit) -> key of the matching show/movie already in the library, or null.
function ownedLookup() {
  buildModel();
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const showByTmdb = new Map(), showByName = new Map();
  for (const s of MODEL.shows.values()) {
    const tid = s.forcedTmdb || (s.tvdbId != null ? tmdbCache.map[s.tvdbId] : null);
    if (tid != null) showByTmdb.set(String(tid), s.key);
    showByName.set(norm(displayName(s)), s.key);
  }
  const movieByTmdb = new Map(), movieByName = new Map();
  for (const m of (DATA.movies || []).concat(userState.customMovies || [])) {
    const rec = (userState.movieTmdb && userState.movieTmdb[m.name]) || (tmdbCache.movies && tmdbCache.movies[m.name]);
    if (rec && rec.id != null) movieByTmdb.set(String(rec.id), m.name);
    movieByName.set(norm(m.name), m.name);
    if (rec && rec.title && !movieByName.has(norm(rec.title))) movieByName.set(norm(rec.title), m.name);
  }
  return (h) => h.media_type === 'tv'
    ? (showByTmdb.get(String(h.id)) || showByName.get(norm(h.name || h.title || '')) || null)
    : (movieByTmdb.get(String(h.id)) || movieByName.get(norm(h.title || h.name || '')) || null);
}

