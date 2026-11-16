/* Mon TV Time — Sauvegarde en ligne (Supabase) */
'use strict';
//////////////////////// Sauvegarde en ligne (Supabase) ////////////////////////
// Connexion par lien reçu par e-mail (ou lien collé dans l'app), puis un fichier privé
// par utilisateur (backups/<id>/backup.json) écrasé à chaque sauvegarde. La clé « publishable » est
// publique par conception : c'est la sécurité côté Supabase (RLS) qui protège les fichiers.
const SB_URL = 'https://loezmygglibdubyyoxpy.supabase.co';
const SB_KEY = 'sb_publishable_Idw7zdQ4VXLJ1Rdql3SClw_lYYXAjnR';
const SB_SESSION_KEY = LABO ? 'tvtime-labo-sb-session' : 'tvtime-sb-session'; // labo : jamais connecté au vrai compte
let sbSession = null; // { at, rt, exp, uid, email } — gardé hors de userState pour ne pas finir dans les sauvegardes
try { sbSession = JSON.parse(localStorage.getItem(SB_SESSION_KEY) || 'null'); } catch {}
let sbPendingEmail = null; // e-mail en attente de saisie du code
let sbBusy = false;
let sbRestoring = false; // une restauration en ligne est en cours (téléchargement + fenêtre + application) : aucun envoi automatique
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
let sbProfile = null; // mon profil (communauté) : { pseudo, is_public, avatar, updated_at } — null = pas encore créé
function sbStoreSession(s) {
  if (LABO && s) { toast('🧪 Version de test : la connexion au compte est désactivée.'); return; }
  sbSession = s;
  if (s) document.querySelectorAll('.backup-banner').forEach(n => n.remove()); // connecté : plus de rappel de sauvegarde
  if (!s) {
    sbProfile = null; try { localStorage.removeItem('tvtime-acct'); } catch {}
    // déconnecté : l'état de la sauvegarde en ligne ne concerne plus ce compte
    if (typeof userState === 'object' && userState && (userState.cloudConflict || userState.lastCloudBackupAt || userState.cloudInfoFailed || userState.cloudUncertain)) {
      delete userState.cloudConflict; delete userState.lastCloudBackupAt; delete userState.cloudInfoFailed; delete userState.cloudUncertain; scheduleSaveState();
    }
  }
  try { s ? localStorage.setItem(SB_SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SB_SESSION_KEY); } catch {}
}
function sbSessionFrom(j) {
  return { at: j.access_token, rt: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000, uid: j.user && j.user.id, email: j.user && j.user.email };
}
async function sbRequest(path, { method = 'GET', json, body, token, headers = {}, cache } = {}) {
  const h = Object.assign({ apikey: SB_KEY }, headers);
  if (token) h.Authorization = 'Bearer ' + token;
  if (json !== undefined) { h['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  return fetch(SB_URL + path, cache ? { method, headers: h, body, cache } : { method, headers: h, body });
}
async function sbError(res) {
  let msg = '';
  try { const j = await res.json(); msg = j.msg || j.message || j.error_description || j.error || ''; } catch {}
  return new Error(msg || ('Erreur ' + res.status));
}
// Connexion par e-mail + mot de passe : aucun e-mail envoyé (exige « Confirm email » désactivé dans Supabase
// pour la création de compte). Le lien par e-mail reste disponible en secours.
async function sbSignInPassword(email, password) {
  const res = await sbRequest('/auth/v1/token?grant_type=password', { method: 'POST', json: { email, password } });
  if (res.status === 400 || res.status === 401) {
    const err = await sbError(res);
    if (/confirm/i.test(err.message)) throw new Error('Compte pas encore confirmé : dans Supabase, désactivez « Confirm email », ou connectez-vous par lien');
    throw new Error('E-mail ou mot de passe incorrect. Vous ne vous en souvenez plus, ou votre compte a été créé avec un lien ? Touchez « Mot de passe oublié ? ».');
  }
  if (!res.ok) throw await sbError(res);
  sbStoreSession(sbSessionFrom(await res.json()));
}
async function sbSignUp(email, password) {
  const res = await sbRequest('/auth/v1/signup', { method: 'POST', json: { email, password } });
  if (res.status === 422 || res.status === 400) {
    const err = await sbError(res);
    if (/already|registered|exists/i.test(err.message)) throw new Error('Un compte existe déjà avec cet e-mail : utilisez « Se connecter »');
    if (/password/i.test(err.message)) throw new Error('Mot de passe trop faible : 6 caractères minimum');
    throw err;
  }
  if (res.status === 429) throw new Error('Trop de demandes pour l\'instant : réessayez dans une heure');
  if (!res.ok) throw await sbError(res);
  const j = await res.json();
  if (!j.access_token) throw new Error('Compte créé, mais Supabase demande une confirmation par e-mail : désactivez « Confirm email » dans Supabase (Authentication → Sign In / Providers → Email), puis connectez-vous');
  sbStoreSession(sbSessionFrom(j));
}
async function sbSetPassword(password) {
  const token = await sbToken();
  if (!token) throw new Error('Non connecté');
  const res = await sbRequest('/auth/v1/user', { method: 'PUT', token, json: { password } });
  if (!res.ok) {
    const err = await sbError(res);
    if (/different|same/i.test(err.message)) throw new Error('C\'est déjà votre mot de passe');
    if (/reauth|nonce/i.test(err.message)) throw new Error('Supabase exige une confirmation par e-mail pour changer le mot de passe (option « Secure password change » à désactiver)');
    throw err;
  }
}
// Envoie l'e-mail contenant le lien de connexion (revient sur cette même page de l'app).
async function sbSendLink(email) {
  const back = encodeURIComponent(location.origin + location.pathname);
  const res = await sbRequest('/auth/v1/otp?redirect_to=' + back, { method: 'POST', json: { email, create_user: true } });
  if (res.status === 429) throw new Error('Trop d\'e-mails envoyés pour l\'instant (limite du service gratuit, environ 2 par heure pour tout le monde). Réessayez dans une heure, une seule fois.');
  if (!res.ok) throw await sbError(res);
  sbPendingEmail = email;
}
// Session à partir d'un retour de lien : …#access_token=…&refresh_token=…&expires_in=…
function sbSessionFromHash(params) {
  const at = params.get('access_token'); if (!at) return null;
  let claims = {};
  try { claims = JSON.parse(atob(at.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch {}
  return { at, rt: params.get('refresh_token'), exp: Date.now() + (parseInt(params.get('expires_in'), 10) || 3600) * 1000, uid: claims.sub, email: claims.email };
}
// Lien collé à la main (iPhone : l'app installée n'a pas le même stockage que Safari). Accepte le lien
// de l'e-mail tel quel (…/auth/v1/verify?token=…) ou l'adresse où il redirige (…#access_token=…).
// Accepte aussi le « code de transfert » (TVT1:…) copié depuis Safari, et les liens enveloppés par
// Gmail / Outlook (https://www.google.com/url?q=… encodé).
async function sbSignInWithLink(text) {
  const raw = (text || '').trim();
  const code = raw.match(/TVT1:([A-Za-z0-9_-]+)/);
  if (code) {
    const res = await sbRequest('/auth/v1/token?grant_type=refresh_token', { method: 'POST', json: { refresh_token: code[1] } });
    if (!res.ok) throw new Error('Code expiré ou déjà utilisé : redemandez un lien');
    sbStoreSession(sbSessionFrom(await res.json()));
    return;
  }
  let t = raw;
  for (let i = 0; i < 3; i++) { try { const d = decodeURIComponent(t); if (d === t) break; t = d; } catch { break; } }
  const m = t.match(/https?:\/\/[^\s"'<>\/]+\/auth\/v1\/verify\?[^\s"'<>]+/) || t.match(/https?:\/\/[^\s"'<>]*#[^\s"'<>]*access_token=[^\s"'<>]+/) || t.match(/https?:\/\/[^\s"'<>]+/);
  if (!m) throw new Error('Collez le lien complet de l\'e-mail, ou le code copié depuis Safari');
  let u; try { u = new URL(m[0].replace(/[)>\]"']+$/, '')); } catch { throw new Error('Lien non reconnu'); }
  const hs = new URLSearchParams(u.hash.replace(/^#/, ''));
  if (hs.get('access_token')) {
    const s = sbSessionFromHash(hs); if (!s || !s.uid) throw new Error('Lien non reconnu');
    sbStoreSession(s);
    if (hs.get('type') === 'recovery') setTimeout(sbAskNewPassword, 300);
    return;
  }
  const tokenHash = u.searchParams.get('token_hash') || u.searchParams.get('token');
  if (!tokenHash) throw new Error('Lien non reconnu');
  const type = u.searchParams.get('type') || 'magiclink';
  const res = await sbRequest('/auth/v1/verify', { method: 'POST', json: { type, token_hash: tokenHash } });
  if (!res.ok) throw new Error('Ce lien a déjà servi ou a expiré (un lien ne marche qu\'une fois) : redemandez un lien et ne le touchez pas, faites un appui long → Copier');
  sbStoreSession(sbSessionFrom(await res.json()));
  if (type === 'recovery') setTimeout(sbAskNewPassword, 300);
}
// « Mot de passe oublié » : Supabase envoie un e-mail avec un lien (type=recovery) qui revient dans l'app
// connecté ; l'app demande alors le nouveau mot de passe (sbAskNewPassword).
async function sbSendRecovery(email) {
  const back = encodeURIComponent(location.origin + location.pathname);
  const res = await sbRequest('/auth/v1/recover?redirect_to=' + back, { method: 'POST', json: { email } });
  if (res.status === 429) throw new Error('Trop d\'e-mails envoyés pour l\'instant (limite du service gratuit, environ 2 par heure pour tout le monde). Réessayez dans une heure, une seule fois.');
  if (!res.ok) throw await sbError(res);
}
function sbAskNewPassword() {
  if (!sbSession) return;
  showModal(`
    <h2 style="margin:0 0 6px">🔑 Nouveau mot de passe</h2>
    <p class="hint" style="color:var(--muted)">Choisissez votre nouveau mot de passe (6 caractères minimum).</p>
    <input class="input" id="npw1" type="password" autocomplete="new-password" placeholder="Nouveau mot de passe" style="width:100%">
    <input class="input" id="npw2" type="password" autocomplete="new-password" placeholder="Confirmez le mot de passe" style="width:100%;margin-top:8px">
    <p class="hint" id="npwMsg" style="color:var(--muted)"></p>
    <div class="modal-actions" style="margin-top:8px;display:flex;gap:10px;justify-content:flex-end">
      <button class="btn ghost" data-close>Plus tard</button>
      <button class="btn primary" id="npwOk">Enregistrer</button>
    </div>`, (root) => {
    const msg = root.querySelector('#npwMsg'), ok = root.querySelector('#npwOk');
    ok.onclick = async () => {
      const a = root.querySelector('#npw1').value, b = root.querySelector('#npw2').value;
      if (a.length < 6) { msg.textContent = '❌ 6 caractères minimum'; return; }
      if (a !== b) { msg.textContent = '❌ Les deux mots de passe ne sont pas identiques'; return; }
      ok.disabled = true; msg.textContent = '…';
      try { await sbSetPassword(a); }
      catch (e) { msg.textContent = '❌ ' + (e.message || 'Échec'); ok.disabled = false; return; }
      if (isIOS && !isStandalone()) {
        // Lien ouvert dans Safari : l'app installée a son propre stockage → on s'y connecte avec le nouveau mot de passe.
        sbStoreSession(null);
        showModal(`<h2 style="margin:0 0 6px">✅ Mot de passe enregistré</h2>
          <p class="hint">Ouvrez maintenant l'app TV Time depuis l'écran d'accueil et connectez-vous avec votre e-mail et ce nouveau mot de passe.</p>
          <div class="modal-actions" style="margin-top:12px;display:flex;justify-content:flex-end"><button class="btn primary" data-close>OK</button></div>`);
      } else { closeModal(); toast('✅ Mot de passe enregistré'); }
      render();
    };
  });
}
// Retour depuis le lien de l'e-mail : la page s'ouvre avec le jeton dans l'adresse (#access_token=…).
// À traiter avant le routeur, puis on remplace l'adresse par la page Réglages.
(function sbHandleReturn() {
  const h = location.hash || '';
  if (!/access_token=|error_description=/.test(h) || /^#\//.test(h)) return;
  const params = new URLSearchParams(h.replace(/^#/, ''));
  let msg;
  const s = sbSessionFromHash(params);
  if (s && s.uid) { sbStoreSession(s); msg = 'Connecté : ' + (s.email || ''); }
  else if (params.get('error_description')) msg = 'Lien invalide ou expiré : demandez-en un nouveau';
  history.replaceState(null, '', location.pathname + location.search + '#/profile');
  if (msg) setTimeout(() => toast(msg), 1200);
  if (s && s.uid && params.get('type') === 'recovery') setTimeout(sbAskNewPassword, 1600); // « mot de passe oublié »
  else if (s && s.uid && isIOS && !isStandalone()) setTimeout(sbShowHandoff, 1600);
})();
// iPhone : le lien de l'e-mail s'ouvre dans Safari, dont le stockage est séparé de l'app installée sur
// l'écran d'accueil. On propose alors de copier un « code de transfert » à coller dans l'app.
// Safari se déconnecte ensuite, pour ne jamais réutiliser le même jeton que l'app.
function sbShowHandoff() {
  if (!sbSession || !sbSession.rt) return;
  const code = 'TVT1:' + sbSession.rt;
  showModal(`
    <h2 style="margin:0 0 6px">📱 Encore une étape</h2>
    <p class="hint" style="color:var(--muted)">Vous êtes connecté dans <b>Safari</b>. Sur iPhone, l'app installée sur l'écran d'accueil ne partage pas cette connexion.</p>
    <ol class="hint" style="padding-left:18px">
      <li>Touchez « Copier le code ».</li>
      <li>Ouvrez l'app TV Time depuis l'écran d'accueil.</li>
      <li>Avatar en haut à droite → Sauvegarde en ligne → « Le lien ne m'a pas connecté » → collez le code → « Me connecter ».</li>
    </ol>
    <input class="input" id="sbHandoffCode" readonly value="${esc(code)}" style="width:100%">
    <p class="hint" id="sbHandoffMsg" style="color:var(--muted)"></p>
    <div class="modal-actions" style="margin-top:12px;display:flex;gap:10px;justify-content:flex-end">
      <button class="btn ghost" data-close>J'utilise Safari</button>
      <button class="btn primary" id="sbHandoffCopy">Copier le code</button>
    </div>`, (root) => {
    const btn = root.querySelector('#sbHandoffCopy');
    const done = () => { sbStoreSession(null); closeModal(); toast('Code copié : ouvrez maintenant l\'app'); render(); };
    btn.onclick = async () => {
      if (btn.dataset.manual) { done(); return; }
      try { await navigator.clipboard.writeText(code); done(); }
      catch {
        const inp = root.querySelector('#sbHandoffCode'); inp.focus(); inp.select();
        root.querySelector('#sbHandoffMsg').textContent = 'Copiez le code ci-dessus à la main (appui long → Copier), puis touchez « J\'ai copié ».';
        btn.textContent = 'J\'ai copié'; btn.dataset.manual = '1';
      }
    };
  });
}
// Jeton valide (rafraîchi si besoin). Renvoie null si déconnecté ; lève une erreur si hors-ligne.
async function sbToken() {
  if (!sbSession) return null;
  if (Date.now() < sbSession.exp - 60000) return sbSession.at;
  const res = await sbRequest('/auth/v1/token?grant_type=refresh_token', { method: 'POST', json: { refresh_token: sbSession.rt } });
  if (res.status === 400 || res.status === 401) { sbStoreSession(null); return null; }
  if (!res.ok) throw await sbError(res);
  sbStoreSession(sbSessionFrom(await res.json()));
  return sbSession.at;
}
// ---- Garde-fou de la sauvegarde en ligne (v133) ----
// Comptage commun : épisodes vus (base + ajouts − retraits) et films vus d'un objet sauvegarde
// ({data, userState}, comme celui de buildBackup()). Sert à comparer cet appareil et la copie en ligne.
function backupCounts(b) {
  const d = (b && b.data) || {}, us = (b && b.userState) || {};
  // Épisodes : ensemble (clés de l'export de base ∪ clés ajoutées) moins les retraits : un ajout déjà présent dans la base n'est compté qu'une fois.
  const keys = new Set();
  for (const r of d.seen || []) { if (r.showId == null || r.showId === '') continue; keys.add(keyFromRecord(r)); }
  for (const k of Object.keys(us.seenAdd || {})) keys.add(k);
  for (const k of Object.keys(us.seenRemove || {})) keys.delete(k);
  const eps = keys.size;
  // Films : un film ajouté qui porte le même nom qu'un film de l'export n'est compté qu'une fois.
  const ms = us.movieStatus || {}, seenNames = new Set();
  let movies = 0;
  for (const m of (d.movies || []).concat(us.customMovies || [])) {
    if (!m || seenNames.has(m.name)) continue;
    seenNames.add(m.name);
    const o = ms[m.name];
    if (((o === 'watched' || o === 'towatch') ? o : (m.status || 'towatch')) === 'watched') movies++;
  }
  return { eps, movies, total: eps + movies };
}
const deviceCounts = () => backupCounts({ data: DATA, userState });
// Y a-t-il quelque chose à protéger ? (épisodes, films, statuts de films, séries ajoutées, listes, avis)
function hasUserData() {
  const n = (x) => Array.isArray(x) ? x.length : (x && typeof x === 'object' ? Object.keys(x).length : 0);
  return !!(n(DATA.seen) || n(DATA.movies) || n(userState.seenAdd) || n(userState.customMovies) || n(userState.movieStatus)
    || n(userState.customShows) || n(userState.userLists) || n(userState.reviews));
}
const CLOUD_GUARD_EPS_MIN = 20;    // copie en ligne protégée si elle compte au moins 20 épisodes…
const CLOUD_GUARD_MOVIES_MIN = 10; // …ou au moins 10 films
const CLOUD_GUARD_RATIO = 0.9;     // et que l'appareil en a moins de 90 % (épisodes et films comparés séparément)
const sbDir = () => `backups/${sbSession.uid}`;
const sbObj = (name) => `/storage/v1/object/authenticated/${sbDir()}/${name}`;
// Alerte : l'appareil est-il nettement plus pauvre que la copie en ligne ? Renvoie {eps, movies} (ce qui manque) ou null.
function sbLow(online, dev) {
  if (!online) return null;
  const eps = (online.eps || 0) >= CLOUD_GUARD_EPS_MIN && dev.eps < online.eps * CLOUD_GUARD_RATIO;
  const movies = (online.movies || 0) >= CLOUD_GUARD_MOVIES_MIN && dev.movies < online.movies * CLOUD_GUARD_RATIO;
  return eps || movies ? { eps, movies } : null;
}
const sbLowText = (low) => low ? 'Il manque ' + [low.eps && 'des épisodes', low.movies && 'des films'].filter(Boolean).join(' et ') + ' sur cet appareil.' : '';
// Petit fichier d'état de la copie en ligne : { at, eps, movies, total, prev: {at, eps, movies}, prevAt }. null s'il n'existe pas.
let _sbInfoCache = null;
async function sbReadInfo(token) {
  const res = await sbRequest(sbObj('info.json'), { token, cache: 'no-store' });
  if (res.status === 400 || res.status === 404) return null;
  if (!res.ok) throw await sbError(res);
  try { return await res.json(); } catch { return null; }
}
// Liste du dossier de l'utilisateur (UNE requête) : noms relatifs (backup.json, backup-prev.json, info.json). Échec = erreur, aucun envoi.
async function sbList(token) {
  const res = await sbRequest('/storage/v1/object/list/backups', { method: 'POST', token, json: { prefix: sbSession.uid, limit: 100, offset: 0 }, cache: 'no-store' });
  if (!res.ok) throw await sbError(res);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error('Liste de la sauvegarde en ligne illisible');
  return new Set(rows.map((r) => String(r && r.name || '').split('/').pop()));
}
// Comptes d'un fichier en ligne. Fichier illisible (JSON abîmé) : { unreadable: true }.
async function sbCountsOf(name, lenient) {
  let b;
  try { b = await sbDownload(name); }
  catch (e) { if (lenient || e instanceof SyntaxError) return { unreadable: true }; throw e; }
  return b ? Object.assign({ at: b.exportedAt || null }, backupCounts(b)) : null;
}
// État de la copie en ligne : existence de backup.json / backup-prev.json (d'après la LISTE du dossier) et leurs comptes
// (lus dans info.json, sinon en téléchargeant le fichier une fois). lenient (envoi forcé) : une lecture en échec = « illisible ».
async function sbOnlineState(token, lenient) {
  const names = await sbList(token);
  const curExists = names.has('backup.json'), prevExists = names.has('backup-prev.json'), infoExists = names.has('info.json');
  let info = null, infoErr = null;
  if (infoExists) { try { info = await sbReadInfo(token); } catch (e) { infoErr = e; } }
  const hasCounts = (x) => x && typeof x.eps === 'number' && typeof x.movies === 'number';
  let cur = null, prev = null, curUnreadable = false;
  if (curExists) {
    cur = hasCounts(info) ? { at: info.at || null, eps: info.eps, movies: info.movies } : await sbCountsOf('backup.json', lenient);
    if (cur && cur.unreadable) { cur = null; curUnreadable = true; }
  }
  if (prevExists) {
    prev = hasCounts(info && info.prev) ? { at: info.prev.at || null, eps: info.prev.eps, movies: info.prev.movies } : await sbCountsOf('backup-prev.json', lenient);
    if (prev && prev.unreadable) prev = null;
  }
  // Référence de comparaison : la copie actuelle ; sinon la version précédente ; sinon, à défaut, ce que dit info.json.
  const base = cur || prev || (hasCounts(info) ? { at: info.at || null, eps: info.eps, movies: info.movies } : null);
  // Incertain : backup.json devrait exister (info.json présent ou sauvegarde déjà faite depuis cet appareil) mais la liste ne le montre pas, ou il est illisible.
  const uncertain = curUnreadable || (!curExists && (infoExists || !!userState.lastCloudBackupAt));
  return { info, infoErr, curExists, prevExists, infoExists, cur, prev, base, curUnreadable, uncertain, fromPrev: !cur && !!prev };
}
async function sbCopy(token, from, to) {
  return sbRequest('/storage/v1/object/copy', { method: 'POST', token, json: { bucketId: 'backups', sourceKey: `${sbSession.uid}/${from}`, destinationKey: `${sbSession.uid}/${to}` } });
}
const SB_JSON_HEADERS = { 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' };
// Envoie la sauvegarde. opts.auto = envoi silencieux ; opts.force = remplacer même si la copie en ligne est plus riche.
// Renvoie { ok: true, infoFailed? } ou { conflict: {at, eps, movies, total, fromPrev} } (rien n'est alors envoyé).
// backup.json n'est jamais déplacé ni supprimé : la version précédente en est une COPIE.
async function sbUpload(opts = {}) {
  const token = await sbToken();
  if (!token) throw new Error('Non connecté');
  // La sauvegarde est construite AVANT toute opération Storage (instantané cohérent, sans l'alerte de conflit).
  const oldConflict = userState.cloudConflict, oldFileAt = userState.lastBackupAt;
  delete userState.cloudConflict;
  const backup = buildBackup(), body = JSON.stringify(backup), dev = backupCounts(backup);
  const undo = () => { if (oldConflict) userState.cloudConflict = oldConflict; userState.lastBackupAt = oldFileAt; };
  try {
    const st = await sbOnlineState(token, !!opts.force);
    if (!opts.force) {
      if (st.infoErr) throw st.infoErr;
      const low = sbLow(st.base, dev);
      if (low) {
        undo();
        const conflict = { at: st.base.at || null, eps: st.base.eps || 0, movies: st.base.movies || 0, total: (st.base.eps || 0) + (st.base.movies || 0), fromPrev: st.fromPrev };
        if (opts.auto) { userState.cloudConflict = conflict; scheduleSaveState(); }
        return { conflict };
      }
      if (st.uncertain) { // copie en ligne introuvable ou illisible alors qu'elle devrait exister : jamais d'envoi sans accord
        undo();
        if (opts.auto) { userState.cloudUncertain = true; scheduleSaveState(); }
        return { uncertain: true, unreadable: st.curUnreadable };
      }
    }
    // 1) version précédente = COPIE de backup.json, mais seulement si la copie actuelle n'est pas plus pauvre que
    // la précédente (sinon on garde la riche : un « Remplacer quand même » ne la fait pas disparaître le lendemain).
    let prevKept = st.prev;
    if (st.curExists && !st.curUnreadable) { // une copie illisible n'est pas copiée en « précédente » : on la laisse et on envoie
      const poorer = st.prevExists && st.prev && st.cur && (st.cur.eps < st.prev.eps * CLOUD_GUARD_RATIO || st.cur.movies < st.prev.movies * CLOUD_GUARD_RATIO);
      if (!poorer) {
        if (st.prevExists) {
          const d = await sbRequest(sbObj('backup-prev.json').replace('/authenticated', ''), { method: 'DELETE', token });
          if (!d.ok && d.status !== 404 && d.status !== 400) throw new Error('La version précédente n\'a pas pu être remplacée : envoi annulé, votre sauvegarde en ligne est intacte.');
        }
        const cp = await sbCopy(token, 'backup.json', 'backup-prev.json');
        if (!cp.ok && cp.status !== 404) throw new Error('La version précédente n\'a pas pu être conservée : envoi annulé, votre sauvegarde en ligne est intacte.');
        prevKept = cp.ok ? st.cur : null;
      }
    }
    // 2) la nouvelle sauvegarde
    const res = await sbRequest(sbObj('backup.json').replace('/authenticated', ''), { method: 'POST', token, body, headers: SB_JSON_HEADERS });
    if (!res.ok) throw await sbError(res);
    // 3) petit fichier d'état : un échec est signalé à l'utilisateur (et info.json supprimé pour ne pas laisser un état périmé)
    const stamp = { at: backup.exportedAt, eps: dev.eps, movies: dev.movies, total: dev.total, prev: prevKept ? { at: prevKept.at || null, eps: prevKept.eps, movies: prevKept.movies } : null, prevAt: prevKept ? (prevKept.at || null) : null };
    let infoFailed = false;
    try {
      const r = await sbRequest(sbObj('info.json').replace('/authenticated', ''), { method: 'POST', token, body: JSON.stringify(stamp), headers: SB_JSON_HEADERS });
      if (!r.ok) throw new Error('info ' + r.status);
    } catch (e) {
      infoFailed = true; console.warn('Sauvegarde en ligne : info.json non écrit', e);
      try { await sbRequest(sbObj('info.json').replace('/authenticated', ''), { method: 'DELETE', token }); } catch {}
    }
    if (infoFailed) userState.cloudInfoFailed = true; else delete userState.cloudInfoFailed;
    delete userState.cloudUncertain;
    _sbInfoCache = null;
    userState.lastCloudBackupAt = new Date().toISOString();
    scheduleSaveState();
    return infoFailed ? { ok: true, infoFailed: true } : { ok: true };
  } catch (e) { undo(); throw e; }
}
// Lit la copie en ligne pour comparer (sert à « Remplacer quand même » : chiffres frais avant d'afficher la fenêtre).
async function sbPeek() {
  const token = await sbToken();
  if (!token) throw new Error('Non connecté');
  const st = await sbOnlineState(token);
  const b = st.base;
  return b ? { at: b.at || null, eps: b.eps || 0, movies: b.movies || 0, total: (b.eps || 0) + (b.movies || 0), fromPrev: st.fromPrev } : null;
}
async function sbDownload(name = 'backup.json') {
  const token = await sbToken();
  if (!token) throw new Error('Non connecté');
  const res = await sbRequest(sbObj(name), { token, cache: 'no-store' });
  if (res.status === 400 || res.status === 404) return null; // aucune sauvegarde en ligne
  if (!res.ok) throw await sbError(res);
  return res.json();
}
// Libellé de date pour l'état de la sauvegarde : « aujourd'hui à 14:02 », « hier à 09:10 », « il y a 3 jours ».
function cloudWhen(iso) {
  const t = Date.parse(iso); if (isNaN(t)) return 'date inconnue';
  const d = new Date(t), now = new Date();
  const day = (x) => Math.round(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / MS_DAY);
  const n = day(now) - day(d);
  const hm = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (n <= 0) return `aujourd'hui à ${hm}`;
  if (n === 1) return `hier à ${hm}`;
  if (n < 31) return `il y a ${n} jours`;
  return fmtAgo(iso);
}
const cloudCountsText = (c) => `${c.eps} épisode${c.eps > 1 ? 's' : ''} et ${c.movies} film${c.movies > 1 ? 's' : ''}`;
// Ligne d'état rassurante (haut du panneau de sauvegarde). Renvoie du HTML.
function sbStateHtml() {
  if (!sbSession) return '';
  if (userState.cloudConflict) return `<div class="sb-state warn"><span>⚠️</span><span><b>Sauvegarde en ligne non mise à jour.</b> Elle contient plus de données que cet appareil : rien n'a été remplacé.</span></div>`;
  if (userState.cloudUncertain) return `<div class="sb-state warn"><span>⚠️</span><span>La sauvegarde en ligne n'a pas pu être vérifiée : l'envoi automatique est suspendu. Touchez « Sauvegarder maintenant ».</span></div>`;
  if (userState.cloudInfoFailed) return `<div class="sb-state warn"><span>⚠️</span><span>Sauvegarde envoyée, mais ses informations n'ont pas pu être mises à jour.</span></div>`;
  const t = userState.lastCloudBackupAt;
  if (!t) return `<div class="sb-state warn"><span>⚠️</span><span>Pas encore de sauvegarde en ligne depuis cet appareil.</span></div>`;
  if (daysSince(t) > 3) return `<div class="sb-state warn"><span>⚠️</span><span>Dernière sauvegarde en ligne : ${esc(cloudWhen(t))}. Touchez « Sauvegarder maintenant ».</span></div>`;
  return `<div class="sb-state"><span>☁️</span><span>Sauvegardé en ligne ${esc(cloudWhen(t))}</span></div>`;
}
// Détail du conflit (les deux comptes) + choix.
function sbConflictHtml() {
  const cf = userState.cloudConflict; if (!cf || !sbSession) return '';
  const dev = deviceCounts();
  return `<div class="sb-conflict"><p style="margin:0 0 8px">Votre sauvegarde en ligne${cf.fromPrev ? ' (version précédente)' : ''}${cf.at ? ' (' + esc(cloudWhen(cf.at)) + ')' : ''} contient <b>${esc(cloudCountsText(cf))}</b>, alors que cet appareil n'en contient que <b>${esc(cloudCountsText(dev))}</b>. ${esc(sbLowText(sbLow(cf, dev)))} Pour ne rien perdre, l'envoi automatique est suspendu.</p>
    <div class="row" style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn primary" id="sbRestoreConflict">Restaurer la sauvegarde en ligne</button><button class="btn ghost" id="sbForce">Remplacer quand même</button></div></div>`;
}
function sbPanelHtml() {
  let inner;
  if (sbSession) {
    inner = `${sbStateHtml()}${sbConflictHtml()}
      <p class="hint" style="color:var(--muted)">Connecté : <b>${esc(sbSession.email || '')}</b></p>
      <div class="row" style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn primary" id="sbSave">☁️ Sauvegarder maintenant</button>
        <button class="btn" id="sbRestore">Restaurer</button>
        <button class="btn ghost" id="sbLogout">Se déconnecter</button>
      </div>
      <p style="margin:8px 0 0"><button class="btn ghost sm" id="sbPrev">Restaurer la version précédente</button></p>
      <span id="sbStatus" class="sub"></span>
      <details style="margin-top:12px"><summary class="hint" style="color:var(--muted);cursor:pointer">🔑 Choisir ou changer mon mot de passe</summary>
        <p class="hint" style="color:var(--muted)">Utile si vous vous êtes connecté avec un lien reçu par e-mail : ensuite, vous vous connecterez avec votre e-mail et ce mot de passe (6 caractères minimum).</p>
        <input class="input" id="sbNewPw" type="password" autocomplete="new-password" placeholder="Nouveau mot de passe">
        <input class="input" id="sbNewPw2" type="password" autocomplete="new-password" placeholder="Confirmez le mot de passe" style="margin-top:8px">
        <div class="row" style="margin-top:8px"><button class="btn" id="sbSetPw">Enregistrer le mot de passe</button> <span id="sbPwStatus" class="sub"></span></div>
      </details>`;
  } else {
    inner = `<p class="hint" style="color:var(--text2);margin-top:0">Créez un compte gratuit : votre historique est sauvegardé automatiquement chaque jour, et vous pouvez retrouver vos amis.</p>
      <input class="input" id="sbEmail" type="email" autocomplete="email" placeholder="Votre e-mail" value="${esc(sbPendingEmail || '')}">
      <input class="input" id="sbPw" type="password" autocomplete="current-password" placeholder="Mot de passe (6 car. min.)" style="margin-top:8px">
      <input class="input" id="sbPw2" type="password" autocomplete="new-password" placeholder="Confirmez le mot de passe (nouveau compte)" style="margin-top:8px" hidden>
      <div class="row" style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap">
        <button class="btn primary" id="sbLogin">Se connecter</button>
        <button class="btn" id="sbSignup">Créer un compte</button>
      </div>
      <span id="sbStatus" class="sub"></span>
      <p style="margin:8px 0 0"><button type="button" class="btn ghost sm" id="sbForgot">Mot de passe oublié ?</button></p>
      <details style="margin-top:12px"${sbPendingEmail ? ' open' : ''}><summary class="hint" style="color:var(--muted);cursor:pointer">Autres façons de se connecter</summary>
        <p class="hint" style="margin-bottom:0"><b>Recevoir un lien par e-mail</b></p>
        <p class="hint" style="color:var(--muted);margin-top:4px">Pour un compte créé avant les mots de passe, ou en cas d'oubli : recevez un lien de connexion (au plus 2 e-mails par heure pour tout le monde), puis choisissez un mot de passe dans Mon compte.</p>
        <div class="row" style="margin-top:8px"><button class="btn" id="sbSend">Recevoir le lien</button></div>
        ${sbPendingEmail ? '<p class="hint" style="color:var(--muted)">✉️ Lien envoyé : ouvrez l\'e-mail (regardez aussi les indésirables) et touchez « Sign in ».</p>' : ''}
        <p class="hint" style="margin:16px 0 0"><b>Le lien ne m'a pas connecté (iPhone…)</b></p>
        <p class="hint" style="color:var(--muted);margin-top:4px">Deux possibilités :<br>
          • Vous avez touché le lien et Safari s'est ouvert : Safari affiche un <b>code</b> à copier, collez-le ici.<br>
          • Ou, dans l'e-mail, faites un <b>appui long</b> sur « Sign in » → « Copier le lien » (sans le toucher avant : un lien ne sert qu'une fois), puis collez-le ici.</p>
        <input class="input" id="sbLink" placeholder="Collez le lien ou le code ici">
        <div class="row" style="margin-top:8px"><button class="btn" id="sbPaste">Me connecter avec ce lien</button></div>
      </details>`;
  }
  return `<div class="panel" id="sbPanel"><h3>Sauvegarde en ligne</h3>${inner}</div>`;
}
function sbWirePanel(el) {
  const st = el.querySelector('#sbStatus');
  const say = (t) => { if (st) st.textContent = t; };
  const on = (id, fn) => { const b = el.querySelector(id); if (b) b.onclick = async () => {
    if (sbBusy || sbRestoring) return; sbBusy = true; b.disabled = true;
    try { await fn(); } catch (e) { say('❌ ' + (e && e.message ? e.message : 'Échec (êtes-vous en ligne ?)')); b.disabled = false; }
    sbBusy = false;
  }; };
  const creds = () => {
    const email = el.querySelector('#sbEmail').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('E-mail invalide');
    const pw = el.querySelector('#sbPw').value;
    if (pw.length < 6) throw new Error('Mot de passe : 6 caractères minimum');
    return { email, pw };
  };
  on('#sbLogin', async () => { const { email, pw } = creds(); say('Connexion…'); await sbSignInPassword(email, pw); toast('Connecté'); render(); });
  on('#sbSignup', async () => {
    const { email, pw } = creds();
    const pw2El = el.querySelector('#sbPw2');
    if (pw2El.hidden) { pw2El.hidden = false; pw2El.focus(); throw new Error('Retapez le mot de passe dans le 2ᵉ champ, puis touchez à nouveau « Créer un compte »'); }
    if (pw2El.value !== pw) throw new Error('Les deux mots de passe ne sont pas identiques');
    say('Création du compte…'); await sbSignUp(email, pw); toast('Compte créé, vous êtes connecté'); render();
  });
  on('#sbForgot', async () => {
    const email = el.querySelector('#sbEmail').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { el.querySelector('#sbEmail').focus(); throw new Error('Indiquez d\'abord votre e-mail ci-dessus'); }
    say('Envoi…'); await sbSendRecovery(email);
    say('✉️ E-mail envoyé à ' + email + ' : touchez le lien qu\'il contient (regardez aussi les indésirables), puis choisissez votre nouveau mot de passe.');
    el.querySelector('#sbForgot').disabled = false;
  });
  on('#sbSend', async () => {
    const email = el.querySelector('#sbEmail').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('E-mail invalide');
    say('Envoi…'); await sbSendLink(email); render();
  });
  const pwb = el.querySelector('#sbSetPw');
  if (pwb) pwb.onclick = async () => {
    const ps = el.querySelector('#sbPwStatus'), pw = el.querySelector('#sbNewPw').value;
    if (pw.length < 6) { ps.textContent = '❌ 6 caractères minimum'; return; }
    if (el.querySelector('#sbNewPw2').value !== pw) { ps.textContent = '❌ Les deux mots de passe ne sont pas identiques'; return; }
    if (sbBusy) return; sbBusy = true; pwb.disabled = true; ps.textContent = '…';
    try { await sbSetPassword(pw); ps.textContent = '✅ Mot de passe enregistré'; el.querySelector('#sbNewPw').value = ''; el.querySelector('#sbNewPw2').value = ''; }
    catch (e) { ps.textContent = '❌ ' + (e.message || 'Échec'); }
    pwb.disabled = false; sbBusy = false;
  };
  on('#sbPaste', async () => {
    say('Vérification…'); await sbSignInWithLink(el.querySelector('#sbLink').value); toast('Connecté'); render();
  });
  on('#sbLogout', async () => { sbStoreSession(null); render(); });
  // Envoi manuel : si la copie en ligne est nettement plus riche, on demande confirmation (deux comptes affichés).
  on('#sbSave', async () => {
    say('Envoi…');
    const r = await sbUpload();
    if (r.conflict) { say(''); el.querySelector('#sbSave').disabled = false; sbConfirmReplace(r.conflict); return; }
    if (r.uncertain) {
      say(''); el.querySelector('#sbSave').disabled = false;
      sbBusy = false; // la fenêtre attend l'utilisateur ; l'envoi forcé reprend le verrou lui-même
      const ok = await askModal(`<h2>⚠️ Sauvegarde en ligne introuvable</h2><p>${r.unreadable ? 'Votre sauvegarde en ligne ne peut pas être lue (fichier abîmé ?).' : 'Votre sauvegarde en ligne principale n\'apparaît plus alors qu\'elle devrait exister.'} Voulez-vous quand même envoyer celle de cet appareil ?</p>`, 'Annuler', 'Envoyer quand même');
      if (ok && !sbBusy) {
        sbBusy = true;
        try { await sbUpload({ force: true }); toast('☁️ Sauvegarde en ligne faite'); } catch (e) { say('❌ ' + (e && e.message ? e.message : 'Échec')); }
        sbBusy = false; render();
      }
      sbBusy = true; // rendu à on() qui le relâche
      return;
    }
    toast(r.infoFailed ? '⚠️ Sauvegarde envoyée, mais ses informations n\'ont pas pu être mises à jour' : '☁️ Sauvegarde en ligne faite'); render();
  });
  const restoreFrom = async (name, label, btnSel) => {
    say('Recherche…');
    let parsed = await sbDownload(name);
    const btn = el.querySelector(btnSel);
    if (!parsed && name === 'backup.json') {
      const p = await sbDownload('backup-prev.json');
      if (p) {
        say('');
        const ok = await askModal(`<h2>Sauvegarde principale introuvable</h2><p>Votre sauvegarde en ligne principale est introuvable, mais une <b>version précédente</b>${p.exportedAt ? ' (' + esc(cloudWhen(p.exportedAt)) + ')' : ''} existe. Voulez-vous la restaurer à la place ?</p>`, 'Annuler', 'Voir la version précédente');
        if (!ok) { if (btn) btn.disabled = false; return; }
        parsed = p; label = 'la version précédente de la sauvegarde en ligne';
      }
    }
    if (!parsed) { say(name === 'backup.json' ? 'Aucune sauvegarde en ligne pour ce compte.' : 'Aucune version précédente en ligne.'); if (btn) btn.disabled = false; return; }
    say('');
    // Fenêtre de confirmation chiffrée + copie de secours : dans applyBackup.
    let applied = false;
    try { applied = await applyBackup(parsed, { label }); } catch (e) { console.error(e); showNotice('Erreur', 'La restauration n’a pas pu aboutir. Rien n’a été perdu.'); }
    if (applied) {
      userState.cloudConflict = null; scheduleSaveState(); // restauré : plus de décalage avec la copie en ligne
      render();
    } else if (btn) btn.disabled = false;
  };
  // Boutons « Restaurer » : pas via on() (qui garde sbBusy pendant tout le clic, ce qui bloquait applyBackup). Leur propre
  // protection : sbRestoring (double clic ignoré, pas d'envoi automatique) ; sbBusy est posé par applyBackup lui-même.
  const restoreBtn = (id, name, label) => { const b = el.querySelector(id); if (b) b.onclick = async () => {
    if (sbBusy || sbRestoring) return; sbRestoring = true; b.disabled = true;
    try { await restoreFrom(name, label, id); }
    catch (e) { say('❌ ' + (e && e.message ? e.message : 'Échec (êtes-vous en ligne ?)')); b.disabled = false; }
    finally { sbRestoring = false; }
  }; };
  restoreBtn('#sbRestore', 'backup.json', 'la sauvegarde en ligne');
  restoreBtn('#sbRestoreConflict', 'backup.json', 'la sauvegarde en ligne');
  restoreBtn('#sbPrev', 'backup-prev.json', 'la version précédente de la sauvegarde en ligne');
  const force = el.querySelector('#sbForce');
  if (force) force.onclick = async () => {
    if (sbBusy) return; sbBusy = true; force.disabled = true; say('Vérification…');
    try {
      const fresh = await sbPeek(); say('');
      if (!fresh || !sbLow(fresh, deviceCounts())) { delete userState.cloudConflict; scheduleSaveState(); toast('Plus de décalage avec la sauvegarde en ligne'); sbBusy = false; render(); return; }
      userState.cloudConflict = fresh; scheduleSaveState();
      sbBusy = false; sbConfirmReplace(fresh); force.disabled = false; return;
    } catch (e) { say('❌ ' + (e && e.message ? e.message : 'Échec (êtes-vous en ligne ?)')); force.disabled = false; }
    sbBusy = false;
  };
  // Date de la version précédente dans le libellé du bouton (lue dans info.json, sans bloquer l'affichage).
  const prevBtn = el.querySelector('#sbPrev');
  if (prevBtn && sbSession) sbLoadInfo().then((i) => {
    const pa = i && ((i.prev && i.prev.at) || i.prevAt);
    if (pa && prevBtn.isConnected) prevBtn.textContent = `Restaurer la version précédente (${new Date(pa).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })})`;
  }).catch(() => {});
}
async function sbLoadInfo() {
  if (_sbInfoCache && Date.now() - _sbInfoCache.t < 60000) return _sbInfoCache.v;
  const token = await sbToken(); if (!token) return null;
  const v = await sbReadInfo(token);
  _sbInfoCache = { t: Date.now(), v };
  return v;
}
// Fenêtre de confirmation avant de remplacer une sauvegarde en ligne plus riche que cet appareil.
function sbConfirmReplace(online) {
  const dev = deviceCounts();
  showModal(`
    <h2 style="margin:0 0 6px">⚠️ Remplacer la sauvegarde en ligne ?</h2>
    <p class="hint" style="color:var(--text2)">Votre sauvegarde en ligne${online.at ? ' (' + esc(cloudWhen(online.at)) + ')' : ''} contient <b>${esc(cloudCountsText(online))}</b>.<br>
      Cet appareil n'en contient que <b>${esc(cloudCountsText(dev))}</b>. ${esc(sbLowText(sbLow(online, dev)))}</p>
    <p class="hint" style="color:var(--muted)">Si vous continuez, la sauvegarde en ligne sera remplacée par celle de cet appareil (l'ancienne reste disponible une fois via « Restaurer la version précédente »).</p>
    <div class="modal-actions" style="margin-top:12px;display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">
      <button class="btn ghost" data-close>Annuler</button>
      <button class="btn danger" id="sbReplaceOk">Remplacer quand même</button>
    </div>`, (root) => {
    root.querySelector('#sbReplaceOk').onclick = async () => {
      if (sbBusy) return; sbBusy = true;
      try { const r = await sbUpload({ force: true }); closeModal(); toast(r.infoFailed ? '⚠️ Sauvegarde remplacée, mais ses informations n\'ont pas pu être mises à jour' : '☁️ Sauvegarde en ligne remplacée'); }
      catch (e) { closeModal(); toast('❌ ' + (e && e.message ? e.message : 'Échec de l\'envoi')); }
      sbBusy = false; render();
    };
  });
}
// Sauvegarde en ligne silencieuse, une fois par jour, quand on est connecté. Si la copie en ligne est
// nettement plus riche que cet appareil, rien n'est envoyé : le conflit est mémorisé et affiché dans Mon compte.
const CLOUD_BACKUP_EVERY_DAYS = 1;
let _sbConflictCheckAt = 0;
function sbMaybeAutoBackup() {
  if (!sbSession || sbBusy || sbRestoring || daysSince(userState.lastCloudBackupAt) < CLOUD_BACKUP_EVERY_DAYS) return false;
  if (userState.cloudConflict) { // conflit en attente : on revérifie au plus toutes les 30 min (il peut s'être résolu)
    if (Date.now() - _sbConflictCheckAt < 1800000) return false;
    _sbConflictCheckAt = Date.now();
  }
  sbBusy = true;
  sbUpload({ auto: true }).then((r) => { if (r && document.getElementById('sbPanel')) render(); }).catch((e) => console.warn('Sauvegarde en ligne automatique', e)).finally(() => { sbBusy = false; }); // silencieux : réessayé à la prochaine ouverture si échec
  return true;
}

