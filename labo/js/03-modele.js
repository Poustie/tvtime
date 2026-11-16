/* Mon TV Time — Construction du modèle (séries vues) */
'use strict';
//////////////////////// Build model ////////////////////////
function buildModel() {
  const shows = new Map(); // showKey -> show object
  for (const s of DATA.shows || []) {
    const k = showKey(s);
    shows.set(k, {
      key: k,
      tvdbId: s.tvdbId,
      name: s.name,
      followed: !!s.followed,
      favorited: !!s.favorited,
      archived: (userState.archived[k] != null) ? userState.archived[k] : !!s.archived,
      specialStatus: s.specialStatus,
      showRating: userState.showRatings[k] != null ? userState.showRatings[k] : (s.showRating ? Math.round(parseFloat(s.showRating)) : null),
      createdAt: s.createdAt || '',
      seenKeys: new Set(),
    });
  }
  // User-added shows (planned for the future). Keyed by a synthetic tmdb key.
  for (const cs of userState.customShows || []) {
    const k = cs.key || (cs.tmdbId ? 'tmdb:' + cs.tmdbId : (cs.tvdbId != null ? String(cs.tvdbId) : 'n:' + cs.name));
    if (shows.has(k)) continue;
    shows.set(k, {
      key: k, tvdbId: cs.tvdbId ?? null, forcedTmdb: cs.tmdbId ?? null, name: cs.name, poster: cs.poster || null,
      followed: true, favorited: false,
      archived: (userState.archived[k] != null) ? userState.archived[k] : false,
      specialStatus: null,
      showRating: userState.showRatings[k] != null ? userState.showRatings[k] : null,
      createdAt: cs.addedAt || '',
      seenKeys: new Set(), custom: true,
    });
  }
  const ensure = (id, name) => {
    const k = id || ('n:' + name);
    if (!shows.has(k)) {
      shows.set(k, { key: k, tvdbId: id || null, name, followed: false, favorited: false, archived: false, specialStatus: null, showRating: null, seenKeys: new Set() });
    }
    return shows.get(k);
  };

  // baseline seen
  const baselineSeen = new Set();
  for (const r of DATA.seen || []) {
    if (r.showId == null || r.showId === '') continue; // lignes orphelines (série non identifiée) = artefacts, pas de vrais visionnages
    const sh = ensure(r.showId, r.showName);
    const kk = epKey(sh.key, r.season, r.number);
    baselineSeen.add(kk);
    sh.seenKeys.add(kk);
  }

  // Anime & co. : TV Time découpe souvent une série en « saisons »-arcs (chacune
  // renumérotée dès 1) alors que TMDB utilise un autre découpage. On réaligne les
  // épisodes vus importés (baseline) sur la numérotation TMDB par ordre absolu.
  for (const sh of shows.values()) {
    if (sh.seenKeys.size === 0) continue;
    const meta = metaFor(sh);
    sh.alignState = (meta && meta.seasons && meta.seasons.length) ? alignSeenToTmdb(sh, meta) : 'nometa';
  }

  // Clés de l'export réellement vues (après réalignement, avant retraits/ajouts) des séries dont la numérotation est
  // SÛRE (aucun réalignement, toutes les saisons en cache) : sert à toggleSeen et à la réparation des seenAdd en double.
  const baseKeys = new Set();
  for (const sh of shows.values()) if (sh.alignState === 'stable') for (const kk of sh.seenKeys) baseKeys.add(kk);
  // Toutes les clés vues de l'export (même séries à numérotation incertaine) : pour décocher un épisode qui vient de l'export.
  const exportKeys = new Set();
  for (const sh of shows.values()) for (const kk of sh.seenKeys) exportKeys.add(kk);

  // apply user removals / additions
  for (const kk of Object.keys(userState.seenRemove)) baselineSeen.delete(kk);
  for (const kk of Object.keys(userState.seenAdd)) baselineSeen.add(kk);

  // recompute per-show seenKeys with overrides
  for (const sh of shows.values()) {
    for (const kk of Array.from(sh.seenKeys)) if (userState.seenRemove[kk]) sh.seenKeys.delete(kk);
  }
  for (const kk of Object.keys(userState.seenAdd)) {
    const sk = kk.split('|')[0];
    // find show by key prefix
    for (const sh of shows.values()) { if (sh.key === sk) { sh.seenKeys.add(kk); break; } }
  }

  // A show with any watched episode is automatically "followed".
  for (const sh of shows.values()) if (sh.seenKeys.size > 0) sh.followed = true;
  // « Mes séries » (séries jamais commencées) : watchlist[clé] = true → ajoutée ; false → retirée (même si l'export la marquait suivie).
  for (const sh of shows.values()) if (sh.seenKeys.size === 0 && userState.watchlist && typeof userState.watchlist[sh.key] === 'boolean') sh.followed = userState.watchlist[sh.key];

  // seen timestamps map for activity
  const seenDates = [];
  for (const r of DATA.seen || []) {
    if (r.showId == null || r.showId === '') continue;
    const kk = epKey(r.showId, r.season, r.number);
    if (!userState.seenRemove[kk] && r.seenAt) seenDates.push(r.seenAt);
  }
  for (const kk of Object.keys(userState.seenAdd)) { if (userState.seenAdd[kk].at) seenDates.push(userState.seenAdd[kk].at); }

  // per-show last activity date (latest seenAt across baseline + user additions)
  const showLast = {};
  for (const r of DATA.seen || []) {
    if (r.showId == null || r.showId === '') continue;
    const sk = r.showId;
    const kk = epKey(sk, r.season, r.number);
    if (userState.seenRemove[kk]) continue;
    if (r.seenAt && (!showLast[sk] || r.seenAt > showLast[sk])) showLast[sk] = r.seenAt;
  }
  for (const [kk, v] of Object.entries(userState.seenAdd)) {
    const sk = kk.split('|')[0];
    const at = v && v.at;
    if (at && (!showLast[sk] || at > showLast[sk])) showLast[sk] = at;
  }
  for (const sh of shows.values()) sh.lastSeenAt = showLast[sh.key] || null;
  // Un revisionnage récent (sans nouvelle date « vu ») compte aussi comme activité pour le tri.
  for (const sh of shows.values()) {
    const ra = userState.rewatchActivity && userState.rewatchActivity[sh.key];
    if (ra) sh.lastSeenAt = maxDateStr(sh.lastSeenAt, ra);
  }

  // emotions/reactions (baseline overlaid by user). TV Time's "star-meter"
  // votes (episodeRatings) are reactions too, so fold them into the reactions.
  const emotionMap = new Map();
  for (const r of DATA.emotions || []) emotionMap.set(keyFromRecord(r), String(r.emotionId));
  for (const r of DATA.episodeRatings || []) { const k = keyFromRecord(r); if (r.rating != null && r.rating !== '' && !emotionMap.has(k)) emotionMap.set(k, String(r.rating)); }
  for (const [k, v] of Object.entries(userState.emotions)) { if (v) emotionMap.set(k, v); else emotionMap.delete(k); }

  // manual episode star ratings (user-set only; TV Time stored no real star notes)
  const ratingMap = new Map();
  for (const [k, v] of Object.entries(userState.ratings)) { if (v) ratingMap.set(k, v); else ratingMap.delete(k); }

  // rewatch counts (baseline from DATA.rewatched, overlaid by user)
  const rewatchMap = new Map();
  for (const r of DATA.rewatched || []) {
    const c = parseInt(r.count, 10);
    if (c > 0) rewatchMap.set(epKey((r.showId || ('n:' + r.showName)), r.season, r.number), c);
  }
  for (const [k, v] of Object.entries(userState.rewatch || {})) {
    const c = parseInt(v, 10);
    if (c > 0) rewatchMap.set(k, c); else rewatchMap.delete(k);
  }

  MODEL = {
    shows,
    seenCount: baselineSeen.size,
    baseKeys,
    exportKeys,
    seenDates,
    emotionMap,
    ratingMap,
    rewatchMap,
  };
  return MODEL;
}

// Remap a show's imported seen episodes onto TMDB's season numbering by absolute
// order. Only when TV Time used more seasons than TMDB (arc-based anime splits).
// Non-destructive (in-memory) and idempotent: once keys are in TMDB coords the
// season structure matches and this becomes a no-op.
function alignSeenToTmdb(sh, meta) {
  const tmdbSeasons = (meta.seasons || []).filter(s => s.n > 0).sort((a, b) => a.n - b.n);
  if (!tmdbSeasons.length) return 'nometa';
  // Flatten TMDB episodes in aired order. Use their REAL episode numbers when the
  // season lists are cached (anime often number continuously, e.g. season 2 = ep
  // 33..53); otherwise fall back to 1..count.
  const allCached = tmdbSeasons.every(se => (tmdbCache.seasons[meta.id + '|' + se.n] || []).length);
  const flat = []; const valid = new Set();
  for (const se of tmdbSeasons) {
    if (allCached) { for (const e of tmdbCache.seasons[meta.id + '|' + se.n]) { flat.push(se.n + '|' + e.n); valid.add(se.n + '|' + e.n); } }
    else { for (let n = 1; n <= se.count; n++) { flat.push(se.n + '|' + n); valid.add(se.n + '|' + n); } }
  }
  // Already (mostly) aligned with the displayed episodes? -> leave it (idempotent).
  let mapped = 0, total = 0;
  for (const k of sh.seenKeys) {
    const p = k.split('|'); const S = +p[p.length - 2], N = +p[p.length - 1];
    if (S <= 0) continue;
    total++;
    if (valid.has(S + '|' + N)) mapped++;
  }
  if (!total || mapped / total >= 0.85) return allCached ? 'stable' : 'pending'; // 'pending' : saisons pas toutes en cache, le résultat peut changer
  // (ci-dessous : réalignement effectué -> 'changed')
  // Absolute-order remap: the k-th watched episode (by TV Time season/number)
  // becomes the k-th TMDB episode.
  const tvSize = {};
  for (const k of sh.seenKeys) {
    const p = k.split('|'); const S = +p[p.length - 2], N = +p[p.length - 1];
    if (S <= 0) continue;
    tvSize[S] = Math.max(tvSize[S] || 0, N);
  }
  const tvSeasons = Object.keys(tvSize).map(Number).sort((a, b) => a - b);
  const tvOffset = {}; let acc = 0;
  for (const s of tvSeasons) { tvOffset[s] = acc; acc += tvSize[s]; }
  const out = new Set();
  for (const k of sh.seenKeys) {
    const p = k.split('|'); const S = +p[p.length - 2], N = +p[p.length - 1];
    if (S <= 0) { out.add(k); continue; }
    const t = flat[tvOffset[S] + N - 1];
    out.add(t ? (sh.key + '|' + t) : k);
  }
  sh.seenKeys = out;
  return 'changed';
}



