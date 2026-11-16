/* Mon TV Time — Communauté (amis) et avis */
'use strict';
//////////////////////// Communauté (profils & amis, via Supabase) ////////////////////////
// Tables profiles / follows (voir supabase-communaute.sql). Un profil n'est lisible par les autres que si
// is_public = true ; on n'y publie qu'un petit résumé (jamais la sauvegarde complète).
let _sbPubAt = 0;
async function sbApi(path, { method = 'GET', json, headers = {} } = {}) {
  const token = await sbToken();
  if (!token) throw new Error('Non connecté');
  const res = await sbRequest('/rest/v1/' + path, { method, json, token, headers });
  if (!res.ok) {
    if (res.status === 409) throw new Error(path.startsWith('profiles') ? 'Ce pseudo est déjà pris' : 'Demande déjà envoyée');
    throw await sbError(res);
  }
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}
async function sbLoadProfile() {
  const rows = await sbApi('profiles?id=eq.' + sbSession.uid + '&select=pseudo,is_public,avatar,updated_at');
  sbProfile = (rows && rows[0]) || null;
  return sbProfile;
}
async function sbCreateProfile(pseudo) {
  if (!/^[A-Za-z0-9_.-]{3,20}$/.test(pseudo)) throw new Error('Pseudo : 3 à 20 caractères (lettres, chiffres, _ . -)');
  await sbApi('profiles', { method: 'POST', json: { id: sbSession.uid, pseudo }, headers: { Prefer: 'return=minimal' } });
  await sbLoadProfile();
}
const SHARE_DEFAULT = { watching: true, recent: true, favs: true };
const shareOpt = (k) => ((userState.share || {})[k] !== undefined ? userState.share[k] : SHARE_DEFAULT[k]);
// Résumé publié sur le profil (petit : séries en cours, activité récente, favoris, compteurs).
function buildShareSnapshot() {
  buildModel();
  const shows = Array.from(MODEL.shows.values());
  const movies = (DATA.movies || []).concat(userState.customMovies || []);
  const snap = {
    v: 1, at: new Date().toISOString(),
    stats: { eps: computeSeenCount(), shows: shows.filter(s => s.seenKeys.size > 0).length, movies: movies.filter(m => movieStatus(m) === 'watched').length },
  };
  const posterOf = (s) => { const m = metaFor(s); return (m && m.poster) || s.poster || null; };
  if (shareOpt('watching')) {
    snap.watching = shows.filter(s => seriesCategory(s) === 'watching')
      .sort((a, b) => (b.lastSeenAt || '').localeCompare(a.lastSeenAt || ''))
      .slice(0, 30)
      .map(s => {
        const pass = isRewatching(s) && rewatchPass(s); // revisionnage : progression du nouveau passage
        return pass ? { n: displayName(s), p: posterOf(s), d: pass.done, t: pass.total, r: 1 }
          : { n: displayName(s), p: posterOf(s), d: s.seenKeys.size, t: airedTotal(metaFor(s)) || 0 };
      });
  }
  if (shareOpt('recent')) {
    const ev = [];
    for (const r of DATA.seen || []) {
      if (r.showId == null || r.showId === '' || !r.seenAt) continue;
      if (userState.seenRemove[epKey(r.showId, r.season, r.number)]) continue;
      ev.push({ k: 'e', at: r.seenAt, sk: String(r.showId), s: r.season, e: r.number });
    }
    for (const [kk, v] of Object.entries(userState.seenAdd || {})) {
      if (!v || !v.at) continue;
      const [sk, s, e] = kk.split('|');
      ev.push({ k: 'e', at: v.at, sk, s, e });
    }
    for (const m of movies) if (movieStatus(m) === 'watched') { const at = movieWatchedOf(m); if (at) ev.push({ k: 'm', at, n: movieDisplayName(m) }); }
    ev.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const groups = [];
    for (const x of ev) {
      if (groups.length >= 10) break;
      if (x.k === 'e') {
        const sh = MODEL.shows.get(x.sk); if (!sh) continue;
        const last = groups[groups.length - 1];
        if (last && last.k === 'e' && last.sk === x.sk) { last.c++; continue; }
        groups.push({ k: 'e', sk: x.sk, n: displayName(sh), e: epTag(sh, x.s, x.e), c: 1, at: x.at });
      } else groups.push({ k: 'm', n: x.n, c: 1, at: x.at });
    }
    snap.recent = groups.map(g => ({ k: g.k, n: g.n, e: g.e, c: g.c, at: g.at }));
  }
  if (shareOpt('favs')) {
    snap.favShows = shows.filter(s => isFavShow(s)).slice(0, 15).map(s => ({ n: displayName(s), p: posterOf(s) }));
    snap.favMovies = movies.filter(m => isFavMovie(m)).slice(0, 15).map(m => ({ n: movieDisplayName(m), p: (tmdbCache.movies && tmdbCache.movies[m.name] && tmdbCache.movies[m.name].poster) || null }));
  }
  return snap;
}
// Met à jour mon profil en ligne (résumé si public, sinon effacé). `extra` = autres champs à modifier.
// Le résumé va dans « profile_snapshots » (lisible par soi et les amis mutuels) ; « profiles » ne garde que pseudo / photo.
// Tant que cette table n'existe pas (SQL pas encore exécuté), repli : résumé écrit dans profiles.snapshot comme avant.
let _sbSnapTable = null, _sbSnapMissAt = 0; // null = inconnu, true = présente, false = absente (retentée après 5 min)
// Seulement les vraies erreurs « table inconnue » de Postgres / PostgREST (pas une 404 quelconque)
const sbMissingTable = (e) => /42P01|PGRST205|Could not find the table|relation "?[\w.]*profile_snapshots"? does not exist/i.test(String(e && e.message));
function markSnapTableMissing() { _sbSnapTable = false; _sbSnapMissAt = Date.now(); }
const snapTableUsable = () => _sbSnapTable !== false || Date.now() - _sbSnapMissAt > 5 * 60000;
async function sbPublishProfile(force, extra) {
  if (!sbSession || !sbProfile) return;
  if (!force && !extra && Date.now() - _sbPubAt < 3600000) return;
  _sbPubAt = Date.now();
  const isPublic = extra && extra.is_public !== undefined ? extra.is_public : sbProfile.is_public;
  const snap = isPublic ? buildShareSnapshot() : null;
  const now = new Date().toISOString();
  const body = Object.assign({}, extra, { updated_at: now });
  let wrote = false, snapErr = null;
  if (snapTableUsable()) {
    try {
      if (snap) await sbApi('profile_snapshots?on_conflict=user_id', { method: 'POST', json: { user_id: sbSession.uid, snapshot: snap, updated_at: now }, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
      else await sbApi('profile_snapshots?user_id=eq.' + sbSession.uid, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      _sbSnapTable = true; wrote = true;
    } catch (e) { if (sbMissingTable(e)) markSnapTableMissing(); else snapErr = e; }
  }
  if (!wrote && !snapErr) body.snapshot = snap; // repli : ancienne table (avant l'exécution du SQL)
  // Le profil (pseudo, photo, trouvable) est toujours enregistré, même si le résumé a échoué
  await sbApi('profiles?id=eq.' + sbSession.uid, { method: 'PATCH', json: body, headers: { Prefer: 'return=minimal' } });
  Object.assign(sbProfile, extra || {}, { updated_at: now });
  if (snapErr) throw snapErr;
}
// Complète des profils (liste d'amis ou fiche) avec leur résumé : table profile_snapshots, sinon profiles.snapshot.
async function sbAttachSnapshots(profs) {
  const ids = profs.map(p => p.id).filter(isUuid);
  if (!ids.length || !snapTableUsable()) return profs;
  try {
    const rows = (await sbApi('profile_snapshots?select=user_id,snapshot,updated_at&user_id=in.(' + ids.join(',') + ')')) || [];
    _sbSnapTable = true;
    const by = new Map(rows.map(r => [r.user_id, r]));
    for (const p of profs) { const r = by.get(p.id); if (r && r.snapshot) { p.snapshot = r.snapshot; p.updated_at = r.updated_at || p.updated_at; } }
  } catch (e) { if (sbMissingTable(e)) markSnapTableMissing(); }
  return profs; // sans ligne dans la nouvelle table : on garde profiles.snapshot (repli)
}
// En arrière-plan (ouverture de l'app) : republie le résumé au plus une fois par heure.
async function sbMaybePublish() {
  if (!sbSession) return;
  try { if (!sbProfile) await sbLoadProfile(); if (sbProfile && sbProfile.is_public) await sbPublishProfile(false); } catch {}
  if (sbProfile) sbCheckFriendRequests();
  sbSyncReviews();
}
// Photo de profil : recadrée au carré et réduite à 160 px (≈ 10 Ko) avant l'envoi.
function avatarFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const S = 160, side = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement('canvas'); c.width = c.height = S;
      c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, S, S);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible')); };
    img.src = url;
  });
}
const safeAvatar = (a) => (typeof a === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(a)) ? a : null;
const safePoster = (p) => (typeof p === 'string' && /^\/[A-Za-z0-9_.-]+$/.test(p)) ? p : null;
function avatarHtml(avatar, pseudo, cls = '') {
  const a = safeAvatar(avatar);
  return a ? `<img class="avatar ${cls}" src="${a}" alt="">` : `<span class="avatar ${cls}">${esc((pseudo || '?').slice(0, 1).toUpperCase())}</span>`;
}
function activityText(g) {
  if (g.k === 'm') return `a vu le film ${g.n}`;
  return g.c > 1 ? `a vu ${g.c} épisodes de ${g.n} (jusqu'à ${g.e})` : `a vu ${g.e} de ${g.n}`;
}
// Demandes d'ami : une ligne follows A→B = « A demande B en ami » ; A→B et B→A = amis.
const isUuid = (id) => /^[0-9a-f-]{36}$/.test(id || '');
async function sbLoadFriends() {
  const me = sbSession.uid;
  const rows = (await sbApi('follows?or=(follower.eq.' + me + ',followed.eq.' + me + ')&select=follower,followed')) || [];
  const out = new Set(rows.filter(r => r.follower === me).map(r => r.followed).filter(isUuid));
  const inc = new Set(rows.filter(r => r.followed === me).map(r => r.follower).filter(isUuid));
  const ids = Array.from(new Set([...out, ...inc]));
  const profs = ids.length ? ((await sbApi('profiles?id=in.(' + ids.join(',') + ')&select=id,pseudo,avatar,snapshot,updated_at')) || []) : [];
  await sbAttachSnapshots(profs);
  const res = { friends: [], incoming: [], outgoing: [] };
  for (const p of profs) {
    if (out.has(p.id) && inc.has(p.id)) res.friends.push(p);
    else if (inc.has(p.id)) res.incoming.push(p);
    else res.outgoing.push(p);
  }
  for (const k of Object.keys(res)) res[k].sort((a, b) => a.pseudo.localeCompare(b.pseudo));
  _sbFriendsCache = res.friends.map(p => ({ id: p.id, pseudo: p.pseudo }));
  sbSetFriendBadge(res.incoming.length);
  return res;
}
// Pastille sur l'onglet Amis = nombre de demandes reçues en attente.
let _badgeReq = 0, _badgeReco = 0;
function sbSetFriendBadge(n) { _badgeReq = n; paintFriendBadge(); }
function sbSetRecoBadge(n) { _badgeReco = n; paintFriendBadge(); }
function paintFriendBadge() {
  const n = _badgeReq + _badgeReco;
  const a = document.querySelector('.bottom-nav a[data-route="friends"]'); if (!a) return;
  let b = a.querySelector('.bn-badge');
  if (!n) { if (b) b.remove(); return; }
  if (!b) { b = document.createElement('span'); b.className = 'bn-badge'; a.appendChild(b); }
  b.textContent = n > 9 ? '9+' : String(n);
}
async function sbCheckFriendRequests() {
  if (!sbSession) return;
  try {
    const me = sbSession.uid;
    const rows = (await sbApi('follows?or=(follower.eq.' + me + ',followed.eq.' + me + ')&select=follower,followed')) || [];
    const mine = new Set(rows.filter(r => r.follower === me).map(r => r.followed));
    sbSetFriendBadge(rows.filter(r => r.followed === me && !mine.has(r.follower)).length);
  } catch {}
  // Recommandations non vues (table absente : ignoré sans bruit)
  if (_recoTable !== false) {
    try { sbSetRecoBadge(((await recoApi('recommendations?to_id=eq.' + sbSession.uid + '&seen=eq.false&select=id')) || []).length); } catch {}
  }
}
async function sbAcceptFriend(id) {
  await sbApi('follows', { method: 'POST', json: { follower: sbSession.uid, followed: id }, headers: { Prefer: 'return=minimal' } });
}
// Supprime le lien dans les deux sens (refuser une demande, l'annuler, ou retirer un ami).
async function sbRemoveFriend(id) {
  const me = sbSession.uid, h = { Prefer: 'return=minimal' };
  await sbApi('follows?follower=eq.' + me + '&followed=eq.' + id, { method: 'DELETE', headers: h });
  await sbApi('follows?follower=eq.' + id + '&followed=eq.' + me, { method: 'DELETE', headers: h });
}
async function sbFollowByPseudo(pseudo) {
  if (!/^[A-Za-z0-9_.-]{3,20}$/.test(pseudo)) throw new Error('Pseudo invalide');
  const rows = await sbApi('profiles?pseudo=ilike.' + encodeURIComponent(pseudo.replace(/_/g, '\\_')) + '&select=id,pseudo');
  const hit = (rows || []).find(r => r.pseudo.toLowerCase() === pseudo.toLowerCase());
  if (!hit) throw new Error('Aucun profil visible avec ce pseudo (son propriétaire doit cocher « Rendre mon profil visible » dans Mon compte)');
  if (hit.id === sbSession.uid) throw new Error('C\'est votre propre pseudo 🙂');
  const back = (await sbApi('follows?follower=eq.' + hit.id + '&followed=eq.' + sbSession.uid + '&select=follower')) || [];
  await sbApi('follows', { method: 'POST', json: { follower: sbSession.uid, followed: hit.id }, headers: { Prefer: 'return=minimal' } });
  return { pseudo: hit.pseudo, accepted: back.length > 0 };
}

// Bouton « Mon compte » (avatar) en haut à droite des 4 onglets : mène au profil, aux réglages et à la connexion.
// Loupe de l'en-tête (Séries / Films) : ouvre la recherche unifiée. À poser à côté de acctBtn().
function searchBtn(kind) {
  return `<button type="button" class="search-btn" data-search="${kind}" aria-label="Rechercher">${icon('search')}</button>`;
}
function wireSearchBtn(el) {
  const b = el.querySelector('[data-search]');
  if (b) b.onclick = () => openUnifiedSearch(b.dataset.search);
}
function acctBtn() {
  let c = null;
  try { c = JSON.parse(localStorage.getItem('tvtime-acct') || 'null'); } catch {}
  const inner = sbSession && c ? avatarHtml(c.avatar, c.pseudo) : '<span class="avatar">👤</span>';
  return `<a class="acct-btn" href="#/profile" aria-label="Mon compte">${inner}</a>`;
}
// Garde le pseudo et la photo sur l'appareil (bouton Mon compte, « Bonjour … » même hors-ligne).
function sbCacheAccount() {
  if (!sbProfile) return;
  try { localStorage.setItem('tvtime-acct', JSON.stringify({ pseudo: sbProfile.pseudo, avatar: safeAvatar(sbProfile.avatar) })); } catch {}
  if (userState.profileName !== sbProfile.pseudo) { userState.profileName = sbProfile.pseudo; scheduleSaveState(); }
  document.querySelectorAll('.acct-btn').forEach(b => { b.innerHTML = avatarHtml(sbProfile.avatar, sbProfile.pseudo); });
}

// Panneau « Mon profil » (page Mon compte) : créer le pseudo, photo, visibilité, ce qui est partagé.
async function fillAccountProfile(box) {
  box.innerHTML = '<div class="panel"><h3>Mon profil</h3><p class="hint" style="color:var(--muted)">Chargement…</p></div>';
  try { await sbLoadProfile(); }
  catch (e) {
    box.innerHTML = `<div class="panel"><h3>Mon profil</h3><p class="hint" style="color:var(--muted)">Indisponible pour l'instant (${esc(e.message || 'hors-ligne')}). Si le message parle d'une table introuvable, le script « supabase-communaute.sql » n'a pas encore été exécuté dans Supabase.</p></div>`;
    return;
  }
  if (!sbProfile) {
    box.innerHTML = `<div class="panel"><h3>Créer mon profil</h3>
      <p class="hint" style="color:var(--muted)">Choisissez un pseudo : c'est le nom que vos amis taperont pour vous retrouver. 3 à 20 caractères : lettres, chiffres, _ . -<br>Votre profil reste <b>invisible</b> tant que vous ne l'avez pas rendu visible.</p>
      <input class="input" id="frPseudo" placeholder="Votre pseudo" autocapitalize="off" autocomplete="off">
      <div class="row" style="margin-top:8px"><button class="btn primary" id="frCreate">Créer mon profil</button> <span id="frStatus" class="sub"></span></div></div>`;
    box.querySelector('#frCreate').onclick = async (ev) => {
      const b = ev.currentTarget, st = box.querySelector('#frStatus'); b.disabled = true; st.textContent = '…';
      try { await sbCreateProfile(box.querySelector('#frPseudo').value.trim()); sbCacheAccount(); render(); }
      catch (e) { st.textContent = '❌ ' + (e.message || 'Échec'); b.disabled = false; }
    };
    return;
  }
  sbCacheAccount();
  const pub = sbProfile.is_public;
  box.innerHTML = `<div class="panel"><h3>Mon profil</h3>
      <div style="display:flex;align-items:center;gap:14px">
        <label style="cursor:pointer">${avatarHtml(sbProfile.avatar, sbProfile.pseudo, 'lg')}<input type="file" id="frAvatar" accept="image/*" hidden><span class="sub" style="display:block;text-align:center;font-size:11px">Changer la photo</span></label>
        <div><b style="font-size:18px">${esc(sbProfile.pseudo)}</b><div class="hint" style="color:var(--muted)">${pub ? '🟢 Trouvable par pseudo' : '🔒 Introuvable'}</div></div>
      </div>
      <label class="check-row" style="display:flex;gap:10px;margin-top:12px;cursor:pointer"><input type="checkbox" id="frPublic" ${pub ? 'checked' : ''}><span>Me rendre trouvable par mon pseudo</span></label>
      <p class="hint" style="color:var(--muted);margin:6px 0 0 26px">Votre pseudo et votre photo permettent à vos amis de vous trouver ; vos séries et votre activité ne sont visibles que par vos amis.</p>
      ${pub ? `<div style="margin-left:26px">
        <label class="check-row"><input type="checkbox" data-share="watching" ${shareOpt('watching') ? 'checked' : ''}> Mes séries en cours</label>
        <label class="check-row"><input type="checkbox" data-share="recent" ${shareOpt('recent') ? 'checked' : ''}> Mon activité récente</label>
        <label class="check-row"><input type="checkbox" data-share="favs" ${shareOpt('favs') ? 'checked' : ''}> Mes favoris</label>
        <p class="hint" style="color:var(--muted)">Mis à jour à chaque ouverture de l'app (au plus une fois par heure). Dernière publication : <b>${esc(fmtAgo(sbProfile.updated_at))}</b>.</p>
        <button class="btn sm" id="frPublish">Publier maintenant</button>
      </div>` : ''}
      <span id="frStatus" class="sub"></span></div>`;
  const st = box.querySelector('#frStatus');
  const guard = (fn) => async (ev) => {
    const t = ev.currentTarget; if (sbBusy) return; sbBusy = true; t.disabled = true;
    try { await fn(t); } catch (e) { st.textContent = '❌ ' + (e.message || 'Échec'); t.disabled = false; }
    sbBusy = false;
  };
  box.querySelector('#frAvatar').onchange = async (ev) => {
    const file = ev.target.files[0]; if (!file || sbBusy) return; sbBusy = true; st.textContent = 'Envoi de la photo…';
    try { const data = await avatarFromFile(file); await sbPublishProfile(true, { avatar: data }); sbCacheAccount(); render(); }
    catch (e) { st.textContent = '❌ ' + (e.message || 'Échec'); }
    sbBusy = false;
  };
  box.querySelector('#frPublic').onchange = guard(async (t) => { await sbPublishProfile(true, { is_public: t.checked }); render(); });
  box.querySelectorAll('[data-share]').forEach(cb => cb.onchange = guard(async (t) => {
    userState.share = Object.assign({}, userState.share, { [t.dataset.share]: t.checked }); scheduleSaveState();
    await sbPublishProfile(true); t.disabled = false; st.textContent = '✅ Mis à jour';
  }));
  const pb = box.querySelector('#frPublish');
  if (pb) pb.onclick = guard(async () => { await sbPublishProfile(true); render(); toast('Profil publié'); });
}

//////////////////////// Avis ////////////////////////
// Mon avis est gardé dans userState.reviews (donc dans les sauvegardes) et, si je suis connecté,
// envoyé dans la table Supabase « reviews » (script supabase-avis.sql) où seuls mes amis peuvent le lire.
// Clé partagée entre utilisateurs = identifiants TMDB : « tv:<série>:<saison>:<épisode> » ou « mv:<film> ».
const REVIEW_MAX = 2000;
const reviewWorkEp = (tmdbId, se, n) => (tmdbId ? `tv:${tmdbId}:${se}:${n}` : null);
const reviewWorkMovie = (id) => (id ? `mv:${id}` : null);
const myReview = (lk) => (userState.reviews || {})[lk] || null;
function setMyReview(lk, work, text, stars) {
  const t = String(text || '').trim().slice(0, REVIEW_MAX);
  const old = myReview(lk);
  userState.reviews = Object.assign({}, userState.reviews);
  let dels = (userState.reviewDeletes || []).slice();
  if (t) {
    userState.reviews[lk] = { text: t, at: new Date().toISOString(), work: work || null, stars: stars || null, pending: !!work };
    if (work) dels = dels.filter(x => x !== work);
  } else {
    delete userState.reviews[lk];
    if (old && old.work && !dels.includes(old.work)) dels.push(old.work);
  }
  userState.reviewDeletes = dels;
  scheduleSaveState();
  return sbSyncReviews();
}
// Envoie les avis pas encore en ligne (écrits hors connexion ou avant de se connecter).
let _revSyncing = false;
async function sbSyncReviews() {
  if (!sbSession || _revSyncing) return;
  _revSyncing = true;
  try {
    const me = sbSession.uid, h = { Prefer: 'return=minimal' };
    for (const work of (userState.reviewDeletes || []).slice()) {
      await sbApi('reviews?user_id=eq.' + me + '&work=eq.' + encodeURIComponent(work), { method: 'DELETE', headers: h });
      userState.reviewDeletes = (userState.reviewDeletes || []).filter(x => x !== work);
      scheduleSaveState();
    }
    for (const [lk, r] of Object.entries(userState.reviews || {})) {
      if (!r || !r.pending || !r.work) continue;
      await sbApi('reviews?on_conflict=user_id,work', { method: 'POST', json: { user_id: me, work: r.work, body: r.text, stars: r.stars || null, updated_at: r.at }, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
      const cur = myReview(lk);
      if (cur && cur.at === r.at) { userState.reviews[lk] = Object.assign({}, cur, { pending: false }); scheduleSaveState(); }
    }
  } catch {} finally { _revSyncing = false; }
}
// Avis des amis sur une œuvre (la sécurité Supabase ne renvoie que ceux de mes amis).
const _frRevCache = new Map();
async function sbFriendReviews(work) {
  const hit = _frRevCache.get(work);
  if (hit && Date.now() - hit.t < 120000) return hit.v;
  const rows = (await sbApi('reviews?work=eq.' + encodeURIComponent(work) + '&user_id=neq.' + sbSession.uid + '&select=user_id,body,stars,updated_at&order=updated_at.desc')) || [];
  const ids = Array.from(new Set(rows.map(r => r.user_id).filter(isUuid)));
  const profs = ids.length ? ((await sbApi('profiles?id=in.(' + ids.join(',') + ')&select=id,pseudo,avatar')) || []) : [];
  const byId = new Map(profs.map(p => [p.id, p]));
  const v = rows.map(r => Object.assign({}, r, { p: byId.get(r.user_id) || { pseudo: 'Ami(e)' } }));
  _frRevCache.set(work, { t: Date.now(), v });
  return v;
}
const reviewsSectionHtml = () => `<div class="about review-sec" style="margin-top:16px"><div class="about-block" id="myReview"></div><div class="about-block" id="frReviews"></div></div>`;
// Remplit « Mon avis » et « Avis de mes amis ». o = { lk, work, seen, stars(), what: "l'épisode" | 'le film' }
function wireReviews(el, o) {
  const box = el.querySelector('#myReview'), fr = el.querySelector('#frReviews');
  if (!box || !fr) return { setSeen() {} };
  const stars = (n) => { const r = reactOfScore(n); return r ? `<span class="rv-stars" title="${esc(r.label)}">${r.emoji} ${n}/5</span>` : ''; };
  const showMine = (editing) => {
    const r = myReview(o.lk);
    if (editing) {
      box.innerHTML = `<h3>Mon avis</h3>
        <div class="review-edit"><textarea id="rvText" maxlength="${REVIEW_MAX}" placeholder="Qu'avez-vous pensé de ${esc(o.what)} ?">${esc(r ? r.text : '')}</textarea>
        <div class="rv-count"><span id="rvN">${r ? r.text.length : 0}</span> / ${REVIEW_MAX}</div>
        <div class="detail-actions"><button class="btn primary" id="rvSave">Enregistrer</button><button class="btn ghost" id="rvCancel">Annuler</button>${r ? '<button class="btn danger" id="rvDel">Supprimer</button>' : ''}</div></div>`;
      const ta = box.querySelector('#rvText');
      ta.focus();
      ta.oninput = () => { box.querySelector('#rvN').textContent = ta.value.length; };
      box.querySelector('#rvSave').onclick = () => {
        if (!ta.value.trim()) { toast('Écrivez quelques mots (ou « Annuler »)'); return; }
        const p = setMyReview(o.lk, o.work, ta.value, o.stars()); showMine(false);
        Promise.resolve(p).then(() => { if (box.isConnected && !box.querySelector('#rvText')) showMine(false); });
        toast(o.work && sbSession ? 'Avis enregistré — vos amis peuvent le lire' : 'Avis enregistré');
      };
      box.querySelector('#rvCancel').onclick = () => showMine(false);
      const del = box.querySelector('#rvDel');
      if (del) del.onclick = () => { if (!confirm('Supprimer mon avis ?')) return; setMyReview(o.lk, o.work, ''); showMine(false); toast('Avis supprimé'); };
      return;
    }
    const note = !o.work ? 'Œuvre non reconnue sur TMDB : avis gardé seulement dans vos données.'
      : !sbSession ? 'Connectez-vous (Mon compte) pour que vos amis puissent le lire.'
      : (r && r.pending) ? 'Sera envoyé à vos amis dès que vous serez en ligne.' : '';
    box.innerHTML = r
      ? `<h3>Mon avis</h3><p class="review-text">${esc(r.text)}</p><div class="rv-meta">${fmtFull(r.at)}${note ? ' · ' + note : ''}</div><button class="btn sm" id="rvEdit">${icon('edit')} Modifier</button>`
      : `<h3>Mon avis</h3><button class="btn" id="rvEdit">${icon('edit')} Écrire un avis</button>${note ? `<div class="rv-meta">${note}</div>` : ''}`;
    box.querySelector('#rvEdit').onclick = () => showMine(true);
  };
  let seen = o.seen;
  const showFriends = async () => {
    if (!o.work || !sbSession) { fr.remove(); return; }
    fr.innerHTML = '<h3>Avis de mes amis</h3><div class="rv-meta">Chargement…</div>';
    let list;
    try { list = await sbFriendReviews(o.work); } catch { fr.innerHTML = '<h3>Avis de mes amis</h3><div class="rv-meta">Indisponibles pour le moment.</div>'; return; }
    if (!list.length) { fr.innerHTML = '<h3>Avis de mes amis</h3><div class="rv-meta">Aucun ami n’a encore donné son avis.</div>'; return; }
    if (!seen) {
      fr.innerHTML = `<h3>Avis de mes amis</h3><div class="rv-meta">🙈 ${list.length} avis vous attend${list.length > 1 ? 'ent' : ''} : visible${list.length > 1 ? 's' : ''} une fois que vous aurez vu ${esc(o.what)}.</div>`;
      return;
    }
    fr.innerHTML = '<h3>Avis de mes amis</h3>' + list.map(r => `<div class="fr-review">${avatarHtml(r.p.avatar, r.p.pseudo)}<div class="fr-review-body"><div><a class="who" href="#/friend/${esc(r.user_id)}">${esc(r.p.pseudo)}</a> ${stars(r.stars)} <span class="rv-meta">${fmtFull(r.updated_at)}</span></div><p class="review-text">${esc(r.body)}</p></div></div>`).join('');
  };
  showMine(false);
  showFriends();
  return { setSeen(v) { if (v !== seen) { seen = v; showFriends(); } } };
}

// ---- Fil « Dernières notations » de la page Amis (avis des amis, un seul appel léger) ----
// Source : table « reviews » (la sécurité Supabase ne renvoie que les avis de mes amis). Les réactions seules ne sont pas partagées.
const _fdMeta = new Map(); // work → { title, poster } (titre FR + affiche, complétés depuis TMDB si absents du cache)
async function sbFeedReviews(friends) {
  const ids = friends.map(f => f.id).filter(isUuid);
  if (!ids.length) return [];
  const rows = (await sbApi('reviews?user_id=in.(' + ids.join(',') + ')&select=user_id,work,body,stars,updated_at&order=updated_at.desc&limit=30')) || [];
  const by = new Map(friends.map(f => [f.id, f]));
  return rows.filter(r => r && r.work && by.has(r.user_id)).map(r => Object.assign({}, r, { p: by.get(r.user_id) }));
}
// « tv:123:1:2 » / « mv:55 » → { kind, id, s, n }
function parseWork(work) {
  const m = /^(tv|mv):([0-9]+)(?::([0-9]+):([0-9]+))?$/.exec(work || '');
  return m ? { kind: m[1] === 'tv' ? 'tv' : 'movie', id: +m[2], s: m[3] != null ? +m[3] : null, n: m[4] != null ? +m[4] : null } : null;
}
function feedMetaCached(w) {
  if (w.kind === 'tv') { const x = tmdbCache.shows && tmdbCache.shows[w.id]; return x ? { title: x.name, poster: x.poster } : null; }
  const x = tmdbCache.movieMeta && tmdbCache.movieMeta[w.id]; return x ? { title: x.title, poster: x.poster } : null;
}
async function feedMetaLoad(work, w) {
  if (_fdMeta.has(work)) return _fdMeta.get(work);
  let v = feedMetaCached(w);
  if (!v && hasKey()) {
    try { const d = await tmdbFetch((w.kind === 'tv' ? '/tv/' : '/movie/') + w.id); v = { title: d.name || d.title, poster: d.poster_path }; } catch {}
  }
  if (v) _fdMeta.set(work, v);
  return v;
}
// Lien + « déjà vu ? » (anti-spoiler : l'extrait reste masqué tant que je n'ai pas vu l'œuvre)
function feedTarget(w, look) {
  const own = (look || ownedLookup())({ media_type: w.kind, id: w.id });
  if (w.kind === 'movie') {
    const m = own && (DATA.movies || []).concat(userState.customMovies || []).find(x => x.name === own);
    return { href: own ? '#/movie/' + encodeURIComponent(own) : '#/preview/movie/' + w.id, seen: !!(m && movieStatus(m) === 'watched') };
  }
  const sh = own && MODEL.shows.get(own);
  if (sh && w.s != null) return { href: '#/episode/' + encodeURIComponent(own) + '/' + w.s + '/' + w.n, seen: isSeen(sh, w.s, w.n) };
  return { href: own ? '#/show/' + encodeURIComponent(own) : '#/preview/tv/' + w.id, seen: !!sh };
}
function feedCardHtml(r, look) {
  const w = parseWork(r.work); if (!w) return '';
  const meta = _fdMeta.get(r.work) || feedMetaCached(w) || {};
  const t = feedTarget(w, look);
  const po = safePoster(meta.poster);
  const rc = reactOfScore(Math.round(Number(r.stars) || 0));
  const ep = w.s != null ? `<span class="fd-ep">S${String(w.s).padStart(2, '0')}E${String(w.n).padStart(2, '0')}</span>` : '';
  const body = String(r.body || '').trim();
  const text = !body ? '' : t.seen ? `<p class="fd-text">${esc(body)}</p>` : '<p class="fd-text fd-hidden">🙈 Avis masqué jusqu’à ce que vous l’ayez vu</p>';
  return `<a class="fd-card" href="${esc(t.href)}">
    <div class="fd-poster">${po ? `<img loading="lazy" src="${IMG(po)}" alt="">` : '<span>' + icon(w.kind === 'tv' ? 'tv' : 'film') + '</span>'}</div>
    <div class="fd-main">
      <div class="fd-title">${esc(meta.title || (w.kind === 'tv' ? 'Série' : 'Film'))} ${ep}</div>
      ${rc ? `<div class="fd-rate" title="${esc(rc.label)}"><span>${rc.emoji}</span> ${esc(rc.label)} · ${Math.round(r.stars)}/5</div>` : ''}
      ${text}
      <div class="fd-who">${avatarHtml(r.p.avatar, r.p.pseudo)}<b>${esc(r.p.pseudo)}</b><span>${esc(fmtAgo(r.updated_at))}</span></div>
    </div></a>`;
}
// Dessine le fil dans « box » ; titres / affiches manquants sont chargés puis la liste est redessinée.
async function paintFeed(box, reviews) {
  const draw = () => { if (!box.isConnected) return; const look = ownedLookup(); box.innerHTML = reviews.map(r => feedCardHtml(r, look)).join(''); };
  buildModel(); draw();
  const todo = reviews.map(r => [r.work, parseWork(r.work)]).filter(([k, w]) => w && !_fdMeta.has(k) && !feedMetaCached(w));
  if (!todo.length) return;
  await Promise.all(todo.map(([k, w]) => feedMetaLoad(k, w)));
  draw();
}

route('friends', async (el) => {
  const head = `<div class="page-head"><h1>Amis</h1>${acctBtn()}</div>`;
  if (!sbSession) {
    el.innerHTML = `${head}<div class="empty"><div class="big">${emojiIcon('👥')}</div><p>Pour retrouver vos amis, connectez-vous d'abord (Mon compte).</p><a class="btn primary" href="#/profile">Me connecter</a></div>`;
    return;
  }
  el.innerHTML = `${head}<p class="hint" style="color:var(--muted)">Chargement…</p>`;
  let L = { friends: [], incoming: [], outgoing: [] };
  try {
    await sbLoadProfile();
    if (sbProfile) { sbCacheAccount(); L = await sbLoadFriends(); }
  } catch (e) {
    el.innerHTML = `${head}<div class="empty"><p>Impossible de joindre le serveur (${esc(e.message || 'hors-ligne')}). Réessayez avec Internet. Si le message parle d'une table introuvable, le script « supabase-communaute.sql » n'a pas encore été exécuté.</p></div>`;
    return;
  }
  if (!sbProfile) {
    el.innerHTML = `${head}<div class="empty"><div class="big">${emojiIcon('👥')}</div><p>Créez d'abord votre profil (pseudo et photo) dans Mon compte.</p><a class="btn primary" href="#/profile">Créer mon profil</a></div>`;
    return;
  }
  const { friends, incoming, outgoing } = L;
  const [recs, revs] = await Promise.all([
    sbLoadRecos().catch(() => []),
    sbFeedReviews(friends).catch(() => []),
  ]);
  const feed = [];
  for (const f of friends) for (const g of ((f.snapshot && f.snapshot.recent) || [])) feed.push({ f, g });
  feed.sort((a, b) => String(b.g.at).localeCompare(String(a.g.at)));
  const lastOf = (f) => { const g = f.snapshot && f.snapshot.recent && f.snapshot.recent[0]; return g ? `${activityText(g)} · ${fmtAgo(g.at)}` : (f.snapshot ? 'Rien de partagé pour l\'instant' : 'Profil pas encore publié'); };
  const person = (f, actions, sub) => `<div class="friend-row">${avatarHtml(f.avatar, f.pseudo)}<span style="flex:1"><b>${esc(f.pseudo)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>${actions}</div>`;
  el.innerHTML = `${head}
    ${sbProfile.is_public ? '' : `<div class="panel"><p class="hint" style="color:var(--muted);margin:0">🔒 Vous êtes introuvable : vos amis ne peuvent pas vous trouver avec votre pseudo. <a href="#/profile">Me rendre trouvable</a></p></div>`}
    ${incoming.length ? `<div class="panel fr-requests"><h3>${icon('mail')} Demandes d'ami <span style="color:var(--muted);font-weight:400">· ${incoming.length}</span></h3>
      ${incoming.map(f => person(f, `<button class="btn sm primary" data-accept="${esc(f.id)}">Accepter</button><button class="btn sm ghost" data-refuse="${esc(f.id)}">Refuser</button>`, 'veut être votre ami(e)')).join('')}</div>` : ''}
    ${friends.length ? `<div class="fr-stories">${friends.map(f => `<a class="fr-story" href="#/friend/${esc(f.id)}">${avatarHtml(f.avatar, f.pseudo)}<span>${esc(f.pseudo)}</span></a>`).join('')}<button type="button" class="fr-story fr-story-add" id="frStoryAdd"><span class="avatar">＋</span><span>Ajouter</span></button></div>` : ''}
    <section class="fd-sec"><h2 class="fd-h">Dernières notations</h2>
      ${revs.length ? '<div class="fd-list" id="fdList"></div>' : `<div class="fd-empty"><div class="big">${emojiIcon('💬')}</div><p>${friends.length ? 'Aucune notation pour l’instant. Les avis écrits par vos amis sur un épisode ou un film apparaîtront ici.' : 'Ajoutez des amis pour voir ici ce qu’ils pensent des séries et des films.'}</p><button type="button" class="btn primary" id="frEmptyAdd">Ajouter un ami</button></div>`}
    </section>
    ${recoSectionHtml(recs, friends)}
    <div class="panel" id="frAddPanel"><h3>Ajouter un ami</h3>
      <div class="row" style="display:flex;gap:10px"><input class="input" id="frAdd" placeholder="Son pseudo" autocapitalize="off" autocomplete="off" style="flex:1"><button class="btn primary" id="frAddBtn">Envoyer</button></div>
      <span id="frAddStatus" class="sub"></span>
    </div>
    <div class="panel"><h3>Mes amis <span style="color:var(--muted);font-weight:400">· ${friends.length}</span></h3>
      ${friends.length ? friends.map(f => `<a class="friend-row" href="#/friend/${esc(f.id)}">${avatarHtml(f.avatar, f.pseudo)}<span><b>${esc(f.pseudo)}</b><small>${esc(lastOf(f))}</small></span></a>`).join('')
        : '<p class="hint" style="color:var(--muted)">Personne pour l\'instant. Envoyez une demande avec le pseudo d\'un ami : vous serez amis quand il l\'aura acceptée.</p>'}
    </div>
    ${outgoing.length ? `<div class="panel"><h3>${icon('clock')} Demandes envoyées</h3>
      ${outgoing.map(f => person(f, `<button class="btn sm ghost" data-cancel="${esc(f.id)}">Annuler</button>`, 'en attente de réponse')).join('')}</div>` : ''}
    ${feed.length ? `<div class="panel"><h3>Activité des amis</h3>${feed.slice(0, 20).map(x => `<div class="feed-line"><b>${esc(x.f.pseudo)}</b> ${esc(activityText(x.g))} <span class="sub">· ${esc(fmtAgo(x.g.at))}</span></div>`).join('')}</div>` : ''}`;
  const act = (sel, fn) => el.querySelectorAll(sel).forEach(btn => btn.onclick = async () => {
    if (sbBusy) return; sbBusy = true; btn.disabled = true;
    try { await fn(btn); sbBusy = false; render(); return; }
    catch (e) { toast('Échec : ' + (e.message || '')); btn.disabled = false; }
    sbBusy = false;
  });
  const goAdd = () => { const p = el.querySelector('#frAddPanel'); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'center' }); const i = el.querySelector('#frAdd'); if (i) setTimeout(() => i.focus({ preventScroll: true }), 350); };
  ['#frStoryAdd', '#frEmptyAdd'].forEach(q => { const b = el.querySelector(q); if (b) b.onclick = goAdd; });
  const fdBox = el.querySelector('#fdList'); if (fdBox) paintFeed(fdBox, revs);
  wireRecoSection(el, recs, friends);
  act('[data-accept]', async (b) => { await sbAcceptFriend(b.dataset.accept); toast('Vous êtes maintenant amis'); });
  act('[data-refuse]', async (b) => { await sbRemoveFriend(b.dataset.refuse); toast('Demande refusée'); });
  act('[data-cancel]', async (b) => { await sbRemoveFriend(b.dataset.cancel); toast('Demande annulée'); });
  el.querySelector('#frAddBtn').onclick = async (ev) => {
    const b = ev.currentTarget, add = el.querySelector('#frAddStatus'); if (sbBusy) return; sbBusy = true; b.disabled = true; add.textContent = '…';
    try { const r = await sbFollowByPseudo(el.querySelector('#frAdd').value.trim()); toast(r.accepted ? 'Vous êtes maintenant amis avec ' + r.pseudo : 'Demande envoyée à ' + r.pseudo); sbBusy = false; render(); return; }
    catch (e) { add.textContent = '❌ ' + (e.message || 'Échec'); b.disabled = false; }
    sbBusy = false;
  };
});

route('friend', async (el, rest) => {
  const id = decodeURIComponent(rest[0] || '');
  const back = `<a class="btn ghost sm" href="#/friends">← Amis</a>`;
  if (!sbSession || !/^[0-9a-f-]{36}$/.test(id)) { el.innerHTML = `${back}<div class="empty">Profil introuvable.</div>`; return; }
  el.innerHTML = `${back}<p class="hint" style="color:var(--muted)">Chargement…</p>`;
  let p;
  try { const rows = await sbApi('profiles?id=eq.' + id + '&select=id,pseudo,avatar,snapshot,updated_at'); p = rows && rows[0]; if (p) await sbAttachSnapshots([p]); }
  catch (e) { el.innerHTML = `${back}<div class="empty"><p>Impossible de charger (${esc(e.message || 'hors-ligne')}).</p></div>`; return; }
  if (!p) { el.innerHTML = `${back}<div class="empty">Ce profil n'est plus visible.</div>`; return; }
  const s = p.snapshot || {};
  const tile = (it, bar) => {
    const po = safePoster(it.p);
    return `<div class="fr-item"><div class="fr-poster">${po ? `<img loading="lazy" src="${IMG(po)}" alt="">` : `<div class="fr-noimg">${esc(it.n)}</div>`}${bar || ''}</div><small>${esc(it.n)}</small></div>`;
  };
  const row = (title, items, barOf) => items && items.length ? `<div class="panel"><h3>${title}</h3><div class="fr-grid">${items.map(it => tile(it, barOf ? barOf(it) : '')).join('')}</div></div>` : '';
  // Même barre que sous nos propres affiches : orange = en cours, bleu sur fond vert = revisionnage.
  const friendBar = (it) => {
    const d = +it.d || 0, t = +it.t || 0;
    if (!t || d <= 0) return '';
    const pct = Math.max(4, Math.min(it.r ? 99 : 100, Math.round(d / t * 100)));
    const prog = it.r ? { pct, cls: 'rw', base: 'green' } : (d >= t ? { pct: 100, cls: 'green' } : { pct: Math.min(99, pct), cls: 'orange' });
    return `<div class="card-progress">${progressBarHtml(prog)}</div>`;
  };
  const st = s.stats || {};
  el.innerHTML = `${back}
    <div class="page-head" style="display:flex;align-items:center;gap:14px">${avatarHtml(p.avatar, p.pseudo, 'lg')}<div><h1 style="margin:0">${esc(p.pseudo)}</h1><span class="sub">Mis à jour ${esc(fmtAgo(p.updated_at))}</span></div></div>
    ${s.stats ? `<div class="stat-grid">
      <div class="stat-card"><div class="k">Épisodes vus</div><div class="v">${esc(st.eps)}</div></div>
      <div class="stat-card"><div class="k">Séries commencées</div><div class="v">${esc(st.shows)}</div></div>
      <div class="stat-card"><div class="k">Films vus</div><div class="v">${esc(st.movies)}</div></div></div>` : '<p class="hint" style="color:var(--muted)">Rien n\'a encore été publié.</p>'}
    ${row('▶️ En cours', s.watching, friendBar)}
    ${s.recent && s.recent.length ? `<div class="panel"><h3>${icon('clock')} Activité récente</h3>${s.recent.map(g => `<div class="feed-line">${esc(activityText(g))} <span class="sub">· ${esc(fmtAgo(g.at))}</span></div>`).join('')}</div>` : ''}
    ${row('❤️ Séries favorites', s.favShows)}
    ${row('🎬 Films favoris', s.favMovies)}
    <p style="margin-top:14px"><button class="btn ghost sm" id="frUnfollow">Retirer ${esc(p.pseudo)} de mes amis</button></p>`;
  el.querySelector('#frUnfollow').onclick = async (ev) => {
    if (!confirm('Retirer ' + p.pseudo + ' de vos amis ?')) return;
    ev.currentTarget.disabled = true;
    try { await sbRemoveFriend(id); location.hash = '#/friends'; }
    catch (e) { toast('Échec : ' + (e.message || '')); ev.currentTarget.disabled = false; }
  };
});

function exportData(fileName) {
  const backup = buildBackup();
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = typeof fileName === 'string' ? fileName : 'tvtime-sauvegarde-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
}
const BACKUP_EVERY_DAYS = 7;
// Sur téléphone, les données vivent dans le navigateur (effacées si on vide les données de Chrome) :
// une fois par semaine, on propose d'enregistrer une sauvegarde dans un fichier (Toujours le même nom).
function maybeWeeklyBackup() {
  if (serverAvailable) return;
  if (!hasUserData()) return;
  if (sbSession) { sbMaybeAutoBackup(); return; } // connecté : sauvegarde en ligne quotidienne, pas de bannière
  if (/^#\/profile/.test(location.hash)) return; // Mon compte : le formulaire de connexion est déjà là
  if (userState.weeklyBackup === false) return;
  if (Date.now() < (userState.backupSnoozeUntil || 0)) return;
  if (daysSince(userState.lastBackupAt) < BACKUP_EVERY_DAYS) return;
  if (document.querySelector('.backup-banner')) return;
  const last = userState.lastBackupAt ? ` Dernier fichier enregistré : ${fmtAgo(userState.lastBackupAt).replace(/\.$/, '')}.` : '';
  const bar = document.createElement('div');
  bar.className = 'backup-banner';
  bar.innerHTML = `<div class="bb-text"><b>🛟 Gardez votre historique en sécurité</b><span>Avec un compte gratuit, une copie privée est enregistrée en ligne chaque jour, sans rien à faire.${esc(last)}</span></div>
    <div class="bb-actions"><button class="btn sm primary" data-bb="acct">Activer la sauvegarde automatique</button><button class="btn sm ghost" data-bb="save">Enregistrer un fichier</button><button class="btn sm ghost" data-bb="later">Plus tard</button></div>`;
  bar.querySelector('[data-bb="acct"]').onclick = () => { userState.backupSnoozeUntil = Date.now() + MS_DAY; scheduleSaveState(); bar.remove(); navTo('#/profile'); };
  bar.querySelector('[data-bb="save"]').onclick = () => { exportData('tvtime-sauvegarde-hebdo.json'); bar.remove(); toast('Sauvegarde enregistrée dans Téléchargements'); };
  bar.querySelector('[data-bb="later"]').onclick = () => { userState.backupSnoozeUntil = Date.now() + MS_DAY; scheduleSaveState(); bar.remove(); };
  document.body.appendChild(bar);
}
const _normName = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
// Export just the LIST of series & movies (no watch history at all), to share
// with a friend. Includes TMDB ids so the receiver can de-duplicate reliably.
function exportSharedList() {
  const showTmdb = userState.showTmdb || {};
  const movTmdb = userState.movieTmdb || {};
  const shows = [];
  for (const s of (DATA.shows || [])) {
    const tmdbId = (s.tvdbId != null ? (tmdbCache.map[s.tvdbId] ?? null) : null) ?? (showTmdb[showKey(s)] ?? null);
    shows.push({ tvdbId: s.tvdbId ?? null, tmdbId: tmdbId ?? null, name: s.name });
  }
  for (const cs of (userState.customShows || [])) shows.push({ tvdbId: cs.tvdbId ?? null, tmdbId: cs.tmdbId ?? null, name: cs.name, poster: cs.poster || null });
  const movies = [];
  const pushMovie = (name, releaseDate, runtime) => {
    const rec = movTmdb[name] || (tmdbCache.movies && tmdbCache.movies[name]);
    movies.push({ name, tmdbId: (rec && rec.id) || null, releaseDate: releaseDate || '', runtime: runtime || 0 });
  };
  for (const m of (DATA.movies || [])) pushMovie(m.name, m.releaseDate, m.runtime);
  for (const cm of (userState.customMovies || [])) pushMovie(cm.name, cm.releaseDate, cm.runtime);
  const payload = { format: 'tvtime-sharedlist', exportedAt: new Date().toISOString(), shows, movies };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'tvtime-liste-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  toast(`Liste exportée : ${shows.length} série(s), ${movies.length} film(s)`);
}
// Merge a shared list into MY OWN additions (customShows / customMovies) so the
// items are treated as added by me (deletable) — WITHOUT overwriting anything I
// already have and WITHOUT marking anything as seen.
async function mergeSharedList(parsed) {
  userState.customShows = userState.customShows || [];
  userState.customMovies = userState.customMovies || [];
  const showTmdb = userState.showTmdb || {};
  const movTmdb = userState.movieTmdb || {};
  const movId = (name) => { const r = movTmdb[name] || (tmdbCache.movies && tmdbCache.movies[name]); return r && r.id != null ? String(r.id) : null; };
  // Everything I already have (catalogue + my own additions).
  const haveTvdb = new Set(), haveTmdb = new Set(), haveShowName = new Set();
  for (const s of (DATA.shows || [])) {
    if (s.tvdbId != null) haveTvdb.add(String(s.tvdbId));
    const tid = (s.tvdbId != null ? tmdbCache.map[s.tvdbId] : null) ?? (showTmdb[showKey(s)] ?? null);
    if (tid != null) haveTmdb.add(String(tid));
    haveShowName.add(_normName(s.name));
  }
  for (const cs of userState.customShows) {
    if (cs.tvdbId != null) haveTvdb.add(String(cs.tvdbId));
    if (cs.tmdbId != null) haveTmdb.add(String(cs.tmdbId));
    haveShowName.add(_normName(cs.name));
  }
  const haveMovieName = new Set(), haveMovieTmdb = new Set();
  for (const m of (DATA.movies || [])) { haveMovieName.add(_normName(m.name)); const id = movId(m.name); if (id) haveMovieTmdb.add(id); }
  for (const cm of userState.customMovies) { haveMovieName.add(_normName(cm.name)); const id = movId(cm.name); if (id) haveMovieTmdb.add(id); }
  let addedShows = 0, addedMovies = 0;
  const now = new Date().toISOString();
  for (const s of (parsed.shows || [])) {
    const nm = _normName(s.name); if (!nm) continue;
    if ((s.tvdbId != null && haveTvdb.has(String(s.tvdbId))) ||
        (s.tmdbId != null && haveTmdb.has(String(s.tmdbId))) ||
        haveShowName.has(nm)) continue;
    const key = s.tmdbId != null ? 'tmdb:' + s.tmdbId : (s.tvdbId != null ? String(s.tvdbId) : 'n:' + s.name);
    userState.customShows.push({ key, tvdbId: s.tvdbId ?? null, tmdbId: s.tmdbId ?? null, name: s.name, poster: s.poster || null, addedAt: now });
    if (s.tvdbId != null) haveTvdb.add(String(s.tvdbId));
    if (s.tmdbId != null) haveTmdb.add(String(s.tmdbId));
    haveShowName.add(nm); addedShows++;
  }
  for (const m of (parsed.movies || [])) {
    const nm = _normName(m.name); if (!nm) continue;
    if ((m.tmdbId != null && haveMovieTmdb.has(String(m.tmdbId))) || haveMovieName.has(nm)) continue;
    userState.customMovies.push({ name: m.name, releaseDate: m.releaseDate || '', runtime: m.runtime || 0, status: 'towatch', custom: true, addedAt: now });
    if (m.tmdbId != null) haveMovieTmdb.add(String(m.tmdbId));
    haveMovieName.add(nm); addedMovies++;
  }
  scheduleSaveState();
  MODEL = null;
  render();
  toast(`Ajouté : ${addedShows} série(s), ${addedMovies} film(s)`);
}
// Replace the in-memory catalogue in place (DATA is a const reference).
// Films added by hand that are in fact a film of the history (same TMDB id, or same
// title in either language): move their info onto the history film and drop the copy.
// Regroupe TOUS les exemplaires d'un même film (historique TV Time, ajouts à la main, listes d'amis…) en un seul :
// même id TMDB, ou même titre (anglais ou français) avec des années compatibles et sans id TMDB contradictoire.
// On garde de préférence l'exemplaire de l'historique TV Time et on lui transfère vu / date / revisionnages /
// réaction / favori / progression / listes / avis des autres. Renvoie le nombre de doublons retirés.
function reconcileDuplicateMovies() {
  const data = DATA.movies || [], cm = userState.customMovies || [];
  const all = data.concat(cm);
  if (all.length < 2) return 0;
  const idOf = (name) => { const r = (userState.movieTmdb && userState.movieTmdb[name]) || (tmdbCache.movies && tmdbCache.movies[name]); return r && r.id != null ? String(r.id) : null; };
  const ids = all.map(m => idOf(m.name));
  const yearOk = (x, y) => { const a = parseInt(movieYear(x), 10), b = parseInt(movieYear(y), 10); return !a || !b || Math.abs(a - b) <= 1; };
  const parent = all.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i, j) => { const ri = find(i), rj = find(j); if (ri !== rj) parent[Math.max(ri, rj)] = Math.min(ri, rj); };
  const byId = new Map(), byName = new Map();
  all.forEach((m, i) => {
    if (ids[i]) { if (byId.has(ids[i])) union(byId.get(ids[i]), i); else byId.set(ids[i], i); }
    const fr = tmdbCache.movies && tmdbCache.movies[m.name] && tmdbCache.movies[m.name].title;
    for (const n of new Set([m.name, fr].filter(Boolean).map(_normName))) {
      if (!n) continue;
      if (!byName.has(n)) { byName.set(n, [i]); continue; }
      for (const j of byName.get(n)) if ((!ids[i] || !ids[j] || ids[i] === ids[j]) && yearOk(all[j], m)) union(j, i);
      byName.get(n).push(i);
    }
  });
  const groups = new Map();
  all.forEach((_, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
  const bag = (k) => (userState[k] = userState[k] || {});
  const drop = new Set();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const ki = g[0], d = all[ki], dn = d.name; // premier = historique TV Time s'il y en a un
    for (const i of g.slice(1)) {
      const c = all[i], cn = c.name;
      if (ids[i] && ids[ki] && ids[i] !== ids[ki]) continue; // deux films différents (remake…)
      // Champs de l'export TV Time : on garde le plus complet sur le film restant.
      if (ki < data.length && i < data.length) {
        if (c.status === 'watched') d.status = 'watched';
        if ((+c.rewatchCount || 0) > (+d.rewatchCount || 0)) d.rewatchCount = c.rewatchCount;
        if (c.watchedAt && (!d.watchedAt || c.watchedAt < d.watchedAt)) d.watchedAt = c.watchedAt;
        if (!d.rating && c.rating) d.rating = c.rating;
        if (c.favorited) d.favorited = true;
      }
      if (ki < data.length) {
        if (!d.runtime && c.runtime) d.runtime = c.runtime;
        if (!movieYear(d) && movieYear(c) && c.releaseDate) d.releaseDate = c.releaseDate;
      }
      if (cn === dn) { drop.add(i); continue; } // même nom : les réglages perso sont déjà partagés
      if (cn !== dn) {
        if (movieStatus(c) === 'watched') {
          bag('movieStatus')[dn] = 'watched';
          const cw = movieWatchedOf(c), dw = movieWatchedOf(d);
          if (cw && (!dw || cw < dw)) bag('movieWatchedAt')[dn] = cw;
        }
        const rw = Math.max(movieRewatchOf(d), movieRewatchOf(c));
        if (rw > movieRewatchOf(d)) bag('movieRewatch')[dn] = rw;
        const rd = userState.movieRewatchDates || {};
        if (rd[cn]) bag('movieRewatchDates')[dn] = [...new Set([...(rd[dn] || []), ...rd[cn]])].sort();
        if (movieRatingOf(c) && !movieRatingOf(d)) bag('movieRatings')[dn] = movieRatingOf(c);
        if (movieEmotionOf(c) && !movieEmotionOf(d)) bag('movieEmotions')[dn] = movieEmotionOf(c);
        if (isFavMovie(c) && !isFavMovie(d)) bag('favMovies')[dn] = true;
        if (movieProgressOf(c) && !movieProgressOf(d)) bag('movieProgress')[dn] = movieProgressOf(c);
        if (!ids[ki] && ids[i]) { bag('movieTmdb')[dn] = (userState.movieTmdb && userState.movieTmdb[cn]) || tmdbCache.movies[cn]; ids[ki] = ids[i]; }
        for (const l of userState.userLists || []) if (l.movies && l.movies.includes(cn)) l.movies = [...new Set(l.movies.map(x => x === cn ? dn : x))];
        const rv = userState.reviews || {};
        if (rv['m:' + cn] && !rv['m:' + dn]) { rv['m:' + dn] = rv['m:' + cn]; }
        if (rv['m:' + cn]) delete rv['m:' + cn];
        for (const k of ['movieStatus', 'movieWatchedAt', 'movieRewatch', 'movieRewatchDates', 'movieRatings', 'movieEmotions', 'favMovies', 'movieProgress', 'movieTmdb']) if (userState[k]) delete userState[k][cn];
      }
      drop.add(i);
    }
  }
  if (!drop.size) return 0;
  const dataDrop = [...drop].filter(i => i < data.length);
  userState.customMovies = cm.filter((_, j) => !drop.has(data.length + j));
  if (dataDrop.length) {
    DATA.movies = data.filter((_, i) => !drop.has(i));
    persistDataOverride(DATA).catch(() => {}); // l'historique corrigé est gardé sur l'appareil
  }
  scheduleSaveState(); MODEL = null;
  return drop.size;
}
function applyDataObject(obj) {
  for (const k of Object.keys(DATA)) delete DATA[k];
  Object.assign(DATA, obj);
  // Defensive : un import corrompu peut transformer des tableaux en objets ;
  // on les recoerce pour que l'app ne plante jamais sur une itération.
  for (const k of ['shows', 'seen', 'movies', 'emotions', 'episodeRatings', 'rewatched', 'lists', 'latest', 'movieRatings']) {
    if (DATA[k] != null && !Array.isArray(DATA[k])) DATA[k] = Object.values(DATA[k]);
  }
}
async function persistDataOverride(obj) {
  await idbSet('dataOverride', obj);
  try { localStorage.setItem(LS_NS + '_dataOverride', JSON.stringify(obj)); } catch {}
}
// ---- Import / restauration sûrs (v133) ----
// Clés de userState propres à CET appareil : jamais écrasées par une restauration (rappels de sauvegarde, état de la copie en ligne).
const RESTORE_DEVICE_KEYS = ['lastCloudBackupAt', 'cloudConflict', 'cloudInfoFailed', 'cloudUncertain', 'lastBackupAt', 'backupSnoozeUntil', 'weeklyBackup'];
// Gardées seulement si la sauvegarde n'en contient pas (clé TMDB, préférences d'affichage, options de partage du profil).
const RESTORE_FILL_KEYS = ['tmdbKey', 'prefs', 'share'];
// Seuls éléments importés quand l'historique de l'appareil est plus complet que celui du fichier.
const RESTORE_SETTINGS_KEYS = ['tmdbKey', 'prefs', 'share', 'homeOrder', 'profileName', 'amoled'];
const _isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const _nkeys = (o) => (o && typeof o === 'object') ? Object.keys(o).length : 0;
const _fmtWhen = (iso) => { const t = Date.parse(iso); return isNaN(t) ? 'date inconnue' : new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };

// Reconnaît le contenu d'un fichier : 'shared' (liste d'un ami), 'full' (sauvegarde complète), 'legacy' (ancien format = seulement userState) ou null.
function backupKind(p) {
  if (!_isObj(p)) return null;
  if (p.format === 'tvtime-sharedlist') return (Array.isArray(p.shows) || Array.isArray(p.movies)) ? 'shared' : null;
  const d = p.data;
  const arr = (x) => x == null || Array.isArray(x), objn = (x) => x == null || _isObj(x);
  const us = p.userState;
  if (_isObj(d) && (Array.isArray(d.shows) || Array.isArray(d.seen) || Array.isArray(d.movies)) && arr(d.shows) && arr(d.seen) && arr(d.movies)
    && (us == null || (_isObj(us) && arr(us.customMovies) && arr(us.customShows) && arr(us.userLists) && objn(us.seenAdd) && objn(us.seenRemove) && objn(us.movieStatus)))) return 'full';
  if (p.format != null && p.format !== 'tvtime-full') return null;
  if (p.data != null) return null;
  const maps = ['seenAdd', 'seenRemove', 'ratings', 'emotions', 'movieStatus', 'movieRatings', 'rewatch', 'favShows', 'favMovies', 'showTmdb', 'movieTmdb'];
  const lists = ['customMovies', 'customShows', 'userLists'];
  const ok = maps.some((k) => _isObj(p[k])) || lists.some((k) => Array.isArray(p[k]));
  const bad = maps.some((k) => p[k] != null && !_isObj(p[k])) || lists.some((k) => p[k] != null && !Array.isArray(p[k]));
  return ok && !bad ? 'legacy' : null;
}
// Date de la dernière modification connue sur cet appareil (épisodes cochés, films vus, revisionnages, avis, sauvegardes).
function deviceLastChange() {
  let best = 0;
  const take = (s) => { if (!s) return; const t = Date.parse(/^\d{4}-\d\d-\d\d \d/.test(String(s)) ? String(s).replace(' ', 'T') + 'Z' : String(s)); if (t > best) best = t; };
  for (const v of Object.values(userState.seenAdd || {})) take(v && v.at);
  for (const v of Object.values(userState.movieWatchedAt || {})) take(v);
  for (const v of Object.values(userState.rewatchActivity || {})) take(v);
  for (const v of Object.values(userState.reviews || {})) take(v && v.at);
  take(userState.lastBackupAt); take(userState.lastCloudBackupAt);
  return best || null;
}
// Chiffres et avertissements affichés avant une restauration.
function restoreInfo(p, kind) {
  const info = { kind, at: p.exportedAt || p.at || null, warns: [], poorer: false };
  if (kind === 'legacy') {
    const mv = (us) => Object.values((us && us.movieStatus) || {}).filter((v) => v === 'watched').length;
    info.bc = { eps: _nkeys(p.seenAdd), movies: mv(p) };
    info.dc = { eps: _nkeys(userState.seenAdd), movies: mv(userState) };
    return info;
  }
  info.bc = backupCounts(p);
  info.dc = deviceCounts();
  const cat = p.data;
  info.poorer = (cat.seen || []).length < (DATA.seen || []).length / 2 || (cat.movies || []).length < (DATA.movies || []).length / 2;
  const last = deviceLastChange(), t = Date.parse(info.at);
  if (isNaN(t)) info.warns.push('La date de cette sauvegarde est inconnue.');
  else if (last && t < last - 600000) info.warns.push(`Cette sauvegarde est plus ancienne que votre dernière modification sur cet appareil (${_fmtWhen(new Date(last).toISOString())}) : ce que vous avez fait depuis sera remplacé.`);
  const le = info.dc.eps - info.bc.eps, lm = info.dc.movies - info.bc.movies;
  if (le > 0 || lm > 0) info.warns.push('Elle contient moins de choses que cet appareil (' + [le > 0 ? `${le} épisode${le > 1 ? 's' : ''} de moins` : '', lm > 0 ? `${lm} film${lm > 1 ? 's' : ''} de moins` : ''].filter(Boolean).join(' et ') + ').');
  return info;
}
// Fenêtre de confirmation générique : renvoie true si on valide, false si on annule (bouton ou fond).
function askModal(bodyHtml, noLabel, yesLabel) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (done) return; done = true; closeModal(); resolve(v); };
    showModal(`${bodyHtml}<div class="rs-actions"><button class="btn ghost" id="rsNo">${esc(noLabel)}</button><button class="btn primary" id="rsYes">${esc(yesLabel)}</button></div>`, (root) => {
      const bd = root.querySelector('.backdrop');
      bd.addEventListener('click', (e) => { if (e.target === bd) fin(false); });
      root.querySelector('#rsNo').onclick = () => fin(false);
      root.querySelector('#rsYes').onclick = () => fin(true);
    });
  });
}
function showNotice(title, text) {
  showModal(`<h2>${esc(title)}</h2><p>${text}</p><div class="rs-actions"><button class="btn primary" data-close>OK</button></div>`);
}
function askRestore(info, label) {
  const rows = info.kind === 'legacy'
    ? [['Épisodes cochés', info.bc.eps, info.dc.eps], ['Films vus', info.bc.movies, info.dc.movies]]
    : [['Épisodes vus', info.bc.eps, info.dc.eps], ['Films vus', info.bc.movies, info.dc.movies]];
  const warns = info.warns.filter((w) => !(info.poorer && /^Elle contient moins/.test(w))).map((w) => `<div class="rs-warn">⚠️ ${esc(w)}</div>`); // « poorer » : le message ℹ️ suffit (l'historique de l'appareil est conservé)
  if (info.poorer) warns.unshift(`<div class="rs-warn rs-info">ℹ️ L'historique de cette sauvegarde est beaucoup plus petit que celui de cet appareil : <b>votre historique, plus complet, sera conservé ; seuls les réglages seront importés.</b></div>`);
  if (info.kind === 'legacy') warns.unshift(`<div class="rs-warn rs-info">ℹ️ Ancien format de sauvegarde (sans l'historique TV Time) : seuls les éléments qu'il contient (épisodes cochés, notes, listes…) remplaceront les vôtres.</div>`);
  const what = info.poorer ? 'Importer ces réglages ?' : 'Restaurer ' + label + ' ?';
  return askModal(`
    <h2>${esc(what)}</h2>
    <p style="margin:0 0 10px">${info.at && !isNaN(Date.parse(info.at)) ? `Sauvegarde du <b>${esc(_fmtWhen(info.at))}</b> (${esc(fmtAgo(info.at))}).` : 'Date de la sauvegarde : <b>inconnue</b>.'}</p>
    <div class="rs-table">
      <div class="rs-row rs-head"><span></span><span>Sauvegarde</span><span>Cet appareil</span></div>
      ${rows.map((r) => `<div class="rs-row"><span>${r[0]}</span><b>${r[1]}</b><b>${r[2]}</b></div>`).join('')}
    </div>
    ${warns.join('')}
    <p style="margin:10px 0 0">Une copie de votre état actuel est faite juste avant : vous pourrez revenir en arrière dans Réglages (« Revenir à l’état du… »).</p>`, 'Annuler', 'Restaurer');
}
// Remet userState dans l'état de la sauvegarde (clés absentes = valeurs d'origine), en gardant les réglages propres à l'appareil.
function replaceUserState(newUs) {
  const keep = {}; for (const k of RESTORE_DEVICE_KEYS) if (k in userState) keep[k] = userState[k];
  const fill = {}; for (const k of RESTORE_FILL_KEYS) fill[k] = userState[k];
  const seenCl = userState.seenChangelog || 0;
  for (const k of Object.keys(userState)) delete userState[k];
  Object.assign(userState, JSON.parse(JSON.stringify(USERSTATE_DEFAULTS)), newUs);
  for (const k of RESTORE_DEVICE_KEYS) { if (k in keep) userState[k] = keep[k]; else delete userState[k]; }
  for (const k of RESTORE_FILL_KEYS) { const v = userState[k]; if ((v == null || v === '') && fill[k]) userState[k] = fill[k]; }
  userState.seenChangelog = Math.max(seenCl, userState.seenChangelog || 0);
}
function importData(ev) {
  const inp = ev.target, f = inp.files[0]; if (!f) return;
  const r = new FileReader();
  r.onerror = () => { inp.value = ''; showNotice('Fichier illisible', 'Ce fichier n’a pas pu être lu. Rien n’a été modifié.'); };
  r.onload = async () => {
    let parsed;
    try { parsed = JSON.parse(r.result); }
    catch { inp.value = ''; showNotice('Fichier illisible', 'Ce fichier est abîmé ou n’est pas un fichier de sauvegarde. Rien n’a été modifié.'); return; }
    try { await applyBackup(parsed, { label: 'ce fichier' }); }
    catch (e) { console.error(e); showNotice('Erreur', 'La sauvegarde n’a pas pu être appliquée. Rien n’a été modifié.'); }
    inp.value = '';
  };
  r.readAsText(f);
}
// Applique le contenu d'un fichier de sauvegarde (importé ou téléchargé depuis Supabase) après confirmation chiffrée
// et copie de secours. Renvoie true si quelque chose a été appliqué.
async function applyBackup(parsed, opts = {}) {
  const kind = backupKind(parsed);
  if (!kind) { showNotice('Ce n’est pas une sauvegarde Mon TV Time', 'Le fichier a été lu, mais son contenu n’est pas celui d’une sauvegarde de l’application. Rien n’a été modifié.'); return false; }
  if (kind === 'shared') {
    // Liste partagée par un ami : on fusionne sans rien écraser ni marquer vu (le résumé s'affiche à la fin).
    await mergeSharedList(parsed);
    return true;
  }
  const info = restoreInfo(parsed, kind);
  if (!(await askRestore(info, opts.label || 'cette sauvegarde'))) return false;
  if (sbBusy) { showNotice('Opération en ligne en cours', 'Une opération avec votre compte en ligne est en cours. Réessayez dans un instant. Rien n’a été modifié.'); return false; }
  sbBusy = true; // pas d'envoi automatique en ligne au milieu de la restauration
  let pre = null;
  try {
    // État d'avant en mémoire : sert à tout remettre tout de suite si la restauration échoue en route.
    pre = { userState: JSON.parse(JSON.stringify(userState)), data: Object.assign({}, DATA) };
    // Copie de secours dans IndexedDB (annulable depuis Réglages). Une copie de moins de 24 h n'est jamais écrasée
    // (sauf une copie « retour » issue d'une annulation) : une 2e restauration ne doit pas faire perdre l'état d'origine.
    const old = await idbGet('avantRestauration');
    const keepOld = old && old.userState && old.kind !== 'redo' && Date.now() - Date.parse(old.at) < 86400000;
    if (!keepOld) {
      const saved = await idbSet('avantRestauration', { at: new Date().toISOString(), userState: pre.userState, data: DATA });
      if (!saved) { showNotice('Restauration annulée', 'La copie de secours n’a pas pu être faite sur cet appareil (stockage indisponible ou plein). Par prudence, rien n’a été modifié.'); return false; }
    }
    let merged = 0;
    if (kind === 'full') {
      const cat = parsed.data;
      if (!info.poorer) {
        applyDataObject(cat); await persistDataOverride(cat);
        if (parsed.userState) { replaceUserState(parsed.userState); cleanRestoredReviews(); }
      } else if (parsed.userState) {
        // Historique de l'appareil plus complet : on garde le catalogue et les épisodes, on n'importe que les réglages.
        for (const k of RESTORE_SETTINGS_KEYS) { const v = parsed.userState[k]; if (v != null && v !== '') userState[k] = v; }
      }
      merged = reconcileDuplicateMovies();
    } else {
      for (const k of Object.keys(parsed)) if (!RESTORE_DEVICE_KEYS.includes(k) && legacyValueOk(k, parsed[k])) userState[k] = parsed[k];
      cleanRestoredReviews();
    }
    repairSeenAddDup();
    afterStateSwap();
    toast((info.poorer ? 'Réglages importés — votre historique, plus complet, a été conservé' : kind === 'legacy' ? 'Données importées' : 'Sauvegarde complète restaurée') + (merged ? ` · ${merged} film(s) en double fusionné(s)` : ''));
    render();
    return true;
  } catch (e) {
    console.error(e);
    let back = false;
    try { if (pre) { await putState(pre); afterStateSwap(); back = true; } } catch (e2) { console.error(e2); }
    showNotice('Erreur pendant la restauration', back
      ? 'La restauration n’a pas pu aboutir. Rien n’a été perdu : votre état d’avant a été remis tel quel.'
      : 'La restauration n’a pas pu aboutir. Rien n’a été perdu : une copie de votre état d’avant est gardée, utilisez « Revenir à l’état du… » dans Réglages.');
    render();
    return false;
  } finally { sbBusy = false; }
}
// Remet un état {userState, data} en place (catalogue + userState, en place).
async function putState(s) {
  if (s.data) { applyDataObject(s.data); await persistDataOverride(s.data); }
  for (const k of Object.keys(userState)) delete userState[k];
  Object.assign(userState, s.userState);
}
// Après un changement complet d'état : corrections d'affiches et thème appliqués sans recharger.
function afterStateSwap() {
  MODEL = null;
  applyTmdbOverrides(); applyTheme();
  scheduleSaveState();
}
// Avis restaurés : rien ne repart en ligne tout seul (ni ancien avis renvoyé, ni suppression d'un avis récent).
function cleanRestoredReviews() {
  for (const k of Object.keys(userState.reviews || {})) if (userState.reviews[k] && typeof userState.reviews[k] === 'object') userState.reviews[k].pending = false;
  userState.reviewDeletes = [];
}
// Ancien format : une clé n'est acceptée que si son type correspond à celui de userState.
const LEGACY_EXTRA_TYPES = { reviews: 'object', reviewDeletes: 'array', prefs: 'object', share: 'object' };
function legacyValueOk(k, v) {
  const kindOf = (x) => Array.isArray(x) ? 'array' : x === null ? 'null' : typeof x;
  if (k in USERSTATE_DEFAULTS) {
    const d = USERSTATE_DEFAULTS[k];
    if (d === null) return v === null || Array.isArray(v);
    return kindOf(v) === kindOf(d);
  }
  return k in LEGACY_EXTRA_TYPES && kindOf(v) === LEGACY_EXTRA_TYPES[k];
}
// « Revenir à l'état d'avant » : échange l'état actuel avec la copie de secours (l'état actuel devient la nouvelle copie : on peut re-basculer).
async function undoLastRestore() {
  const s = await idbGet('avantRestauration');
  if (!s || !s.userState) { toast('Aucune copie de secours'); return false; }
  const cur = deviceCounts(), tgt = backupCounts({ data: s.data, userState: s.userState });
  const ok = await askModal(`<h2>Revenir à l'état du ${esc(_fmtWhen(s.at))} ?</h2>
    <div class="rs-table">
      <div class="rs-row rs-head"><span></span><span>État actuel</span><span>Après le retour</span></div>
      <div class="rs-row"><span>Épisodes vus</span><b>${cur.eps}</b><b>${tgt.eps}</b></div>
      <div class="rs-row"><span>Films vus</span><b>${cur.movies}</b><b>${tgt.movies}</b></div>
    </div>
    <p style="margin:10px 0 0">L'état actuel est gardé : vous pourrez y revenir avec le même bouton.</p>`, 'Annuler', 'Revenir en arrière');
  if (!ok) return false;
  if (sbBusy) { showNotice('Opération en ligne en cours', 'Réessayez dans un instant. Rien n’a été modifié.'); return false; }
  sbBusy = true;
  try {
    const kept = await idbSet('avantRestauration', { at: new Date().toISOString(), kind: 'redo', userState: JSON.parse(JSON.stringify(userState)), data: DATA });
    if (!kept) { showNotice('Retour annulé', 'L’état actuel n’a pas pu être mis de côté. Par prudence, rien n’a été modifié.'); return false; }
    await putState(s);
    afterStateSwap();
    toast('État d’avant rétabli');
    render();
    return true;
  } catch (e) {
    console.error(e);
    showNotice('Erreur', 'Le retour n’a pas pu aboutir. Les copies sont toujours là : vous pouvez réessayer.');
    return false;
  } finally { sbBusy = false; }
}


//////////////////////// « Conseillé par » et recommandations entre amis ////////////////////////
// Local : userState.recommendedBy[clé] = { name, at, fromId? } (clé = clé de série ou nom de film).
// En ligne : table « recommendations » (supabase/supabase-recommandations.sql). Tant qu'elle n'existe pas (PGRST205),
// l'envoi et la section « Recommandé pour vous » restent cachés, sans erreur.
let _recoTable = null;        // null = inconnu, true = présente, false = absente
let _sbFriendsCache = [];     // amis mutuels vus au dernier chargement : [{ id, pseudo }]
const recoSendUsable = () => !!sbSession && _recoTable !== false;
async function recoApi(path, opts) {
  try { const r = await sbApi(path, opts); _recoTable = true; return r; }
  catch (e) { if (sbMissingTable(e)) _recoTable = false; throw e; }
}
const recoWork = (kind, id) => (kind === 'tv' ? 'tv:' : 'mv:') + id;
function recommendedByOf(key) { const r = userState.recommendedBy && userState.recommendedBy[key]; return r && r.name ? r : null; }
function setRecommendedBy(key, name, fromId) {
  name = String(name || '').trim().slice(0, 40);
  if (!userState.recommendedBy) userState.recommendedBy = {};
  if (!name) delete userState.recommendedBy[key];
  else { const r = { name, at: new Date().toISOString() }; if (fromId) r.fromId = fromId; userState.recommendedBy[key] = r; }
  scheduleSaveState();
}
// Ligne « Conseillé par … » de la fiche (touche = modifier).
function recoByHtml(key) {
  const r = recommendedByOf(key);
  return `<button type="button" class="reco-by${r ? ' set' : ''}" id="recoBy">${r ? `${icon('mail')} Conseillé par <b>${esc(r.name)}</b>` : `${icon('mail')} Conseillé par…`}</button>`;
}
function wireRecoBy(el, key) {
  const b = el.querySelector('#recoBy'); if (b) b.onclick = () => openRecoBy(key);
}
function openRecoBy(key) {
  const cur = recommendedByOf(key);
  showModal(`<h2>${icon('mail')} Conseillé par</h2>
    <p class="hint" style="color:var(--muted)">Qui vous a donné envie de voir ça ? (facultatif)</p>
    <input class="input" id="recoName" list="recoNames" maxlength="40" placeholder="Un prénom ou un pseudo" autocomplete="off" value="${esc(cur ? cur.name : '')}">
    <datalist id="recoNames">${_sbFriendsCache.map(f => `<option value="${esc(f.pseudo)}"></option>`).join('')}</datalist>
    <div class="row"><button class="btn ghost" data-close>Annuler</button>${cur ? '<button class="btn ghost" id="recoClear">Effacer</button>' : ''}<button class="btn primary" id="recoSave">Enregistrer</button></div>`,
    (root) => {
      const input = root.querySelector('#recoName');
      if (sbSession && !_sbFriendsCache.length) sbLoadFriends().then(() => { const dl = root.querySelector('#recoNames'); if (dl) dl.innerHTML = _sbFriendsCache.map(f => `<option value="${esc(f.pseudo)}"></option>`).join(''); }).catch(() => {});
      const done = (name) => {
        const f = _sbFriendsCache.find(x => x.pseudo.toLowerCase() === String(name).trim().toLowerCase());
        setRecommendedBy(key, name, f && f.id); closeModal(); render();
      };
      root.querySelector('#recoSave').onclick = () => done(input.value);
      const c = root.querySelector('#recoClear'); if (c) c.onclick = () => done('');
      input.onkeydown = (e) => { if (e.key === 'Enter') done(input.value); };
    });
}
// Élément de la feuille d'actions d'une fiche : « Recommander à un ami » (aucun si hors ligne / table absente / pas d'id TMDB).
function recoActionItems(kind, tmdbId, title, poster) {
  if (!recoSendUsable() || !tmdbId) return [];
  return [{ icon: '💌', label: 'Recommander à un ami', sub: 'Il le verra dans l’onglet Amis', run: () => openRecoSend(kind, tmdbId, title, poster) }];
}
async function openRecoSend(kind, tmdbId, title, poster) {
  if (!sbSession) { toast('Connectez-vous pour recommander à un ami'); return; }
  let friends;
  try { friends = (await sbLoadFriends()).friends; } catch (e) { toast('Impossible de charger vos amis'); return; }
  if (!friends.length) { toast('Pas encore d’ami : ajoutez-en depuis l’onglet Amis'); return; }
  showModal(`<h2>${icon('mail')} Recommander à un ami</h2><p><b>${esc(title)}</b></p>
    <div class="reco-friends">${friends.map(f => `<label class="reco-friend"><input type="radio" name="recoTo" value="${esc(f.id)}"> ${avatarHtml(f.avatar, f.pseudo)} <span>${esc(f.pseudo)}</span></label>`).join('')}</div>
    <textarea class="input" id="recoMsg" maxlength="280" rows="3" placeholder="Un petit mot (facultatif, 280 caractères)"></textarea>
    <div class="row"><button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="recoGo">Envoyer</button></div>`,
    (root) => {
      root.querySelector('#recoGo').onclick = async (ev) => {
        const to = (root.querySelector('input[name="recoTo"]:checked') || {}).value;
        if (!to) { toast('Choisissez un ami'); return; }
        const b = ev.currentTarget; b.disabled = true;
        const row = { from_id: sbSession.uid, to_id: to, work: recoWork(kind, tmdbId), title: String(title).slice(0, 200), poster: poster || null, message: root.querySelector('#recoMsg').value.trim().slice(0, 280) || null };
        try {
          await recoApi('recommendations', { method: 'POST', json: row, headers: { Prefer: 'return=minimal' } });
          closeModal(); const f = friends.find(x => x.id === to); toast('Recommandation envoyée à ' + (f ? f.pseudo : 'votre ami'));
        } catch (e) {
          b.disabled = false;
          if (_recoTable === false) { closeModal(); toast('Les recommandations ne sont pas encore disponibles'); }
          else toast(/déjà/.test(e.message || '') ? 'Déjà recommandé à cet ami' : 'Échec : ' + (e.message || ''));
        }
      };
    });
}
// Reçues : les plus récentes ; table absente -> [] (et _recoTable = false).
async function sbLoadRecos() {
  if (!sbSession || _recoTable === false) return [];
  try { return (await recoApi('recommendations?to_id=eq.' + sbSession.uid + '&select=id,from_id,work,title,poster,message,created_at,seen&order=created_at.desc&limit=50')) || []; }
  catch (e) { if (_recoTable === false) return []; throw e; }
}
function recoSectionHtml(recs, friends) {
  if (!recs.length) return '';
  const name = (id) => { const f = friends.find(x => x.id === id); return f ? f.pseudo : 'un ami'; };
  const sorted = recs.slice().sort((a, b) => (a.seen === b.seen ? 0 : a.seen ? 1 : -1) || String(b.created_at).localeCompare(String(a.created_at)));
  return `<div class="panel reco-panel"><h3>${icon('mail')} Recommandé pour vous <span style="color:var(--muted);font-weight:400">· ${recs.length}</span></h3>
    ${sorted.map(r => {
      const po = safePoster(r.poster);
      return `<div class="reco-row" data-id="${esc(r.id)}">
        <div class="reco-poster">${po ? `<img loading="lazy" src="${IMG(po)}" alt="">` : '<div class="fr-noimg">💌</div>'}</div>
        <div class="reco-info"><b>${esc(r.title)}</b>${r.seen ? '' : ' <span class="reco-new">Nouveau</span>'}
          <small>par ${esc(name(r.from_id))}${r.work.startsWith('tv:') ? ' · série' : ' · film'}</small>
          ${r.message ? `<div class="reco-msg">« ${esc(r.message)} »</div>` : ''}
          <div class="reco-btns"><button class="btn sm primary" data-ra="add">+ Ajouter</button><button class="btn sm" data-ra="see">Voir</button><button class="btn sm ghost" data-ra="ignore">Ignorer</button></div></div>
      </div>`;
    }).join('')}</div>`;
}
function wireRecoSection(el, recs, friends) {
  const delRow = (id) => recoApi('recommendations?id=eq.' + id, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  el.querySelectorAll('.reco-row').forEach(row => {
    const r = recs.find(x => String(x.id) === row.dataset.id); if (!r) return;
    const kind = r.work.startsWith('tv:') ? 'tv' : 'movie', id = +r.work.split(':')[1];
    const f = friends.find(x => x.id === r.from_id);
    row.querySelector('[data-ra="see"]').onclick = () => { location.hash = '#/preview/' + kind + '/' + id; };
    row.querySelector('[data-ra="ignore"]').onclick = async (ev) => {
      ev.currentTarget.disabled = true;
      try { await delRow(r.id); render(); } catch (e) { toast('Échec : ' + (e.message || '')); ev.currentTarget.disabled = false; }
    };
    row.querySelector('[data-ra="add"]').onclick = async (ev) => {
      ev.currentTarget.disabled = true;
      const hit = kind === 'tv' ? { id, name: r.title, poster_path: r.poster || null, media_type: 'tv' } : { id, title: r.title, poster_path: r.poster || null, media_type: 'movie' };
      const key = kind === 'tv' ? addCustomShow(hit) : addCustomMovie(hit);
      if (key && !recommendedByOf(key)) setRecommendedBy(key, f ? f.pseudo : 'un ami', r.from_id); // ne remplace pas un « Conseillé par » déjà rempli
      try { await delRow(r.id); } catch {}
      render();
    };
  });
  // Affichées = vues : la pastille de l'onglet Amis disparaît.
  if (recs.some(r => !r.seen)) {
    recoApi('recommendations?to_id=eq.' + sbSession.uid + '&seen=eq.false', { method: 'PATCH', json: { seen: true }, headers: { Prefer: 'return=minimal' } })
      .then(() => sbSetRecoBadge(0)).catch(() => {});
  }
}
