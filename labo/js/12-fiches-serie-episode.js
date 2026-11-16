/* Mon TV Time — Fiche série et fiche épisode */
'use strict';
//////////////////////// Show detail ////////////////////////
route('show', async (el, rest) => {
  buildModel();
  const key = decodeURIComponent(rest.join('/'));
  const sh = MODEL.shows.get(key);
  if (!sh) { el.innerHTML = `<div class="empty">Série introuvable.</div>`; return; }
  const fresh = (lastShowKey !== key); // true only when arriving on this show (not on an in-page re-render)
  lastShowKey = key;

  let meta = null, tmdbId = null;
  if (hasKey()) {
    tmdbId = overrideShowTmdb(sh) || (sh.tvdbId ? await resolveTmdbId(sh.tvdbId) : null);
    if (tmdbId) { try { meta = await getShowMeta(tmdbId); } catch {} }
  }

  const genres = meta ? meta.genres.join(' · ') : '';
  el.innerHTML = `
    ${backBtn('#/home')}
    ${immHeroHtml({
      backdrop: meta && meta.backdrop, poster: meta && meta.poster, posterHtml: posterHtml(sh, meta && meta.poster),
      title: meta && meta.name ? fullTitle(meta.name, meta.originalName) : displayName(sh),
      sub: meta ? [(meta.firstAir || '').slice(0, 4), meta.status ? statusFr(meta.status) : '', genres].filter(Boolean).map(esc).join(' · ') : '',
      tags: `${sh.archived ? '<span class="chip chip-stop">' + icon('stop') + ' Arrêtée</span>' : ''}
        <span class="chip" id="showCount">${esc(showCountText(sh, meta))}</span>
        <span class="chip" id="showRwChip"${isRewatching(sh) ? '' : ' hidden'}>${esc(showRewatchText(sh))}</span>`,
    })}
    <div class="imm-body">
      <div class="detail-actions">
        <button class="btn ${isFavShow(sh) ? 'on' : ''}" id="btnFav">${isFavShow(sh) ? icon('heart', 'f') + ' Dans mes favoris' : icon('heart') + ' Ajouter aux favoris'}</button>
        ${sh.seenKeys.size === 0
          ? ((sh.archived || sh.custom) ? '' : `<button class="btn ${sh.followed ? '' : 'primary'}" id="btnLater">${sh.followed ? 'Retirer de mes séries' : icon('plus') + ' Ajouter à mes séries'}</button>`)
          : (sh.archived ? '' : `<button class="btn ${isPinnedWatching(sh) ? 'on' : ''}" id="btnPin">${icon('pin')} ${isPinnedWatching(sh) ? 'Épinglée' : 'Épingler'}</button>`)}
        ${sh.archived ? '<button class="btn primary" id="btnResume">▶ Reprendre la série</button>' : ''}
        <button class="btn" id="btnMore" aria-label="Plus d’actions">${icon('more')} Plus</button>
      </div>
      ${recoByHtml(sh.key)}
      <div id="nextEpLine"></div>
      ${avisCardHtml({ cls: 'show-react', score: showScore(sh), locked: !sh.seenKeys.size, vote: meta && meta.vote })}
      ${sh.seenKeys.size === 0 && tmdbId ? '<div class="appr-slot" id="apprSlot"></div>' : ''}
      ${meta && meta.overview ? `<div class="glass imm-card"><div class="overview">${esc(meta.overview)}</div></div>` : ''}
    </div>
    <div class="detail-tabs">
      <button class="tab active" data-tab="episodes">Épisodes</button>
      <button class="tab" data-tab="about">À propos</button>
    </div>
    <div class="tab-panel active" data-panel="episodes"><div id="seasons">${meta ? '<div class="loading">Chargement des épisodes…</div>' : offlineSeasons(sh)}</div></div>
    <div class="tab-panel" data-panel="about"><div id="about">${meta ? showAboutHtml(sh, meta) : ''}</div></div>`;

  wireTabs(el);
  wireReactPicker(el.querySelector('.show-react'), () => showScore(sh), (v) => setShowScore(sh, v), () => sh.seenKeys.size > 0);
  wireTrailer(el);
  if (meta) fillRelated(el, 'tv', meta.id);
  el.querySelector('#btnFav').onclick = () => { toggleFavShow(sh); toast(isFavShow(sh) ? 'Ajoutée aux favoris' : 'Retirée des favoris'); render(); };
  const bPin = el.querySelector('#btnPin');
  if (bPin) bPin.onclick = () => { togglePinWatching(sh); toast(isPinnedWatching(sh) ? 'Série épinglée' : 'Série désépinglée'); render(); };
  const bLater = el.querySelector('#btnLater');
  if (bLater) bLater.onclick = () => afterMyShowToggle(sh, toggleMyShow(sh));
  const bResume = el.querySelector('#btnResume');
  if (bResume) bResume.onclick = () => { toggleArchived(sh); toast('Série reprise'); render(); };
  wireRecoBy(el, sh.key);
  el.querySelector('#btnMore').onclick = () => openActionSheet(displayName(sh), showActionItems(sh, { meta, tmdbId, page: true }).concat(recoActionItems('tv', tmdbId, (meta && meta.name) || displayName(sh), meta && meta.poster)));

  renderAppreciation(el.querySelector('#apprSlot'), 'tv', tmdbId, meta);
  if (meta) await renderSeasons(el.querySelector('#seasons'), sh, tmdbId, meta, fresh);
  if (meta) {
    fillNextEpLine(el, sh);
    // Après un « vu » dans la liste des épisodes, la ligne « Prochain épisode » suit (calcul mémorisé : instantané).
    const sea = el.querySelector('#seasons');
    if (sea) sea.addEventListener('click', () => setTimeout(() => fillNextEpLine(el, sh), 150));
    // Fenêtres « Marquer une saison vue » / « marquer les précédents » (hors de #seasons)
    const mr = document.getElementById('modalRoot');
    if (mr) {
      if (_nextLineModalFn) mr.removeEventListener('click', _nextLineModalFn);
      _nextLineModalFn = () => setTimeout(() => { if (location.hash.startsWith('#/show/')) fillNextEpLine(el, sh); }, 300);
      mr.addEventListener('click', _nextLineModalFn);
    }
  }
});

// ---- Lot 9-B : en-tête immersif et carte « Votre avis » (fiche série, fiche film, aperçu Explorer) ----
// o = { backdrop, poster (chemins TMDB), posterHtml, title (texte brut), sub (HTML déjà échappé), tags (HTML) }
function immHeroHtml(o) {
  const url = o.backdrop ? IMG(o.backdrop, 'w780') : (o.poster ? IMG(o.poster, 'w342') : '');
  const kind = o.backdrop ? 'bd' : (o.poster ? 'pst' : 'none'); // pas de décor : affiche floutée, sinon dégradé
  return `<div class="detail-hero title-top imm">
    <div class="bg bg-${kind}" style="${url ? `background-image:url(${url})` : ''}"></div>
    <div class="poster imm-poster">${o.posterHtml || ''}</div>
    <div class="imm-in">
      <h1>${esc(o.title)}</h1>
      ${o.sub ? `<div class="sub">${o.sub}</div>` : ''}
      ${o.tags ? `<div class="tags">${o.tags}</div>` : ''}
    </div>
  </div>`;
}
const fmtVoteFr = (v) => (Number(v) > 0 ? Number(v).toFixed(1).replace('.', ',') : '');
// Note moyenne du public (TMDB), « 7,8 ★ »
const avgHtml = (v) => fmtVoteFr(v) ? `<span class="avis-avg" title="Note moyenne du public (TMDB)">Note moyenne <b>${fmtVoteFr(v)} ★</b></span>` : '';
// Carte « Votre avis » : les 5 réactions en grand (même mécanique que reactPickerHtml / wireReactPicker) + note moyenne.
// o = { cls, score, locked, vote }
function avisCardHtml(o) {
  return `<div class="glass avis-card ${o.cls || ''}${o.locked ? ' is-locked' : ''}">
    <div class="avis-head"><span class="react-label">Votre avis</span>${avgHtml(o.vote)}</div>
    ${reactPickerHtml(o.score, true, o.locked)}
  </div>`;
}

// ---- En-tête de la fiche série : « N épisode(s) vu(s) / T » et revisionnage, remis à jour à chaque changement ----
// Épisodes réguliers vus (saison 0 = spéciaux exclue : sinon « 74 / 73 »).
const regularSeenCount = (sh) => { let c = 0; for (const k of sh.seenKeys) { const p = k.split('|'); if (+p[p.length - 2] > 0) c++; } return c; };
function showCountText(sh, meta) {
  const t = meta && meta.totalEpisodes ? airedTotal(meta) : 0;
  return `${regularSeenCount(sh)} épisode(s) vu(s)${t ? ' / ' + t : ''}${meta && meta.totalEpisodes > t ? ` · ${meta.totalEpisodes - t} à venir` : ''}`;
}
function showRewatchText(sh) { const p = rewatchPass(sh); return '🔁 Revisionnage' + (p ? ` ${p.done}/${p.total}` : ''); }
function refreshShowHeader(sh) {
  const c = document.getElementById('showCount');
  if (c) c.textContent = showCountText(sh, metaFor(sh));
  const r = document.getElementById('showRwChip');
  if (r) { const on = isRewatching(sh); r.hidden = !on; if (on) r.textContent = showRewatchText(sh); }
}
let _nextLineModalFn = null;
// Ligne « Prochain épisode » sous l'en-tête de la fiche série (même calcul que « Prochains épisodes » : nextEpisodeInfo).
async function fillNextEpLine(el, sh) {
  const slot = el.querySelector('#nextEpLine');
  if (!slot || !hasKey() || !(sh.seenKeys.size > 0 || isPinnedWatching(sh))) return;
  let info = null;
  try { info = await nextEpisodeInfo(sh); } catch {}
  if (!slot.isConnected) return;
  const e = info && !info.rewatch ? (info.next || info.soon) : null;
  if (!e) { slot.innerHTML = ''; return; }
  const tag = e.s != null ? epTag(sh, e.s, e.n) : '';
  let txt;
  if (info.next) {
    const d = e.air ? daysFromToday(e.air) : NaN;
    txt = `▶ Prochain épisode : ${tag} · ` + (isNaN(d) ? 'disponible' : d === 0 ? "disponible aujourd’hui" : `disponible depuis le ${fmtDayLong(e.air, false)}`);
  } else txt = `📅 Prochain épisode : ${tag ? tag + ' · ' : ''}${fmtDayLong(e.air)} (${inDays(e.air)})`;
  slot.innerHTML = `<button type="button" class="next-ep-line">${esc(txt)}</button>`;
  slot.querySelector('button').onclick = () => { if (e.s != null) openEpisode(sh.key, e.s, e.n); };
}

//////////////////////// Episode detail ////////////////////////
// Épisodes sortis et non vus AVANT (season, n) (hors spéciaux) : même règle que la liste des saisons.
async function prevUnseenOf(sh, tmdbId, season, n) {
  if (season === 0 || !tmdbId) return [];
  let meta = tmdbCache.shows[tmdbId]; if (!meta) { try { meta = await getShowMeta(tmdbId); } catch {} }
  if (!meta) return [];
  const out = [], now = new Date();
  for (const se of meta.seasons.map(s => s.n).filter(x => x > 0 && x <= season).sort((x, y) => x - y)) {
    let eps = []; try { eps = await getSeasonEpisodes(tmdbId, se); } catch {}
    for (const e of eps) {
      if (se === season && e.n >= n) continue;
      if ((!e.air || new Date(e.air) <= now) && !isSeen(sh, se, e.n)) out.push({ season: se, n: e.n });
    }
  }
  return out;
}
// Previous / next episode of the episode page (specials stay among specials).
async function episodeNeighbors(tmdbId, season, n) {
  const out = { prev: null, next: null };
  if (!tmdbId) return out;
  let meta = null; try { meta = await getShowMeta(tmdbId); } catch {}
  const seasons = season === 0 ? [0] : ((meta && meta.seasons) || []).map(s => s.n).filter(x => x > 0).sort((a, b) => a - b);
  const epsOf = async (s) => { try { return (await getSeasonEpisodes(tmdbId, s)).map(e => e.n).sort((a, b) => a - b); } catch { return []; } };
  const cur = await epsOf(season);
  const i = cur.indexOf(n);
  if (i > 0) out.prev = { s: season, n: cur[i - 1] };
  if (i >= 0 && i < cur.length - 1) out.next = { s: season, n: cur[i + 1] };
  const si = seasons.indexOf(season);
  if (!out.prev && si > 0) { const p = await epsOf(seasons[si - 1]); if (p.length) out.prev = { s: seasons[si - 1], n: p[p.length - 1] }; }
  if (!out.next && si >= 0 && si < seasons.length - 1) { const q = await epsOf(seasons[si + 1]); if (q.length) out.next = { s: seasons[si + 1], n: q[0] }; }
  return out;
}
route('episode', async (el, rest) => {
  buildModel();
  const showKey = decodeURIComponent(rest[0] || '');
  const season = parseInt(rest[1], 10);
  const n = parseInt(rest[2], 10);
  const sh = MODEL.shows.get(showKey);
  if (!sh || !isFinite(season) || !isFinite(n)) { el.innerHTML = `<div class="empty">Épisode introuvable.</div>`; return; }

  let ep = null, tmdbId = null;
  if (hasKey()) {
    tmdbId = overrideShowTmdb(sh) || (sh.tvdbId ? await resolveTmdbId(sh.tvdbId) : null);
    if (tmdbId) { try { ep = await getEpisodeMeta(tmdbId, season, n); } catch {} }
  }
  if (!ep && tmdbId && tmdbCache.seasons[tmdbId + '|' + season]) {
    ep = (tmdbCache.seasons[tmdbId + '|' + season] || []).find(e => e.n === n) || null;
  }

  if (tmdbId && !splitMapOf(sh)) { const mt = tmdbCache.shows[tmdbId]; if (mt && mt.seasons && mt.seasons.length === 1) { try { await getSeasonEpisodes(tmdbId, mt.seasons[0].n); } catch {} } }
  const dsp = epDisp(sh, season, n); // numéro affiché (saisons d'animé redécoupées)
  const k = epKey(sh.key, season, n);
  const seen = sh.seenKeys.has(k);
  const rating = MODEL.ratingMap.get(k) || 0;
  const emo = MODEL.emotionMap.get(k);
  const rw = MODEL.rewatchMap.get(k) || 0;
  const title = (ep && ep.name) || ('Épisode ' + dsp.n);
  const overviewTxt = ep ? (ep.overview || 'Pas de synopsis disponible pour cet épisode.') : (hasKey() ? 'Détails indisponibles.' : 'Ajoutez une clé TMDB (Réglages) pour voir les détails de l\'épisode.');
  const seenAt = seen ? episodeSeenAt(sh, season, n) : null;
  const rwTxt = rewatchListText(userState.rewatchDates && userState.rewatchDates[k], rw);
  const rows = [
    infoRow('Diffusion', ep && ep.air ? fmtFull(ep.air) : ''),
    infoRow('Mon visionnage', seen ? (seenAt ? `Vu le ${fmtFull(seenAt)}` : 'Vu (date non enregistrée)') + (rwTxt ? `<br>${rwTxt}` : '') : ''),
    infoRow('Durée', ep && ep.runtime ? `${ep.runtime} min` : ''),
    infoRow('Note du public', ep && ep.vote ? `⭐ ${ep.vote.toFixed(1)}/10 <span class="muted">(${ep.voteCount})</span>` : ''),
  ].join('');
  const guestsHtml = (ep && ep.guests && ep.guests.length)
    ? `<div class="about" style="margin-top:16px"><div class="about-block"><h3>Invités</h3><div class="cast-list">${ep.guests.map(castItemHtml).join('')}</div></div></div>`
    : '';

  const hideSpoil = antiSpoiler() && !seen; // anti-spoiler (Personnalisation)
  const stillImg = ep && ep.still ? `<img src="${IMG(ep.still, 'w780')}" alt="">` : `<div class="ep-still-ph">${epTag(sh, season, n)}</div>`;
  const nb = { key: sh.key, ...(await episodeNeighbors(tmdbId, season, n)) };
  el._epNb = nb; // read by the swipe to know the previous / next episode of this page
  const epLabel = (e) => epTag(sh, e.s, e.n);
  el.innerHTML = `
    ${backBtn('#/show/' + encodeURIComponent(sh.key))}
    <div class="ep-page">
      <h1 class="ep-title ${hideSpoil ? 'spoil' : ''}">${esc(title)}</h1>
      <div class="ep-num-row">
        <div class="ep-num">Saison ${dsp.s} · Épisode ${dsp.n}</div>
        <div class="ep-nav">
          ${nb.prev ? `<button class="btn sm ghost" data-epnav="prev" title="Épisode précédent">‹ ${epLabel(nb.prev)}</button>` : ''}
          ${nb.next ? `<button class="btn sm ghost" data-epnav="next" title="Épisode suivant">${epLabel(nb.next)} ›</button>` : ''}
        </div>
      </div>
      <div class="ep-visual ${hideSpoil ? 'spoil' : ''}">${stillImg}</div>
      ${hideSpoil ? '<p class="spoil-hint">🙈 Épisode pas encore vu : touchez pour afficher le titre, l\'image et le résumé</p>' : ''}
      <p class="synopsis-text ep-synopsis ${hideSpoil ? 'spoil' : ''}">${esc(overviewTxt)}</p>
      <div class="detail-actions">
        <button class="btn ${seen ? 'primary' : ''}" id="epSeen">${seen ? '✓ Vu' : '✓ Je l’ai vu'}</button>
        <button class="btn" id="epRw" ${seen ? '' : 'disabled title="Marquez d’abord l’épisode comme vu"'}>${icon('repeat')} Je l’ai revu${rw > 0 ? ` · Vu ${rw + 1} fois` : ''}</button>
        ${rw > 0 ? '<button class="btn" id="epRwMinus" title="Retirer un visionnage">−1</button>' : ''}
        ${seen ? '<button class="btn" id="epRwFix" title="Corriger le nombre de visionnages">' + icon('edit') + ' Corriger</button>' : ''}
      </div>
      <div class="ep-react">
        <span class="react-label">Ma réaction</span>
        ${reactPickerHtml(epScore(k), true, !seen)}
      </div>
    </div>
    ${rows ? `<div class="about" style="margin-top:16px">${infoBlock(rows)}</div>` : ''}
    ${guestsHtml}
    ${reviewsSectionHtml()}`;

  const reviews = wireReviews(el, { lk: k, work: reviewWorkEp(tmdbId, season, n), seen, stars: () => epScore(k), what: 'l’épisode' });
  el.querySelectorAll('[data-epnav]').forEach(b => b.onclick = () => swipeTo(b.dataset.epnav));
  el.querySelector('#epSeen').onclick = async () => {
    const wasComplete = isShowComplete(sh);
    toggleSeen(sh, season, n);
    const now = sh.seenKeys.has(k);
    const b = el.querySelector('#epSeen');
    b.classList.toggle('primary', now); b.textContent = now ? '✓ Vu' : '✓ Je l’ai vu';
    const rwb = el.querySelector('#epRw'); if (rwb) rwb.disabled = !now;
    reviews.setSeen(now);
    if (now) revealSpoil(); // épisode vu : plus rien à cacher
    setReactLocked(el.querySelector('.ep-react'), !now, epScore(k));
    updateSyncStatus();
    if (now) {
      // Comme dans la liste : proposer de marquer aussi les épisodes précédents non vus.
      const prev = await prevUnseenOf(sh, tmdbId, season, n);
      if (!sh.seenKeys.has(k)) return; // décoché entre-temps (double appui) : rien à proposer
      if (prev.length) { offerMarkPrevious(sh, prev, season, n); return; }
    }
    if (now && !wasComplete && isShowComplete(sh)) celebrateCompletion(sh);
  };
  const seenNow = () => sh.seenKeys.has(k);
  const revealSpoil = () => { el.querySelectorAll('.spoil').forEach(x => x.classList.remove('spoil')); el.querySelector('.spoil-hint')?.remove(); };
  el.querySelectorAll('.spoil, .spoil-hint').forEach(x => x.addEventListener('click', revealSpoil));
  el.querySelector('#epRw').onclick = () => {
    if (!seenNow()) { toast('Marquez d’abord l’épisode comme vu'); return; }
    const prev = rewatchOf(sh, season, n);
    setRewatch(sh, season, n, prev + 1);
    updateSyncStatus();
    render(); // affiche la nouvelle date de revisionnage
    toastUndo(`🔁 Vu ${prev + 2} fois`, () => { setRewatch(sh, season, n, prev); render(); });
  };
  const epRwFix = el.querySelector('#epRwFix');
  if (epRwFix) epRwFix.onclick = () => openRewatchStepper(`${displayName(sh)} · ${epTag(sh, season, n)}`, () => rewatchOf(sh, season, n), (c) => setRewatch(sh, season, n, c), render);
  const epRwMinus = el.querySelector('#epRwMinus');
  if (epRwMinus) epRwMinus.onclick = () => { setRewatch(sh, season, n, rewatchOf(sh, season, n) - 1); render(); toast('Un visionnage retiré'); };
  wireReactPicker(el.querySelector('.ep-react'), () => epScore(k), (v) => setEpScore(sh, season, n, v), () => sh.seenKeys.has(k));
});

function offlineSeasons(sh) {
  // Build seasons from the seen keys + user-added episodes (no TMDB)
  const bySeason = {};
  for (const k of sh.seenKeys) { const [, s, n] = k.split('|'); (bySeason[s] = bySeason[s] || new Set()).add(parseInt(n, 10)); }
  for (const e of customEpsForShow(sh)) { (bySeason[e.s] = bySeason[e.s] || new Set()).add(e.n); }
  const seasons = Object.keys(bySeason).sort((a, b) => a - b);
  if (!seasons.length) return `<div class="empty">Aucun épisode enregistré. Ajoutez une clé TMDB (Réglages) pour voir la liste complète des épisodes, ou utilisez « ➕ Ajouter un épisode ».</div>`;
  return `<div class="panel"><p class="hint" style="color:var(--muted)">Sans clé TMDB, seuls vos épisodes vus / ajoutés sont affichés.</p></div>` +
    seasons.map(s => `<div class="season-head"><h3>Saison ${s}</h3><span class="count">${bySeason[s].size} épisode(s)</span></div>`).join('');
}

// Split a season's episodes into groups whenever there is a very long gap
// between consecutive air dates. Some anime are stored on TMDB as ONE season
// with continuous numbering spanning several years — this recovers the real
// broadcast seasons (cours) for display.
function splitByAirGaps(eps, thrDays) {
  const groups = []; let cur = []; let prev = null;
  for (const e of eps) {
    if (e.air) {
      const t = Date.parse(String(e.air).replace(' ', 'T'));
      if (!isNaN(t)) {
        if (prev != null && (t - prev) > thrDays * 86400000) { if (cur.length) groups.push(cur); cur = []; }
        prev = t;
      }
    }
    cur.push(e);
  }
  if (cur.length) groups.push(cur);
  return groups;
}

// Animés rangés par TMDB en une seule grande saison et redécoupés à l'écran : numéro AFFICHÉ
// dans la saison redécoupée (ex. 1×40 → 3×01). Les épisodes restent enregistrés sous leur numéro TMDB.
const _splitMaps = new Map(); // clé série -> { sn, map: Map(n -> { s, n }) } ou null (pas de découpage)
function setSplitMap(sh, sn, groups) {
  if (!groups || groups.length < 2) { _splitMaps.set(sh.key, null); return; }
  const map = new Map();
  groups.forEach((g, i) => g.forEach((e, j) => map.set(e.n, { s: i + 1, n: j + 1 })));
  _splitMaps.set(sh.key, { sn, map });
}
function splitMapOf(sh) {
  if (!sh) return null;
  if (_splitMaps.has(sh.key)) return _splitMaps.get(sh.key);
  const id = overrideShowTmdb(sh) || (sh.tvdbId != null ? tmdbCache.map[sh.tvdbId] : null);
  const meta = id && tmdbCache.shows[id];
  if (!meta) return null; // pas encore connu : on réessaiera plus tard
  const ms = meta.seasons || [];
  if (ms.length !== 1 || !(ms[0].n > 0)) { _splitMaps.set(sh.key, null); return null; }
  const eps = tmdbCache.seasons[id + '|' + ms[0].n];
  if (!eps || !eps.length) return null;
  // Comme renderSeasons : les épisodes ajoutés à la main (sans date) font partie de la saison découpée.
  const present = new Set(eps.map(e => e.n));
  const extra = customEpsForShow(sh).filter(e => e.s === ms[0].n && !present.has(e.n)).map(e => ({ n: e.n, name: e.name, air: null, custom: true }));
  setSplitMap(sh, ms[0].n, splitByAirGaps([...eps, ...extra].sort((a, b) => a.n - b.n), 120));
  return _splitMaps.get(sh.key);
}
function epDisp(sh, season, n) {
  const x = splitMapOf(sh);
  const d = x && x.sn === season && x.map.get(n);
  return d || { s: season, n };
}
const pad2 = (v) => String(v).padStart(2, '0');
const epTag = (sh, season, n) => { const d = epDisp(sh, season, n); return `${d.s}×${pad2(d.n)}`; };
const epSE = (sh, season, n) => { const d = epDisp(sh, season, n); return `S${pad2(d.s)}E${pad2(d.n)}`; };

async function renderSeasons(container, sh, tmdbId, meta, fresh) {
  container.innerHTML = '';
  // Merge TMDB seasons with any user-added (custom) seasons/episodes.
  const custom = customEpsForShow(sh);
  const customBySeason = {};
  for (const e of custom) (customBySeason[e.s] = customBySeason[e.s] || []).push(e);
  const metaSeasons = meta ? meta.seasons : [];
  const tmdbSeasonNums = new Set(metaSeasons.map(s => s.n));
  const seasonNums = new Set(tmdbSeasonNums);
  for (const s of Object.keys(customBySeason)) seasonNums.add(Number(s));
  const sorted = Array.from(seasonNums).sort((a, b) => a - b);

  const buildEpsForSeason = async (sn) => {
    let eps = [];
    if (tmdbId && tmdbSeasonNums.has(sn)) { try { eps = await getSeasonEpisodes(tmdbId, sn); } catch { eps = []; } }
    const present = new Set(eps.map(e => e.n));
    const customEps = (customBySeason[sn] || []).filter(e => !present.has(e.n))
      .map(e => ({ n: e.n, name: e.name, air: null, custom: true }));
    return eps.concat(customEps).sort((a, b) => a.n - b.n);
  };

  // Display blocks: normally one per season. For a single-season anime with big
  // air-date gaps, split it into visual seasons.
  const blocks = []; // { sn, label, eps }
  if (metaSeasons.length === 1 && sorted.length === 1 && sorted[0] > 0) {
    const sn = sorted[0];
    const all = await buildEpsForSeason(sn);
    const groups = splitByAirGaps(all, 120);
    setSplitMap(sh, sn, groups);
    if (groups.length > 1) groups.forEach((g, i) => blocks.push({ sn, ds: i + 1, label: 'Saison ' + (i + 1), eps: g }));
    else blocks.push({ sn, ds: sn, label: 'Saison ' + sn, eps: all });
  } else {
    _splitMaps.set(sh.key, null);
    for (const sn of sorted) blocks.push({ sn, ds: sn, label: 'Saison ' + sn, eps: null }); // fetched lazily below
  }

  // Flat list of rendered episodes, used to offer "mark all previous episodes".
  const renderedEps = [];
  const getPrevUnseen = (season, n) => {
    if (season === 0) return []; // don't chain from specials
    const out = [];
    for (const e of renderedEps) {
      if (e.season === 0) continue;
      const before = e.season < season || (e.season === season && e.n < n);
      if (!before) continue;
      const aired = !e.air || new Date(e.air) <= new Date();
      if (aired && !isSeen(sh, e.season, e.n)) out.push({ season: e.season, n: e.n });
    }
    return out;
  };

  let expandedChosen = false;
  let firstUnseenEl = null; // first unwatched aired episode row (to auto-scroll a show in progress)
  // Resume point = just AFTER the last watched episode, so intentionally-skipped
  // fillers earlier on don't send you back to an old gap.
  let lastSeenS = -1, lastSeenN = -1;
  for (const k of sh.seenKeys) {
    const p = k.split('|'); const S = +p[p.length - 2], N = +p[p.length - 1];
    if (S > lastSeenS || (S === lastSeenS && N > lastSeenN)) { lastSeenS = S; lastSeenN = N; }
  }
  // During a re-watch, the resume point is the first episode not yet seen in this viewing.
  const curPass = currentPass(sh);
  let blockIdx = 0;
  for (const block of blocks) {
    const sn = block.sn;
    const secId = 'sea_' + (blockIdx++);
    const all = block.eps != null ? block.eps : await buildEpsForSeason(sn);
    const total = all.length;
    for (const e of all) renderedEps.push({ season: sn, n: e.n, air: e.air });
    const seenInBlock = () => all.filter(e => isSeen(sh, sn, e.n)).length;
    const airedEps = () => all.filter(e => !e.air || new Date(e.air) <= new Date());

    // Expand the block holding the resume point (first aired unseen episode that
    // comes after the last watched one).
    const firstUnseen = curPass
      ? (sn > 0 ? all.find(e => isSeen(sh, sn, e.n) && !inCurrentPass(sh, sn, e.n, curPass)) : undefined)
      : all.find(e => (!e.air || new Date(e.air) <= new Date()) && !isSeen(sh, sn, e.n)
        && (sn > lastSeenS || (sn === lastSeenS && e.n > lastSeenN)));
    const hasUnseen = !!firstUnseen;
    const expand = !expandedChosen && hasUnseen;
    if (expand) expandedChosen = true;

    const head = document.createElement('div');
    head.className = 'season-head' + (expand ? '' : ' collapsed');
    head.innerHTML = `<span class="caret">▸</span><h3>${esc(block.label)}</h3><span class="count" id="${secId}_c">${seenInBlock()} / ${total}</span> <div class="markall-group"><button class="btn sm ghost markall-seen">Tout vu</button><button class="btn sm ghost markall-unseen">Tout non vu</button></div>`;
    container.appendChild(head);

    const body = document.createElement('div');
    body.id = secId; body.className = 'season-body' + (expand ? '' : ' collapsed'); body.dataset.season = sn; container.appendChild(body);

    const markBtn = head.querySelector('.markall-seen');
    const updateCount = () => {
      const c = document.getElementById(secId + '_c'); if (c) c.textContent = `${seenInBlock()} / ${total}`;
      const av = airedEps();
      markBtn.textContent = (av.length && av.every(e => isSeen(sh, sn, e.n))) ? '🔁 Tout revu' : 'Tout vu'; // saison déjà complète : +1 visionnage
      refreshShowHeader(sh);
    };
    const buildBody = () => {
      const pass = currentPass(sh);
      body.innerHTML = all.map(e => epHtml(sh, sn, e, pass)).join('') +
        `<button class="btn sm ghost add-ep" data-season="${block.ds}">${icon('plus')} Ajouter un épisode à la saison ${block.ds}</button>`;
      wireEpisodes(body, sh, sn, updateCount, { getPrevUnseen });
      body.querySelector('.add-ep').onclick = () => addEpisodePrompt(sh, meta, block.ds);
      updateCount();
    };
    buildBody();

    if (expand && firstUnseen) firstUnseenEl = body.querySelector('.ep[data-n="' + firstUnseen.n + '"]');

    head._update = updateCount; // pour remettre le bloc à jour depuis l'extérieur (offerMarkPrevious)
    const blockKeys = () => all.map(e => epKey(sh.key, sn, e.n));
    head.onclick = (ev) => {
      if (ev.target.closest('.markall-group')) return;
      const collapsed = head.classList.toggle('collapsed');
      body.classList.toggle('collapsed', collapsed);
    };

    // « Tout vu » : coche tous les épisodes sortis ; si TOUS sont déjà vus, c'est un revisionnage (+1 sur chacun, bouton « 🔁 Tout revu »).
    // Dans les deux cas : « Annuler ».
    const redraw = () => {
      buildBody(); repaintPass(sh); updateSyncStatus();
      // « Annuler » est touché dans le toast (hors de la liste) : remettre aussi l'en-tête et le prochain épisode à jour
      refreshShowHeader(sh);
      const pageEl = container.closest('.app-pane, #app');
      if (pageEl) fillNextEpLine(pageEl, sh);
    };
    markBtn.onclick = (ev) => {
      ev.stopPropagation();
      const aired = airedEps();
      if (!aired.length) { toast('Aucun épisode sorti dans cette saison'); return; }
      const wasComplete = isShowComplete(sh);
      const snap = snapshotEpisodes(sh, blockKeys()); // état exact avant l'action, pour « Annuler »
      if (aired.every(e => isSeen(sh, sn, e.n))) {
        aired.forEach(e => setRewatch(sh, sn, e.n, rewatchOf(sh, sn, e.n) + 1));
        redraw();
        toastUndo(`🔁 ${block.label} revue (+1 visionnage)`, () => { restoreSnapshot(snap); redraw(); });
      } else {
        const added = aired.filter(e => !isSeen(sh, sn, e.n));
        added.forEach(e => toggleSeen(sh, sn, e.n, true));
        redraw();
        toastUndo(`${block.label} marquée comme vue`, () => { restoreSnapshot(snap); redraw(); });
        if (!wasComplete && isShowComplete(sh)) celebrateCompletion(sh);
      }
    };
    // « Tout non vu » : décoche la saison ET efface ses revisionnages — après confirmation, avec « Annuler ».
    head.querySelector('.markall-unseen').onclick = async (ev) => {
      ev.stopPropagation();
      const seenEps = all.filter(e => isSeen(sh, sn, e.n)), rwEps = all.filter(e => rewatchOf(sh, sn, e.n) > 0);
      if (!seenEps.length && !rwEps.length) { toast('Rien à effacer dans cette saison'); return; }
      const ok = await askModal(`<h2>Tout marquer comme non vu ?</h2><p>${seenEps.length} épisode(s) de « ${esc(block.label)} » seront décochés${rwEps.length ? ` et leurs revisionnages (${rwEps.length} épisode(s)) effacés` : ''}.</p>`, 'Annuler', 'Tout non vu');
      if (!ok) return;
      const snap = snapshotEpisodes(sh, blockKeys());
      all.forEach(e => {
        if (rewatchOf(sh, sn, e.n) > 0) setRewatch(sh, sn, e.n, 0);
        if (isSeen(sh, sn, e.n)) toggleSeen(sh, sn, e.n, false);
      });
      redraw();
      toastUndo(`${block.label} marquée comme non vue`, () => { restoreSnapshot(snap); redraw(); });
    };
  }

  // On a fresh open of a show in progress, jump straight to the first unwatched
  // episode (after render() has done its scroll-to-top).
  if (fresh && firstUnseenEl && sh.seenKeys.size > 0) {
    setTimeout(() => { try { firstUnseenEl.scrollIntoView({ block: 'center' }); } catch {} }, 80);
  }
  // Back from an episode page: same open seasons and same position as before.
  const rs = showViewRestore;
  if (!fresh && rs && rs.key === sh.key) {
    showViewRestore = null;
    container.querySelectorAll('.season-body').forEach((b, i) => {
      const open = !!rs.open[i];
      b.classList.toggle('collapsed', !open);
      if (b.previousElementSibling) b.previousElementSibling.classList.toggle('collapsed', !open);
    });
    setTimeout(() => {
      const row = rs.bodyId ? document.querySelector('#' + rs.bodyId + ' .ep[data-n="' + rs.n + '"]') : null;
      window.scrollTo(0, row ? row.getBoundingClientRect().top + window.scrollY - rs.top : rs.y);
    }, 80);
  }
}

function epHtml(sh, season, e, pass) {
  const k = epKey(sh.key, season, e.n);
  const seen = sh.seenKeys.has(k);
  const cur = seen && (!pass || inPassKey(k, pass));
  const rating = MODEL.ratingMap.get(k) || 0;
  const emo = MODEL.emotionMap.get(k);
  const rw = MODEL.rewatchMap.get(k) || 0;
  const aired = e.air && new Date(e.air) <= new Date();
  return `<div class="ep ${seen ? 'seen' : ''} ${cur ? 'cur' : ''} ${e.custom ? 'custom' : ''}" data-n="${e.n}">
    <div class="check ${seen ? 'on' : ''}" data-act="seen" role="button" aria-label="Marquer comme vu">✓</div>
    <div class="num">${epTag(sh, season, e.n)}</div>
    <div class="epname" data-act="open"><span class="${antiSpoiler() && !seen && e.name ? 'spoil-name' : ''}">${esc(e.name || 'Épisode ' + epDisp(sh, season, e.n).n)}</span>${e.custom ? ' <span class="tag-custom">ajouté</span>' : ''}<small>${e.air ? esc(e.air) : ''}${!aired && e.air ? ' · à venir' : ''}</small></div>
    <div class="rw ${rw > 0 ? 'on' : ''}" data-act="rw" role="button" aria-label="Je l’ai revu" title="Je l’ai revu — appui long : corriger">🔁<span class="rw-n">${rw > 0 ? '×' + (rw + 1) : ''}</span></div>
    ${epReactBtnHtml(epScore(k))}
    ${e.custom ? `<button class="ep-del" data-act="delcustom" title="Supprimer cet épisode ajouté">${icon('trash')}</button>` : ''}
  </div>`;
}

// Liste d'épisodes : la réaction choisie seule (ou 😀 discret) ; masqué tant que l'épisode n'est pas vu (CSS .ep:not(.seen)).
function epReactBtnHtml(v) {
  const r = reactOfScore(v);
  return `<button type="button" class="ep-react-btn${r ? ' has' : ''}" data-act="react" aria-label="Ma réaction">${r ? r.emoji : '😀'}</button>`;
}
// Feuille de choix de la réaction : 5 grands boutons ; retoucher la réaction choisie l'enlève.
function openReactSheet(title, get, set, onDone) {
  const v = get();
  showModal(`<h2>${esc(title)}</h2>
    <p class="hint">Ma réaction · touchez la réaction choisie pour l’enlever</p>
    <div class="react-sheet">${REACT_SCALE.map(r => `<button type="button" data-v="${r.v}" class="${v === r.v ? 'on' : ''}"><span class="rsh-e">${r.emoji}</span><span class="rsh-l">${esc(r.label)}</span></button>`).join('')}</div>
    <div class="row"><button class="btn ghost" data-close>Fermer</button></div>`,
    (root) => {
      sheetStyle(root);
      root.querySelectorAll('.react-sheet button').forEach(b => b.onclick = () => {
        const x = parseInt(b.dataset.v, 10);
        set(get() === x ? 0 : x); closeModal(); if (onDone) onDone();
      });
    });
}

// ---- Fin de série : célébration + confettis ----
function isShowComplete(sh) {
  const m = metaFor(sh);
  return !!(m && airedTotal(m) > 0 && sh.seenKeys.size >= airedTotal(m));
}
function fmtDur(mins) {
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), mm = Math.round(mins % 60);
  if (d > 0) return h > 0 ? `${d} j ${h} h` : `${d} j`;
  if (h > 0) return mm > 0 ? `${h} h ${mm}` : `${h} h`;
  return `${mm} min`;
}
function celebrateCompletion(sh) {
  const m = metaFor(sh);
  const episodes = sh.seenKeys.size;
  const watchTime = fmtDur(episodes * ((m && m.runtime) || DEFAULT_RUNTIME));
  const wd = showWatchDates(sh);
  let spanTxt = null;
  if (wd.first && wd.last) {
    const days = Math.max(1, Math.round((Date.parse(String(wd.last).replace(' ', 'T')) - Date.parse(String(wd.first).replace(' ', 'T'))) / 86400000));
    spanTxt = days >= 365 ? `${Math.round(days / 365 * 10) / 10} an(s)` : days >= 30 ? `${Math.round(days / 30)} mois` : `${days} j`;
  }
  const seasons = m ? m.seasons.length : 0;
  const rating = sh.showRating;
  showModal(`
    <div class="celebrate">
      <canvas class="confetti-cv"></canvas>
      <div class="cel-emoji">🎉</div>
      <h2>Série terminée !</h2>
      <p class="cel-name">${esc(displayName(sh))}</p>
      <div class="cel-stats">
        <div class="cel-stat"><b>${episodes}</b><span>épisodes vus</span></div>
        <div class="cel-stat"><b>${watchTime}</b><span>de visionnage</span></div>
        ${spanTxt ? `<div class="cel-stat"><b>${spanTxt}</b><span>pour la terminer</span></div>` : (seasons ? `<div class="cel-stat"><b>${seasons}</b><span>saison(s)</span></div>` : '')}
      </div>
      ${wd.first ? `<p class="cel-msg">Du ${fmtFull(wd.first)} au ${fmtFull(wd.last)}${showScore(sh) ? ` · Ta réaction : ${reactCaption(showScore(sh))}` : ''}</p>` : ''}
      <button class="btn primary" data-close>🎊 Génial !</button>
    </div>`, (root) => { runConfetti(root.querySelector('.confetti-cv')); });
}
function runConfetti(canvas) {
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const box = canvas.parentElement;
  canvas.width = box.clientWidth; canvas.height = Math.max(300, box.clientHeight);
  const colors = ['#f5c518', '#ff5e5e', '#5ec8ff', '#7CFC00', '#ff9ff3', '#ffd34e', '#a78bfa'];
  const parts = Array.from({ length: 150 }, () => ({
    x: Math.random() * canvas.width, y: Math.random() * -canvas.height,
    r: 4 + Math.random() * 6, c: colors[(Math.random() * colors.length) | 0],
    vy: 2 + Math.random() * 3.5, vx: -1.5 + Math.random() * 3,
    rot: Math.random() * 6.28, vr: -0.25 + Math.random() * 0.5,
  }));
  let frames = 0;
  const tick = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.03; p.rot += p.vr;
      if (p.y > canvas.height + 20) { p.y = -20; p.x = Math.random() * canvas.width; }
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6);
      ctx.restore();
    }
    if (++frames < 260 && document.body.contains(canvas)) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  };
  tick();
}

function wireEpisodes(container, sh, season, onChange, opts) {
  container.querySelectorAll('.ep').forEach(row => {
    const n = parseInt(row.dataset.n, 10);
    row.querySelector('[data-act="seen"]').onclick = () => {
      const wasSeen = isSeen(sh, season, n);
      const wasComplete = isShowComplete(sh);
      toggleSeen(sh, season, n);
      const seen = isSeen(sh, season, n);
      row.classList.toggle('seen', seen);
      row.querySelector('.check').classList.toggle('on', seen);
      repaintPass(sh);
      updateSyncStatus(); onChange();
      // When checking (not unchecking) a mid-season episode, offer to also mark
      // every earlier aired episode as seen.
      if (seen && !wasSeen && opts && opts.getPrevUnseen) {
        const prev = opts.getPrevUnseen(season, n);
        if (prev.length) { offerMarkPrevious(sh, prev, season, n); return; }
      }
      if (seen && !wasComplete && isShowComplete(sh)) celebrateCompletion(sh);
    };
    const rwEl = row.querySelector('[data-act="rw"]');
    const paintRw = () => {
      const c = rewatchOf(sh, season, n);
      rwEl.classList.toggle('on', c > 0);
      rwEl.querySelector('.rw-n').textContent = c > 0 ? '×' + (c + 1) : '';
      const seen = isSeen(sh, season, n);
      row.classList.toggle('seen', seen);
      row.querySelector('.check').classList.toggle('on', seen);
      repaintPass(sh);
    };
    const epTitle = `${displayName(sh)} · ${epTag(sh, season, n)}`;
    rwEl.onclick = () => {
      if (!isSeen(sh, season, n)) { toast('Marquez d’abord l’épisode comme vu'); return; }
      const prev = rewatchOf(sh, season, n);
      setRewatch(sh, season, n, prev + 1); paintRw(); updateSyncStatus(); onChange();
      toastUndo(`🔁 ${epTag(sh, season, n)} : vu ${prev + 2} fois`, () => { setRewatch(sh, season, n, prev); paintRw(); onChange(); });
    };
    onLongPress(rwEl, () => !isSeen(sh, season, n) ? toast('Marquez d’abord l’épisode comme vu') : openRewatchStepper(epTitle, () => rewatchOf(sh, season, n), (c) => setRewatch(sh, season, n, c), () => { paintRw(); onChange(); }));
    const reactBtn = row.querySelector('[data-act="react"]');
    if (reactBtn) reactBtn.onclick = () => {
      const ek = epKey(sh.key, season, n);
      openReactSheet(epTitle, () => epScore(ek), (v) => setEpScore(sh, season, n, v), () => {
        const r = reactOfScore(epScore(ek));
        reactBtn.textContent = r ? r.emoji : '😀'; reactBtn.classList.toggle('has', !!r); onChange();
      });
    };
    const del = row.querySelector('[data-act="delcustom"]');
    if (del) del.onclick = () => { removeCustomEpisode(sh, season, n); render(); };
    const nameEl = row.querySelector('.epname[data-act="open"]');
    if (nameEl) nameEl.onclick = () => { saveShowView(sh, row); openEpisode(sh.key, season, n); };
  });
}

// Offer to mark every earlier aired episode as seen after checking a mid-run episode.
function offerMarkPrevious(sh, prevList, season, n) {
  const cnt = prevList.length;
  const label = epTag(sh, season, n);
  showModal(`<h2>Marquer les épisodes précédents ?</h2>
    <p>Vous avez marqué l'épisode <strong>${label}</strong> comme vu. Voulez-vous aussi marquer les <strong>${cnt}</strong> épisode(s) précédent(s) comme vu(s) ?</p>
    <div class="row"><button class="btn ghost" data-close>Non, juste celui-ci</button><button class="btn primary" id="mpGo">Oui, tout marquer avant</button></div>`,
    (root) => {
      root.querySelector('#mpGo').onclick = () => {
        prevList.forEach(p => toggleSeen(sh, p.season, p.n, true));
        // Update the affected rows in place so the page doesn't jump back to the top.
        prevList.forEach(p => {
          const row = document.querySelector('.season-body[data-season="' + p.season + '"] .ep[data-n="' + p.n + '"]');
          if (row) { row.classList.add('seen'); const ck = row.querySelector('.check'); if (ck) ck.classList.add('on'); }
        });
        repaintPass(sh);
        document.querySelectorAll('.season-body[data-season]').forEach(body => {
          const c = document.getElementById(body.id + '_c');
          if (c) c.textContent = body.querySelectorAll('.ep.seen').length + ' / ' + body.querySelectorAll('.ep').length;
        });
        document.querySelectorAll('.season-head').forEach(h => { if (h._update) h._update(); }); // compteurs + « Tout vu / 🔁 Tout revu » + en-tête
        updateSyncStatus(); refreshShowHeader(sh);
        closeModal();
        toast(`${cnt} épisode(s) marqué(s) comme vu(s)`);
        if (isShowComplete(sh)) celebrateCompletion(sh);
      };
    });
}

// Saisons telles qu'elles s'affichent : [{ ds (n° affiché), sn (saison TMDB interne), nums: [n° internes des épisodes] }].
// Animé redécoupé : « Saison 3 » affichée = un morceau de la saison TMDB 1.
function displaySeasonsOf(sh, meta) {
  const sm = splitMapOf(sh), out = [];
  const custom = customEpsForShow(sh);
  if (sm) {
    const g = {};
    for (const [n, d] of sm.map) (g[d.s] = g[d.s] || []).push(n);
    for (const ds of Object.keys(g).map(Number).sort((x, y) => x - y)) out.push({ ds, sn: sm.sn, nums: g[ds].sort((x, y) => x - y) });
    return out;
  }
  const id = overrideShowTmdb(sh) || (sh.tvdbId != null ? tmdbCache.map[sh.tvdbId] : null);
  const seasons = new Set(meta ? meta.seasons.map(s => s.n) : []);
  for (const e of custom) seasons.add(e.s);
  for (const sn of Array.from(seasons).sort((x, y) => x - y)) {
    const listed = ((id && tmdbCache.seasons[id + '|' + sn]) || []).map(e => e.n);
    const cnt = meta ? ((meta.seasons.find(x => x.n === sn) || {}).count || 0) : 0;
    const nums = new Set(listed.length ? listed : Array.from({ length: cnt }, (_, i) => i + 1));
    for (const e of custom) if (e.s === sn) nums.add(e.n);
    out.push({ ds: sn, sn, nums: Array.from(nums).sort((x, y) => x - y) });
  }
  return out;
}
// Numéro affiché (saison, épisode) -> clé interne. { s, n, exists, clash, noSeason }.
function displayToInternal(sh, meta, ds, dn) {
  const list = displaySeasonsOf(sh, meta), sm = splitMapOf(sh);
  const cur = list.find(x => x.ds === ds);
  if (sm && !cur) return { noSeason: true, max: list.length };
  if (!cur) return { s: ds, n: dn };
  if (dn <= cur.nums.length && sm) return { s: cur.sn, n: cur.nums[dn - 1], exists: true };
  if (!sm) return { s: cur.sn, n: dn, exists: cur.nums.includes(dn) };
  const n = cur.nums[cur.nums.length - 1] + (dn - cur.nums.length); // après le dernier épisode de ce morceau
  return { s: cur.sn, n, clash: sm.map.has(n) };
}
function addEpisodePrompt(sh, meta, presetSeason) {
  const list = displaySeasonsOf(sh, meta);
  const defSeason = presetSeason != null ? presetSeason : (list.length ? list[list.length - 1].ds : 1);
  const split = !!splitMapOf(sh);
  // Saison redécoupée : numéros affichés 1..N (pas les numéros TMDB internes) ; sinon dernier numéro + 1.
  const nextN = (ds) => { const c = list.find(x => x.ds === ds); return !c ? 1 : split ? c.nums.length + 1 : Math.max(c.nums.length, ...c.nums) + 1; };
  showModal(`<h2>Ajouter un épisode</h2>
    <p>Utile quand le nombre d'épisodes est incorrect (épisode manquant, spécial…).${split ? ' Les numéros sont ceux affichés dans la liste (saison redécoupée).' : ''}</p>
    <div class="modal-fields">
      <label class="field"><span>Saison</span><input class="input" id="aeS" type="number" min="1" ${split ? `max="${list.length}"` : ''} value="${defSeason}"></label>
      <label class="field"><span>Épisode n°</span><input class="input" id="aeN" type="number" min="1" value="${nextN(defSeason)}"></label>
    </div>
    <label class="field"><span>Titre (optionnel)</span><input class="input" id="aeT" placeholder="Titre de l'épisode"></label>
    <label class="check-row"><input type="checkbox" id="aeSeen" checked> Marquer comme vu tout de suite</label>
    <div class="row"><button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="aeGo">Ajouter</button></div>`,
    (root) => {
      root.querySelector('#aeS').oninput = () => { const s = parseInt(root.querySelector('#aeS').value, 10); if (s > 0) root.querySelector('#aeN').value = nextN(s); };
      root.querySelector('#aeGo').onclick = () => {
        const ds = parseInt(root.querySelector('#aeS').value, 10);
        const dn = parseInt(root.querySelector('#aeN').value, 10);
        if (!ds || !dn || ds < 1 || dn < 1) { toast('Saison / épisode invalide'); return; }
        const t = displayToInternal(sh, meta, ds, dn);
        if (t.noSeason) { toast(`Cette série n’a que ${t.max} saisons affichées`); return; }
        if (t.exists) { toast(`L’épisode ${ds}×${pad2(dn)} existe déjà`); return; }
        if (t.clash) { toast(`Le numéro ${ds}×${pad2(dn)} est déjà pris par l’épisode suivant : choisissez le prochain numéro libre`); return; }
        const ok = addCustomEpisode(sh, t.s, t.n, root.querySelector('#aeT').value.trim());
        if (ok && root.querySelector('#aeSeen').checked) toggleSeen(sh, t.s, t.n, true); // pas de coche sur un épisode déjà existant
        closeModal(); render();
        toast(ok ? `Épisode ${ds}×${pad2(dn)} ajouté` : 'Cet épisode existe déjà');
      };
    });
}

// ---- Dates relatives en français (jours LOCAUX : les dates TMDB sont des jours AAAA-MM-JJ, sans heure) ----
const DAYS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
// Numéro de jour (entier) d'une date AAAA-MM-JJ ; NaN si ce n'est pas une date.
function dayNumOf(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / MS_DAY) : NaN;
}
function todayDayNum() { const d = new Date(); return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_DAY); }
// Nombre de jours entre aujourd'hui et la date (> 0 : à venir, < 0 : passé) ; NaN si date invalide.
const daysFromToday = (dateStr) => dayNumOf(dateStr) - todayDayNum();
// « jeudi 20 nov. » (avec l'année si ce n'est pas l'année en cours) ; withWeekday = false → « 20 nov. ».
function fmtDayLong(dateStr, withWeekday = true) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  if (!m) return '';
  const wd = DAYS_FR[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
  return (withWeekday ? wd + ' ' : '') + (+m[3]) + ' ' + MONTHS_FR[+m[2] - 1] + (+m[1] !== new Date().getFullYear() ? ' ' + m[1] : '');
}
// « aujourd'hui », « demain », « hier », « jeudi » (dans moins de 7 jours), « jeudi dernier » (il y a moins de 7 jours),
// sinon « jeudi 20 nov. ».
function relDay(dateStr) {
  const d = daysFromToday(dateStr);
  if (isNaN(d)) return '';
  if (d === 0) return "aujourd'hui";
  if (d === 1) return 'demain';
  if (d === -1) return 'hier';
  const wd = DAYS_FR[((dayNumOf(dateStr) + 4) % 7 + 7) % 7]; // 1er janv. 1970 = jeudi
  if (d > 1 && d < 7) return wd;
  if (d < -1 && d > -7) return wd + ' dernier';
  return fmtDayLong(dateStr);
}
// « dans 3 jours » / « il y a 2 jours » (« demain », « hier », « aujourd'hui » pour les cas proches).
function inDays(dateStr) {
  const d = daysFromToday(dateStr);
  if (isNaN(d)) return '';
  if (d === 0) return "aujourd'hui";
  if (d === 1) return 'demain';
  if (d === -1) return 'hier';
  const a = Math.abs(d);
  const span = a >= 365 ? `${Math.round(a / 365)} an${Math.round(a / 365) > 1 ? 's' : ''}` : a >= 60 ? `${Math.round(a / 30)} mois` : `${a} jours`;
  return d > 0 ? 'dans ' + span : 'il y a ' + span;
}


//////////////////////// Où regarder : mes plateformes (prefs.myProviders = ids TMDB) ////////////////////////
// Remplace la version de 05-actions.js (ce fichier se charge après, donc celle-ci l'emporte).
const COMMON_PROVIDERS = [[8, 'Netflix'], [119, 'Amazon Prime Video'], [337, 'Disney Plus'], [381, 'Canal+'], [350, 'Apple TV+'], [1899, 'Max'],
  [531, 'Paramount Plus'], [283, 'Crunchyroll'], [415, 'ADN'], [56, 'OCS'], [236, 'France TV'], [234, 'Arte'], [2, 'Apple TV'], [3, 'Google Play Movies']];
const myProviderIds = () => ((prefs().myProviders) || []).map(Number);
// Une plateforme est « à moi » : par id, ou par nom pour les anciennes fiches du cache sans id.
function isMyProvider(x) {
  const ids = myProviderIds(), names = prefs().myProviderNames || {};
  return x.id != null ? ids.includes(Number(x.id)) : ids.some(i => (names[i] || '').toLowerCase() === (x.name || '').toLowerCase());
}
// Vrai si l'œuvre est en streaming sur l'une de mes plateformes (sans requête).
const onMyProviders = (p) => !!(p && (p.flatrate || []).some(isMyProvider));
function providersHtml(p) {
  if (!p) return '';
  const chip = (x, mine) => `<span class="prov-chip${mine ? ' mine' : ''}" title="${esc(x.name)}">${x.logo ? `<img src="${IMG(x.logo, 'w92')}" alt="${esc(x.name)}">` : ''}<span>${esc(x.name)}</span></span>`;
  const grp = (title, arr, mine, cls) => arr && arr.length
    ? `<div class="prov-group${cls ? ' ' + cls : ''}"><span class="prov-title">${title}</span><div class="prov-logos">${arr.map(x => chip(x, mine)).join('')}</div></div>` : '';
  const flat = p.flatrate || [], mine = flat.filter(isMyProvider), others = flat.filter(x => !isMyProvider(x));
  const body = mine.length
    ? grp('✓ Sur vos plateformes', mine, true, 'prov-mine') + grp('Aussi en streaming', others, false) + grp('Location', p.rent) + grp('Achat', p.buy)
    : grp('Streaming', flat) + grp('Location', p.rent) + grp('Achat', p.buy);
  if (!body) return '';
  return `<div class="about-block"><h3>Où regarder <span class="src">(FR)</span></h3>${body}
    <div class="prov-actions">${p.link ? `<a class="btn ghost sm" href="${esc(p.link)}" target="_blank" rel="noopener">Voir sur JustWatch ↗</a>` : ''}<button type="button" class="btn ghost sm" data-pickprov>Choisir mes plateformes</button></div></div>`;
}
// Fenêtre de choix : plateformes courantes + celles déjà vues dans les fiches du cache.
function openProviderPicker() {
  const all = new Map(COMMON_PROVIDERS.map(([id, n]) => [id, n]));
  const names = prefs().myProviderNames || {};
  for (const i of myProviderIds()) if (!all.has(i)) all.set(i, names[i] || ('Plateforme ' + i));
  const scan = (c) => { for (const k of Object.keys(c || {})) { const pv = c[k] && c[k].providers; if (pv) for (const x of (pv.flatrate || [])) if (x.id != null && !all.has(Number(x.id))) all.set(Number(x.id), x.name); } };
  scan(tmdbCache.shows); scan(tmdbCache.movieMeta);
  const mine = new Set(myProviderIds());
  showModal(`<h2>Mes plateformes</h2><p class="hint" style="color:var(--muted)">Cochez vos abonnements : ils passent en premier dans « Où regarder ».</p>
    <div class="prov-pick">${[...all].map(([id, n]) => `<label class="check-row" style="display:flex;gap:10px;cursor:pointer;padding:6px 0"><input type="checkbox" data-pid="${id}" ${mine.has(id) ? 'checked' : ''}><span>${esc(n)}</span></label>`).join('')}</div>
    <div class="row"><button class="btn primary" data-close>Terminé</button></div>`, (root) => {
    root.querySelectorAll('[data-pid]').forEach(cb => cb.onchange = () => {
      const ids = [...root.querySelectorAll('[data-pid]')].filter(x => x.checked).map(x => Number(x.dataset.pid));
      const nm = {}; ids.forEach(i => { nm[i] = all.get(i); });
      setPref('myProviders', ids); setPref('myProviderNames', nm);
    });
    root.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => render()));
  });
}
document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-pickprov]')) openProviderPicker(); });
