/* Mon TV Time — Fenêtres, synchro, personnalisation */
'use strict';
//////////////////////// Modal ////////////////////////
function showModal(html, onReady) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="backdrop"><div class="modal">${html}</div></div>`;
  root.querySelector('.backdrop').onclick = (e) => { if (e.target.classList.contains('backdrop')) closeModal(); };
  root.querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
  if (onReady) onReady(root);
}
function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }
// ---- Bouton / geste « retour » du téléphone avec une fenêtre ouverte : il ferme la fenêtre et on reste sur la page ----
// À l'ouverture d'une fenêtre on ajoute une entrée d'historique (même adresse, donc ni changement de page ni redessin) ;
// « retour » la consomme (popstate) et ferme la fenêtre. Si on ferme la fenêtre nous-mêmes (croix, fond, action), l'entrée est
// retirée par history.back() — sauf si la page a changé entre-temps (alors elle reste sous la nouvelle page et est sautée au retour).
(function wireModalBack() {
  const root = document.getElementById('modalRoot');
  if (!root || !window.MutationObserver) return;
  const open = () => root.children.length > 0;
  let pushed = false, hashAtPush = '', ignorePop = 0, wantPush = false, settleT = null;
  const push = () => {
    if (ignorePop > 0) { wantPush = true; return; } // un history.back() est encore en route : on attend son popstate
    try { history.pushState({ tvtModal: 1 }, ''); pushed = true; hashAtPush = location.hash; } catch { pushed = false; }
  };
  const settle = () => {
    settleT = null;
    if (open() || !pushed) return;
    pushed = false;
    if (location.hash === hashAtPush && history.state && history.state.tvtModal) { ignorePop++; history.back(); }
  };
  new MutationObserver(() => {
    if (open()) { if (settleT) { clearTimeout(settleT); settleT = null; } if (!pushed) push(); }
    else if (pushed && !settleT) settleT = setTimeout(settle, 0); // laisse une action de la fenêtre changer de page avant de décider
  }).observe(root, { childList: true });
  window.addEventListener('popstate', (ev) => {
    if (ignorePop > 0) { ignorePop--; if (!ignorePop && wantPush) { wantPush = false; if (open()) push(); } return; }
    if (open()) { pushed = false; root.innerHTML = ''; return; } // « retour » : on ferme la fenêtre, la page ne bouge pas
    if (ev.state && ev.state.tvtModal) history.back(); // entrée laissée sous une page : on la saute
  });
  // Aucune fenêtre ne reste affichée après un changement de page.
  window.addEventListener('hashchange', () => { if (open()) { pushed = false; root.innerHTML = ''; } });
})();
// Affiche en grand : clic sur l'affiche d'une fiche (série / film, y compris l'aperçu).
function openPosterViewer(src) {
  closePosterViewer();
  const v = document.createElement('div');
  v.className = 'poster-viewer';
  v.innerHTML = `<img src="${src}" alt=""><button class="pv-close" aria-label="Fermer">✕</button>`;
  v.onclick = closePosterViewer;
  document.body.appendChild(v);
}
function closePosterViewer() { document.querySelectorAll('.poster-viewer').forEach(n => n.remove()); }
document.addEventListener('click', (ev) => {
  const img = ev.target.closest && ev.target.closest('.detail-hero .poster img');
  if (!img) return;
  ev.stopPropagation();
  openPosterViewer(img.src.replace(/\/t\/p\/w\d+\//, '/t/p/w780/'));
}, true);
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closePosterViewer(); });
window.addEventListener('hashchange', closePosterViewer);


// Pop-up « Nouveautés » : au premier lancement suivant une mise à jour, liste les
// notes de version ajoutées depuis la dernière visite. Fermée = marquée comme vue.
function maybeShowChangelogPopup() {
  const newest = CHANGELOG.length ? (CHANGELOG[0].id || 0) : 0;
  const seen = userState.seenChangelog || 0;
  const fresh = CHANGELOG.filter(e => (e.id || 0) > seen);
  if (!fresh.length || newest <= seen) return;
  // Marqué vu tout de suite : ne réapparaît pas, même fermé en touchant à côté.
  userState.seenChangelog = newest;
  scheduleSaveState();
  const body = fresh.map(e => `
    <div class="cl-modal-entry">
      <h4>${esc(e.title)} <span class="cl-date">${esc(e.date)}</span></h4>
      <ul class="cl-list">${e.items.map(it => `<li>${esc(it)}</li>`).join('')}</ul>
    </div>`).join('');
  showModal(`
    <h2 style="margin:0 0 4px">🆕 Nouveautés</h2>
    <p class="hint" style="color:var(--muted);margin:0 0 12px">Ce qui a changé depuis votre dernière visite.</p>
    <div class="cl-modal-body">${body}</div>
    <div class="modal-actions" style="margin-top:14px;display:flex;justify-content:flex-end">
      <button class="btn primary" data-close>J'ai compris</button>
    </div>`);
}

function needKeyHtml(msg) {
  return `<div class="empty"><div class="big">🔑</div><p>${esc(msg)}</p><a class="btn primary" href="#/settings">Ajouter une clé TMDB</a></div>`;
}

//////////////////////// Sync status ////////////////////////
function updateSyncStatus() {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  el.textContent = hasKey() ? 'TMDB ✓' : 'Hors-ligne';
}
// True-black background for AMOLED screens.
//////////////////////// Personnalisation ////////////////////////
// Réglages d'apparence et d'organisation, dans userState.prefs (donc inclus dans les sauvegardes).
const ACCENTS = {
  jaune:  { c: '#f5c518', c2: '#ffd34e', on: '#10141a', ink: '#8a6a00', label: 'Jaune' },
  orange: { c: '#f97316', c2: '#fb923c', on: '#10141a', ink: '#c2410c', label: 'Orange' },
  rouge:  { c: '#ef4444', c2: '#f87171', on: '#ffffff', ink: '#dc2626', label: 'Rouge' },
  rose:   { c: '#ec4899', c2: '#f472b6', on: '#ffffff', ink: '#db2777', label: 'Rose' },
  violet: { c: '#a855f7', c2: '#c084fc', on: '#ffffff', ink: '#9333ea', label: 'Violet' },
  bleu:   { c: '#3b82f6', c2: '#60a5fa', on: '#ffffff', ink: '#2563eb', label: 'Bleu' },
  cyan:   { c: '#06b6d4', c2: '#22d3ee', on: '#10141a', ink: '#0e7490', label: 'Turquoise' },
  vert:   { c: '#22c55e', c2: '#4ade80', on: '#10141a', ink: '#15803d', label: 'Vert' },
};
const TEXT_SIZES = { s: 0.9, m: 1, l: 1.12, xl: 1.25 };
const START_TABS = { home: '📺 Séries', movies: '🎬 Films', explore: '🧭 Explorer', friends: '👥 Amis' };
const prefs = () => userState.prefs || {};
function setPref(k, v) { userState.prefs = Object.assign({}, userState.prefs, { [k]: v }); scheduleSaveState(); }
// Thème : 'dark' (par défaut), 'amoled' (ancien réglage userState.amoled) ou 'light'.
function themeOf() { return prefs().theme || (userState.amoled ? 'amoled' : 'dark'); }
// Durées de la règle « En cours » (réglables) : après le dernier épisode vu, et après un nouvel épisode non vu.
const activeDays = () => prefs().activeDays || ACTIVE_DAYS;
const newEpDays = () => prefs().newEpDays || RECENT_DAYS;
const fmtDays = (d) => d >= 365 ? '1 an' : d >= 28 ? Math.round(d / 30.5) + ' mois' : Math.round(d / 7) + ' semaine' + (d >= 14 ? 's' : '');
const isHomeSectionHidden = (sec) => !!(prefs().homeHidden || {})[sec];
// Rangées d'Explorer dans l'ordre choisi (les inconnues/nouvelles à la fin), sans les rangées masquées.
function exploreRowOrder() {
  const ids = EXPLORE_ROWS.map(r => r.id), out = [];
  for (const id of (prefs().exploreOrder || [])) if (ids.includes(id) && !out.includes(id)) out.push(id);
  for (const id of ids) if (!out.includes(id)) out.push(id);
  return out;
}
const exploreRowsShown = () => exploreRowOrder().filter(id => !(prefs().exploreHidden || {})[id]).map(id => EXPLORE_ROWS.find(r => r.id === id));
// Anti-spoiler : titre, image et résumé des épisodes pas encore vus sont floutés (toucher pour afficher).
const antiSpoiler = () => !!prefs().antiSpoiler;
function startHash() { const t = prefs().startTab; return '#/' + (START_TABS[t] ? t : 'home'); }
function applyTheme() {
  const t = themeOf(), root = document.documentElement, p = prefs();
  root.classList.toggle('amoled', t === 'amoled');
  root.classList.toggle('light', t === 'light');
  const a = ACCENTS[p.accent] || ACCENTS.jaune;
  root.style.setProperty('--accent', a.c);
  root.style.setProperty('--accent2', a.c2);
  root.style.setProperty('--on-accent', a.on);
  root.style.setProperty('--accent-ink', t === 'light' ? a.ink : a.c); // texte coloré lisible sur fond clair
  root.style.setProperty('--fs', String(TEXT_SIZES[p.textSize] || 1));
  root.classList.toggle('poster-s', p.posterSize === 's');
  root.classList.toggle('poster-l', p.posterSize === 'l');
  // La barre d'état du téléphone (heure/batterie) suit cette couleur.
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', t === 'amoled' ? '#000000' : t === 'light' ? '#f4f5f7' : '#0e1116');
}

route('custom', async (el) => {
  const p = prefs(), t = themeOf();
  const chip = (name, val, label, cur) => `<button type="button" class="chip ${String(cur) === String(val) ? 'active' : ''}" data-pref="${name}" data-val="${val}">${label}</button>`;
  const secs = { watching: '▶️ En cours', stale: '🕰️ Pas vu depuis longtemps', notStarted: '🆕 Pas commencée', finished: '✅ Terminée' };
  el.innerHTML = `
    ${backBtn('#/profile')}
    <div class="page-head"><h1>🎨 Personnalisation</h1><span class="sub">Enregistré avec vos données (et dans la sauvegarde en ligne)</span></div>
    <div class="panel"><h3>Couleur principale</h3>
      <div class="swatches">${Object.entries(ACCENTS).map(([k, a]) => `<button type="button" class="swatch ${(p.accent || 'jaune') === k ? 'on' : ''}" data-pref="accent" data-val="${k}" style="background:${a.c}" title="${a.label}" aria-label="${a.label}"></button>`).join('')}</div>
    </div>
    <div class="panel"><h3>Thème</h3>
      <div class="chips">${chip('theme', 'dark', '🌙 Sombre', t)}${chip('theme', 'amoled', '⚫ Noir total (AMOLED)', t)}${chip('theme', 'light', '☀️ Clair', t)}</div>
      <p class="hint" style="color:var(--muted)">« Noir total » économise la batterie sur les écrans OLED.</p>
    </div>
    <div class="panel"><h3>Taille du texte</h3>
      <div class="chips">${chip('textSize', 's', 'Petite', p.textSize || 'm')}${chip('textSize', 'm', 'Normale', p.textSize || 'm')}${chip('textSize', 'l', 'Grande', p.textSize || 'm')}${chip('textSize', 'xl', 'Très grande', p.textSize || 'm')}</div>
    </div>
    <div class="panel"><h3>Taille des affiches</h3>
      <div class="chips">${chip('posterSize', 's', 'Petites', p.posterSize || 'm')}${chip('posterSize', 'm', 'Normales', p.posterSize || 'm')}${chip('posterSize', 'l', 'Grandes', p.posterSize || 'm')}</div>
      <p class="hint" style="color:var(--muted)">Sur téléphone : 4, 3 ou 2 affiches par ligne.</p>
    </div>
    <div class="panel"><h3>Onglet à l'ouverture</h3>
      <div class="chips">${Object.entries(START_TABS).map(([k, l]) => chip('startTab', k, l, START_TABS[p.startTab] ? p.startTab : 'home')).join('')}</div>
    </div>
    <div class="panel"><h3>Sections de la page Séries</h3>
      <p class="hint" style="color:var(--muted)">Décochez une section pour la masquer (l'ordre se change avec « ↕ Réorganiser » sur la page Séries).</p>
      ${Object.entries(secs).map(([k, l]) => `<label class="check-row" style="display:flex;gap:10px;cursor:pointer;margin:6px 0"><input type="checkbox" data-sec="${k}" ${isHomeSectionHidden(k) ? '' : 'checked'}><span>${l}</span></label>`).join('')}
    </div>
    <div class="panel">${titleModePrefHtml()}</div>
    <div class="panel"><h3>Anti-spoiler</h3>
      <label class="check-row" style="display:flex;gap:10px;cursor:pointer"><input type="checkbox" id="custSpoil" ${antiSpoiler() ? 'checked' : ''}><span>Flouter le titre, l'image et le résumé des épisodes que je n'ai pas encore vus <span class="hint" style="display:block;color:var(--muted)">Sur la fiche de l'épisode, touchez pour les afficher. Dans la liste des épisodes d'une série, les titres sont floutés.</span></span></label>
    </div>
    <div class="panel"><h3>Rangées d'Explorer</h3>
      <p class="hint" style="color:var(--muted)">Cochez les rangées à afficher et changez leur ordre avec ▲ ▼.</p>
      <div id="custRows">${exploreRowOrder().map((id, i, arr) => { const r = EXPLORE_ROWS.find(x => x.id === id); return `<div class="cust-row"><label class="check-row" style="display:flex;gap:10px;cursor:pointer;flex:1"><input type="checkbox" data-row="${id}" ${(prefs().exploreHidden || {})[id] ? '' : 'checked'}><span>${esc(r.title)}</span></label><button type="button" class="ord-btn" data-rowmove="up" data-id="${id}" ${i === 0 ? 'disabled' : ''} aria-label="Monter">▲</button><button type="button" class="ord-btn" data-rowmove="down" data-id="${id}" ${i === arr.length - 1 ? 'disabled' : ''} aria-label="Descendre">▼</button></div>`; }).join('')}</div>
    </div>
    <div class="panel"><h3>Règle « En cours »</h3>
      <p class="hint" style="color:var(--muted)">Une série reste « En cours » pendant ce temps après le dernier épisode vu (ou revu) :</p>
      <div class="chips">${[[30, '1 mois'], [61, '2 mois'], [92, '3 mois'], [183, '6 mois'], [365, '1 an']].map(([v, l]) => chip('activeDays', v, l, activeDays())).join('')}</div>
      <p class="hint" style="color:var(--muted);margin-top:12px">Quand un nouvel épisode sort et que vous ne l'avez pas encore vu, elle reste « En cours » pendant :</p>
      <div class="chips">${[[14, '2 semaines'], [31, '1 mois'], [61, '2 mois'], [92, '3 mois']].map(([v, l]) => chip('newEpDays', v, l, newEpDays())).join('')}</div>
      <p class="hint" style="color:var(--muted);margin-top:12px">Une série épinglée reste toujours « En cours ». Ces durées s'appliquent aussi aux séries en cours visibles par vos amis.</p>
    </div>
    <p style="margin-top:6px"><button type="button" class="btn ghost sm" id="custReset">Tout remettre par défaut</button></p>`;

  const refresh = () => { applyTheme(); MODEL = null; render(); };
  el.querySelectorAll('[data-pref]').forEach(b => b.onclick = () => {
    const name = b.dataset.pref, num = ['activeDays', 'newEpDays'].includes(name);
    const val = num ? parseInt(b.dataset.val, 10) : b.dataset.val;
    setPref(name, val);
    if (name === 'theme') { userState.amoled = val === 'amoled'; scheduleSaveState(); }
    refresh();
  });
  el.querySelectorAll('[data-sec]').forEach(cb => cb.onchange = () => {
    const h = Object.assign({}, prefs().homeHidden, { [cb.dataset.sec]: !cb.checked });
    if (!cb.checked && Object.keys(secs).every(k => h[k])) { cb.checked = true; toast('Gardez au moins une section'); return; }
    setPref('homeHidden', h);
    toast(cb.checked ? 'Section affichée' : 'Section masquée');
  });
  wireTitleModePref(el);
  el.querySelector('#custSpoil').onchange = (e) => { setPref('antiSpoiler', e.target.checked); toast(e.target.checked ? 'Anti-spoiler activé' : 'Anti-spoiler désactivé'); };
  el.querySelectorAll('[data-row]').forEach(cb => cb.onchange = () => {
    const h = Object.assign({}, prefs().exploreHidden, { [cb.dataset.row]: !cb.checked });
    if (!cb.checked && EXPLORE_ROWS.every(r => h[r.id])) { cb.checked = true; toast('Gardez au moins une rangée'); return; }
    setPref('exploreHidden', h);
  });
  el.querySelectorAll('[data-rowmove]').forEach(b => b.onclick = () => {
    const order = exploreRowOrder(), i = order.indexOf(b.dataset.id), j = b.dataset.rowmove === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    setPref('exploreOrder', order);
    const y = window.scrollY; render(); requestAnimationFrame(() => window.scrollTo(0, y));
  });
  el.querySelector('#custReset').onclick = () => {
    if (!confirm('Remettre toute la personnalisation par défaut ?')) return;
    userState.prefs = {}; userState.amoled = false; scheduleSaveState(); refresh(); toast('Personnalisation par défaut');
  };
});


//////////////////////// Guide de premier lancement (L7-5) ////////////////////////
const GUIDE_STEPS = [
  { ic: '📺', title: 'Bienvenue dans Mon TV Time',
    body: 'Suivez vos <b>séries</b> et vos <b>films</b> : cochez les épisodes vus, retrouvez les prochains épisodes, notez avec des réactions, découvrez de nouveaux titres dans Explorer et comparez avec vos amis.' },
  { ic: '📥', title: 'Vos données',
    body: 'Vous avez un <b>fichier TV Time</b> ou une <b>sauvegarde</b> de l’application ? Importez-le dans les Réglages pour tout retrouver. Sinon, partez de zéro : ajoutez vos premières séries depuis Explorer.',
    actions: [{ label: '📥 Importer un fichier ou une sauvegarde', go: '#/settings' }, { label: '✨ Partir de zéro', go: '#/explore' }] },
  { ic: '☁️', title: 'Sauvegarde en ligne',
    body: 'Créez un compte (e-mail + mot de passe) dans <b>Mon compte</b> pour sauvegarder vos données en ligne, les retrouver sur un autre téléphone et vous connecter avec vos amis. C’est facultatif.',
    actions: [{ label: '☁️ Ouvrir Mon compte', go: '#/profile' }] }
];
function showGuide(step) {
  step = Math.max(0, Math.min(step | 0, GUIDE_STEPS.length - 1));
  const g = GUIDE_STEPS[step], last = step === GUIDE_STEPS.length - 1;
  showModal(`<div class="guide">
    <div class="guide-ic">${g.ic}</div>
    <h2>${g.title}</h2>
    <p class="guide-body">${g.body}</p>
    ${(g.actions || []).map((a, i) => `<button class="btn guide-act" data-go="${a.go}">${a.label}</button>`).join('')}
    <div class="guide-dots">${GUIDE_STEPS.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</div>
    <div class="guide-nav"><button class="btn ghost" id="guideSkip" type="button">Passer</button><button class="btn primary" id="guideNext" type="button">${last ? 'Terminer' : 'Suivant'}</button></div>
  </div>`, (root) => {
    root.querySelector('#guideSkip').onclick = closeModal;
    root.querySelector('#guideNext').onclick = () => { if (last) closeModal(); else showGuide(step + 1); };
    root.querySelectorAll('.guide-act').forEach(b => b.onclick = () => { closeModal(); location.hash = b.dataset.go; });
  });
}
// Au démarrage : seulement si l'appareil n'a AUCUNE donnée et que le guide n'a jamais été vu. Renvoie true s'il s'ouvre.
function maybeShowGuide() {
  if (hasUserData() || prefs().tutoSeen) return false;
  setPref('tutoSeen', true);
  // Le guide remplace la pop-up « Nouveautés » (inutile pour un tout nouvel utilisateur).
  if (CHANGELOG.length) userState.seenChangelog = CHANGELOG[0].id || 0;
  showGuide(0);
  return true;
}
