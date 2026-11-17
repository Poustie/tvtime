/* Mon TV Time — Prochain épisode, Prochains épisodes, titres similaires */
'use strict';
//////////////////////// Prochain épisode (« Prochains épisodes » + fiche série) ////////////////////////
// nextEpisodeInfo(sh) = UN seul calcul pour la page « Prochains épisodes » et la ligne « Prochain épisode » de la fiche série.
// Règle de reprise (comme la fiche) : premier épisode SORTI et non vu qui vient APRÈS le dernier épisode vu (saison 0 ignorée) ;
// pendant un revisionnage, premier épisode vu mais pas encore revu dans le passage en cours.
// Résultat : { tmdbId, poster, status, next, soon, remaining, rewatch, ended }
//   next = { s, n, name, air } | null  (épisode à regarder maintenant)
//   soon = { s, n, name, air } | null  (prochain épisode ANNONCÉ, date future ; s/n = null si seule la date est connue)
//   remaining = épisodes sortis non vus après le point de reprise (revisionnage : épisodes restant à revoir)
// null = série inconnue de TMDB / pas de clé / erreur réseau (non mémorisé). Mémorisé en mémoire pour la session
// (clé = série, validité = signature des épisodes vus) ; force = recalcul.
const _nextInfo = new Map(); // clé série -> { sig, p: Promise }
function lastSeenPoint(sh) {
  let s = -1, n = -1;
  for (const k of sh.seenKeys) {
    const p = k.split('|'); const S = +p[p.length - 2], N = +p[p.length - 1];
    if (S > 0 && (S > s || (S === s && N > n))) { s = S; n = N; }
  }
  return { s, n };
}
function nextSig(sh) {
  const lp = lastSeenPoint(sh), pass = currentPass(sh), rp = pass ? rewatchPass(sh) : null;
  return [sh.seenKeys.size, lp.s, lp.n, sh.lastSeenAt || '', pass ? pass.level + ':' + (rp ? rp.done : '') : '',
    customEpsForShow(sh).length, overrideShowTmdb(sh) || sh.tvdbId || '', hasKey() ? 1 : 0, userState.tmdbKey ? 1 : 0, _seasonVer, (metaFor(sh) || {}).fetchedAt || 0].join('|');
}
function nextEpisodeInfo(sh, force, forceSeasons) {
  const sig = nextSig(sh), c = _nextInfo.get(sh.key);
  if (!force && c && c.sig === sig) return c.p;
  const entry = { sig, p: null };
  entry.p = computeNextInfo(sh, forceSeasons).then((r) => { if (r && r.partial && _nextInfo.get(sh.key) === entry) _nextInfo.delete(sh.key); return r; }) // saison non chargée (hors-ligne, 429) : pas mémorisé, retenté au prochain affichage
    .catch(() => { if (_nextInfo.get(sh.key) === entry) _nextInfo.delete(sh.key); return null; });
  _nextInfo.set(sh.key, entry);
  return entry.p;
}
async function computeNextInfo(sh, forceSeasons) {
  if (!hasKey()) return null;
  const tmdbId = overrideShowTmdb(sh) || (sh.tvdbId ? await resolveTmdbId(sh.tvdbId) : null);
  if (!tmdbId) {
    // Vrai « introuvable » (mémorisé dans tmdbCache.map) -> null ; sinon erreur de résolution -> résultat partiel, non mémorisé.
    if (!sh.tvdbId || (sh.tvdbId in tmdbCache.map)) return null;
    return { tmdbId: null, poster: null, status: '', next: null, soon: null, remaining: 0, rewatch: false, ended: false, partial: true, unknown: true };
  }
  let meta = tmdbCache.shows[tmdbId];
  if (!meta || !meta.seasons) meta = await getShowMeta(tmdbId);
  const pass = currentPass(sh);
  const out = { tmdbId, poster: meta.poster || null, status: meta.status || '', next: null, soon: null, remaining: 0, rewatch: !!pass, ended: false, partial: false };
  // Série terminée sur TMDB et entièrement vue : rien à calculer (pas de réseau).
  if (!pass && meta.status && meta.status !== 'Returning Series' && !meta.nextAir && isShowComplete(sh)) { out.ended = true; return out; }
  const today = todayDayNum();
  const customs = customEpsForShow(sh).filter(e => e.s > 0);
  const tmdbSeasons = new Set((meta.seasons || []).map(s => s.n).filter(n => n > 0));
  const all = Array.from(new Set([...tmdbSeasons, ...customs.map(e => e.s)])).sort((a, b) => a - b);
  const lp = lastSeenPoint(sh);
  // Perf : seulement de la saison du dernier épisode vu jusqu'à la dernière (tout, en revisionnage ou si rien n'est vu).
  const seasons = (pass || lp.s < 0) ? all : all.filter(sn => sn >= lp.s);
  for (const sn of seasons) {
    let eps = [];
    if (tmdbSeasons.has(sn)) { try { eps = await getSeasonEpisodes(tmdbId, sn, !!forceSeasons && isLiveSeason(meta, sn)); } catch { eps = []; out.partial = true; } }
    const present = new Set(eps.map(e => e.n));
    eps = eps.concat(customs.filter(e => e.s === sn && !present.has(e.n)).map(e => ({ n: e.n, name: e.name, air: null, custom: true })))
      .sort((a, b) => a.n - b.n);
    for (const e of eps) {
      const seen = isSeen(sh, sn, e.n);
      const item = { s: sn, n: e.n, name: e.name || '', air: e.air || null };
      if (pass) { // revisionnage : vu mais pas encore revu dans ce passage
        if (seen && !inCurrentPass(sh, sn, e.n, pass)) { out.remaining++; if (!out.next) out.next = item; }
        continue;
      }
      if (seen) continue;
      const aired = e.custom || (e.air && dayNumOf(e.air) <= today);
      if (aired) {
        if (sn > lp.s || (sn === lp.s && e.n > lp.n)) { out.remaining++; if (!out.next) out.next = item; }
      } else if (e.air && (!out.soon || e.air < out.soon.air)) out.soon = item;
    }
  }
  // Seule la date est connue (liste d'épisodes pas encore à jour) : on garde la date annoncée par la série.
  if (!pass && !out.soon && meta.nextAir && dayNumOf(meta.nextAir) >= today) out.soon = { s: null, n: null, name: '', air: meta.nextAir };
  return out;
}
// Groupe de la page « Prochains épisodes » : 'new' | 'resume' | 'soon' | 'uptodate'.
function upnextGroup(sh, info) {
  if (info.next) {
    if (info.rewatch) return 'resume';
    const ls = sh.lastSeenAt ? String(sh.lastSeenAt).slice(0, 10) : '';
    // Nouveau : sorti APRÈS mon dernier visionnage, ou sorti récemment (newEpDays, 31 j par défaut : un rattrapage reste « nouveau »).
    if (info.next.air && ((ls && info.next.air > ls) || daysSince(info.next.air) <= newEpDays())) return 'new';
    // Retard : « À reprendre » si vu dans la durée « En cours » (ou épinglée), sinon « En pause ».
    return (isPinnedWatching(sh) || !sh.lastSeenAt || daysSince(sh.lastSeenAt) <= activeDays()) ? 'resume' : 'pause';
  }
  return info.soon ? 'soon' : 'uptodate';
}

//////////////////////// Up Next ////////////////////////
// Legacy #/upnext link -> now a tab inside the Séries page.
route('upnext', () => { seriesTab = 'asuivre'; location.hash = '#/home'; });

const UPNEXT_GROUPS = [
  ['new', '🆕', 'Nouveaux épisodes', 'Sortis depuis votre dernier visionnage'],
  ['resume', '▶', 'À reprendre', 'Épisodes en retard, sortis avant votre dernier visionnage'],
  ['soon', '📅', 'Bientôt', 'Séries à jour avec un prochain épisode annoncé'],
  ['pause', '⏸', 'En pause', 'Retard sur des séries pas regardées depuis longtemps'],
];
let _upPauseOpen = false; // groupe « En pause » replié par défaut
// « Prochains épisodes » : trois groupes (nouveaux épisodes / à reprendre / bientôt) pour les séries suivies, non arrêtées,
// commencées (ou épinglées « en cours »). Rendu dans la page Séries.
async function renderUpnext(el) {
  buildModel();
  if (!hasKey()) { el.innerHTML = needKeyHtml('« Prochains épisodes » a besoin des données TMDB pour connaître les épisodes disponibles.'); return; }
  el.innerHTML = `<div class="home-head" style="margin-bottom:14px"><span class="sub" id="upSub">Prochain épisode de vos séries en cours</span>
    <div class="spacer"></div><button class="btn sm ghost" id="refreshUp">Actualiser</button></div>
    <div id="upList"><div class="loading">Analyse de vos séries…</div></div>`;

  const candidates = Array.from(MODEL.shows.values()).filter(s => s.followed && !s.archived && (s.seenKeys.size > 0 || isPinnedWatching(s)));
  const listEl = el.querySelector('#upList');
  const setSub = (txt) => { const s = el.querySelector('#upSub'); if (s) s.textContent = txt; };
  const entries = []; // { sh, info, group }
  const silentSet = new Set(); // séries à jour sans date annoncée

  const collect = async (force) => {
    entries.length = 0; silentSet.clear();
    let done = 0;
    const queue = candidates.slice();
    const worker = async () => {
      while (queue.length) {
        const sh = queue.shift();
        let info = null;
        try { info = await nextEpisodeInfo(sh, false, force); } catch {}
        done++;
        if (info) {
          const g = upnextGroup(sh, info);
          if (g === 'uptodate') { if (!info.ended && !info.unknown) silentSet.add(sh.key); } else entries.push({ sh, info, group: g });
        }
        if (done % 5 === 0 || done === candidates.length) setSub(`Analyse ${done}/${candidates.length}…`);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  };

  const rowHtml = (r) => {
    const { sh, info, group } = r;
    const e = group === 'soon' ? info.soon : info.next;
    const hasEp = e.s != null;
    const spoil = antiSpoiler() && e.name && !(hasEp && isSeen(sh, e.s, e.n));
    const title = hasEp ? (e.name || 'Épisode ' + epDisp(sh, e.s, e.n).n) : '';
    let when, wIc = '';
    if (group === 'soon') {
      const d = daysFromToday(e.air);
      when = d <= 1 ? relDay(e.air) : `${relDay(e.air)} · ${inDays(e.air)}`;
      wIc = icon('calendar') + ' ';
    } else if (info.rewatch) { when = 'À revoir'; wIc = icon('repeat') + ' '; }
    else { when = e.air ? `Sorti ${relDay(e.air)}` : 'Disponible'; if (group === 'new') wIc = icon('sparkle') + ' '; }
    const left = group !== 'soon' && info.remaining > 0 ? ` · ${info.remaining} restant${info.remaining > 1 ? 's' : ''}` : '';
    return `<div class="upnext-row" data-key="${esc(sh.key)}">
      <div class="poster">${posterHtml(sh, info.poster)}</div>
      <div class="info">
        <div class="sname">${esc(displayName(sh))}</div>
        ${hasEp ? `<div class="ename"><b>${epTag(sh, e.s, e.n)}</b> · <span class="${spoil ? 'spoil-name' : ''}">${esc(title)}</span></div>` : ''}
        <div class="when">${wIc}${esc(when + left)}</div>
      </div>
      ${group !== 'soon' ? `<button class="btn sm ghost up-mark" data-mark title="${info.rewatch ? 'Compter un revisionnage' : 'Marquer comme vu'}">${info.rewatch ? '🔁 Revu' : '✓ Vu'}</button>` : ''}
    </div>`;
  };
  const sortGroup = (g, a, b) => {
    if (g === 'new') return (b.info.next.air || '').localeCompare(a.info.next.air || '');
    if (g === 'resume' || g === 'pause') return (b.sh.lastSeenAt || '').localeCompare(a.sh.lastSeenAt || '');
    return (a.info.soon.air || '').localeCompare(b.info.soon.air || '');
  };
  const paint = () => {
    const n = entries.length, silent = silentSet.size;
    setSub(n ? `${n} série${n > 1 ? 's' : ''} avec un épisode à regarder` : 'Prochain épisode de vos séries en cours');
    if (!n && !silent) { listEl.innerHTML = `<div class="empty"><div class="big">🎉</div>Rien à regarder pour l’instant.<br><small>Commencez une série ou épinglez-en une pour la voir ici.</small></div>`; return; }
    listEl.innerHTML = UPNEXT_GROUPS.map(([g, ico, title, hint]) => {
      const rows = entries.filter(r => r.group === g).sort((a, b) => sortGroup(g, a, b));
      if (!rows.length) return '';
      return g === 'pause'
        ? `<section class="up-group up-pause"><button type="button" class="up-pause-head" aria-expanded="${_upPauseOpen}"><h2>${emojiIcon(ico)} ${title} <span class="sec-count">${rows.length}</span></h2><span class="caret">${_upPauseOpen ? '▾' : '▸'}</span></button>
        <div class="up-pause-body"${_upPauseOpen ? '' : ' hidden'}>${rows.map(rowHtml).join('')}</div></section>`
        : `<section class="up-group"><div class="home-head"><h2>${emojiIcon(ico)} ${title} <span class="sec-count">${rows.length}</span></h2>
        <button class="sec-info" title="${esc(hint)}" aria-label="À propos de ce groupe" data-hint="${esc(hint)}">${icon('info')}</button></div>
        ${rows.map(rowHtml).join('')}</section>`;
    }).join('') + (n ? '' : `<div class="empty"><div class="big">🎉</div>Vous êtes à jour !</div>`) +
      (silent ? `<p class="up-foot">${silent} série${silent > 1 ? 's' : ''} à jour sans date annoncée</p>` : '');
    listEl.querySelectorAll('.upnext-row').forEach(row => {
      const r = entries.find(x => x.sh.key === row.dataset.key);
      row.onclick = () => {
        const e = r.group === 'soon' ? r.info.soon : r.info.next;
        if (e && e.s != null) openEpisode(r.sh.key, e.s, e.n); else openShow(r.sh.key);
      };
      const b = row.querySelector('[data-mark]');
      if (b) b.onclick = (ev) => { ev.stopPropagation(); markNext(r); };
    });
    listEl.querySelectorAll('.sec-info').forEach(b => b.onclick = () => toast(b.dataset.hint));
    const ph = listEl.querySelector('.up-pause-head');
    if (ph) ph.onclick = () => { _upPauseOpen = !_upPauseOpen; paint(); };
  };
  // Recalcule UNE série après un changement, puis redessine (les listes d'épisodes sont en cache : instantané).
  const refreshOne = async (r) => {
    let info = null;
    try { info = await nextEpisodeInfo(r.sh); } catch {}
    const i = entries.indexOf(r);
    const g = info ? upnextGroup(r.sh, info) : 'uptodate';
    if (i >= 0) entries.splice(i, 1);
    silentSet.delete(r.sh.key);
    if (g === 'uptodate') { if (info && !info.ended && !info.unknown) silentSet.add(r.sh.key); } else entries.push({ sh: r.sh, info, group: g });
    paint();
  };
  const markNext = async (r) => {
    const sh = r.sh, e = r.info.next;
    if (!e || r._busy) return; // 2e tap pendant le traitement ignoré
    r._busy = true;
    try {
      const snap = snapshotEpisodes(sh, [epKey(sh.key, e.s, e.n)]); // état exact avant, restauré par « Annuler »
      if (r.info.rewatch) setRewatch(sh, e.s, e.n, rewatchOf(sh, e.s, e.n) + 1);
      else {
        toggleSeen(sh, e.s, e.n, true);
        const a = userState.seenAdd && userState.seenAdd[epKey(sh.key, e.s, e.n)];
        sh.lastSeenAt = maxDateStr(sh.lastSeenAt, a && a.at);
      }
      const undo = () => restoreSnapshot(snap);
      updateSyncStatus();
      toastUndo(`${epTag(sh, e.s, e.n)} ${r.info.rewatch ? 'revu' : 'vu'}`, async () => { undo(); updateSyncStatus(); await refreshOne(entries.find(x => x.sh === sh) || { sh }); });
      await refreshOne(r);
    } finally { r._busy = false; }
  };
  // « Actualiser » : recalcul complet ; les séries en cours de diffusion dont la fiche TMDB a plus d'un jour sont relues.
  el.querySelector('#refreshUp').onclick = async () => {
    listEl.innerHTML = '<div class="loading">Actualisation…</div>';
    const running = candidates.filter(s => { const m = metaFor(s); return m && m.status === 'Returning Series' && Date.now() - (m.fetchedAt || 0) > MS_DAY; });
    let i = 0;
    const w = async () => { while (i < running.length) { const sh = running[i++]; const id = overrideShowTmdb(sh) || tmdbCache.map[sh.tvdbId]; if (id) { try { await getShowMeta(id, true); } catch {} } } };
    await Promise.all(Array.from({ length: 6 }, w));
    _nextInfo.clear();
    await collect(true); paint(); // true : relit aussi la saison utile des séries en cours
  };

  await collect();
  if (!el.isConnected) return;
  paint();
}

//////////////////////// Calendrier des sorties ////////////////////////
// Épisodes des séries suivies (non arrêtées, commencées ou épinglées) sortis ces 7 derniers jours ou à venir dans les 30 jours,
// groupés par jour. Données : getSeasonEpisodes (cache + rafraîchissement existants) des saisons utiles (la dernière et celle du
// dernier épisode diffusé). Mémorisé pour la session : clé série -> { sig, p }.
const CAL_PAST = 7, CAL_AHEAD = 30;
const _calMemo = new Map();
let _calPastOpen = false; // section « Ces 7 derniers jours » repliée par défaut
function calSig(sh) { return [todayDayNum(), _seasonVer, overrideShowTmdb(sh) || sh.tvdbId || '', hasKey() ? 1 : 0].join('|'); }
// Épisodes de la fenêtre pour UNE série : { tmdbId, poster, eps: [{ s, n, name, air }] } ; null = série inconnue de TMDB.
function calendarEpisodes(sh, force) {
  const sig = calSig(sh), c = _calMemo.get(sh.key);
  if (!force && c && c.sig === sig) return c.p;
  const entry = { sig, p: null };
  entry.p = calLoad(sh, force).then((r) => { if (r && r.partial && _calMemo.get(sh.key) === entry) _calMemo.delete(sh.key); return r; })
    .catch(() => { if (_calMemo.get(sh.key) === entry) _calMemo.delete(sh.key); return null; });
  _calMemo.set(sh.key, entry);
  return entry.p;
}
async function calLoad(sh, force) {
  const tmdbId = overrideShowTmdb(sh) || (sh.tvdbId ? await resolveTmdbId(sh.tvdbId) : null);
  if (!tmdbId) return null;
  let meta = tmdbCache.shows[tmdbId];
  if (!meta || !meta.seasons) meta = await getShowMeta(tmdbId);
  const out = { tmdbId, poster: meta.poster || null, eps: [], partial: false };
  // Série terminée sans sortie récente : rien à chercher (pas de réseau).
  if (!isRunningMeta(meta) && !(meta.lastAir && daysFromToday(meta.lastAir) >= -CAL_PAST)) return out;
  const nums = (meta.seasons || []).map(s => s.n).filter(n => n > 0);
  const wanted = new Set();
  if (nums.length) wanted.add(Math.max(...nums));
  if (meta.lastEp && meta.lastEp.s > 0 && nums.includes(meta.lastEp.s)) wanted.add(meta.lastEp.s);
  for (const sn of wanted) {
    let eps = [];
    try { eps = await getSeasonEpisodes(tmdbId, sn, !!force && isLiveSeason(meta, sn)); } catch { out.partial = true; }
    for (const e of eps) {
      const d = daysFromToday(e.air);
      if (!isNaN(d) && d >= -CAL_PAST && d <= CAL_AHEAD) out.eps.push({ s: sn, n: e.n, name: e.name || '', air: e.air });
    }
  }
  return out;
}
async function renderCalendar(el) {
  buildModel();
  if (!hasKey()) { el.innerHTML = needKeyHtml('Le calendrier a besoin des données TMDB pour connaître les dates de sortie.'); return; }
  el.innerHTML = `<div class="home-head" style="margin-bottom:14px"><span class="sub" id="calSub">Sorties des 30 prochains jours de vos séries</span>
    <div class="spacer"></div><button class="btn sm ghost" id="refreshCal">Actualiser</button></div>
    <div id="calList"><div class="loading">Analyse de vos séries…</div></div>`;
  const candidates = Array.from(MODEL.shows.values()).filter(s => s.followed && !s.archived && (s.seenKeys.size > 0 || isPinnedWatching(s)));
  const listEl = el.querySelector('#calList');
  const setSub = (txt) => { const s = el.querySelector('#calSub'); if (s) s.textContent = txt; };
  let items = []; // { sh, poster, e }

  const collect = async (force) => {
    items = [];
    let done = 0;
    const queue = candidates.slice();
    const worker = async () => {
      while (queue.length) {
        const sh = queue.shift();
        let r = null;
        try { r = await calendarEpisodes(sh, force); } catch {}
        done++;
        if (r) for (const e of r.eps) items.push({ sh, poster: r.poster, e });
        if (done % 5 === 0 || done === candidates.length) setSub(`Analyse ${done}/${candidates.length}…`);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
  };
  const rowHtml = ({ sh, poster, e }, showDay) => {
    const seen = isSeen(sh, e.s, e.n);
    const spoil = antiSpoiler() && e.name && !seen;
    const title = e.name || 'Épisode ' + epDisp(sh, e.s, e.n).n;
    return `<div class="upnext-row cal-row" data-key="${esc(sh.key)}" data-s="${e.s}" data-n="${e.n}">
      <div class="poster">${posterHtml(sh, poster)}</div>
      <div class="info">
        <div class="sname">${esc(displayName(sh))}</div>
        <div class="ename"><b>${epTag(sh, e.s, e.n)}</b> · <span class="${spoil ? 'spoil-name' : ''}">${esc(title)}</span></div>
        ${showDay ? `<div class="when">${esc(fmtDayLong(e.air))}</div>` : ''}
      </div>
      ${seen ? '<span class="cal-seen" title="Déjà vu" aria-label="Déjà vu">✓</span>' : ''}
    </div>`;
  };
  const bySeries = (a, b) => displayName(a.sh).localeCompare(displayName(b.sh)) || a.e.s - b.e.s || a.e.n - b.e.n;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const paint = () => {
    const today = todayDayNum();
    const past = items.filter(x => daysFromToday(x.e.air) < 0).sort((a, b) => b.e.air.localeCompare(a.e.air) || bySeries(a, b));
    const days = new Map(); // date -> éléments
    for (const x of items) if (daysFromToday(x.e.air) >= 0) { const k = String(x.e.air).slice(0, 10); if (!days.has(k)) days.set(k, []); days.get(k).push(x); }
    const keys = Array.from(days.keys()).sort();
    const n = keys.reduce((t, k) => t + days.get(k).length, 0);
    setSub(n ? `${n} épisode${n > 1 ? 's' : ''} à venir dans les ${CAL_AHEAD} prochains jours` : 'Sorties des 30 prochains jours de vos séries');
    let html = '';
    if (past.length) html += `<section class="up-group up-pause"><button type="button" class="up-pause-head" aria-expanded="${_calPastOpen}"><h2>${icon('clock')} Ces ${CAL_PAST} derniers jours <span class="sec-count">${past.length}</span></h2><span class="caret">${_calPastOpen ? '▾' : '▸'}</span></button>
      <div class="up-pause-body"${_calPastOpen ? '' : ' hidden'}>${past.map(x => rowHtml(x, true)).join('')}</div></section>`;
    for (const k of keys) {
      const d = dayNumOf(k) - today;
      const title = d === 0 ? 'Aujourd’hui' : d === 1 ? 'Demain' : cap(fmtDayLong(k));
      const rows = days.get(k).sort(bySeries);
      html += `<section class="up-group cal-day"><div class="home-head"><h2>${esc(title)} <span class="sec-count">${rows.length}</span></h2></div>${rows.map(x => rowHtml(x, false)).join('')}</section>`;
    }
    if (!n) html += `<div class="empty"><div class="big">${emojiIcon('📅')}</div>Aucune sortie prévue dans les ${CAL_AHEAD} prochains jours pour vos séries.</div>`;
    listEl.innerHTML = html;
    listEl.querySelectorAll('.cal-row').forEach(row => row.onclick = () => openEpisode(row.dataset.key, +row.dataset.s, +row.dataset.n));
    const ph = listEl.querySelector('.up-pause-head');
    if (ph) ph.onclick = () => { _calPastOpen = !_calPastOpen; paint(); };
  };
  el.querySelector('#refreshCal').onclick = async () => {
    listEl.innerHTML = '<div class="loading">Actualisation…</div>';
    await collect(true); if (!el.isConnected) return; paint();
  };
  await collect();
  if (!el.isConnected) return;
  paint();
}

//////////////////////// Titres similaires (À propos) ////////////////////////
// Saga (collection TMDB, films seulement, dans l'ordre de sortie) + titres similaires
// (recommandations TMDB complétées par « similar »). Mis en cache 30 jours.
async function getRelated(kind, id) {
  if (!tmdbCache.related) tmdbCache.related = {};
  const ck = kind + id, cached = tmdbCache.related[ck];
  if (cached && Date.now() - cached.at < 30 * MS_DAY) return cached;
  const d = await tmdbFetch(`/${kind}/${id}?append_to_response=recommendations,similar`);
  let saga = null;
  const col = kind === 'movie' ? d.belongs_to_collection : null;
  if (col && col.id) {
    try {
      const cd = await tmdbFetch(`/collection/${col.id}`);
      const parts = (cd.parts || []).filter(p => p.id !== Number(id))
        .sort((a, b) => (a.release_date || '9999').localeCompare(b.release_date || '9999'));
      if (parts.length) saga = { name: cd.name || col.name || 'La saga', hits: parts.map(p => slimHit(p, 'movie')) };
    } catch {}
  }
  const skip = new Set([Number(id)].concat(saga ? saga.hits.map(h => h.id) : []));
  const similar = [];
  for (const h of ((d.recommendations || {}).results || []).concat((d.similar || {}).results || [])) {
    if (!h.poster_path || skip.has(h.id)) continue;
    skip.add(h.id); similar.push(slimHit(h, kind));
    if (similar.length >= 20) break;
  }
  const out = { at: Date.now(), saga, similar };
  tmdbCache.related[ck] = out; scheduleSaveCache();
  return out;
}
const relatedSlotHtml = () => '<div id="relatedSlot"></div>';
async function fillRelated(root, kind, id) {
  const slot = root && root.querySelector('#relatedSlot');
  if (!slot || !id || !hasKey()) return;
  let r;
  try { r = await getRelated(kind, id); } catch { return; }
  if (!slot.isConnected && !root.isConnected) return;
  const own = ownedLookup();
  const blocks = [];
  if (r.saga && r.saga.hits.length) blocks.push(['🎞️ ' + esc(r.saga.name), r.saga.hits]);
  if (r.similar.length) blocks.push([kind === 'tv' ? 'Séries similaires' : 'Films similaires', r.similar]);
  slot.innerHTML = blocks.map(([t, hits]) => `<div class="about-block related-block"><h3>${t}</h3><div class="exp-row">${expHitsHtml(hits, own)}</div></div>`).join('');
  slot.querySelectorAll('.related-block').forEach((b, i) => wireExpHits(b, blocks[i][1], own));
}

