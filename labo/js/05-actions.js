/* Mon TV Time — Favoris, listes, vu / revu, épisodes ajoutés */
'use strict';
//////////////////////// Favorites ////////////////////////
function isFavShow(sh) {
  const o = userState.favShows && userState.favShows[sh.key];
  return (o === undefined || o === null) ? !!sh.favorited : !!o;
}
function toggleFavShow(sh) {
  if (!userState.favShows) userState.favShows = {};
  userState.favShows[sh.key] = !isFavShow(sh);
  scheduleSaveState();
}
function isFavMovie(m) {
  const o = userState.favMovies && userState.favMovies[m.name];
  return (o === undefined || o === null) ? !!m.favorited : !!o;
}
function toggleFavMovie(m) {
  if (!userState.favMovies) userState.favMovies = {};
  userState.favMovies[m.name] = !isFavMovie(m);
  scheduleSaveState();
}

//////////////////////// User lists ////////////////////////
function getUserLists() {
  if (!Array.isArray(userState.userLists)) userState.userLists = [];
  return userState.userLists;
}
function createList(name) {
  const l = { id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: (name || 'Nouvelle liste').trim() || 'Nouvelle liste', shows: [], movies: [] };
  getUserLists().push(l); scheduleSaveState(); return l;
}
function renameList(id, name) { const l = getUserLists().find(x => x.id === id); if (l) { l.name = (name || '').trim() || l.name; scheduleSaveState(); } }
function deleteList(id) { userState.userLists = getUserLists().filter(x => x.id !== id); scheduleSaveState(); }
// Ajoute / retire un élément d'une liste ; renvoie true s'il y est maintenant. Toast de retour.
function listToggleShow(id, key) {
  const l = getUserLists().find(x => x.id === id); if (!l) return false;
  if (!Array.isArray(l.shows)) l.shows = [];
  const add = !l.shows.includes(key);
  if (add) l.shows.push(key); else l.shows = l.shows.filter(k => k !== key);
  scheduleSaveState();
  toast(add ? `Ajouté à « ${l.name} »` : `Retiré de « ${l.name} »`);
  return add;
}
function listToggleMovie(id, name) {
  const l = getUserLists().find(x => x.id === id); if (!l) return false;
  if (!Array.isArray(l.movies)) l.movies = [];
  const add = !l.movies.includes(name);
  if (add) l.movies.push(name); else l.movies = l.movies.filter(n => n !== name);
  scheduleSaveState();
  toast(add ? `Ajouté à « ${l.name} »` : `Retiré de « ${l.name} »`);
  return add;
}

// Modal to add a show or a movie to one or more user lists.
function openAddToListModal(kind, ref) {
  const isMovie = kind === 'movie';
  const id = isMovie ? ref.name : ref.key;
  const draw = () => {
    const lists = getUserLists();
    const rows = lists.length ? lists.map(l => {
      const has = isMovie ? (l.movies || []).includes(id) : (l.shows || []).includes(id);
      return `<label class="check-row"><input type="checkbox" data-list="${esc(l.id)}" ${has ? 'checked' : ''}> ${esc(l.name)} <span class="sub" style="margin-left:auto">${(l.shows || []).length + (l.movies || []).length}</span></label>`;
    }).join('') : `<p class="hint" style="color:var(--muted)">Aucune liste. Créez-en une ci-dessous.</p>`;
    showModal(`<h2>Ajouter à une liste</h2>
      <p class="sub">${esc(isMovie ? movieDisplayName(ref) : displayName(ref))}</p>
      <div class="modal-fields" style="max-height:40vh;overflow:auto">${rows}</div>
      <label class="field"><span>Nouvelle liste</span><div style="display:flex;gap:8px"><input class="input" id="newListName" placeholder="Nom de la liste"><button class="btn" id="newListGo">Créer</button></div></label>
      <div class="row"><button class="btn primary" data-close>Terminé</button></div>`,
      (root) => {
        root.querySelectorAll('[data-list]').forEach(c => c.onchange = () => {
          if (isMovie) listToggleMovie(c.dataset.list, id); else listToggleShow(c.dataset.list, id);
        });
        root.querySelector('#newListGo').onclick = () => {
          const name = root.querySelector('#newListName').value.trim();
          if (!name) { toast('Nom requis'); return; }
          const l = createList(name);
          if (isMovie) listToggleMovie(l.id, id); else listToggleShow(l.id, id);
          toast(`Liste « ${l.name} » créée et élément ajouté`);
          draw();
        };
      });
  };
  draw();
}


// First / last personal watch dates for a series (from imported + user-added seen).
function showWatchDates(sh) {
  const dates = [];
  for (const r of DATA.seen || []) {
    const sk = r.showId || ('n:' + r.showName);
    if (sk !== sh.key) continue;
    const kk = epKey(sk, r.season, r.number);
    if (userState.seenRemove[kk]) continue;
    if (r.seenAt) dates.push(r.seenAt);
  }
  for (const [kk, v] of Object.entries(userState.seenAdd)) {
    if (kk.split('|')[0] === sh.key && v && v.at) dates.push(v.at);
  }
  dates.sort();
  return { first: dates[0] || null, last: dates[dates.length - 1] || null, count: dates.length };
}

// --- "À propos" section shared by the show & movie detail pages ---
function infoRow(label, value) {
  if (!value) return '';
  return `<div class="info-row"><span class="info-label">${esc(label)}</span><span class="info-value">${value}</span></div>`;
}
// providersHtml : voir 12-fiches-serie-episode.js (mes plateformes mises en avant)
function castItemHtml(c) {
  return `<div class="cast-item" data-pid="${esc(String(c.id || 0))}" data-pname="${esc(c.name || '')}" role="button" tabindex="0">
      <div class="cast-photo">${c.profile ? `<img loading="lazy" src="${IMG(c.profile, 'w185')}" alt="">` : `<span>${esc((c.name || '?').slice(0, 1))}</span>`}</div>
      <div class="cast-name">${esc(c.name)}</div>
      ${c.character ? `<div class="cast-char">${esc(c.character)}</div>` : ''}
    </div>`;
}
function castHtml(cast) {
  if (!cast || !cast.length) return '';
  return `<div class="about-block"><h3>Distribution</h3><div class="cast-list">${cast.map(castItemHtml).join('')}</div></div>`;
}
function trailerHtml(key) {
  if (!key) return '';
  return `<div class="about-block"><h3>Bande-annonce</h3><div class="trailer" data-yt="${esc(key)}"><button class="trailer-play" type="button">▶ Lire la bande-annonce</button></div></div>`;
}
function wireTrailer(el) {
  el.querySelectorAll('.trailer').forEach(box => {
    const btn = box.querySelector('.trailer-play');
    if (!btn) return;
    btn.onclick = () => {
      const k = box.dataset.yt;
      box.innerHTML = `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(k)}?autoplay=1" title="Bande-annonce" frameborder="0" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>`;
    };
  });
}
function wireTabs(el) {
  const tabs = el.querySelectorAll('.detail-tabs .tab');
  const panels = el.querySelectorAll('.tab-panel');
  tabs.forEach(t => t.onclick = () => {
    tabs.forEach(x => x.classList.toggle('active', x === t));
    panels.forEach(p => p.classList.toggle('active', p.dataset.panel === t.dataset.tab));
  });
}

function fmtFull(d) {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return esc(s);
  const months = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  return `${parseInt(m[3], 10)} ${months[parseInt(m[2], 10) - 1]} ${m[1]}`;
}
function statusFr(s) {
  const map = { 'Returning Series': 'En diffusion', 'Ended': 'Diffusion terminée', 'Canceled': 'Annulée', 'Cancelled': 'Annulée', 'In Production': 'En production', 'Post Production': 'En post-production', 'Planned': 'Prévue', 'Pilot': 'Pilote' };
  return map[s] || s;
}
function infoBlock(rows) {
  return rows ? `<div class="about-block info-block">${rows}</div>` : '';
}
function showAboutHtml(sh, meta) {
  const wd = showWatchDates(sh);
  const seen = sh.seenKeys.size;
  const watchInfo = seen
    ? `${seen} épisode(s) vu(s)` + (wd.first ? ` · du ${fmtFull(wd.first)}` + (wd.last && wd.last !== wd.first ? ` au ${fmtFull(wd.last)}` : '') : '')
    : '';
  const rows = [
    infoRow('Genre', meta.genres.length ? esc(meta.genres.join(', ')) : ''),
    infoRow('Première diffusion', meta.firstAir ? fmtFull(meta.firstAir) : ''),
    infoRow('Statut', meta.status ? esc(statusFr(meta.status)) : ''),
    infoRow('Épisodes', meta.totalEpisodes ? `${sh.seenKeys.size} vus / ${airedTotal(meta)}${meta.totalEpisodes > airedTotal(meta) ? ` (+${meta.totalEpisodes - airedTotal(meta)} à venir)` : ''}` : (sh.seenKeys.size ? `${sh.seenKeys.size} vus` : '')),
    infoRow('Note du public', meta.vote ? `⭐ ${meta.vote.toFixed(1)}/10 <span class="muted">(${meta.voteCount})</span>` : ''),
    infoRow('Mes visionnages', watchInfo),
    infoRow('Revisionnages', showRewatchHistoryHtml(sh)),
  ].join('');
  return `<div class="about">${infoBlock(rows)}${providersHtml(meta.providers)}${castHtml(meta.cast)}${trailerHtml(meta.trailer)}${relatedSlotHtml()}</div>`;
}
function movieAboutHtml(m, meta) {
  const rt = (meta && meta.runtime) || m.runtime;
  const watchedAt = movieWatchedOf(m);
  const rwTxt = rewatchListText(userState.movieRewatchDates && userState.movieRewatchDates[m.name], movieRewatchOf(m));
  const watchInfo = movieStatus(m) === 'watched'
    ? (watchedAt ? `Vu le ${fmtFull(watchedAt)}` : 'Vu (date non enregistrée)') + (rwTxt ? `<br>${rwTxt}` : '')
    : '';
  const rows = [
    infoRow('Genre', meta && meta.genres.length ? esc(meta.genres.join(', ')) : ''),
    infoRow('Sortie', meta && meta.release ? fmtFull(meta.release) : (movieYear(m) ? esc(movieYear(m)) : '')),
    infoRow('Durée', rt ? `${Math.floor(rt / 60)}h${String(rt % 60).padStart(2, '0')}` : ''),
    infoRow('Note du public', meta && meta.vote ? `⭐ ${meta.vote.toFixed(1)}/10 <span class="muted">(${meta.voteCount})</span>` : ''),
    infoRow('Reprise', movieProgressOf(m) ? `${Math.floor(movieProgressOf(m) / 60)}h${String(movieProgressOf(m) % 60).padStart(2, '0')}` + (rt ? ` / ${Math.floor(rt / 60)}h${String(rt % 60).padStart(2, '0')}` : '') + ' vues' : ''),
    infoRow('Mon visionnage', watchInfo),
  ].join('');
  return `<div class="about">${infoBlock(rows)}${providersHtml(meta && meta.providers)}${castHtml(meta && meta.cast)}${trailerHtml(meta && meta.trailer)}${relatedSlotHtml()}</div>`;
}

//////////////////////// Toggle actions ////////////////////////
function isSeen(sh, season, number) { return sh.seenKeys.has(epKey(sh.key, season, number)); }

function toggleSeen(sh, season, number, seen) {
  const k = epKey(sh.key, season, number);
  const currentlySeen = sh.seenKeys.has(k);
  const target = seen != null ? seen : !currentlySeen;
  if (target === currentlySeen) return; // déjà dans l'état demandé : on ne touche à rien (ni date, ni retrait)
  const inBase = !!(MODEL && MODEL.baseKeys && MODEL.baseKeys.has(k)); // épisode de l'export TV Time
  if (target) {
    const firstEver = sh.seenKeys.size === 0; // vraie 1re coche de la série
    sh.seenKeys.add(k);
    sh.followed = true; // marquer un épisode vu suit automatiquement la série
    if (firstEver && userState.watchlist && sh.key in userState.watchlist) delete userState.watchlist[sh.key]; // elle est commencée : le drapeau « ajoutée / retirée » ne sert plus
    unarchiveOnActivity(sh);
    const hadRemove = !!userState.seenRemove[k];
    if (hadRemove) delete userState.seenRemove[k];
    // Hors de l'export (ou numérotation incertaine) : l'épisode n'est pas rendu par la base, il faut un seenAdd.
    if (!hadRemove || !inBase) userState.seenAdd[k] = { at: new Date().toISOString().slice(0, 19).replace('T', ' ') };
  } else {
    sh.seenKeys.delete(k);
    const hadAdd = !!userState.seenAdd[k];
    if (hadAdd) delete userState.seenAdd[k];
    const inExport = !!(MODEL && MODEL.exportKeys && MODEL.exportKeys.has(k)); // vu dans l'export, même si la numérotation est incertaine
    if (!hadAdd || inBase || inExport) userState.seenRemove[k] = true; // un épisode de l'export doit être retiré explicitement
  }
  scheduleSaveState();
  if (MODEL) MODEL.seenCount = computeSeenCount(); // MODEL peut être nul juste après un renouvellement de saison
}
// Copie exacte des données d'une série pour des épisodes donnés + son état (arrêtée, épinglée, « à voir plus tard », revisionnage,
// dernière activité) : « Annuler » (Tout vu / Tout revu / Tout non vu / ✓ Vu des Prochains épisodes) les remet TELLES QUELLES,
// en écrivant userState directement (pas via les setters, qui recréeraient des dates du jour et relanceraient la reprise de la série).
const SNAP_EP_MAPS = ['seenAdd', 'seenRemove', 'rewatch', 'rewatchDates', 'rewatchAt', 'emotions', 'ratings'];
const SNAP_SHOW_MAPS = ['rewatching', 'rewatchTs', 'rewatchActivity', 'archived', 'watchlist', 'pinnedWatching'];
function snapshotEpisodes(sh, keys) {
  const snap = { sh, keys: keys.slice(), ep: {}, show: {}, seen: keys.filter(k => sh.seenKeys.has(k)), archived: sh.archived, followed: sh.followed, lastSeenAt: sh.lastSeenAt };
  for (const m of SNAP_EP_MAPS) { snap.ep[m] = {}; const src = userState[m]; if (src) for (const k of keys) if (k in src) snap.ep[m][k] = JSON.stringify(src[k]); }
  for (const m of SNAP_SHOW_MAPS) { const src = userState[m]; snap.show[m] = (src && sh.key in src) ? JSON.stringify(src[sh.key]) : undefined; }
  return snap;
}
function restoreSnapshot(snap) {
  const sh = snap.sh;
  for (const m of SNAP_EP_MAPS) {
    if (!userState[m]) userState[m] = {};
    for (const k of snap.keys) { if (k in snap.ep[m]) userState[m][k] = JSON.parse(snap.ep[m][k]); else delete userState[m][k]; }
  }
  for (const m of SNAP_SHOW_MAPS) {
    if (!userState[m]) userState[m] = {};
    if (snap.show[m] !== undefined) userState[m][sh.key] = JSON.parse(snap.show[m]); else delete userState[m][sh.key];
  }
  for (const k of snap.keys) { if (snap.seen.includes(k)) sh.seenKeys.add(k); else sh.seenKeys.delete(k); }
  sh.archived = snap.archived; sh.followed = snap.followed; sh.lastSeenAt = snap.lastSeenAt;
  scheduleSaveState();
  MODEL = null; buildModel(); // reconstruit depuis userState (les données ci-dessus font foi)
}
// Réparation (idempotente, à chaque démarrage) : un « Marquer vu » refait sur un épisode déjà vu dans l'export TV Time avait
// créé un seenAdd qui écrasait la vraie date. On retire ces seenAdd en double (séries à numérotation sûre seulement) :
// l'épisode reste vu, avec sa date d'origine.
function repairSeenAddDup() {
  if (!(DATA.seen || []).length || !Object.keys(userState.seenAdd || {}).length) return 0;
  buildModel();
  let n = 0;
  for (const k of Object.keys(userState.seenAdd)) {
    if (MODEL.baseKeys.has(k) && !userState.seenRemove[k]) { delete userState.seenAdd[k]; n++; }
  }
  if (n) { MODEL = null; scheduleSaveState(); console.info(`Réparation : ${n} date(s) d'épisode rétablie(s) d'après l'export TV Time`); }
  return n;
}
function computeSeenCount() {
  if (!MODEL) return 0;
  let c = 0; for (const sh of MODEL.shows.values()) c += sh.seenKeys.size; return c;
}
const epScore = (k) => { if (!MODEL) buildModel(); return reactScore(MODEL.emotionMap.get(k), MODEL.ratingMap.get(k)); };
function setEpScore(sh, season, number, v) {
  const k = epKey(sh.key, season, number), r = reactOfScore(v);
  if (r) { MODEL.emotionMap.set(k, r.id); MODEL.ratingMap.set(k, v); userState.emotions[k] = r.id; userState.ratings[k] = v; }
  else { MODEL.emotionMap.delete(k); MODEL.ratingMap.delete(k); userState.emotions[k] = ''; userState.ratings[k] = 0; }
  scheduleSaveState();
}
const showScore = (sh) => reactScore(null, sh.showRating);
function setShowScore(sh, v) { sh.showRating = v || null; userState.showRatings[sh.key] = v || 0; scheduleSaveState(); }
// Rewatch counts (number of *extra* views beyond the first). Total views = count + 1.
function rewatchOf(sh, season, number) {
  return MODEL.rewatchMap.get(epKey(sh.key, season, number)) || 0;
}
function setRewatch(sh, season, number, count) {
  const k = epKey(sh.key, season, number);
  const c = Math.max(0, count | 0);
  const prev = MODEL.rewatchMap.get(k) || 0;
  if (c > 0) { MODEL.rewatchMap.set(k, c); userState.rewatch[k] = c; }
  else { MODEL.rewatchMap.delete(k); userState.rewatch[k] = 0; }
  // A rewatch implies the episode was seen at least once.
  if (c > 0 && !isSeen(sh, season, number)) toggleSeen(sh, season, number, true);
  if (!userState.rewatchAt) userState.rewatchAt = {};
  if (c > prev) userState.rewatchAt[k] = Date.now();
  else if (c < prev) delete userState.rewatchAt[k];
  logRewatchDates('rewatchDates', k, prev, c);
  // Revisionnage détecté quand on (re)commence depuis le début : 1er épisode, ou suite
  // d'épisodes tous déjà revus avant celui-ci. Un épisode isolé au milieu ne déclenche rien.
  if (c > prev && isShowComplete(sh) && continuesFromStart(sh, season, number, c)) markRewatching(sh, c);
  // Un revisionnage compte comme une activité récente -> la série remonte en tête des « En cours ».
  if (c > prev) {
    unarchiveOnActivity(sh);
    if (!userState.rewatchActivity) userState.rewatchActivity = {};
    userState.rewatchActivity[sh.key] = new Date().toISOString().slice(0, 19).replace('T', ' ');
    sh.lastSeenAt = maxDateStr(sh.lastSeenAt, userState.rewatchActivity[sh.key]);
  }
  scheduleSaveState();
}
function maxDateStr(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return b > a ? b : a;
}
// Seen regular episodes (no specials) in viewing order: [[season, n, key], …].
function regularEps(sh) {
  const eps = [];
  for (const k of sh.seenKeys) {
    const p = k.split('|'); const s = +p[p.length - 2], n = +p[p.length - 1];
    if (s > 0) eps.push([s, n, k]);
  }
  return eps.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
// True if every episode before (season, number) is already seen c+1 times or is part of the current pass.
function continuesFromStart(sh, season, number, c) {
  const pass = currentPass(sh);
  for (const [s, n, k] of regularEps(sh)) {
    if (s === season && n === number) return true;
    if ((MODEL.rewatchMap.get(k) || 0) < c && !(pass && inPassKey(k, pass))) return false;
  }
  return false;
}
// Pass = { level, since } : an episode belongs to it if seen `level`+1 times, or re-watched since the pass started.
function markRewatching(sh, level) {
  if (!userState.rewatching) userState.rewatching = {};
  const cur = isRewatching(sh) ? passInfo(sh) : null;
  if (cur && level <= cur.level) return;
  userState.rewatching[sh.key] = { level: Math.max(1, level | 0), since: Date.now() };
}
function passInfo(sh) {
  const f = userState.rewatching && userState.rewatching[sh.key];
  if (!f) return null;
  if (typeof f === 'object') return f;
  // Ancien format (true) : niveau = nb de visionnages du 1er épisode.
  const eps = regularEps(sh);
  let level = eps.length ? (MODEL.rewatchMap.get(eps[0][2]) || 0) : 0;
  if (level <= 0) for (const [, , k] of eps) level = Math.max(level, MODEL.rewatchMap.get(k) || 0);
  const ts = userState.rewatchTs && userState.rewatchTs[sh.key];
  return { level: Math.max(1, level), since: ts || Infinity };
}
function inPassKey(k, pass) {
  const c = MODEL.rewatchMap.get(k) || 0;
  const at = userState.rewatchAt && userState.rewatchAt[k];
  return c >= pass.level || (c > 0 && !!at && at > pass.since);
}
function rewatchPass(sh) {
  const pass = passInfo(sh);
  if (!pass) return null;
  const eps = regularEps(sh);
  if (!eps.length) return null;
  let done = 0;
  for (const [, , k] of eps) if (inPassKey(k, pass)) done++;
  return { level: pass.level, since: pass.since, done, total: eps.length };
}
// A finished show is "being re-watched" while its current pass isn't complete.
function isRewatching(sh) {
  if (!userState.rewatching || !userState.rewatching[sh.key]) return false;
  if (!isShowComplete(sh)) return false;
  const pass = rewatchPass(sh);
  return !!(pass && pass.done < pass.total); // passage terminé -> revient « Terminée »
}
// Current re-watch pass (null = first viewing: every seen episode counts).
function currentPass(sh) {
  return isRewatching(sh) ? passInfo(sh) : null;
}
function inCurrentPass(sh, season, n, pass) {
  const k = epKey(sh.key, season, n);
  return sh.seenKeys.has(k) && (!pass || inPassKey(k, pass));
}
// Re-tint every episode row of the show page after a change that may shift the pass.
function repaintPass(sh) {
  const pass = currentPass(sh);
  document.querySelectorAll('#seasons .season-body[data-season] .ep[data-n]').forEach(row => {
    const sn = +row.closest('.season-body').dataset.season, n = +row.dataset.n;
    row.classList.toggle('cur', inCurrentPass(sh, sn, n, pass));
  });
}
function movieRewatchOf(m) {
  const o = userState.movieRewatch && userState.movieRewatch[m.name];
  const c = (o != null) ? parseInt(o, 10) : parseInt(m.rewatchCount, 10);
  return c > 0 ? c : 0;
}
function setMovieRewatch(name, count) {
  if (!userState.movieRewatch) userState.movieRewatch = {};
  const m = (DATA.movies || []).concat(userState.customMovies || []).find(x => x.name === name);
  const prev = m ? movieRewatchOf(m) : (parseInt(userState.movieRewatch[name], 10) || 0);
  userState.movieRewatch[name] = Math.max(0, count | 0);
  logRewatchDates('movieRewatchDates', name, prev, userState.movieRewatch[name]);
  scheduleSaveState();
}
// Dates de chaque revisionnage (en plus du 1er visionnage) : userState.rewatchDates[clé d'épisode] et
// userState.movieRewatchDates[nom du film] = ["AAAA-MM-JJ HH:MM:SS", …]. +1 ajoute la date du jour,
// −1 retire la plus récente. Les revisionnages antérieurs à ce suivi n'ont pas de date.
function logRewatchDates(map, key, prev, c) {
  if (c === prev) return;
  if (!userState[map]) userState[map] = {};
  const arr = (userState[map][key] || []).slice();
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  for (let i = prev; i < c; i++) arr.push(now);
  if (c < prev) arr.splice(Math.max(0, arr.length - (prev - c)));
  if (arr.length) userState[map][key] = arr; else delete userState[map][key];
}
// « Revu le 3 oct. 2026, le 28 oct. 2026 » (+ revisionnages sans date) — null si aucun revisionnage.
function rewatchListText(dates, count) {
  if (!(count > 0)) return null;
  const d = (dates || []).slice(-count).sort();
  const undated = count - d.length;
  const parts = d.map(x => 'le ' + fmtFull(x));
  if (undated > 0) parts.unshift(undated + ' fois sans date');
  return 'Revu ' + parts.join(', ');
}
// Date du 1er visionnage d'un épisode (ajout dans l'app, sinon export TV Time).
function episodeSeenAt(sh, season, number) {
  const a = userState.seenAdd[epKey(sh.key, season, number)];
  if (a && a.at) return a.at;
  for (const r of DATA.seen || []) if (String(r.showId) === String(sh.key) && +r.season === +season && +r.number === +number) return r.seenAt || null;
  return null;
}
// Historique des revisionnages d'une série, regroupé par jour (le plus récent d'abord).
function showRewatchHistoryHtml(sh) {
  const byDay = {};
  const pre = sh.key + '|';
  for (const [k, dates] of Object.entries(userState.rewatchDates || {})) {
    if (!k.startsWith(pre)) continue;
    const p = k.split('|'); const s = +p[p.length - 2], n = +p[p.length - 1];
    for (const d of dates) (byDay[d.slice(0, 10)] = byDay[d.slice(0, 10)] || []).push([s, n]);
  }
  const days = Object.keys(byDay).sort().reverse();
  if (!days.length) return '';
  const lab = ([s, n]) => epTag(sh, s, n);
  const line = (day) => {
    const eps = byDay[day].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const txt = eps.length > 4 ? `${lab(eps[0])} → ${lab(eps[eps.length - 1])}` : eps.map(lab).join(', ');
    return `<div>${fmtFull(day)} : ${eps.length} épisode${eps.length > 1 ? 's' : ''} <span class="muted">(${txt})</span></div>`;
  };
  const head = days.slice(0, 5).map(line).join('');
  const more = days.length > 5 ? `<details><summary class="muted" style="cursor:pointer">Voir les ${days.length - 5} autres jours</summary>${days.slice(5).map(line).join('')}</details>` : '';
  return head + more;
}// « Mes séries » pour une série jamais commencée : ajoute (suivie) ou retire. Garde le drapeau interne userState.watchlist
// (true = ajoutée, false = retirée même si l'export TV Time la disait suivie, absent = état de l'export). Renvoie true si ajoutée.
function toggleMyShow(sh) {
  const adding = !sh.followed;
  if (!adding && sh.custom && !confirm('Retirer « ' + displayName(sh) + ' » de vos séries ? Pour la remettre, il faudra la rechercher dans Explorer.')) return null;
  if (!userState.watchlist) userState.watchlist = {};
  if (!adding && sh.custom) { removeCustomShow(sh.key); delete userState.watchlist[sh.key]; } // série ajoutée à la main : on la retire vraiment
  else userState.watchlist[sh.key] = adding;
  MODEL = null; scheduleSaveState();
  return adding;
}
// Après « Retirer de mes séries » d'une série ajoutée à la main, sa fiche n'existe plus : retour à la page Séries.
function afterMyShowToggle(sh, adding) {
  if (adding === null) return; // retrait annulé
  toast(adding ? 'Ajoutée à mes séries' : 'Retirée de mes séries');
  if (!adding && sh.custom && location.hash.startsWith('#/show/')) { replaceRoute('#/home'); return; }
  render();
}
function toggleArchived(sh) {
  sh.archived = !sh.archived;
  userState.archived[sh.key] = sh.archived;
  if (sh.archived && userState.pinnedWatching) delete userState.pinnedWatching[sh.key]; // arrêtée ET épinglée n'a pas de sens
  scheduleSaveState();
}
// Regarder (ou revoir) un épisode d'une série arrêtée la reprend automatiquement.
function unarchiveOnActivity(sh) {
  if (!sh.archived) return;
  sh.archived = false;
  userState.archived[sh.key] = false;
}
function isPinnedWatching(sh) {
  return !!(userState.pinnedWatching && userState.pinnedWatching[sh.key]);
}
function togglePinWatching(sh) {
  if (!userState.pinnedWatching) userState.pinnedWatching = {};
  if (userState.pinnedWatching[sh.key]) delete userState.pinnedWatching[sh.key];
  else userState.pinnedWatching[sh.key] = true;
  scheduleSaveState();
}

//////////////////////// Custom (user-added) episodes ////////////////////////
function customEpsForShow(sh) {
  return (userState.customEpisodes && userState.customEpisodes[sh.key]) || [];
}
function addCustomEpisode(sh, season, number, name) {
  if (!userState.customEpisodes) userState.customEpisodes = {};
  const arr = userState.customEpisodes[sh.key] || (userState.customEpisodes[sh.key] = []);
  if (arr.some(e => e.s === season && e.n === number)) return false;
  arr.push({ s: season, n: number, name: name || '' });
  scheduleSaveState();
  return true;
}
function removeCustomEpisode(sh, season, number) {
  const arr = userState.customEpisodes && userState.customEpisodes[sh.key];
  if (arr) {
    const i = arr.findIndex(e => e.s === season && e.n === number);
    if (i >= 0) { arr.splice(i, 1); scheduleSaveState(); }
  }
  if (isSeen(sh, season, number)) toggleSeen(sh, season, number, false);
}

