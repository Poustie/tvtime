/* Mon TV Time — Démarrage (boot) — à charger EN DERNIER */
'use strict';
//////////////////////// Boot ////////////////////////
(async function boot() {
  // Demande au navigateur de conserver nos données (pas d'éviction automatique) :
  // ainsi une réinstallation / mise à jour à la MÊME adresse récupère tout seule.
  try { if (navigator.storage?.persist) { if (!(await navigator.storage.persisted())) await navigator.storage.persist(); } } catch {}
  // Detect whether the local PowerShell server is present.
  const st = LABO ? null : await apiGet('/api/state');
  serverAvailable = (st !== null);
  if (LABO) {
    document.documentElement.classList.add('labo'); document.title = 'TV Time — TEST';
    if (await laboCopyFromMain()) setTimeout(() => toast('🧪 Version de test : copie de vos données faite. Vos vraies données ne seront pas modifiées.'), 1200);
  }

  if (serverAvailable) {
    const cache = await apiGet('/api/cache');
    if (st && typeof st === 'object') userState = Object.assign(userState, st);
    if (cache && cache.map) tmdbCache = Object.assign(tmdbCache, cache);
  } else {
    // Standalone / PWA mode: load from IndexedDB on the device, with a
    // localStorage fallback (more reliable when opened from a local file://),
    // then seed from data bundled into the app on first run.
    let us = await idbGet('userState');
    let tc = await idbGet('tmdbCache');
    if (!us) { try { const ls = localStorage.getItem(LS_NS + '_userState'); if (ls) us = JSON.parse(ls); } catch {} }
    if (!us && window.SEED_USERDATA) us = window.SEED_USERDATA;
    if ((!tc || !tc.map) && window.SEED_CACHE) tc = window.SEED_CACHE;
    if (us && typeof us === 'object') userState = Object.assign(userState, us);
    if (tc && tc.map) tmdbCache = Object.assign(tmdbCache, tc);
  }

  // Restore a full-backup catalogue (imported once) so history survives reloads,
  // even on a blank/hosted build. The richer dataset wins.
  try {
    let ov = await idbGet('dataOverride');
    if (!ov) { try { const ls = localStorage.getItem(LS_NS + '_dataOverride'); if (ls) ov = JSON.parse(ls); } catch {} }
    if (ov && (ov.seen?.length || 0) > (DATA.seen?.length || 0)) applyDataObject(ov);
  } catch {}

  applyTmdbOverrides();
  try { repairSeenAddDup(); } catch (e) { console.warn('repairSeenAddDup', e); }
  const mergedDup = reconcileDuplicateMovies();
  if (mergedDup) setTimeout(() => toast(`${mergedDup} film(s) ajouté(s) à la main fusionné(s) avec votre historique`), 1500);
  updateSyncStatus();
  applyTheme();
  if (!location.hash) location.hash = startHash(); // onglet d'ouverture choisi (Personnalisation)
  render();
  if (!maybeShowGuide()) maybeShowChangelogPopup();
  maybeWeeklyBackup();
  setTimeout(sbMaybePublish, 8000);
  setTimeout(refreshMovieMatches, 6000);
  setTimeout(retryNullMatches, 20000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { maybeWeeklyBackup(); sbMaybePublish(); } });
  if ('serviceWorker' in navigator && !LABO) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
