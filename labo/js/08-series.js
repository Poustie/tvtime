/* Mon TV Time — Page Séries */
'use strict';
//////////////////////// Home view ////////////////////////
const MS_DAY = 86400000;
const RECENT_DAYS = 31; // fenêtre « nouvel épisode récent » (~1 mois)
const ACTIVE_DAYS = 92; // une série vue il y a moins de ~3 mois est encore « En cours »
function daysSince(dateStr) {
  if (!dateStr) return Infinity;
  const t = Date.parse(String(dateStr).replace(' ', 'T'));
  if (isNaN(t)) return Infinity;
  return (Date.now() - t) / MS_DAY;
}
function fmtAgo(dateStr) {
  const d = daysSince(dateStr);
  if (!isFinite(d)) return 'jamais';
  const n = Math.round(d);
  if (n <= 0) return "aujourd'hui";
  if (n === 1) return 'hier';
  if (n < 7) return `il y a ${n} j`;
  if (n < 31) return `il y a ${Math.round(n / 7)} sem.`;
  if (n < 365) return `il y a ${Math.round(n / 30)} mois`;
  return `il y a ${Math.round(n / 365)} ${plural(Math.round(n / 365), 'an', 'ans')}`;
}

route('home', async (el) => {
  buildModel();
  const shows = Array.from(MODEL.shows.values());
  el.innerHTML = `
    <div class="page-head"><h1>Séries</h1>${searchBtn('tv')}${acctBtn()}
      <div class="spacer"></div>
      ${seriesTab === 'avoir' ? `<button class="btn sm ghost ${homeEditOrder ? 'primary' : ''}" id="btnReorder">${homeEditOrder ? icon('check') + ' Terminé' : icon('sort') + ' Réorganiser'}</button>` : ''}
    </div>
    <div class="pill-tabs" id="seriesTabs">
      <span class="chip ${seriesTab === 'avoir' ? 'active' : ''}" data-stab="avoir">${icon('tv')} Mes séries</span>
      <span class="chip ${seriesTab === 'asuivre' ? 'active' : ''}" data-stab="asuivre">${icon('play')} Prochains</span>
      <span class="chip ${seriesTab === 'calendrier' ? 'active' : ''}" data-stab="calendrier">${icon('calendar')} Calendrier</span>
    </div>
    <div id="seriesBody"></div>`;

  wireSearchBtn(el);
  el.querySelectorAll('#seriesTabs .chip').forEach(c => c.onclick = () => { seriesTab = c.dataset.stab; render(); });
  const bReorder = el.querySelector('#btnReorder');
  if (bReorder) bReorder.onclick = () => { homeEditOrder = !homeEditOrder; render(); };

  const body = el.querySelector('#seriesBody');
  if (seriesTab === 'asuivre') { await renderUpnext(body); return; }
  if (seriesTab === 'calendrier') { await renderCalendar(body); return; }
  await renderSeriesAvoir(body, shows);
});

// Categorised "À voir" view of the Séries page (En cours / Pas vu / Pas commencée / Terminée).
// Catégorie d'une série sur la page Séries (« En cours », « Pas vu depuis longtemps », « Pas commencée »,
// « Terminée ») ; null = arrêtée ou non suivie. Aussi utilisée pour les séries en cours du profil en ligne.
function seriesCategory(s) {
  if (s.archived) return null;
  const started = s.seenKeys.size > 0;
  if (!started) return s.followed ? 'notStarted' : null;
  const m = metaFor(s);
  const total = airedTotal(m);
  const done = total > 0 && s.seenKeys.size >= total;
  const rewatching = isRewatching(s);
  // Tout vu = Terminée — sauf si un nouveau visionnage est en cours (revisionnage).
  if (done && !rewatching) return 'finished';
  // « En cours » si :
  if (isPinnedWatching(s)) return 'watching';                              // épinglée : toujours
  if (daysSince(s.lastSeenAt) <= activeDays()) return 'watching';         // épisode vu (ou revu) récemment (3 mois par défaut)
  const firstNew = done ? null : firstNewEpisodeAir(s, m);
  if (firstNew && daysSince(firstNew) <= newEpDays()) return 'watching';   // nouvel épisode non vu : 1 mois max (par défaut) après sa sortie
  return s.followed ? 'stale' : null;
}
// Date de sortie du dernier épisode sorti, s'il est postérieur à votre dernier visionnage (donc non vu). null sinon.
function firstNewEpisodeAir(s, m) {
  if (!m || !m.lastAir) return null;
  const lastSeen = s.lastSeenAt ? String(s.lastSeenAt).slice(0, 10) : '';
  if (m.lastAir <= lastSeen) return null;
  const today = new Date().toISOString().slice(0, 10);
  // Règle du propriétaire (30/10) : date de sortie du PREMIER épisode sorti après le dernier visionnage (saisons en cache, sinon lastAir).
  let first = null;
  for (const se of m.seasons || []) {
    const eps = se.n > 0 && tmdbCache.seasons[m.id + '|' + se.n];
    if (!eps) continue;
    for (const e of eps) if (e.air && e.air > lastSeen && e.air <= today && (!first || e.air < first)) first = e.air;
  }
  return first || m.lastAir;
}
async function renderSeriesAvoir(el, shows) {
  const watching = [], stale = [], notStarted = [], finished = [], archived = [];
  const lists = { watching, stale, notStarted, finished };
  for (const s of shows) { if (s.archived) { archived.push(s); continue; } const c = seriesCategory(s); if (c) lists[c].push(s); } // arrêtées : section à part, jamais en double
  watching.sort((a, b) => (b.lastSeenAt || '').localeCompare(a.lastSeenAt || ''));
  stale.sort((a, b) => (a.lastSeenAt || '').localeCompare(b.lastSeenAt || ''));
  notStarted.sort((a, b) => displayName(a).localeCompare(displayName(b)));
  finished.sort((a, b) => (b.lastSeenAt || '').localeCompare(a.lastSeenAt || ''));
  archived.sort((a, b) => (b.lastSeenAt || '').localeCompare(a.lastSeenAt || ''));

  // Section definitions, rendered in the user-chosen order.
  const defs = {
    watching:   { id: 'homeWatching',   icon: '▶️', title: 'En cours',                sub: `Vue il y a moins de ${fmtDays(activeDays())}, épinglée, revisionnage récent ou nouvel épisode (${fmtDays(newEpDays())})`, list: watching,   withAgo: true },
    stale:      { id: 'homeStale',      icon: '🕰️', title: 'Pas vu depuis longtemps', sub: 'Séries suivies mises en pause',          list: stale,      withAgo: true },
    notStarted: { id: 'homeNotStarted', icon: '🆕', title: 'Pas commencée',           sub: 'Dans votre liste mais jamais démarrée', list: notStarted, withAgo: false },
    finished:   { id: 'homeFinished',   icon: '✅', title: 'Terminée',                sub: 'Vues intégralement',                    list: finished,   withAgo: true },
    archived:   { id: 'homeArchived',   icon: '⏹️', title: 'Arrêtées',                sub: 'Séries que vous avez décidé d’arrêter',  list: archived,   withAgo: true },
  };
  const order = normalizeHomeOrder(userState.homeOrder);

  const sectionHtml = (secId, pos, total) => {
    const d = defs[secId];
    return `
    <section class="home-section" data-sec="${secId}">
      <div class="home-head">
        ${homeEditOrder ? `<div class="home-order">
          <button class="ord-btn" data-move="up" data-sec="${secId}" ${pos === 0 ? 'disabled' : ''} title="Monter">▲</button>
          <button class="ord-btn" data-move="down" data-sec="${secId}" ${pos === total - 1 ? 'disabled' : ''} title="Descendre">▼</button>
        </div>` : ''}
        <h2>${emojiIcon(d.icon)} ${d.title} <span class="sec-count">${d.list.length}</span></h2>
        <button class="sec-info" title="${esc(d.sub)}" aria-label="À propos de cette catégorie">${icon('info')}</button>
      </div>
      ${d.list.length ? `<div class="grid" id="${d.id}"></div>` : `<p class="home-empty">Rien ici pour le moment.</p>`}
    </section>`;
  };

  const shown = homeEditOrder ? order : order.filter(sec => !isHomeSectionHidden(sec));
  el.innerHTML = shown.map((secId, i) => sectionHtml(secId, i, shown.length)).join('');

  el.querySelectorAll('.sec-info').forEach(b => b.onclick = () => {
    const sec = b.closest('.home-section')?.dataset.sec;
    if (sec && defs[sec]) toast(defs[sec].sub);
  });

  const fill = (id, list, withAgo) => {
    const grid = el.querySelector('#' + id);
    if (!grid) return;
    grid.innerHTML = list.map(s => cardHtml(s)).join('');
    if (withAgo) {
      grid.querySelectorAll('.show-card').forEach(c => {
        const sh = MODEL.shows.get(c.dataset.key);
        const m = c.querySelector('.meta');
        if (sh && m) m.textContent = `${sh.seenKeys.size} vus · ${fmtAgo(sh.lastSeenAt)}`;
      });
    }
    grid.querySelectorAll('.show-card').forEach(c => c.onclick = () => openShow(c.dataset.key));
    hydratePosters(grid, list);
  };
  for (const secId of order) fill(defs[secId].id, defs[secId].list, defs[secId].withAgo);

  // Reorder controls
  el.querySelectorAll('.ord-btn[data-move]').forEach(b => b.onclick = () => {
    moveHomeSection(b.dataset.sec, b.dataset.move);
    render();
  });

  // Fetch fresh airing info for running shows in the background, then re-render in place (same scroll position).
  refreshAiringDates(shows).then(changed => {
    if (!changed || currentRoute().split('/')[0] !== 'home') return;
    scrollByHash[location.hash] = window.scrollY;
    render();
  });
}

// Cached TMDB meta for a show (no network).
function metaFor(sh) {
  if (!sh) return null;
  const id = sh.forcedTmdb || (sh.tvdbId != null ? tmdbCache.map[sh.tvdbId] : null);
  return id ? (tmdbCache.shows[id] || null) : null;
}
// Episodes already broadcast. TMDB's total also counts announced future episodes
// (e.g. a next season listed with 1 episode a year ahead).
function airedTotal(m) {
  if (!m || !(m.totalEpisodes > 0)) return 0;
  const le = m.lastEp;
  if (!le || !m.nextAir) return m.totalEpisodes;
  let n = le.n;
  for (const s of m.seasons || []) if (s.n < le.s) n += s.count;
  return Math.max(1, Math.min(m.totalEpisodes, n));
}

// Refetch meta of running shows when it is missing airing fields, when the
// announced next episode date has passed, or when it is over a week old.
// Each show is tried at most once per session (TMDB can keep a past date).
const _airTried = new Set();
async function refreshAiringDates(shows) {
  if (!hasKey()) return false;
  const todo = [];
  for (const sh of shows) {
    if (_airTried.has(sh.key)) continue;
    const m = metaFor(sh);
    if (!m || m.status !== 'Returning Series') continue;
    const age = Date.now() - (m.fetchedAt || 0);
    const stale = !('lastEp' in m) || (m.nextAir && daysSince(m.nextAir) >= 0 && age > MS_DAY / 2) || age > 7 * MS_DAY;
    if (stale) { todo.push(sh); _airTried.add(sh.key); }
  }
  if (!todo.length) return false;
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const sh = todo[i++];
      const id = sh.forcedTmdb || tmdbCache.map[sh.tvdbId];
      if (!id) continue;
      try { await getShowMeta(id, true); } catch {}
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));
  return true;
}

// Keep only known section ids, in a valid order, filling any missing ones.
function normalizeHomeOrder(order) {
  const known = ['watching', 'stale', 'notStarted', 'finished', 'archived'];
  const out = [];
  for (const s of (Array.isArray(order) ? order : [])) if (known.includes(s) && !out.includes(s)) out.push(s);
  for (const s of known) if (!out.includes(s)) out.push(s);
  return out;
}
function moveHomeSection(secId, dir) {
  const order = normalizeHomeOrder(userState.homeOrder);
  const i = order.indexOf(secId);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  userState.homeOrder = order;
  scheduleSaveState();
}

