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
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { }
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { }); });
}
