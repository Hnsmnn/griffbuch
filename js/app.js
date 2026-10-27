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

/* Phone back button / gesture.
   We keep a stack of spare history entries ("guards") above the first one. Every back press uses
   one up and we handle the step inside the app. Android skips entries a page added without a tap
   since its last back press, so guards are only topped up from inside taps and key presses.
   From the logbook's first tab we jump to the very first entry and ask: one more back closes the app. */
const GUARDS = 20;
let guards = 0, ignorePops = 0;
history.replaceState({ gb: 'root' }, '');
function topUpGuards() { while (guards < GUARDS) { history.pushState({ gb: 'guard' }, ''); guards++; } }
history.pushState({ gb: 'guard' }, ''); guards = 1;
['click', 'keydown'].forEach(ev => document.addEventListener(ev, () => {
  if (!$('#exitdlg').hidden) $('#exitdlg').hidden = true;
  topUpGuards();
}, true));
function handleBack() {
  if (state.tab === 'plan' && state.planNav.length > 1) { planUp(); return true; }
  if (state.tab === 'settings') { showTab(state.prevTab); return true; }
  if (state.tab === 'plan') { showTab(state.lastLogTab); return true; }
  if (state.tab !== 'log') { showTab('log'); return true; }
  return false;
}
window.addEventListener('popstate', () => {
  if (ignorePops) { ignorePops--; return; }
  guards = Math.max(0, guards - 1);
  if (handleBack()) return;
  if (guards) { ignorePops++; history.go(-guards); guards = 0; }
  $('#exitdlg').hidden = false;
});

try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { }
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { }); });
}
