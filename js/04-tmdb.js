/* Mon TV Time — TMDB */
'use strict';
//////////////////////// TMDB ////////////////////////
function hasKey() { return !!userState.tmdbKey; }

async function tmdbFetch(path, lang = 'fr-FR') {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${TMDB}${path}${sep}api_key=${encodeURIComponent(userState.tmdbKey)}&language=${lang}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('TMDB ' + r.status);
  return r.json();
}

async function resolveTmdbId(tvdbId) {
  if (!tvdbId) return null;
  if (tvdbId in tmdbCache.map) return tmdbCache.map[tvdbId];
  // « Introuvable » (null) n'est mémorisé que si TMDB a répondu SANS résultat : jamais sur une erreur
  // réseau / HTTP (clé invalide, 429, 5xx, hors-ligne), qui sera simplement retentée plus tard.
  const t = _resolveFailAt.get(tvdbId);
  if (t && Date.now() - t < 60000) return null; // erreur récente : on ne martèle pas TMDB
  try {
    const res = await tmdbFetch(`/find/${tvdbId}?external_source=tvdb_id`);
    const hit = (res.tv_results && res.tv_results[0]) || null;
    tmdbCache.map[tvdbId] = hit ? hit.id : null;
    _resolveFailAt.delete(tvdbId);
  } catch { _resolveFailAt.set(tvdbId, Date.now()); return null; }
  scheduleSaveCache();
  return tmdbCache.map[tvdbId];
}
const _resolveFailAt = new Map(); // tvdbId -> date de la dernière erreur de résolution (mémoire seulement)

// Listes d'épisodes d'une saison. Copie en cache réutilisée sauf si elle est périmée (voir seasonStale) ;
// tmdbCache.seasonsAt[clé] = date du téléchargement. Une liste vide n'est JAMAIS mémorisée. Hors-ligne / erreur : copie en cache.
// force = re-télécharger maintenant (bouton « Actualiser » de Prochains épisodes).
let _seasonVer = 0;                // +1 quand une liste change (invalide les calculs mémorisés)
const _seasonTry = new Map();      // clé -> { at, ok } dernier essai de téléchargement (mémoire) : pas plus d'un essai / 10 min
const SEASON_TTL = 24 * 3600 * 1000;        // saison en cours de diffusion : copie valable 24 h
function isRunningMeta(meta) { return !!meta && (meta.status === 'Returning Series' || meta.status === 'In Production' || !!meta.nextAir); }
// Saison « utile » d'une série en cours : la dernière, ou celle de l'épisode diffusé en dernier.
function isLiveSeason(meta, sn) {
  if (!isRunningMeta(meta)) return false;
  const nums = (meta.seasons || []).map(s => s.n).filter(n => n > 0);
  return sn === Math.max(0, ...nums) || !!(meta.lastEp && meta.lastEp.s === sn);
}
function seasonStale(tmdbId, sn, cached) {
  const meta = tmdbCache.shows[tmdbId];
  if (!meta) return false;
  const se = (meta.seasons || []).find(s => s.n === sn);
  if (se && se.count > cached.length) return true;                                                // TMDB annonce plus d'épisodes
  if (meta.lastEp && meta.lastEp.s === sn && cached.every(e => e.n < meta.lastEp.n)) return true; // dernier épisode diffusé absent
  const at = (tmdbCache.seasonsAt || {})[tmdbId + '|' + sn] || 0;
  if (isLiveSeason(meta, sn) && Date.now() - at > SEASON_TTL) return true;                        // saison en cours : copie > 24 h
  return false;
}
const _seasonFlight = new Map(); // clé -> téléchargement en cours, partagé par les appelants simultanés
let _seasonResetT = null;
// Une liste de saison a changé de numérotation / taille : on reconstruit le modèle (volets pré-rendus mis à jour), une seule fois.
function seasonsRenumbered() {
  _seasonVer++; _dataVer++;
  if (typeof _splitMaps !== 'undefined') _splitMaps.clear();
  clearTimeout(_seasonResetT);
  _seasonResetT = setTimeout(() => { MODEL = null; try { buildModel(); } catch {} }, 400);
}
// Y a-t-il des épisodes vus / réactions / revisionnages de cette saison, pour une série liée à cet id TMDB ?
function seasonHasUserData(tmdbId, sn) {
  buildModel();
  for (const sh of MODEL.shows.values()) {
    if (String(showTmdbIdOf(sh)) !== String(tmdbId)) continue;
    const pre = sh.key + '|' + sn + '|';
    for (const k of sh.seenKeys) if (k.startsWith(pre)) return true;
    for (const mp of [MODEL.emotionMap, MODEL.ratingMap, MODEL.rewatchMap]) for (const [k, v] of mp) if (v && k.startsWith(pre)) return true;
  }
  return false;
}
async function getSeasonEpisodes(tmdbId, seasonNumber, force) {
  const ck = tmdbId + '|' + seasonNumber;
  const cached = tmdbCache.seasons[ck];
  const have = !!(cached && cached.length);
  if (!force && have && !seasonStale(tmdbId, seasonNumber, cached)) return cached;
  const flying = _seasonFlight.get(ck);
  if (flying) return flying; // même téléchargement pour tous les appelants simultanés
  const tried = _seasonTry.get(ck);
  if (!force && tried && Date.now() - tried.at < 600000) {
    if (cached) return cached;
    if (!tried.ok) throw new Error('TMDB : saison indisponible (essai récent échoué)'); // pas de [] trompeur
    return []; // TMDB a répondu : saison sans épisodes connus
  }
  const p = (async () => {
    let d;
    try { d = await tmdbFetch(`/tv/${tmdbId}/season/${seasonNumber}`); }
    catch (e) { _seasonTry.set(ck, { at: Date.now(), ok: false }); if (cached) return cached; throw e; }
    _seasonTry.set(ck, { at: Date.now(), ok: true });
    const eps = (d.episodes || []).map(e => ({
      n: e.episode_number, name: e.name, air: e.air_date,
      runtime: e.runtime, still: e.still_path, overview: e.overview,
    }));
    if (!eps.length) return cached || []; // liste vide : pas mémorisée (saison à venir sans épisodes connus), retentée plus tard
    if (!tmdbCache.seasonsAt) tmdbCache.seasonsAt = {};
    const sameNums = have && cached.length === eps.length && cached.every((e, i) => e.n === eps[i].n);
    if (have && !sameNums) {
      // Nouvelle liste raccourcie / renumérotée : acceptée seulement si elle contient tous les anciens numéros,
      // ou si rien de vu / noté / revu dans cette saison ; sinon on garde l'ancienne copie.
      const superset = cached.every(e => eps.some(x => x.n === e.n));
      if (!superset && seasonHasUserData(tmdbId, seasonNumber)) {
        console.warn(`Saison ${ck} : nouvelle liste TMDB (${eps.length} ép.) ignorée, l'ancienne (${cached.length} ép.) contient des épisodes vus / notés`);
        tmdbCache.seasonsAt[ck] = Date.now(); scheduleSaveCache();
        return cached;
      }
    }
    const airChanged = have && !sameNums ? false : (have && cached.some((e, i) => e.air !== eps[i].air));
    tmdbCache.seasons[ck] = eps; tmdbCache.seasonsAt[ck] = Date.now(); scheduleSaveCache();
    if (have && !sameNums) seasonsRenumbered();
    else if (!have || airChanged) { _seasonVer++; if (typeof _splitMaps !== 'undefined') _splitMaps.clear(); }
    return eps;
  })();
  _seasonFlight.set(ck, p);
  try { return await p; } finally { _seasonFlight.delete(ck); }
}

// Full detail for one episode (synopsis, air date, runtime, public rating, guests).
async function getEpisodeMeta(tmdbId, season, n, force) {
  if (!tmdbCache.episodes) tmdbCache.episodes = {};
  const ck = tmdbId + '|' + season + '|' + n;
  if (!force && tmdbCache.episodes[ck] && 'vote' in tmdbCache.episodes[ck]) return tmdbCache.episodes[ck];
  const d = await tmdbFetch(`/tv/${tmdbId}/season/${season}/episode/${n}`);
  const meta = {
    name: d.name, overview: d.overview, air: d.air_date, runtime: d.runtime,
    still: d.still_path, vote: d.vote_average || null, voteCount: d.vote_count || 0,
    guests: (d.guest_stars || []).slice(0, 12).map(c => ({ id: c.id, name: c.name, character: c.character || '', profile: c.profile_path || null })),
  };
  tmdbCache.episodes[ck] = meta; scheduleSaveCache();
  return meta;
}

async function getShowMeta(tmdbId, force) {
  if (!force && tmdbCache.shows[tmdbId] && tmdbCache.shows[tmdbId].cast && ('originalName' in tmdbCache.shows[tmdbId] || titleMode() === 'fr')) return tmdbCache.shows[tmdbId];
  const d = await tmdbFetch(`/tv/${tmdbId}?append_to_response=credits,videos,watch/providers`);
  const meta = {
    id: tmdbId, name: d.name, originalName: d.original_name || null, poster: d.poster_path, backdrop: d.backdrop_path,
    overview: d.overview, firstAir: d.first_air_date, status: d.status,
    runtime: (d.episode_run_time && d.episode_run_time[0]) || null,
    genres: (d.genres || []).map(g => g.name), lang: d.original_language || null,
    seasons: (d.seasons || []).filter(s => s.season_number > 0).map(s => ({ n: s.season_number, count: s.episode_count })),
    totalEpisodes: d.number_of_episodes,
    lastAir: (d.last_episode_to_air && d.last_episode_to_air.air_date) || null,
    lastEp: d.last_episode_to_air ? { s: d.last_episode_to_air.season_number, n: d.last_episode_to_air.episode_number } : null,
    fetchedAt: Date.now(),
    nextAir: (d.next_episode_to_air && d.next_episode_to_air.air_date) || null,
    vote: d.vote_average || null, voteCount: d.vote_count || 0,
    cast: extractCast(d.credits),
    trailer: pickTrailer(d.videos),
    providers: extractProviders(d['watch/providers']),
  };
  if (!meta.trailer) meta.trailer = await trailerFallback('tv', tmdbId);
  tmdbCache.shows[tmdbId] = meta; scheduleSaveCache();
  return meta;
}

async function getMovieMeta(tmdbId, force) {
  if (!tmdbCache.movieMeta) tmdbCache.movieMeta = {};
  if (!force && tmdbCache.movieMeta[tmdbId] && tmdbCache.movieMeta[tmdbId].cast && ('originalTitle' in tmdbCache.movieMeta[tmdbId] || titleMode() === 'fr')) return tmdbCache.movieMeta[tmdbId];
  const d = await tmdbFetch(`/movie/${tmdbId}?append_to_response=credits,videos,watch/providers`);
  const meta = {
    id: tmdbId, title: d.title, originalTitle: d.original_title || null, poster: d.poster_path, backdrop: d.backdrop_path,
    overview: d.overview, release: d.release_date, runtime: d.runtime,
    genres: (d.genres || []).map(g => g.name), lang: d.original_language || null, vote: d.vote_average || null,
    voteCount: d.vote_count || 0, tagline: d.tagline,
    cast: extractCast(d.credits),
    trailer: pickTrailer(d.videos),
    providers: extractProviders(d['watch/providers']),
  };
  if (!meta.trailer) meta.trailer = await trailerFallback('movie', tmdbId);
  tmdbCache.movieMeta[tmdbId] = meta; scheduleSaveCache();
  return meta;
}

// --- extract enrichment sub-objects from a TMDB response ---
function extractCast(credits) {
  return ((credits && credits.cast) || []).slice(0, 18)
    .map(c => ({ id: c.id, name: c.name, character: c.character || '', profile: c.profile_path || null }));
}
function pickTrailer(videos) {
  const r = (videos && videos.results) || [];
  const yt = r.filter(v => v.site === 'YouTube');
  const best = yt.find(v => v.type === 'Trailer' && v.official)
    || yt.find(v => v.type === 'Trailer')
    || yt.find(v => v.type === 'Teaser') || yt[0];
  return best ? best.key : null;
}
async function trailerFallback(kind, id) {
  try { return pickTrailer(await tmdbFetch(`/${kind}/${id}/videos`, 'en-US')); }
  catch { return null; }
}
function extractProviders(wp) {
  const fr = wp && wp.results && wp.results.FR;
  if (!fr) return null;
  const uniq = (arr) => { const seen = {}, out = []; for (const p of arr || []) { if (!seen[p.provider_id]) { seen[p.provider_id] = 1; out.push({ id: p.provider_id, name: p.provider_name, logo: p.logo_path }); } } return out; };
  const flat = uniq((fr.flatrate || []).concat(fr.free || [], fr.ads || []));
  const rent = uniq(fr.rent), buy = uniq(fr.buy);
  if (!flat.length && !rent.length && !buy.length) return null;
  return { link: fr.link || null, flatrate: flat, rent, buy };
}

function movieRatingOf(m) {
  // ma note manuelle uniquement ; les codes importés de TV Time sont des réactions, pas des étoiles
  const o = userState.movieRatings && userState.movieRatings[m.name];
  const n = parseInt(o, 10);
  return isFinite(n) ? Math.max(0, Math.min(5, n)) : 0;
}
function movieEmotionOf(m) {
  const o = userState.movieEmotions && userState.movieEmotions[m.name];
  if (o !== undefined) return o || null; // '' = réaction effacée
  return (m.rating != null && m.rating !== '') ? String(m.rating) : null; // import TV Time
}
const movieScore = (m) => reactScore(movieEmotionOf(m), movieRatingOf(m));
function setMovieScore(m, v) {
  const r = reactOfScore(v);
  if (!userState.movieEmotions) userState.movieEmotions = {};
  if (!userState.movieRatings) userState.movieRatings = {};
  userState.movieEmotions[m.name] = r ? r.id : '';
  userState.movieRatings[m.name] = r ? v : 0;
  scheduleSaveState();
}
function movieWatchedOf(m) {
  return (userState.movieWatchedAt && userState.movieWatchedAt[m.name]) || m.watchedAt || null;
}
// Minutes already watched of a movie you paused mid-way (resume point).
function movieProgressOf(m) {
  const v = userState.movieProgress && userState.movieProgress[m.name];
  const n = parseInt(v, 10);
  return isFinite(n) && n > 0 ? n : 0;
}
function setMovieProgress(name, minutes) {
  if (!userState.movieProgress) userState.movieProgress = {};
  const n = parseInt(minutes, 10);
  if (isFinite(n) && n > 0) userState.movieProgress[name] = n;
  else delete userState.movieProgress[name];
  scheduleSaveState();
}
// Partial-watch bar for a movie card (only for in-progress, not-yet-watched films).
function movieCardProgress(m) {
  if (movieStatus(m) === 'watched') return null;
  const mins = movieProgressOf(m);
  if (!mins) return null;
  const rt = parseInt(m.runtime, 10);
  const total = (isFinite(rt) && rt > 0) ? rt : MOVIE_DEFAULT_RUNTIME;
  return { pct: Math.max(4, Math.min(99, Math.round(mins / total * 100))), cls: 'orange' };
}

