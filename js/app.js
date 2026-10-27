'use strict';
/* Startup. Runs after all other scripts are loaded. */
if (IS_TEST) {
  $('#testbadge').hidden = false;
  document.title = 'Griffbuch Test';
  $('meta[name="apple-mobile-web-app-title"]').setAttribute('content', 'Griffbuch Test');
  $('link[rel="manifest"]').setAttribute('href', 'manifest-test.webmanifest');
}
applyI18n();
$('#testbadge').title = t('test_hint');
fillSelect('#h-proto', PROTOS);
fillSelect('#h-grip', GRIPS);
resetDates();
setHangRows([20, 20, 20, 20, 20], [0, 0, 0, 0, 0]);
addSetRow('8', ''); addSetRow('8', ''); addSetRow('8', '');
loadData();
fillSessTypes();
setAsc('boulder', 'rock');
setAttempts(null);
fillBw();
idleDisplay();
render();

/* Phone back button / gesture: one extra history entry ("guard") stays on top. Each back press
   lands below it; we handle the step inside the app and put the guard back. Only from the
   logbook's first tab do we ask before really leaving. */
history.replaceState({ gb: 'root' }, '');
history.pushState({ gb: 'guard' }, '');
function handleBack() {
  if (state.tab === 'plan' && state.planNav.length > 1) { planUp(); return true; }
  if (state.tab === 'settings') { showTab(state.prevTab); return true; }
  if (state.tab === 'plan') { showTab(state.lastLogTab); return true; }
  if (state.tab !== 'log') { showTab('log'); return true; }
  return false;
}
window.addEventListener('popstate', () => {
  if (handleBack()) { history.pushState({ gb: 'guard' }, ''); return; }
  $('#exitdlg').hidden = false;
  $('#exit-no').focus();
});
$('#exit-no').addEventListener('click', () => { $('#exitdlg').hidden = true; history.pushState({ gb: 'guard' }, ''); });
$('#exit-yes').addEventListener('click', () => { $('#exitdlg').hidden = true; history.back(); });

try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { }
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { }); });
}
