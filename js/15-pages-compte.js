/* Mon TV Time — Acteur, Mon compte, notes de version, stats, listes, réglages */
'use strict';
//////////////////////// Fiche acteur ////////////////////////
async function getPersonMeta(id) {
  if (!tmdbCache.people) tmdbCache.people = {};
  const c = tmdbCache.people[id];
  if (c && Date.now() - (c.at || 0) < 30 * MS_DAY) return c;
  const d = await tmdbFetch(`/person/${id}?append_to_response=combined_credits,external_ids`);
  let bio = d.biography || '';
  if (!bio) { try { bio = (await tmdbFetch(`/person/${id}`, 'en-US')).biography || ''; } catch {} }
  const seen = new Set();
  const credits = ((d.combined_credits && d.combined_credits.cast) || [])
    .filter(x => (x.media_type === 'tv' || x.media_type === 'movie') && !(x.genre_ids || []).some(g => g === 10767 || g === 10763))
    .filter(x => { const k = x.media_type + x.id; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))
    .slice(0, 40)
    .map(x => ({ media_type: x.media_type, id: x.id, name: x.name || x.title || '', year: (x.first_air_date || x.release_date || '').slice(0, 4), poster: x.poster_path || null, character: x.character || '' }));
  const p = {
    at: Date.now(), id, name: d.name, profile: d.profile_path || null, bio,
    birthday: d.birthday || null, deathday: d.deathday || null, place: d.place_of_birth || '',
    dept: d.known_for_department || '', gender: d.gender || 0,
    imdb: (d.external_ids && d.external_ids.imdb_id) || d.imdb_id || null, credits,
  };
  tmdbCache.people[id] = p; scheduleSaveCache();
  return p;
}
function personRole(p) {
  const f = p.gender === 1;
  const map = { Acting: f ? 'Actrice' : 'Acteur', Directing: f ? 'Réalisatrice' : 'Réalisateur', Writing: f ? 'Scénariste' : 'Scénariste', Production: f ? 'Productrice' : 'Producteur' };
  return map[p.dept] || p.dept || '';
}
function ageBetween(from, to) {
  const a = new Date(from), b = to ? new Date(to) : new Date();
  if (isNaN(a) || isNaN(b)) return null;
  let y = b.getFullYear() - a.getFullYear();
  if (b.getMonth() < a.getMonth() || (b.getMonth() === a.getMonth() && b.getDate() < a.getDate())) y--;
  return y;
}
route('person', async (el, rest) => {
  let id = parseInt(rest[0], 10) || 0;
  const name = decodeURIComponent(rest.slice(1).join('/'));
  const wiki = `https://fr.wikipedia.org/w/index.php?search=${encodeURIComponent(name)}`;
  el.innerHTML = `${backBtn('#/home')}<div id="ps"><div class="loading">Chargement…</div></div>`;
  const box = el.querySelector('#ps');
  const fallback = (msg) => `<div class="empty">${msg}<br><br><a class="btn" href="${esc(wiki)}" target="_blank" rel="noopener">Ouvrir Wikipédia ↗</a></div>`;
  if (!hasKey()) { box.innerHTML = fallback(`Pas de clé TMDB : impossible d'afficher la fiche de ${esc(name)}.`); return; }
  try {
    if (!id && name) {
      const r = await tmdbFetch(`/search/person?query=${encodeURIComponent(name)}`);
      id = r.results && r.results[0] ? r.results[0].id : 0;
    }
    if (!id) { box.innerHTML = fallback(`Aucune fiche trouvée pour ${esc(name)}.`); return; }
    const p = await getPersonMeta(id);
    const age = p.birthday ? ageBetween(p.birthday, p.deathday) : null;
    const f = p.gender === 1;
    const rows = [
      infoRow(f ? 'Née' : 'Né', p.birthday ? fmtFull(p.birthday) + (p.place ? ` à ${esc(p.place)}` : '') : ''),
      infoRow(f ? 'Décédée' : 'Décédé', p.deathday ? fmtFull(p.deathday) : ''),
    ].join('');
    const ownedKey = ownedLookup();
    const credits = p.credits.map(c => { const owned = ownedKey(c); return { ...c, owned, st: owned ? ownedState(c.media_type === 'tv' ? 'tv' : 'movie', owned) : null }; })
      .sort((a, b) => (b.owned ? 1 : 0) - (a.owned ? 1 : 0));
    box.innerHTML = `
      <div class="person-hero">
        <div class="person-photo">${p.profile ? `<img src="${IMG(p.profile, 'w342')}" alt="">` : esc((p.name || '?').slice(0, 1))}</div>
        <div>
          <h1>${esc(p.name)}</h1>
          <div class="sub">${esc(personRole(p))}${age != null ? ` · ${age} ans` : ''}</div>
          <div class="detail-actions">
            <a class="btn" href="${esc(wiki)}" target="_blank" rel="noopener">Wikipédia ↗</a>
            ${p.imdb ? `<a class="btn ghost" href="https://www.imdb.com/name/${encodeURIComponent(p.imdb)}/" target="_blank" rel="noopener">IMDb ↗</a>` : ''}
          </div>
        </div>
      </div>
      <div class="about" style="margin-top:16px">
        ${infoBlock(rows)}
        ${p.bio ? `<div class="about-block"><h3>Biographie</h3><p class="synopsis-text bio clamp">${esc(p.bio)}</p><button class="btn sm ghost" id="bioMore">Lire la suite</button></div>` : ''}
        ${credits.length ? `<div class="about-block"><h3>Filmographie</h3><div class="ps-grid">${credits.map((c, i) => `
          <div class="exp-hit${c.owned ? ' owned ' + c.st.cls : ''}" data-open="${i}">
            <div class="ps-poster">${c.poster ? `<img loading="lazy" src="${IMG(c.poster, 'w185')}" alt="">` : `<div class="fallback-title">${esc(c.name)}</div>`}<span class="badge-tag">${c.media_type === 'tv' ? '📺 Série' : '🎬 Film'}</span>${c.owned ? ownedBadgeHtml(c.st) : ''}</div>
            <div class="ps-name">${esc(c.name)}${c.year ? ` <span>(${c.year})</span>` : ''}</div>
            ${c.character ? `<div class="ps-char">${esc(c.character)}</div>` : ''}
          </div>`).join('')}</div></div>` : ''}
      </div>`;
    const more = box.querySelector('#bioMore');
    if (more) more.onclick = () => { const b = box.querySelector('.bio'); const open = b.classList.toggle('clamp'); more.textContent = open ? 'Lire la suite' : 'Réduire'; };
    box.querySelectorAll('.exp-hit').forEach(card => card.onclick = () => {
      const c = credits[parseInt(card.dataset.open, 10)];
      if (c.owned && c.media_type === 'tv') { openShow(c.owned); return; }
      if (c.owned) { openMovie(c.owned); return; }
      navTo('#/preview/' + c.media_type + '/' + c.id);
    });
  } catch { box.innerHTML = fallback(`Impossible de charger la fiche de ${esc(name)}.`); }
});

//////////////////////// Profil (hub) ////////////////////////
// Les N derniers épisodes / films vus, du plus récent au plus ancien. Dates réelles seulement (statValidDay écarte 1970 / 0001) :
// épisodes = DATA.seen[].seenAt (export TV Time) et userState.seenAdd[clé].at (ajouts faits dans l'app) ; films = movieWatchedOf (movieWatchedAt ou export).
function recentViews(limit) {
  buildModel();
  const evs = new Map();
  for (const r of DATA.seen || []) {
    if (r.showId == null || r.showId === '') continue;
    const kk = epKey(r.showId, r.season, r.number);
    if (userState.seenRemove[kk] || !statValidDay(r.seenAt)) continue;
    const o = evs.get(kk), at = String(r.seenAt);
    if (!o || at < o.at) evs.set(kk, { t: 'e', sk: r.showId, s: r.season, n: r.number, at });
  }
  for (const [kk, v] of Object.entries(userState.seenAdd || {})) {
    if (!v || !statValidDay(v.at)) continue;
    const p = kk.split('|');
    evs.set(kk, { t: 'e', sk: p.slice(0, -2).join('|'), s: +p[p.length - 2], n: +p[p.length - 1], at: String(v.at) });
  }
  const bySh = new Map(); // une seule carte par série : son épisode vu le plus récemment + le nombre d'épisodes
  for (const e of evs.values()) {
    const sh = MODEL.shows.get(e.sk);
    if (!sh || !sh.seenKeys.has(epKey(e.sk, e.s, e.n))) continue;
    const g = bySh.get(e.sk);
    if (!g) bySh.set(e.sk, Object.assign({}, e, { count: 1 }));
    else { g.count++; if (e.at > g.at) Object.assign(g, { s: e.s, n: e.n, at: e.at }); }
  }
  const list = [...bySh.values()];
  for (const m of (DATA.movies || []).concat(userState.customMovies || [])) {
    if (movieStatus(m) !== 'watched' || !statValidDay(movieWatchedOf(m))) continue;
    list.push({ t: 'm', m, at: String(movieWatchedOf(m)) });
  }
  list.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  return list.slice(0, limit);
}
// Un épisode / film de la rangée « Récemment vus » : affiche, titre, S01E02, réaction.
function recentCardHtml(e, i) {
  if (e.t === 'm') {
    const sc = movieScore(e.m), nm = movieDisplayName(e.m);
    return `<div class="rv-card" data-rv="${i}"><div class="poster" data-mposter="${esc(e.m.name)}"><div class="fallback-title">${esc(nm)}</div></div>
      <div class="title">${esc(nm)}</div>${sc ? '<div class="meta"><span class="rv-react">' + reactBadge(sc) + '</span></div>' : ''}</div>`;
  }
  const sh = MODEL.shows.get(e.sk), nm = displayName(sh), sc = epScore(epKey(e.sk, e.s, e.n));
  const what = (e.count > 1 ? 'Dernier : ' : '') + epSE(sh, e.s, e.n);
  return `<div class="rv-card" data-rv="${i}"><div class="poster" data-poster="${esc(sh.key)}"><div class="fallback-title">${esc(nm)}</div></div>
    <div class="title">${esc(nm)}</div><div class="meta">${esc(what)}${sc ? ' <span class="rv-react">' + reactBadge(sc) + '</span>' : ''}</div></div>`;
}
// Photo + pseudo : profil Supabase s'il est chargé, sinon copie gardée sur l'appareil, sinon initiale du nom.
function profileHeroHtml() {
  let c = null;
  try { c = JSON.parse(localStorage.getItem('tvtime-acct') || 'null'); } catch {}
  const p = sbSession ? (sbProfile || c) : null;
  const name = (p && p.pseudo) || userDisplayName() || '?';
  const av = p ? avatarHtml(p.avatar, name, 'xl') : '<span class="avatar xl">' + esc(name.slice(0, 1).toUpperCase()) + '</span>';
  return `<div class="acct-hero"><div class="acct-av">${av}</div><div class="acct-name">${esc(name)}</div>
    <button class="btn sm ghost${sbSession && _acctEditOpen ? ' on' : ''}" id="acctEdit">${sbSession ? icon('edit') + ' Modifier le profil' : icon('user') + ' Se connecter'}</button></div>`;
}
let _acctEditOpen = false; // bloc « Modifier le profil » ouvert (gardé quand la page se redessine)
const PROFILE_MENU = [
  ['library', '#/library', 'Bibliothèque', 'Toutes vos œuvres — séries &amp; films'],
  ['chart', '#/stats', 'Statistiques', 'Séries &amp; films'],
  ['list', '#/lists', 'Listes', 'Créez et modifiez vos listes'],
  ['palette', '#/custom', 'Personnalisation', 'Couleurs, thème, tailles, accueil'],
  ['gear', '#/settings', 'Réglages', 'Clé TMDB, synchronisation, sauvegarde'],
  ['sparkle', '#/changelog', 'Notes de version', 'Les nouveautés de chaque mise à jour'],
  ['book', '#/profile', 'Revoir le guide', 'Une visite rapide de l’application', 'guideCard'],
];
route('profile', async (el) => {
  libBackTo = '#/profile';
  document.querySelectorAll('.backup-banner').forEach(n => n.remove()); // Mon compte : pas de bannière de rappel
  buildModel();
  const shows = Array.from(MODEL.shows.values());
  const following = shows.filter(s => s.followed && !s.archived).length;
  const started = shows.filter(s => s.seenKeys.size > 0).length;
  const movies = (DATA.movies || []).concat(userState.customMovies || []);
  const moviesSeen = movies.filter(m => movieStatus(m) === 'watched').length;
  const seenCount = computeSeenCount();
  const recent = recentViews(10);
  const favSeries = shows.filter(s => isFavShow(s)).sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const favMovies = movies.filter(m => isFavMovie(m)).sort((a, b) => a.name.localeCompare(b.name));
  const favSection = (title, ic, count, gridId, inner) => `
    <div class="panel">
      <h3>${emojiIcon(ic)} ${title} <span class="count" style="color:var(--muted);font-weight:400">· ${count}</span></h3>
      ${count ? `<div class="grid" id="${gridId}">${inner}</div>` : `<p class="hint" style="color:var(--muted)">Aucun favori pour l'instant. Ouvrez une œuvre puis touchez ♡ « Ajouter aux favoris ».</p>`}
    </div>`;
  const menu = PROFILE_MENU.map(([ic, href, t, sub, id]) => `<a class="am-row" href="${href}"${id ? ` id="${id}"` : ''}><span class="am-ic">${icon(ic)}</span><span class="am-tx"><b>${t}</b><small>${sub}</small></span><span class="am-chev">${icon('chev')}</span></a>`).join('');
  el.innerHTML = `
    ${backBtn('#/home')}
    <div class="page-head"><h1>Mon compte</h1></div>
    <div id="acctHero">${profileHeroHtml()}</div>
    ${sbSession ? `<div id="acctProfile"${_acctEditOpen ? '' : ' hidden'}></div>` : ''}
    <a class="glass acct-stats" href="#/stats" aria-label="Voir les statistiques">
      <div><b>${statFmtN(moviesSeen)}</b><span>Films vus</span></div>
      <div><b>${statFmtN(following)}</b><span>Séries suivies</span></div>
      <div><b>${statFmtN(seenCount)}</b><span>Épisodes vus</span></div>
      <div><b>${statFmtN(started)}</b><span>Séries commencées</span></div>
    </a>
    ${recent.length ? `<div class="rv-sec"><h3>${icon('history')} Récemment vus</h3><div class="rv-row" id="rvRow">${recent.map(recentCardHtml).join('')}</div></div>` : ''}
    ${favSection('Séries favorites', '❤️', favSeries.length, 'favSeriesGrid', favSeries.map(s => cardHtml(s)).join(''))}
    ${favSection('Films favoris', '🎬', favMovies.length, 'favMoviesGrid', favMovies.map(m => movieCardHtml(m)).join(''))}
    <div class="acct-quiet">${badgeCardHtml()}<div id="acctSb">${sbPanelHtml()}</div></div>
    <div class="glass acct-menu">${menu}</div>`;

  sbWirePanel(el);
  const gc = el.querySelector('#guideCard');
  if (gc) gc.onclick = (ev) => { ev.preventDefault(); showGuide(0); };
  const ap = el.querySelector('#acctProfile');
  // « Modifier le profil » : ouvre / referme le bloc de réglages du profil (replié par défaut pour une page propre)
  const goEdit = () => {
    if (!ap) { const t = el.querySelector('#acctSb'); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    ap.hidden = !ap.hidden; _acctEditOpen = !ap.hidden;
    el.querySelectorAll('#acctEdit').forEach(b => b.classList.toggle('on', _acctEditOpen));
    if (_acctEditOpen) ap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const edit = el.querySelector('#acctEdit');
  if (edit) edit.onclick = goEdit;
  if (ap) fillAccountProfile(ap).then(() => {
    if (!sbProfile) { ap.hidden = false; return; } // profil pas encore créé : le formulaire reste visible
    const h = el.querySelector('#acctHero');
    if (h && sbProfile) { h.innerHTML = profileHeroHtml(); const e2 = h.querySelector('#acctEdit'); if (e2) e2.onclick = goEdit; }
  });
  const rv = el.querySelector('#rvRow');
  if (rv) {
    rv.querySelectorAll('.rv-card').forEach(c => c.onclick = () => {
      const e = recent[+c.dataset.rv];
      if (e.t === 'm') openMovie(e.m.name); else if (e.count > 1) openShow(e.sk); else openEpisode(e.sk, e.s, e.n);
    });
    hydratePosters(rv, recent.filter(e => e.t === 'e').map(e => MODEL.shows.get(e.sk)));
    hydrateMoviePosters(rv, recent.filter(e => e.t === 'm').map(e => e.m));
  }
  const sg = el.querySelector('#favSeriesGrid');
  if (sg) {
    sg.querySelectorAll('.show-card').forEach(c => c.onclick = () => openShow(c.dataset.key));
    hydratePosters(sg, favSeries);
  }
  const mg = el.querySelector('#favMoviesGrid');
  if (mg) {
    wireMovieButtons(mg);
    hydrateMoviePosters(mg, favMovies);
  }
});

//////////////////////// Notes de version ////////////////////////
route('changelog', async (el) => {
  const entries = CHANGELOG.map(e => `
    <div class="panel cl-entry">
      <h3>${esc(e.title)} <span class="cl-date">${esc(e.date)}</span></h3>
      <ul class="cl-list">${e.items.map(it => `<li>${esc(it)}</li>`).join('')}</ul>
    </div>`).join('');
  el.innerHTML = `
    ${backBtn('#/profile')}
    <div class="page-head"><h1>${icon('sparkle')} Notes de version</h1><span class="sub">L'historique des nouveautés de l'application</span></div>
    ${entries}`;
});

//////////////////////// Statistiques enrichies (L7-4) et badges (L7-9) ////////////////////////
const STAT_MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const STAT_WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const statFmtN = (n) => Number(n).toLocaleString('fr-FR');
// Date « AAAA-MM-JJ » valide, ou null (ignore les fausses dates de TV Time : 1970, 0001…).
function statValidDay(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  if (!m) return null;
  const y = +m[1];
  if (y < 1990 || y > new Date().getFullYear() + 1) return null;
  return m[1] + '-' + m[2] + '-' + m[3];
}
// Durée (min) d'un épisode d'une série : durée TMDB en cache, sinon valeur par défaut (comme la carte « Temps de visionnage »).
function statShowRuntime(sh) {
  if (sh && sh.tvdbId && tmdbCache.map[sh.tvdbId] && tmdbCache.shows[tmdbCache.map[sh.tvdbId]]) {
    const m = tmdbCache.shows[tmdbCache.map[sh.tvdbId]];
    if (m.runtime) return m.runtime;
  }
  return DEFAULT_RUNTIME;
}
// Durée (min) d'un film : durée de l'export, sinon fiche TMDB en cache, sinon valeur par défaut.
function statMovieRuntime(m) {
  let rt = parseInt(m.runtime, 10);
  if (!(rt > 0)) {
    const rec = (userState.movieTmdb && userState.movieTmdb[m.name]) || (tmdbCache.movies && tmdbCache.movies[m.name]);
    const mm = rec && rec.id && tmdbCache.movieMeta && tmdbCache.movieMeta[rec.id];
    rt = mm ? parseInt(mm.runtime, 10) : 0;
  }
  return rt > 0 ? rt : MOVIE_DEFAULT_RUNTIME;
}
// Toutes les statistiques par date, calculées à la demande (rien n'est stocké).
function computeStatsData() {
  buildModel();
  const shows = MODEL.shows;
  // Épisodes : un événement par épisode vu (export TV Time + ajouts faits dans l'app), dédoublonné par clé.
  const evs = new Map();
  for (const r of DATA.seen || []) {
    if (r.showId == null || r.showId === '') continue; // lignes orphelines de l'export : ignorées comme dans buildModel
    const sk = r.showId;
    const kk = epKey(sk, r.season, r.number);
    if (userState.seenRemove[kk]) continue;
    const day = statValidDay(r.seenAt);
    const o = evs.get(kk);
    if (!o || (day && (!o.day || day < o.day))) evs.set(kk, { sk, s: r.season, n: r.number, day });
  }
  for (const [kk, v] of Object.entries(userState.seenAdd || {})) {
    const p = kk.split('|');
    const day = statValidDay(v && v.at);
    const o = evs.get(kk);
    if (day || !o) evs.set(kk, { sk: p.slice(0, -2).join('|'), s: +p[p.length - 2], n: +p[p.length - 1], day: day || (o && o.day) || null });
  }
  const D = { byYear: {}, byMonth: {}, perShowYear: {}, showFirst: {}, dayCounts: {}, weekday: [0, 0, 0, 0, 0, 0, 0], epDays: [], movDays: [], first: null, movYearList: {} };
  const bucket = (map, k) => map[k] || (map[k] = { eps: 0, movies: 0, epMin: 0, movMin: 0 });
  const rtCache = {};
  for (const e of evs.values()) {
    if (!e.day) continue;
    if (rtCache[e.sk] == null) rtCache[e.sk] = statShowRuntime(shows.get(e.sk));
    const rt = rtCache[e.sk];
    for (const b of [bucket(D.byYear, e.day.slice(0, 4)), bucket(D.byMonth, e.day.slice(0, 7))]) { b.eps++; b.epMin += rt; }
    const py = D.perShowYear[e.day.slice(0, 4)] || (D.perShowYear[e.day.slice(0, 4)] = {});
    py[e.sk] = (py[e.sk] || 0) + 1;
    if (!D.showFirst[e.sk] || e.day < D.showFirst[e.sk]) D.showFirst[e.sk] = e.day;
    const dc = D.dayCounts[e.day] || (D.dayCounts[e.day] = { n: 0, min: 0, shows: {} });
    dc.n++; dc.min += rt; dc.shows[e.sk] = (dc.shows[e.sk] || 0) + 1;
    const [yy, mo, dd] = e.day.split('-').map(Number);
    D.weekday[new Date(yy, mo - 1, dd).getDay()]++;
    D.epDays.push(e.day);
    if (!D.first || e.day < D.first.day) D.first = e;
  }
  D.epDays.sort();
  D.epDated = D.epDays.length;
  // Films vus avec une date valide.
  const allMovies = (DATA.movies || []).concat(userState.customMovies || []);
  D.moviesWatched = allMovies.filter(m => movieStatus(m) === 'watched');
  for (const m of D.moviesWatched) {
    const day = statValidDay(movieWatchedOf(m));
    if (!day) continue;
    const rt = statMovieRuntime(m);
    for (const b of [bucket(D.byYear, day.slice(0, 4)), bucket(D.byMonth, day.slice(0, 7))]) { b.movies++; b.movMin += rt; }
    (D.movYearList[day.slice(0, 4)] = D.movYearList[day.slice(0, 4)] || []).push(m);
    D.movDays.push(day);
  }
  D.movDays.sort();
  // Revisionnages : total, par série, et datés (épisodes + films).
  D.rewatchTotal = 0; D.rewatchByShow = {};
  for (const [k, c] of MODEL.rewatchMap) {
    D.rewatchTotal += c;
    const sk = k.split('|').slice(0, -2).join('|');
    D.rewatchByShow[sk] = (D.rewatchByShow[sk] || 0) + c;
  }
  for (const m of D.moviesWatched) D.rewatchTotal += movieRewatchOf(m);
  D.rewatchYear = {};
  for (const arr of Object.values(userState.rewatchDates || {}).concat(Object.values(userState.movieRewatchDates || {}))) {
    for (const d of arr || []) { const day = statValidDay(d); if (day) D.rewatchYear[day.slice(0, 4)] = (D.rewatchYear[day.slice(0, 4)] || 0) + 1; }
  }
  // Marathon : le plus d'épisodes vus le même jour. Un jour qui dépasse 24 h de visionnage n'est pas réaliste
  // (typiquement la date d'import de TV Time) : il est écarté des records et signalé à part.
  D.marathon = null; D.bulkDays = [];
  for (const [day, c] of Object.entries(D.dayCounts)) if (c.min > 1440) D.bulkDays.push({ day, n: c.n });
  D.bulkDays.sort((a, b) => b.n - a.n);
  for (const [day, c] of Object.entries(D.dayCounts)) if (c.min <= 1440 && (!D.marathon || c.n > D.marathon.n || (c.n === D.marathon.n && day < D.marathon.day))) D.marathon = { day, n: c.n, shows: c.shows };
  return D;
}
const statShowName = (sk) => { const sh = MODEL.shows.get(sk); return sh ? displayName(sh) : String(sk).replace(/^n:/, ''); };
function statTotMin(b) { return b ? b.epMin + b.movMin : 0; }
function statHoursTxt(min) { const h = Math.round(min / 60); return h >= 1 ? statFmtN(h) + ' h' : Math.round(min) + ' min'; }
// Une barre « épisodes + films » (largeur en % du maximum), avec le détail en dessous.
function statBarRow(label, b, maxMin) {
  b = b || { eps: 0, movies: 0, epMin: 0, movMin: 0 };
  const pe = maxMin ? (b.epMin / maxMin * 100) : 0, pm = maxMin ? (b.movMin / maxMin * 100) : 0;
  const txt = `${statHoursTxt(b.epMin + b.movMin)} · ${statFmtN(b.eps)} épisode${b.eps > 1 ? 's' : ''} · ${statFmtN(b.movies)} film${b.movies > 1 ? 's' : ''}`;
  return `<div class="sb-row"><span class="sb-lbl">${esc(label)}</span><span class="sb-track"><i class="e" style="width:${pe}%"></i><i class="m" style="width:${pm}%"></i></span><span class="sb-val">${txt}</span></div>`;
}
function statPerYearHtml(D) {
  const years = Object.keys(D.byYear).sort().reverse();
  const max = Math.max(1, ...years.map(y => statTotMin(D.byYear[y])));
  return years.map(y => statBarRow(y, D.byYear[y], max)).join('') || '<p class="hint">Aucune date de visionnage enregistrée.</p>';
}
function statPerMonthHtml(D) {
  const now = new Date(), months = [];
  for (let i = 0; i < 12; i++) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); }
  const max = Math.max(1, ...months.map(k => statTotMin(D.byMonth[k])));
  return months.map(k => statBarRow(STAT_MONTHS[+k.slice(5) - 1] + ' ' + k.slice(0, 4), D.byMonth[k], max)).join('');
}
function statRecordsHtml(D) {
  const row = (ic, k, v) => `<div class="rec-row"><span class="rec-ic">${emojiIcon(ic)}</span><span class="rec-k">${k}</span><span class="rec-v">${v}</span></div>`;
  const shows = Array.from(MODEL.shows.values());
  const top = shows.filter(s => s.seenKeys.size).sort((a, b) => b.seenKeys.size - a.seenKeys.size)[0];
  const rwEntry = Object.entries(D.rewatchByShow).sort((a, b) => b[1] - a[1])[0];
  const wdMax = Math.max(...D.weekday), wd = D.weekday.indexOf(wdMax);
  const out = [];
  out.push(row('📺', 'Série la plus regardée', top ? `<b>${esc(displayName(top))}</b><br><small>${statFmtN(top.seenKeys.size)} épisodes vus</small>` : '—'));
  out.push(row('🔁', 'Série la plus revue', rwEntry ? `<b>${esc(statShowName(rwEntry[0]))}</b><br><small>${statFmtN(rwEntry[1])} revisionnage${rwEntry[1] > 1 ? 's' : ''}</small>` : '<small>Aucun revisionnage</small>'));
  if (D.marathon) {
    const best = Object.entries(D.marathon.shows).sort((a, b) => b[1] - a[1])[0];
    out.push(row('🏃', 'Plus long marathon', `<b>${statFmtN(D.marathon.n)} épisodes en un jour</b><br><small>${fmtFull(D.marathon.day)}${best ? ' · surtout ' + esc(statShowName(best[0])) : ''}</small>`));
  } else out.push(row('🏃', 'Plus long marathon', '—'));
  if (D.first) {
    const sh = MODEL.shows.get(D.first.sk);
    out.push(row('🥇', 'Premier épisode enregistré', `<b>${esc(statShowName(D.first.sk))}</b><br><small>${sh ? esc(epTag(sh, D.first.s, D.first.n)) + ' · ' : ''}${fmtFull(D.first.day)}${(D.bulkDays || []).some(b => b.day === D.first.day) ? ' (date d’import de TV Time ?)' : ''}</small>`));
  } else out.push(row('🥇', 'Premier épisode enregistré', '—'));
  out.push(row('📆', 'Jour préféré', wdMax ? `<b>${STAT_WEEKDAYS[wd]}</b><br><small>${statFmtN(wdMax)} épisodes vus ce jour-là</small>` : '—'));
  return out.join('');
}
// Bilan d'une année : épisodes, films, heures, tops, nouvelles séries.
function statYearReviewHtml(D, y) {
  const b = D.byYear[y] || { eps: 0, movies: 0, epMin: 0, movMin: 0 };
  const topShows = Object.entries(D.perShowYear[y] || {}).sort((a, c) => c[1] - a[1]).slice(0, 5);
  const mv = (D.movYearList[y] || []).slice().sort((a, c) => movieScore(c) - movieScore(a) || movieDisplayName(a).localeCompare(movieDisplayName(c))).slice(0, 3);
  const newShows = Object.values(D.showFirst).filter(d => d.slice(0, 4) === y).length;
  const rw = D.rewatchYear[y] || 0;
  const maxTop = topShows.length ? topShows[0][1] : 1;
  const mvRow = (m, i) => { const sc = movieScore(m), r = sc ? reactOfScore(sc) : null; return `<div class="rec-row"><span class="rec-ic">${['🥇', '🥈', '🥉'][i]}</span><span class="rec-k">${esc(movieDisplayName(m))}</span><span class="rec-v">${r ? r.emoji : '<small>pas noté</small>'}</span></div>`; };
  return `
    <div class="stat-grid">
      <div class="stat-card"><div class="k">Épisodes</div><div class="v">${statFmtN(b.eps)}</div></div>
      <div class="stat-card"><div class="k">Films</div><div class="v">${statFmtN(b.movies)}</div></div>
      <div class="stat-card"><div class="k">Temps total</div><div class="v">${statFmtN(Math.round((b.epMin + b.movMin) / 60))}<small> h</small></div></div>
      <div class="stat-card"><div class="k">Nouvelles séries</div><div class="v">${statFmtN(newShows)}</div></div>
    </div>
    ${rw ? `<p class="hint stat-help">Et ${statFmtN(rw)} revisionnage${rw > 1 ? 's' : ''} daté${rw > 1 ? 's' : ''} cette année.</p>` : ''}
    <h4 class="stat-sub">Top 5 séries</h4>
    ${topShows.map(([sk, n]) => barRow(esc(statShowName(sk)), n, maxTop)).join('') || '<p class="hint">Rien de daté cette année-là.</p>'}
    <h4 class="stat-sub">Top 3 films (selon vos réactions)</h4>
    ${mv.map(mvRow).join('') || '<p class="hint">Aucun film daté cette année-là.</p>'}`;
}
// ---- Badges : jalons calculés à partir de l'historique (rien n'est stocké) ----
function computeBadges(D) {
  const seenCount = computeSeenCount();
  const shows = Array.from(MODEL.shows.values());
  const doneShows = shows.filter(isShowComplete);
  const doneDays = doneShows.map(s => statValidDay(s.lastSeenAt)).filter(Boolean).sort();
  const dayList = Object.entries(D.dayCounts).filter(([, c]) => c.min <= 1440).sort((a, b) => a[0] < b[0] ? -1 : 1);
  const startDay = (D.epDays[0] && D.movDays[0]) ? (D.epDays[0] < D.movDays[0] ? D.epDays[0] : D.movDays[0]) : (D.epDays[0] || D.movDays[0] || null);
  const ancDays = startDay ? Math.max(0, Math.floor((Date.now() - new Date(startDay + 'T00:00:00').getTime()) / 86400000)) : 0;
  const plus = (day, n) => { const d = new Date(day + 'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  return [
    { id: 'eps', ic: '📺', title: 'Épisodes vus', value: seenCount, tiers: [100, 500, 1000, 5000, 10000, 20000], label: n => statFmtN(n) + ' épisodes', unit: '', date: n => D.epDays.length >= n ? D.epDays[n - 1] : null },
    { id: 'done', ic: '✅', title: 'Séries terminées', value: doneShows.length, tiers: [10, 50, 100, 250], label: n => statFmtN(n) + ' séries terminées', unit: '', date: n => doneDays.length >= n ? doneDays[n - 1] : null },
    { id: 'mov', ic: '🎬', title: 'Films vus', value: D.moviesWatched.length, tiers: [10, 50, 100, 250, 500, 1000], label: n => statFmtN(n) + ' films', unit: '', date: n => D.movDays.length >= n ? D.movDays[n - 1] : null },
    { id: 'rew', ic: '🔁', title: 'Revisionnages', value: D.rewatchTotal, tiers: [10, 50, 100, 500, 1000, 5000], label: n => statFmtN(n) + ' revisionnages', unit: '', date: () => null },
    { id: 'mar', ic: '🏃', title: 'Marathon', value: D.marathon ? D.marathon.n : 0, tiers: [5, 10, 20, 30], label: n => n + ' épisodes en un jour', unit: '', date: n => { const f = dayList.find(([, c]) => c.n >= n); return f ? f[0] : null; } },
    { id: 'anc', ic: '🎂', title: 'Ancienneté', value: ancDays, tiers: [365, 730, 1825, 3650], label: n => (n / 365) + (n === 365 ? ' an' : ' ans') + ' d’historique', unit: ' j', date: n => startDay && ancDays >= n ? plus(startDay, n) : null }
  ];
}
// Résumé : nombre de badges obtenus et prochain badge le plus proche.
function badgeSummary(groups) {
  let got = 0, next = null;
  for (const g of groups) {
    got += g.tiers.filter(t => g.value >= t).length;
    const nt = g.tiers.find(t => g.value < t);
    if (nt) { const ratio = g.value / nt; if (!next || ratio > next.ratio) next = { g, nt, ratio }; }
  }
  return { got, total: groups.reduce((a, g) => a + g.tiers.length, 0), next };
}
function badgesHtml(groups) {
  return groups.map(g => {
    const got = g.tiers.filter(t => g.value >= t);
    const nt = g.tiers.find(t => g.value < t);
    const chips = got.map(t => { const d = g.date(t); return `<span class="bdg">${icon('medal')} ${esc(g.label(t))}${d ? `<small>${fmtFull(d)}</small>` : ''}</span>`; }).join('');
    const pct = nt ? Math.min(100, Math.round(g.value / nt * 100)) : 100;
    return `<div class="bdg-group">
      <div class="bdg-head"><span>${emojiIcon(g.ic)} ${esc(g.title)}</span><b>${statFmtN(g.value)}${g.unit}</b></div>
      <div class="bdg-got">${chips || '<span class="hint">Pas encore de badge ici.</span>'}</div>
      ${nt ? `<div class="bdg-next"><span class="bdg-nt">Prochain : ${esc(g.label(nt))}</span><span class="sb-track"><i class="e" style="width:${pct}%"></i></span><span class="bdg-prog">${statFmtN(g.value)} / ${statFmtN(nt)}${g.unit}</span></div>` : '<div class="bdg-next"><span class="bdg-nt">🎉 Tous les badges de cette série sont obtenus.</span></div>'}
    </div>`;
  }).join('');
}
// Carte « badges » de Mon compte.
function badgeCardHtml() {
  const s = badgeSummary(computeBadges(computeStatsData()));
  const nx = s.next;
  return `<a class="panel badge-card" href="#/stats">
    <div class="bdg-head"><span>${icon('medal')} Mes badges</span><b>${s.got} / ${s.total}</b></div>
    ${nx ? `<div class="bdg-next"><span class="bdg-nt">Prochain : ${esc(nx.g.label(nx.nt))}</span><span class="sb-track"><i class="e" style="width:${Math.min(100, Math.round(nx.ratio * 100))}%"></i></span><span class="bdg-prog">${statFmtN(nx.g.value)} / ${statFmtN(nx.nt)}${nx.g.unit}</span></div>` : '<p class="hint" style="margin:6px 0 0">Tous les badges sont obtenus.</p>'}
    <small class="muted">Voir tous les badges →</small></a>`;
}
// Blocs ajoutés en haut de la page Statistiques.
function statsPlusHtml(D) {
  const cy = new Date().getFullYear();
  const undated = Math.max(0, computeSeenCount() - D.epDated);
  const groups = computeBadges(D);
  return `
    <details class="panel stat-sec" open id="statBilan"><summary><h3>🎉 Bilan de l’année</h3></summary>
      <div class="yr-chips"><button class="chip active" data-y="${cy}">${cy}</button><button class="chip" data-y="${cy - 1}">${cy - 1}</button></div>
      <div id="statBilanBody">${statYearReviewHtml(D, String(cy))}</div>
    </details>
    <details class="panel stat-sec" open><summary><h3>${icon('medal')} Badges</h3></summary>
      <p class="hint stat-help">Calculés à partir de votre historique. Les dates sont approximatives quand certains épisodes n’ont pas de date.</p>
      ${badgesHtml(groups)}
    </details>
    <details class="panel stat-sec" open><summary><h3>${icon('calendar')} Temps de visionnage par mois</h3></summary>
      <p class="hint stat-help"><i class="sb-key e"></i> épisodes <i class="sb-key m"></i> films · 12 derniers mois</p>
      ${statPerMonthHtml(D)}
    </details>
    <details class="panel stat-sec" open><summary><h3>${icon('calendar')} Temps de visionnage par année</h3></summary>
      <p class="hint stat-help"><i class="sb-key e"></i> épisodes <i class="sb-key m"></i> films. Durées estimées : ${DEFAULT_RUNTIME} min par épisode et ${MOVIE_DEFAULT_RUNTIME} min par film quand la durée réelle est inconnue.${(D.bulkDays || []).length ? ` ${D.bulkDays.length} jour${D.bulkDays.length > 1 ? 's' : ''} (dont le ${fmtFull(D.bulkDays[0].day)}, ${statFmtN(D.bulkDays[0].n)} épisodes) ${D.bulkDays.length > 1 ? 'ont' : 'a'} trop d’épisodes pour une seule journée : ce sont sûrement des cochages en lot ou l’import de TV Time. Ils sont comptés dans leur année mais pas dans les records.` : ''}${undated ? ` ${statFmtN(undated)} épisode${undated > 1 ? 's' : ''} sans date ne sont pas comptés ici.` : ''}</p>
      ${statPerYearHtml(D)}
    </details>
    <details class="panel stat-sec" open><summary><h3>${icon('trophy')} Records</h3></summary>
      ${statRecordsHtml(D)}
    </details>`;
}
function wireStatsPlus(el, D) {
  el.querySelectorAll('#statBilan .yr-chips .chip').forEach(c => c.onclick = () => {
    el.querySelectorAll('#statBilan .yr-chips .chip').forEach(x => x.classList.toggle("active", x === c));
    el.querySelector('#statBilanBody').innerHTML = statYearReviewHtml(D, c.dataset.y);
  });
}

//////////////////////// Stats ////////////////////////
route('stats', async (el) => {
  buildModel();
  const SD = computeStatsData();
  const shows = Array.from(MODEL.shows.values());
  const seenCount = computeSeenCount();

  // time watched using cached runtimes where available
  let minutes = 0, withRuntime = 0;
  for (const sh of shows) {
    let rt = DEFAULT_RUNTIME;
    if (sh.tvdbId && tmdbCache.map[sh.tvdbId] && tmdbCache.shows[tmdbCache.map[sh.tvdbId]]) {
      const m = tmdbCache.shows[tmdbCache.map[sh.tvdbId]];
      if (m.runtime) { rt = m.runtime; withRuntime += sh.seenKeys.size; }
    }
    minutes += sh.seenKeys.size * rt;
  }
  const days = Math.floor(minutes / 1440), hrs = Math.floor((minutes % 1440) / 60);
  const followingN = shows.filter(s => s.followed && !s.archived).length;
  const startedN = shows.filter(s => s.seenKeys.size > 0).length;

  // emotions/reactions breakdown (star-meter reactions merged in)
  const emoCounts = {};
  for (const v of MODEL.emotionMap.values()) emoCounts[v] = (emoCounts[v] || 0) + 1;
  const emoTotal = Object.values(emoCounts).reduce((a, b) => a + b, 0) || 1;
  const knownEmoIds = new Set(EMOTIONS.map(e => e.id));
  let otherReactions = 0;
  for (const [id, c] of Object.entries(emoCounts)) if (!knownEmoIds.has(id)) otherReactions += c;

  // my personal star ratings for shows (1-5)
  const showRatingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const s of shows) { const r = showScore(s); if (r >= 1 && r <= 5) showRatingCounts[r]++; }
  const ratedShows = Object.values(showRatingCounts).reduce((a, b) => a + b, 0);

  // activity by year
  const byYear = {};
  // Même calcul que le bloc « Par année » du haut (épisodes dédoublonnés, fausses dates TV Time ignorées).
  for (const [y, b] of Object.entries(SD.byYear)) if (b.eps) byYear[y] = b.eps;
  const years = Object.keys(byYear).sort();

  // top shows
  const top = shows.filter(s => s.seenKeys.size).sort((a, b) => b.seenKeys.size - a.seenKeys.size).slice(0, 12);
  const maxTop = top.length ? top[0].seenKeys.size : 1;

  // ---- movie stats ----
  const allMovies = (DATA.movies || []).concat(userState.customMovies || []);
  const moviesWatched = allMovies.filter(m => movieStatus(m) === 'watched');
  const moviesToWatch = allMovies.filter(m => movieStatus(m) === 'towatch').length;
  const MOVIE_DEFAULT_RT = 115;
  let movMinutes = 0;
  for (const m of moviesWatched) { const rt = parseInt(m.runtime, 10); movMinutes += (isFinite(rt) && rt > 0) ? rt : MOVIE_DEFAULT_RT; }
  const movDays = Math.floor(movMinutes / 1440), movHrs = Math.floor((movMinutes % 1440) / 60);
  const movEmoCounts = {};
  for (const m of allMovies) { const e = movieEmotionOf(m); if (e) movEmoCounts[e] = (movEmoCounts[e] || 0) + 1; }
  const knownEmoIdsMov = new Set(EMOTIONS.map(e => e.id));
  let movOtherReactions = 0;
  for (const [id, c] of Object.entries(movEmoCounts)) if (!knownEmoIdsMov.has(id)) movOtherReactions += c;
  const movEmoTotal = Object.values(movEmoCounts).reduce((a, b) => a + b, 0);
  const movMyRatingCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const m of allMovies) { const r = movieScore(m); if (r >= 1 && r <= 5) movMyRatingCounts[r]++; }
  const myRatedMovies = Object.values(movMyRatingCounts).reduce((a, b) => a + b, 0);
  const movByYear = {};
  for (const [y, b] of Object.entries(SD.byYear)) if (b.movies) movByYear[y] = b.movies;
  const movYears = Object.keys(movByYear).sort();

  el.innerHTML = `
    ${backBtn('#/profile')}
    <div class="page-head"><h1>Statistiques</h1><span class="sub">Bonjour ${esc(userDisplayName())} 👋</span></div>
    ${statsPlusHtml(SD)}
    <div class="page-head" style="margin-top:6px"><h1>${icon('tv')} Séries</h1><span class="sub">Vos statistiques séries</span></div>
    <div class="stat-grid">
      <div class="stat-card"><div class="k">Épisodes vus</div><div class="v">${seenCount}</div></div>
      <div class="stat-card"><div class="k">Temps de visionnage</div><div class="v">${days}<small> j</small> ${hrs}<small> h</small></div></div>
      <div class="stat-card"><div class="k">Séries suivies</div><div class="v">${followingN}</div></div>
      <div class="stat-card"><div class="k">Séries commencées</div><div class="v">${startedN}</div></div>
      <div class="stat-card"><div class="k">Réactions</div><div class="v">${MODEL.emotionMap.size}</div></div>
    </div>
    <p class="hint stat-help">« Réactions » = nombre d’épisodes auxquels une réaction est associée (celles de TV Time et les vôtres). Le détail est plus bas, dans « Réactions importées de TV Time ».</p>
    ${!hasKey() ? `<div class="panel"><p style="color:var(--muted);margin:0">⏱️ Le temps de visionnage est estimé à ${DEFAULT_RUNTIME} min/épisode. Ajoutez une clé TMDB (Réglages) puis « Synchroniser » pour des durées exactes.</p></div>` : ''}

    <div class="panel"><h3>${icon('trophy')} Top séries (épisodes vus)</h3>
      ${top.map(s => barRow(esc(s.name), s.seenKeys.size, maxTop)).join('') || '<p class="hint">—</p>'}
    </div>
    <div class="panel"><h3>😍 Réactions importées de TV Time</h3>
      <p class="hint" style="color:var(--muted);margin:.2rem 0 .6rem">Détail par type de réaction donnée aux épisodes dans TV Time (y compris MDR, Triste, Choqué). Ce n’est pas la même chose que « Mes appréciations » ci-dessous, qui compte une seule note de 1 à 5 par série.</p>
      ${(() => {
        const rows = EMOTIONS.filter(e => emoCounts[e.id]).sort((a, b) => emoCounts[b.id] - emoCounts[a.id]).map(e => barRow(`${e.emoji} ${e.label}`, emoCounts[e.id], emoTotal)).join('');
        const other = otherReactions ? barRow('🎬 Autres réactions', otherReactions, emoTotal) : '';
        return (rows + other) || '<p class="hint">Aucune réaction.</p>';
      })()}
    </div>
    <div class="panel"><h3>🎯 Mes appréciations</h3>
      <p class="hint" style="color:var(--muted);margin:.2rem 0 .6rem">Votre réaction sur la fiche de chaque série, de 👎 1/5 à 🤩 5/5.</p>
      ${ratedShows ? [5, 4, 3, 2, 1].map(v => barRow(`${reactOfScore(v).emoji} ${reactOfScore(v).label} · ${v}/5`, showRatingCounts[v], Math.max(1, ...Object.values(showRatingCounts)))).join('') : '<p class="hint">Aucune note pour l\'instant.</p>'}
    </div>
    <div class="panel"><h3>${icon('calendar')} Activité par année</h3>
      ${years.map(y => barRow(y, byYear[y], Math.max(...years.map(z => byYear[z])))).join('') || '<p class="hint">—</p>'}
    </div>

    <div class="page-head" style="margin-top:22px"><h1>${icon('film')} Films</h1><span class="sub">Vos statistiques cinéma</span></div>
    <div class="stat-grid">
      <div class="stat-card"><div class="k">Films vus</div><div class="v">${moviesWatched.length}</div></div>
      <div class="stat-card"><div class="k">Temps de visionnage</div><div class="v">${movDays}<small> j</small> ${movHrs}<small> h</small></div></div>
      <div class="stat-card"><div class="k">Films à voir</div><div class="v">${moviesToWatch}</div></div>
      <div class="stat-card"><div class="k">Réactions</div><div class="v">${movEmoTotal}</div></div>
    </div>
    <p class="hint stat-help">« Réactions » = nombre de films auxquels une réaction est associée.</p>
    <div class="panel"><p style="color:var(--muted);margin:0">⏱️ Durée estimée à ${MOVIE_DEFAULT_RT} min/film lorsque la durée réelle est inconnue.</p></div>
    <div class="panel"><h3>😍 Réactions importées de TV Time</h3>
      <p class="hint" style="color:var(--muted);margin:.2rem 0 .6rem">Détail par type de réaction donnée aux films dans TV Time. Ce n’est pas la même chose que « Mes appréciations » ci-dessous, qui compte une seule note de 1 à 5 par film.</p>
      ${(() => {
        const rows = EMOTIONS.filter(e => movEmoCounts[e.id]).sort((a, b) => movEmoCounts[b.id] - movEmoCounts[a.id]).map(e => barRow(`${e.emoji} ${e.label}`, movEmoCounts[e.id], movEmoTotal)).join('');
        const other = movOtherReactions ? barRow('🎬 Autres réactions', movOtherReactions, movEmoTotal) : '';
        return (rows + other) || '<p class="hint">Aucune réaction.</p>';
      })()}
    </div>
    <div class="panel"><h3>🎯 Mes appréciations</h3>
      <p class="hint" style="color:var(--muted);margin:.2rem 0 .6rem">Votre réaction sur la fiche de chaque film (y compris celles importées de TV Time), de 👎 1/5 à 🤩 5/5.</p>
      ${myRatedMovies ? [5, 4, 3, 2, 1].map(v => barRow(`${reactOfScore(v).emoji} ${reactOfScore(v).label} · ${v}/5`, movMyRatingCounts[v], Math.max(1, ...Object.values(movMyRatingCounts)))).join('') : '<p class="hint">Aucune note pour l\'instant.</p>'}
    </div>
    <div class="panel"><h3>${icon('calendar')} Films vus par année</h3>
      ${movYears.length ? movYears.map(y => barRow(y, movByYear[y], Math.max(...movYears.map(z => movByYear[z])))).join('') : '<p class="hint">Les dates de visionnage sont enregistrées à partir de maintenant, quand vous marquez un film comme vu.</p>'}
    </div>`;
  wireStatsPlus(el, SD);
});
function barRow(label, val, max) {
  const pct = Math.round((val / (max || 1)) * 100);
  return `<div class="bar-row"><span class="lbl">${label}</span><span class="track"><i style="width:${pct}%"></i></span><span class="val">${val}</span></div>`;
}

//////////////////////// Lists ////////////////////////
route('lists', async (el) => {
  buildModel();
  const allMovies = (DATA.movies || []).concat(userState.customMovies || []);
  const movieByName = Object.fromEntries(allMovies.map(m => [m.name, m]));
  const imported = (DATA.lists || []).filter(l => (l.items || []).length);

  function draw() {
    const lists = getUserLists();
    el.innerHTML = `
      ${backBtn('#/profile')}
      <div class="page-head"><h1>Listes</h1><span class="sub">${lists.length} ${plural(lists.length, 'liste', 'listes')}</span>
        <div class="spacer"></div><button class="btn primary" id="newList">${icon('plus')} Nouvelle liste</button></div>
      ${lists.length ? '' : `<div class="empty"><div class="big">${emojiIcon('📃')}</div>Aucune liste. Créez-en une, puis ajoutez des séries et des films depuis leur fiche (« Ajouter à une liste »).</div>`}
      ${lists.map(l => {
        const shows = (l.shows || []).map(k => MODEL.shows.get(k)).filter(Boolean);
        const movies = (l.movies || []).map(n => movieByName[n]).filter(Boolean);
        const n = shows.length + movies.length;
        return `<div class="panel">
          <h3>${esc(l.name)} <span class="count" style="color:var(--muted);font-weight:400">· ${n} ${plural(n, 'élément', 'éléments')}</span>
            <span style="float:right;display:flex;gap:6px">
              <button class="btn sm" data-rename="${esc(l.id)}">${icon('edit')} Renommer</button>
              <button class="btn sm danger" data-dellist="${esc(l.id)}">${icon('trash')} Supprimer</button>
            </span></h3>
          ${n ? `<div class="grid">
            ${shows.map(s => `<div class="list-item" data-open-show="${esc(s.key)}">${cardHtml(s)}<button class="list-remove" data-rmshow="${esc(l.id)}|${esc(s.key)}" title="Retirer de la liste">✕</button></div>`).join('')}
            ${movies.map(m => `<div class="list-item" data-open-movie="${esc(m.name)}">${movieCardHtml(m)}<button class="list-remove" data-rmmovie="${esc(l.id)}|${esc(m.name)}" title="Retirer de la liste">✕</button></div>`).join('')}
          </div>` : `<p class="hint" style="color:var(--muted)">Liste vide — ajoutez des œuvres depuis leur fiche.</p>`}
        </div>`;
      }).join('')}
      ${imported.length ? `<div class="page-head" style="margin-top:22px"><h1>Listes importées</h1><span class="sub">Depuis TV Time · lecture seule</span></div>
        ${imported.map((l, i) => `<div class="panel"><h3>${esc(l.name || 'Liste importée ' + (i + 1))} <span class="count" style="color:var(--muted);font-weight:400">· ${(l.items || []).length} élément(s)</span></h3>
          <div class="grid" id="implist_${i}"></div></div>`).join('')}` : ''}`;

    el.querySelector('#newList').onclick = () => {
      showModal(`<h2>Nouvelle liste</h2>
        <label class="field"><span>Nom</span><input class="input" id="nlName" placeholder="Ex. À regarder ce week-end"></label>
        <div class="row"><button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="nlGo">Créer</button></div>`,
        (root) => {
          const go = () => { const name = root.querySelector('#nlName').value.trim(); if (!name) { toast('Nom requis'); return; } createList(name); closeModal(); draw(); toast(`Liste « ${name} » créée`); };
          root.querySelector('#nlGo').onclick = go;
          root.querySelector('#nlName').onkeydown = (e) => { if (e.key === 'Enter') go(); };
        });
    };
    el.querySelectorAll('[data-rename]').forEach(b => b.onclick = () => {
      const id = b.dataset.rename; const cur = getUserLists().find(x => x.id === id);
      showModal(`<h2>Renommer la liste</h2>
        <label class="field"><span>Nom</span><input class="input" id="rnName" value="${esc(cur ? cur.name : '')}"></label>
        <div class="row"><button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="rnGo">Enregistrer</button></div>`,
        (root) => {
          const go = () => { renameList(id, root.querySelector('#rnName').value); closeModal(); draw(); };
          root.querySelector('#rnGo').onclick = go;
          root.querySelector('#rnName').onkeydown = (e) => { if (e.key === 'Enter') go(); };
        });
    });
    el.querySelectorAll('[data-dellist]').forEach(b => b.onclick = () => {
      const id = b.dataset.dellist; const cur = getUserLists().find(x => x.id === id);
      showModal(`<h2>Supprimer la liste ?</h2><p>« ${esc(cur ? cur.name : '')} » sera définitivement supprimée. Les séries et films ne sont pas affectés.</p>
        <div class="row"><button class="btn ghost" data-close>Annuler</button><button class="btn danger" id="dlGo">Supprimer</button></div>`,
        (root) => { root.querySelector('#dlGo').onclick = () => { deleteList(id); closeModal(); draw(); toast('Liste supprimée'); }; });
    });
    el.querySelectorAll('[data-rmshow]').forEach(b => b.onclick = (ev) => { ev.stopPropagation(); const [id, key] = b.dataset.rmshow.split('|'); listToggleShow(id, key); draw(); });
    el.querySelectorAll('[data-rmmovie]').forEach(b => b.onclick = (ev) => { ev.stopPropagation(); const [id, name] = b.dataset.rmmovie.split('|'); listToggleMovie(id, name); draw(); });
    el.querySelectorAll('[data-open-show]').forEach(c => c.onclick = (ev) => { if (ev.target.closest('.list-remove')) return; openShow(c.dataset.openShow); });
    el.querySelectorAll('[data-open-movie]').forEach(c => c.onclick = (ev) => { if (ev.target.closest('.list-remove')) return; openMovie(c.dataset.openMovie); });

    // hydrate posters for user-list items
    const sList = lists.flatMap(l => (l.shows || []).map(k => MODEL.shows.get(k)).filter(Boolean));
    if (sList.length) hydratePosters(el, sList);
    const mList = lists.flatMap(l => (l.movies || []).map(n => movieByName[n]).filter(Boolean));
    if (mList.length) hydrateMoviePosters(el, mList);

    // imported lists (read-only, resolved via TMDB)
    imported.forEach(async (l, i) => {
      const grid = el.querySelector('#implist_' + i);
      if (!grid) return;
      if (!hasKey()) { grid.innerHTML = `<p class="hint" style="grid-column:1/-1;color:var(--muted)">Ajoutez une clé TMDB pour afficher les affiches.</p>`; return; }
      // Chaque élément : affiche + titre dessous ; un clic ouvre la fiche si l'œuvre est dans la bibliothèque, sinon l'aperçu.
      grid.innerHTML = (l.items || []).map(it => `<div class="show-card imp-item" data-lid="${esc(it.id)}" data-type="${esc(it.type)}"><div class="poster"><div class="ph">🎬</div></div><div class="title">…</div></div>`).join('');
      for (const card of grid.querySelectorAll('.imp-item')) {
        try {
          const type = card.dataset.type === 'movie' ? 'movie' : 'tv';
          const res = await tmdbFetch(`/find/${card.dataset.lid}?external_source=tvdb_id`);
          let hit = (type === 'movie' ? res.movie_results : res.tv_results)?.[0];
          let mt = type;
          if (!hit) { hit = res.tv_results?.[0] || res.movie_results?.[0]; mt = res.tv_results?.[0] ? 'tv' : 'movie'; }
          if (!hit) { card.querySelector('.title').textContent = 'Introuvable sur TMDB'; continue; }
          const poster = card.querySelector('.poster'), nm = hit.name || hit.title || '';
          poster.innerHTML = hit.poster_path ? `<img loading="lazy" src="${IMG(hit.poster_path)}" alt="">` : `<div class="fallback-title">${esc(nm)}</div>`;
          card.querySelector('.title').textContent = nm;
          card.onclick = () => {
            const h = Object.assign({}, hit, { media_type: mt });
            const key = ownedLookup()(h);
            if (key) { mt === 'tv' ? openShow(key) : openMovie(key); return; }
            navTo('#/preview/' + mt + '/' + hit.id);
          };
        } catch {}
      }
    });
  }
  draw();
});

//////////////////////// Settings ////////////////////////
route('settings', async (el) => {
  el.innerHTML = `
    ${backBtn('#/profile')}
    <div class="page-head"><h1>Réglages</h1></div>
    <div class="panel">
      <h3>Affichage</h3>
      <p class="hint" style="color:var(--muted);margin:0">Couleurs, thème clair ou noir, tailles, onglet d'ouverture… : <a href="#/custom">${icon('palette')} Personnalisation</a>.</p>
    </div>
    <div class="panel">
      <div class="settings-field">
        <label>Clé API TMDB</label>
        <div style="display:flex;gap:8px"><input class="input" id="tmdbKey" type="password" autocomplete="off" placeholder="Collez votre clé API TMDB (v3)" value="${esc(userState.tmdbKey)}" style="flex:1;min-width:0"><button class="btn" id="tmdbKeyShow" type="button">Afficher</button></div>
        <div class="hint">Gratuit : créez un compte sur <b>themoviedb.org</b> → Paramètres → API → demandez une clé « Developer ». Copiez la <b>clé API (v3 auth)</b>. Elle permet d'afficher les affiches, la liste complète des épisodes, les dates de diffusion et « Prochains épisodes ».</div>
      </div>
      <div class="row" style="display:flex;gap:10px">
        <button class="btn primary" id="saveKey">Enregistrer</button>
        <button class="btn" id="testKey">Tester la clé</button>
        <span id="keyStatus" class="sub" style="align-self:center"></span>
      </div>
    </div>

    <div class="panel">
      <h3>Synchronisation</h3>
      <p class="hint" style="color:var(--muted)">Pré-charge les affiches et épisodes de vos séries et les affiches de vos films (recommandé pour « Prochains épisodes », le temps de visionnage exact et les affiches manquantes). ${Object.keys(tmdbCache.shows).length} série(s) et ${Object.keys(tmdbCache.movies || {}).length} film(s) en cache.</p>
      <div class="row" style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn primary" id="syncAll">Synchroniser toutes mes œuvres</button><span id="syncProg" class="sub" style="align-self:center"></span></div>
    </div>

    <div class="panel">
      <h3>Sauvegarde dans un fichier</h3>
      <p class="hint" style="color:var(--muted)">${serverAvailable
        ? 'Vos ajouts (épisodes vus, notes, réactions) sont enregistrés dans <b>userdata.json</b> à côté de l\'application.'
        : 'Mode autonome : vos ajouts sont enregistrés <b>sur cet appareil</b> (stockage du navigateur). Pensez à exporter une sauvegarde de temps en temps.'}<br>
      « Exporter » crée une <b>sauvegarde complète</b> (tout votre historique + vos ajouts). « Importer » la restaure entièrement, y compris sur un autre appareil.</p>
      <div class="row" style="display:flex;gap:10px">
        <button class="btn" id="exportBtn">Exporter mes données</button>
        <label class="btn" style="cursor:pointer">Importer<input type="file" id="importFile" accept="application/json" hidden></label>
      </div>
      <div id="undoRestoreBox"></div>
      ${sbSession ? sbStateHtml() : ''}
      ${serverAvailable ? '' : `<p class="hint" style="color:var(--muted);margin-top:10px">Dernière sauvegarde dans un fichier : <b>${userState.lastBackupAt ? esc(fmtAgo(userState.lastBackupAt)) : 'jamais'}</b></p>
      <label class="check-row"><input type="checkbox" id="weeklyBackup" ${userState.weeklyBackup !== false ? 'checked' : ''}> Me proposer une sauvegarde chaque semaine</label>`}
    </div>

    <div class="panel">
      <h3>Partager ma liste</h3>
      <p class="hint" style="color:var(--muted)">Crée un fichier avec vos séries et films <b>sans l'historique</b> (rien n'est marqué comme vu). La personne qui le reçoit clique sur <b>« Importer »</b> ci-dessus : ses propres œuvres sont <b>conservées</b>, les vôtres viennent s'ajouter (sans doublon).</p>
      <button class="btn" id="shareBtn">Partager ma liste (sans l'historique)</button>
    </div>

    <div class="panel">
      <h3>À propos</h3>
      <p class="hint" style="color:var(--muted)"><b>TV Time</b> · version ${APP_VERSION}<br>
      Données importées le ${esc((DATA.generatedAt || '').replace('T', ' '))}. Compte : ${esc(DATA.user?.mail || '')}.<br>
      ${(DATA.shows || []).length} séries · ${(DATA.seen || []).length} épisodes vus · ${((DATA.emotions || []).length + (DATA.episodeRatings || []).length)} réactions.</p>
      <p style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><a class="btn ghost sm" href="#/changelog">${icon('sparkle')} Notes de version</a><button class="btn ghost sm" id="guideBtn" type="button">${icon('book')} Revoir le guide</button></p>
    </div>`;

  el.querySelector('#guideBtn').onclick = () => showGuide(0);
  el.querySelector('#saveKey').onclick = () => { userState.tmdbKey = el.querySelector('#tmdbKey').value.trim(); scheduleSaveState(); updateSyncStatus(); toast('Clé enregistrée'); };
  el.querySelector('#tmdbKeyShow').onclick = (ev) => {
    const inp = el.querySelector('#tmdbKey'), show = inp.type === 'password';
    inp.type = show ? 'text' : 'password'; ev.currentTarget.textContent = show ? 'Masquer' : 'Afficher';
  };
  el.querySelector('#testKey').onclick = async () => {
    const st = el.querySelector('#keyStatus'); st.textContent = 'Test…';
    const prevKey = userState.tmdbKey; // une clé invalide n'est pas gardée
    userState.tmdbKey = el.querySelector('#tmdbKey').value.trim();
    try { await tmdbFetch('/configuration'); st.textContent = '✅ Clé valide'; scheduleSaveState(); updateSyncStatus(); }
    catch (e) {
      userState.tmdbKey = prevKey;
      st.textContent = /TMDB 40[13]/.test(String(e && e.message)) ? '❌ Clé invalide (non enregistrée)' : '⚠️ Test impossible (réseau ?) — clé non enregistrée';
    }
  };
  el.querySelector('#syncAll').onclick = () => syncEverything(el.querySelector('#syncProg'));
  el.querySelector('#exportBtn').onclick = () => { exportData(); render(); };
  const wb = el.querySelector('#weeklyBackup');
  if (wb) wb.onchange = (e) => { userState.weeklyBackup = e.target.checked; scheduleSaveState(); };
  el.querySelector('#shareBtn').onclick = exportSharedList;
  el.querySelector('#importFile').onchange = importData;
  // Copie faite avant la dernière restauration : bouton pour tout remettre comme avant.
  idbGet('avantRestauration').then((s) => {
    const box = el.querySelector('#undoRestoreBox');
    if (!s || !s.userState || !box) return;
    const d = new Date(s.at);
    const when = isNaN(d) ? '' : ` (${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})`;
    box.innerHTML = `<button class="btn ghost" id="undoRestore" style="margin-top:10px">↩ Revenir à l’état du${when.replace(' (', ' ').replace(')', '')}</button>`;
    box.querySelector('#undoRestore').onclick = () => undoLastRestore();
  });
});

async function syncEverything(progEl) {
  if (!hasKey()) { toast('Ajoutez d\'abord une clé TMDB'); return; }
  await syncAllShows(progEl);
  await syncAllMovies(progEl);
  if (progEl) progEl.textContent = '✅ Terminé';
  toast('Synchronisation terminée');
}

async function syncAllShows(progEl) {
  buildModel();
  const shows = Array.from(MODEL.shows.values()).filter(s => (s.followed || s.seenKeys.size) && s.tvdbId);
  let done = 0;
  const queue = shows.slice();
  const worker = async () => {
    while (queue.length) {
      const sh = queue.shift();
      try {
        const id = await resolveTmdbId(sh.tvdbId);
        if (id) { const m = await getShowMeta(id); for (const s of m.seasons) await getSeasonEpisodes(id, s.n); }
      } catch {}
      done++; if (progEl) progEl.textContent = `Séries ${done}/${shows.length}…`;
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));
  scheduleSaveCache();
}

async function syncAllMovies(progEl) {
  const movies = (DATA.movies || []).concat(userState.customMovies || []);
  let done = 0;
  const queue = movies.slice();
  const worker = async () => {
    while (queue.length) {
      const m = queue.shift();
      try { await resolveMovie(m.name, movieYear(m)); } catch {}
      done++; if (progEl) progEl.textContent = `Films ${done}/${movies.length}…`;
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  scheduleSaveCache();
}

// Full backup: catalogue complet (historique) + éditions utilisateur.
function buildBackup() {
  userState.lastBackupAt = new Date().toISOString();
  scheduleSaveState();
  return {
    format: 'tvtime-full',
    version: APP_VERSION,
    exportedAt: userState.lastBackupAt,
    data: DATA,
    userState: userState,
  };
}

