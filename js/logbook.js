'use strict';
/* Logbook: entry forms, history, backup, settings, progress charts, timer. */

/* ---------- tabs + mode ---------- */
const LOG_TABS = ['log', 'hist', 'prog', 'timer'];
function showTab(tab) {
  if (tab !== 'settings') state.prevTab = tab;
  if (LOG_TABS.includes(tab)) state.lastLogTab = tab;
  state.tab = tab;
  const inPlan = tab === 'plan' || (tab === 'settings' && state.prevTab === 'plan');
  $$('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === (inPlan ? 'plan' : 'log')));
  $('#modeseg').hidden = tab === 'settings';
  $('nav.tabs').hidden = inPlan;
  $$('nav.tabs button').forEach(b => { if (b.dataset.tab === tab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  [...LOG_TABS, 'settings', 'plan'].forEach(v => { $('#v-' + v).hidden = v !== tab; });
  $('#gear').setAttribute('aria-pressed', tab === 'settings');
  window.scrollTo(0, 0);
  render();
}
$$('nav.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
$('#gear').addEventListener('click', () => showTab(state.tab === 'settings' ? state.prevTab : 'settings'));
$$('[data-mode]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.mode === 'plan' ? 'plan' : state.lastLogTab)));

const LOG_FORMS = { hang: '#f-hang', kraft: '#f-kraft', ascent: '#f-asc', session: '#f-sess' };
function setLogType(type) {
  state.logType = type;
  $$('[data-lt]').forEach(b => b.setAttribute('aria-pressed', b.dataset.lt === type));
  Object.entries(LOG_FORMS).forEach(([k, sel]) => { $(sel).hidden = k !== type; });
  renderPlanLink();
}
$$('[data-lt]').forEach(b => b.addEventListener('click', () => setLogType(b.dataset.lt)));

function resetDates() { ['#h-date', '#k-date', '#a-date', '#ss-date'].forEach(id => { $(id).value = todayStr(); }); }

async function saveEntry(entry, errEl) {
  try {
    await saveRecord(entry);
    toast(t('saved'));
    afterSaveLink(entry);
    return true;
  } catch (e) {
    errEl.textContent = e && e.code === 'quota_exceeded' ? t('quota') : t('save_fail');
    return false;
  }
}
function fillBw(force) { if (!S.bw) return; ['#h-bw', '#k-bw'].forEach(id => { if (force || !$(id).value) $(id).value = S.bw; }); }

/* Banner shown while the open form was filled from a planned session. */
function renderPlanLink() {
  const L = state.planLink, show = !!L && L.kind === state.logType;
  $('#planlink').hidden = !show;
  if (show) $('#planlink-t').textContent = t('plan_from', { s: L.label, date: dayDate(L.date) });
}
$('#planlink-x').addEventListener('click', () => { state.planLink = null; renderPlanLink(); });

let rowCounter = 0;
function numberRows(wrap) { $$('.setrow', wrap).forEach((r, i) => { r.querySelector('.n').textContent = i + 1; }); }

/* ---------- hangboard form ---------- */
const PROTO_DEFAULTS = {
  max: { hang: 10, rest: 0, reps: 1, sets: 5 }, rep: { hang: 7, rest: 3, reps: 6, sets: 3 },
  minedge: { hang: 10, rest: 0, reps: 1, sets: 4 }, long: { hang: 30, rest: 0, reps: 1, sets: 3 }
};
function fillSelect(sel, list) {
  const cur = $(sel).value;
  $(sel).innerHTML = list.map(x => `<option value="${esc(x.id)}">${esc(x[S.lang])}</option>`).join('');
  if (cur) $(sel).value = cur;
}
function addHangRow(edge, load) {
  const wrap = $('#h-rows');
  if (edge === undefined) {
    const prev = wrap.lastElementChild;
    edge = prev ? prev.querySelector('.ed').value : '20';
    load = prev ? prev.querySelector('.ld').value : '0';
  }
  rowCounter++;
  const row = document.createElement('div');
  row.className = 'setrow';
  row.innerHTML = `<span class="n"></span>
    <input class="ed" id="h-e-${rowCounter}" type="number" inputmode="decimal" min="1" step="1" placeholder="mm" aria-label="${esc(t('edge_mm'))}" value="${esc(edge)}">
    <input class="ld" id="h-l-${rowCounter}" type="number" inputmode="decimal" step="0.5" placeholder="0" aria-label="${esc(t('load_kg'))}" value="${esc(load)}">
    <button type="button" class="x" aria-label="−">×</button>`;
  row.querySelector('.x').addEventListener('click', () => { row.remove(); numberRows(wrap); dirty.hang = true; });
  wrap.appendChild(row); numberRows(wrap);
}
function setHangRows(edges, loads) { $('#h-rows').innerHTML = ''; edges.forEach((e, i) => addHangRow(String(e), String(loads[i] ?? 0))); }
function currentRows() {
  return $$('#h-rows .setrow').map(r => ({ e: parseFloat(r.querySelector('.ed').value), l: parseFloat(r.querySelector('.ld').value) }));
}
$('#h-add').addEventListener('click', () => { addHangRow(); dirty.hang = true; });

function lastHang(match) { return sorted().find(e => e.type === 'hang' && match(e)); }
function applyHang(e) {
  $('#h-hang').value = e.hang; $('#h-rest').value = e.rest; $('#h-reps').value = e.reps;
  setHangRows(edgesOf(e), loadsOf(e));
  if (e.bw) $('#h-bw').value = e.bw;
}
function applyHangFull(e) {
  $('#h-proto').value = e.proto; $('#h-grip').value = e.grip; $('#h-arm').value = armOf(e);
  applyHang(e);
}
let hangNoteEntry = null;
function hangPrefillNote(e) {
  hangNoteEntry = e;
  $('#h-prefill').textContent = e ? t('pf_hang', { date: shortDate(e.ts), proto: nameOf(PROTOS, e.proto), grip: nameOf(GRIPS, e.grip) }) : '';
}
function onHangCategoryChange() {
  const p = $('#h-proto').value, g = $('#h-grip').value, a = $('#h-arm').value;
  const m = lastHang(e => e.proto === p && e.grip === g && armOf(e) === a);
  if (m) { applyHang(m); hangPrefillNote(m); return; }
  hangPrefillNote(null);
  const d = PROTO_DEFAULTS[p]; if (!d) return;
  $('#h-hang').value = d.hang; $('#h-rest').value = d.rest; $('#h-reps').value = d.reps;
  const first = currentRows()[0] || { e: 20, l: 0 };
  setHangRows(Array(d.sets).fill(Number.isFinite(first.e) ? first.e : 20), Array(d.sets).fill(Number.isFinite(first.l) ? first.l : 0));
}
['#h-proto', '#h-grip', '#h-arm'].forEach(id => $(id).addEventListener('change', onHangCategoryChange));
$('#f-hang').addEventListener('input', () => { dirty.hang = true; });

$('#f-hang').addEventListener('submit', async ev => {
  ev.preventDefault();
  const err = $('#h-err'); err.textContent = '';
  const rows = currentRows();
  const hang = num('#h-hang');
  if (!rows.length) { err.textContent = t('e_sets'); return; }
  if (rows.some(r => !Number.isFinite(r.e) || r.e <= 0)) { err.textContent = t('e_edge'); return; }
  if (!hang || hang <= 0) { err.textContent = t('e_hang'); return; }
  const edges = rows.map(r => r.e), loads = rows.map(r => (Number.isFinite(r.l) ? r.l : 0));
  const entry = {
    id: newId(), type: 'hang', ts: dateToTs($('#h-date').value),
    proto: $('#h-proto').value, grip: $('#h-grip').value, arm: $('#h-arm').value,
    edges, loads, sets: edges.length,
    edge: Math.round(avg(edges) * 10) / 10, load: Math.round(avg(loads) * 10) / 10,
    hang, rest: num('#h-rest') || 0, reps: Math.max(1, Math.round(num('#h-reps') || 1)),
    bw: num('#h-bw'), rpe: num('#h-rpe'), note: $('#h-note').value.trim()
  };
  if (await saveEntry(entry, err)) { $('#h-note').value = ''; $('#h-rpe').value = ''; hangPrefillNote(null); }
});

/* ---------- strength form ---------- */
function addSetRow(r = '', kg = '') {
  const wrap = $('#k-sets');
  const prev = wrap.lastElementChild;
  if (prev && r === '' && kg === '') { r = prev.querySelector('.r').value; kg = prev.querySelector('.kg').value; }
  rowCounter++;
  const row = document.createElement('div');
  row.className = 'setrow';
  row.innerHTML = `<span class="n"></span>
    <input class="r" id="k-r-${rowCounter}" type="number" inputmode="numeric" min="0" step="1" aria-label="${esc(t('reps_short'))}" value="${esc(r)}">
    <input class="kg" id="k-kg-${rowCounter}" type="number" inputmode="decimal" step="0.5" placeholder="0" aria-label="${esc(t('addkg'))}" value="${esc(kg)}">
    <button type="button" class="x" aria-label="−">×</button>`;
  row.querySelector('.x').addEventListener('click', () => { row.remove(); numberRows(wrap); dirty.kraft = true; });
  wrap.appendChild(row); numberRows(wrap);
}
function setKraftSets(sets) { $('#k-sets').innerHTML = ''; sets.forEach(s => addSetRow(String(s.r), s.kg ? String(s.kg) : '')); }
$('#k-add').addEventListener('click', () => { addSetRow(); dirty.kraft = true; });
$('#f-kraft').addEventListener('input', () => { dirty.kraft = true; });

const normEx = s => String(s || '').trim().toLowerCase();
function lastKraft(ex) { return sorted().find(e => e.type === 'kraft' && (ex == null || normEx(e.ex) === normEx(ex))); }
let kraftNoteEntry = null;
function kraftPrefillNote(e) { kraftNoteEntry = e; $('#k-prefill').textContent = e ? t('pf_kraft', { date: shortDate(e.ts) }) : ''; }
$('#k-ex').addEventListener('change', () => {
  const m = lastKraft($('#k-ex').value);
  if (m) { setKraftSets(m.sets); if (m.bw) $('#k-bw').value = m.bw; }
  kraftPrefillNote(m || null);
});
function fillExList() {
  const used = [...new Set(sorted().filter(e => e.type === 'kraft').map(e => e.ex))];
  const all = [...used, ...BASE_EX[S.lang].filter(x => !used.some(u => normEx(u) === normEx(x)))];
  $('#exlist').innerHTML = all.map(x => `<option value="${esc(x)}"></option>`).join('');
}
$('#f-kraft').addEventListener('submit', async ev => {
  ev.preventDefault();
  const err = $('#k-err'); err.textContent = '';
  const ex = $('#k-ex').value.trim();
  if (!ex) { err.textContent = t('e_ex'); return; }
  const sets = $$('#k-sets .setrow').map(row => ({
    r: parseFloat(row.querySelector('.r').value), kg: parseFloat(row.querySelector('.kg').value) || 0
  })).filter(s => Number.isFinite(s.r) && s.r > 0).map(s => ({ r: Math.round(s.r), kg: s.kg }));
  if (!sets.length) { err.textContent = t('e_kset'); return; }
  const entry = { id: newId(), type: 'kraft', ts: dateToTs($('#k-date').value), ex, sets, bw: num('#k-bw'), note: $('#k-note').value.trim() };
  if (await saveEntry(entry, err)) { $('#k-note').value = ''; kraftPrefillNote(null); }
});

/* ---------- ascents form ---------- */
const asc = { kind: 'boulder', env: 'rock', att: null };
function lastAscent(kind, env) { return sorted().find(e => e.type === 'ascent' && (!kind || e.kind === kind) && (!env || e.env === env)); }
/* Rebuilds the grade list for the current kind/env; `pick` is the stored grade of an entry to preselect. */
function buildGradeSelect(pick) {
  const sc = catScale(asc.kind, asc.env);
  let want = null;
  const src = pick || lastAscent(asc.kind, asc.env);
  if (src) want = sc.value(src);
  if (want == null) want = sc.numeric ? Math.round((S.gym[asc.kind].min + S.gym[asc.kind].max) / 2) : sc.value({ diff: (asc.kind === 'boulder' ? FONT : FR).indexOf(asc.kind === 'boulder' ? '6A' : '6a') });
  $('#a-grade').innerHTML = sc.options.map(o => `<option value="${o.v}"${o.v === want ? ' selected' : ''}>${esc(o.label)}</option>`).join('');
  $('#a-scale').textContent = sc.title;
}
function setAsc(kind, env, pick) {
  asc.kind = kind; asc.env = env;
  $$('[data-ak]').forEach(b => b.setAttribute('aria-pressed', b.dataset.ak === kind));
  $$('[data-env]').forEach(b => b.setAttribute('aria-pressed', b.dataset.env === env));
  $('#a-area-l').dataset.i = env === 'gym' ? 'gymname' : 'area';
  $('#a-area-l').textContent = t($('#a-area-l').dataset.i);
  $('#a-area').dataset.iph = env === 'gym' ? 'ph_gym' : 'ph_area';
  $('#a-area').placeholder = t($('#a-area').dataset.iph);
  buildGradeSelect(pick);
  fillAreaList();
}
function ascPlaceDefault() {
  const last = lastAscent(asc.kind, asc.env);
  if (last && last.area) return last.area;
  return asc.env === 'gym' ? (S.gym[asc.kind].name || '') : '';
}
$$('[data-ak]').forEach(b => b.addEventListener('click', () => { setAsc(b.dataset.ak, asc.env); $('#a-area').value = ascPlaceDefault(); dirty.ascent = true; }));
$$('[data-env]').forEach(b => b.addEventListener('click', () => { setAsc(asc.kind, b.dataset.env); $('#a-area').value = ascPlaceDefault(); dirty.ascent = true; }));
$('#f-asc').addEventListener('input', () => { dirty.ascent = true; });

/* Flash and attempts stay consistent: flash = 1 attempt, 2+ attempts = no flash. */
function setAttempts(n) {
  asc.att = n;
  $('#a-att').textContent = n == null ? '–' : String(n);
  $('#a-flash').checked = n === 1;
}
$('#a-plus').addEventListener('click', () => { setAttempts(asc.att == null ? 1 : Math.min(999, asc.att + 1)); dirty.ascent = true; });
$('#a-minus').addEventListener('click', () => { if (asc.att == null) return; setAttempts(asc.att <= 1 ? null : asc.att - 1); dirty.ascent = true; });
$('#a-flash').addEventListener('change', () => { setAttempts($('#a-flash').checked ? 1 : null); });

function fillAreaList() {
  const areas = [...new Set(sorted().filter(e => e.type === 'ascent' && e.env === asc.env && e.area).map(e => e.area))];
  if (asc.env === 'gym') ['boulder', 'route'].forEach(k => { const n = S.gym[k].name; if (n && !areas.includes(n)) areas.push(n); });
  $('#arealist').innerHTML = areas.map(a => `<option value="${esc(a)}"></option>`).join('');
}
function applyAscent(e, withName) {
  setAsc(e.kind, e.env || 'rock', e);
  $('#a-area').value = e.area || '';
  if (withName) $('#a-name').value = e.name || '';
}
$('#f-asc').addEventListener('submit', async ev => {
  ev.preventDefault();
  const err = $('#a-err'); err.textContent = '';
  const sc = catScale(asc.kind, asc.env);
  const v = parseInt($('#a-grade').value, 10);
  if (!Number.isFinite(v)) { err.textContent = t('e_grade'); return; }
  const entry = {
    id: newId(), type: 'ascent', ts: dateToTs($('#a-date').value), kind: asc.kind, env: asc.env,
    flash: $('#a-flash').checked, name: $('#a-name').value.trim(), area: $('#a-area').value.trim(), note: $('#a-note').value.trim()
  };
  if (sc.numeric) { entry.gnum = v; entry.gym = 'g1'; entry.grade = String(v); }
  else { entry.diff = sc.toDiff(v); entry.grade = (asc.kind === 'boulder' ? FONT : FR)[entry.diff]; }
  if (asc.att != null) entry.attempts = asc.att;
  if (await saveEntry(entry, err)) {
    $('#a-name').value = ''; $('#a-note').value = ''; setAttempts(null); $('#a-prefill').textContent = '';
  }
});

/* ---------- session form (climbing and other sessions) ---------- */
function fillSessTypes() {
  const cur = $('#ss-type').value;
  $('#ss-type').innerHTML = allTypes().filter(x => !['hang', 'kraft', 'rest'].includes(x.id))
    .map(x => `<option value="${esc(x.id)}">${esc(typeName(x.id))}</option>`).join('');
  if (cur && allTypes().some(x => x.id === cur)) $('#ss-type').value = cur;
}
$('#f-sess').addEventListener('submit', async ev => {
  ev.preventDefault();
  const err = $('#ss-err'); err.textContent = '';
  const stype = $('#ss-type').value;
  if (!stype) { err.textContent = t('e_stype'); return; }
  const entry = {
    id: newId(), type: 'session', ts: dateToTs($('#ss-date').value), stype,
    dur: num('#ss-dur'), rpe: num('#ss-rpe'), desc: $('#ss-desc').value.trim(), note: $('#ss-note').value.trim()
  };
  if (await saveEntry(entry, err)) { ['#ss-dur', '#ss-rpe', '#ss-desc', '#ss-note'].forEach(id => { $(id).value = ''; }); }
});

/* ---------- prefill ---------- */
let ascNoteEntry = null;
function initialPrefill() {
  if (state.prefilled) return;
  state.prefilled = true;
  const h = lastHang(() => true);
  if (h && !dirty.hang) { applyHangFull(h); hangPrefillNote(h); }
  const k = lastKraft(null);
  if (k && !dirty.kraft) { $('#k-ex').value = k.ex; setKraftSets(k.sets); if (k.bw) $('#k-bw').value = k.bw; kraftPrefillNote(k); }
  const a = lastAscent();
  if (a && !dirty.ascent) { applyAscent(a); ascNoteEntry = a; $('#a-prefill').textContent = t('pf_asc', { date: shortDate(a.ts) }); }
}
function prefill(e) {
  resetDates();
  state.planLink = null;
  if (e.type === 'hang') { applyHangFull(e); hangPrefillNote(e); setLogType('hang'); }
  else if (e.type === 'ascent') { applyAscent(e, true); setAttempts(null); $('#a-prefill').textContent = ''; setLogType('ascent'); }
  else if (e.type === 'session') { fillSessTypes(); $('#ss-type').value = e.stype; $('#ss-dur').value = e.dur || ''; $('#ss-desc').value = e.desc || ''; setLogType('session'); }
  else { $('#k-ex').value = e.ex; setKraftSets(e.sets); if (e.bw) $('#k-bw').value = e.bw; kraftPrefillNote(e); setLogType('kraft'); }
  showTab('log');
  toast(t('prefilled_toast'));
}

/* ---------- descriptions ---------- */
const signed = l => (l > 0 ? '+' + fmt(l) : l < 0 ? '−' + fmt(-l) : '0');
function loadStr(e) {
  const ls = loadsOf(e), a = avg(ls);
  let s = ls.every(x => x === ls[0]) ? (ls[0] ? signed(ls[0]) + ' kg' : t('bwonly')) : ls.map(signed).join('/') + ' kg';
  if (e.bw) s += ' (' + fmt((e.bw + a) / e.bw * 100, 0) + ' ' + t('pctbw') + ')';
  return s;
}
function edgeStr(e) {
  const ed = edgesOf(e);
  if (ed.every(x => x === ed[0])) return fmt(ed[0], 1) + ' mm';
  return ed.map(x => fmt(x, 1)).join('/') + ' mm (Ø ' + fmt(avg(ed), 1) + ')';
}
const gripLabel = e => nameOf(GRIPS, e.grip) + (armOf(e) === '1' ? ' · ' + t('one').toLowerCase() : '');
const attStr = n => (n === 1 ? t('att_1') : t('att_n', { n }));
const hangTiming = e => (e.reps > 1 ? `${fmt(e.hang, 0)} s / ${fmt(e.rest, 0)} s` : `${fmt(e.hang, 0)} s`);
const setsStr = sets => (sets || []).map(s => s.kg ? `${s.r} × ${fmt(s.kg)} kg` : `${s.r} ${t('u_reps')}`).join(' · ');
function describe(e) {
  if (e.type === 'ascent') {
    const g = gradeText(e);
    return {
      t: `${e.name || t(e.kind)} · ${g}${e.flash ? ' · ' + t('flash') : ''}`,
      d: [t(e.kind) + ' ' + g, t(e.env === 'gym' ? 'gym' : 'rock'), e.flash ? t('flash') : (e.attempts ? attStr(e.attempts) : ''), e.area].filter(Boolean).join(' · ')
    };
  }
  if (e.type === 'hang') {
    return { t: `${gripLabel(e)} · ${edgeStr(e)}`, d: `${nameOf(PROTOS, e.proto)} · ${edgesOf(e).length} × ${e.reps} · ${hangTiming(e)} · ${loadStr(e)}${e.rpe ? ' · RPE ' + e.rpe : ''}` };
  }
  if (e.type === 'session') {
    const day = dateKey(e.ts);
    const n = state.entries.filter(x => x.type === 'ascent' && dateKey(x.ts) === day).length;
    return {
      t: typeName(e.stype) + (e.dur ? ` · ${fmt(e.dur, 0)} ${t('min')}` : ''),
      d: [e.desc, e.rpe ? 'RPE ' + e.rpe : '', n ? (n === 1 ? t('asc_same_day_1') : t('asc_same_day', { n })) : ''].filter(Boolean).join(' · ')
    };
  }
  return { t: e.ex, d: setsStr(e.sets) };
}

/* ---------- history ---------- */
$$('[data-hf]').forEach(b => b.addEventListener('click', () => {
  state.histFilter = b.dataset.hf;
  $$('[data-hf]').forEach(x => x.setAttribute('aria-pressed', x === b));
  renderHist();
}));
function renderStats() {
  const days = new Set(state.entries.map(e => dateKey(e.ts)));
  const now = new Date(); const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const d30 = Date.now() - 30 * 864e5;
  let w = 0, m = 0;
  days.forEach(k => { const ts = new Date(k + 'T12:00:00').getTime(); if (ts >= monday.getTime()) w++; if (ts >= d30) m++; });
  $('#s-week').textContent = w; $('#s-30').textContent = m; $('#s-total').textContent = state.entries.length;
}
function renderHist() {
  renderStats();
  const list = sorted().filter(e => state.histFilter === 'all' || e.type === state.histFilter);
  const box = $('#hist');
  if (!list.length) {
    box.innerHTML = `<div class="card">${emptyBox(t('empty_hist_t'), t('empty_hist'))}</div>`;
    return;
  }
  const groups = [];
  list.forEach(e => { const k = dateKey(e.ts); const g = groups[groups.length - 1]; if (g && g.k === k) g.items.push(e); else groups.push({ k, items: [e] }); });
  box.innerHTML = groups.map(g => `<div class="day"><h3>${esc(new Date(g.k + 'T12:00:00').toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</h3>
    ${g.items.map(e => { const x = describe(e); return `<div class="entry ${e.type}"><span class="tag"></span><div>
      <div class="t">${esc(x.t)}</div><div class="d">${esc(x.d)}</div>${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}
      <div class="acts"><button type="button" data-again="${esc(e.id)}">${esc(t('again'))}</button>${e.type !== 'ascent' ? `<button type="button" data-toplan="${esc(e.id)}">${esc(t('to_plan'))}</button>` : ''}<button type="button" data-del="${esc(e.id)}">${esc(t('del'))}</button></div>
    </div></div>`; }).join('')}</div>`).join('');
}
$('#hist').addEventListener('click', async ev => {
  const again = ev.target.closest('[data-again]'), del = ev.target.closest('[data-del]'), toplan = ev.target.closest('[data-toplan]');
  if (again) { const e = state.entries.find(x => x.id === again.dataset.again); if (e) prefill(e); }
  if (toplan) openPlanFromEntry(toplan.dataset.toplan);
  if (del) {
    if (!del.classList.contains('armed')) {
      del.classList.add('armed'); del.textContent = t('del_sure');
      setTimeout(() => { del.classList.remove('armed'); del.textContent = t('del'); }, 3500);
      return;
    }
    try { await removeRecord(del.dataset.del); toast(t('deleted')); } catch (e) { toast(t('del_fail')); }
  }
});

/* ---------- backup ---------- */
const LAST_KEY = NS + '.lastBackup';
const exportJSON = () => JSON.stringify({ app: 'griffbuch', version: 3, exported: new Date().toISOString(), bw: S.bw, entries: sorted(), plan: P });
function showLastBackup() {
  let ts = null; try { ts = localStorage.getItem(LAST_KEY); } catch (e) { }
  $('#x-last').textContent = ts ? t('last_backup', { date: new Date(+ts).toLocaleDateString(locale()) }) : '';
}
$('#x-save').addEventListener('click', async () => {
  if (!state.entries.length && !P.blocks.length) { toast(t('b_none')); return; }
  const name = (IS_TEST ? 'griffbuch-test-backup-' : 'griffbuch-backup-') + todayStr() + '.json';
  const blob = new Blob([exportJSON()], { type: 'application/json' });
  const done = () => { try { localStorage.setItem(LAST_KEY, String(Date.now())); } catch (e) { } showLastBackup(); };
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Griffbuch' });
      done(); return;
    }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  done(); toast(t('b_saved'));
});
/* Adds plan parts from a backup that are not here yet (matched by id). */
function mergePlan(p) {
  if (!p || typeof p !== 'object') return false;
  let changed = false;
  ['blocks', 'templates', 'types'].forEach(k => {
    (Array.isArray(p[k]) ? p[k] : []).forEach(x => { if (x && x.id && !P[k].some(y => y.id === x.id)) { P[k].push(x); changed = true; } });
  });
  (Array.isArray(p.done) ? p.done : []).forEach(d => {
    if (d && !P.done.some(x => x.date === d.date && x.sid === d.sid && x.iid === d.iid)) { P.done.push(d); changed = true; }
  });
  if (changed) savePlan();
  return changed;
}
async function importText(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { toast(t('b_bad')); return; }
  const list = Array.isArray(data) ? data : data && Array.isArray(data.entries) ? data.entries : null;
  if (!list) { toast(t('b_bad')); return; }
  const have = new Set(state.entries.map(e => e.id));
  const fresh = list.filter(e => e && e.id && ['hang', 'kraft', 'ascent', 'session'].includes(e.type) && Number.isFinite(e.ts) && !have.has(e.id)).map(migrate);
  state.entries = [...fresh, ...state.entries];
  if (data.bw && !S.bw) { S.bw = data.bw; saveSettings(); fillBw(); }
  if (!persist()) { state.entries = state.entries.filter(e => !fresh.includes(e)); toast(t('quota')); return; }
  const planChanged = mergePlan(data.plan);
  toast(fresh.length ? t('b_imported', { n: fresh.length }) : planChanged ? t('b_plan_imported') : t('b_dupes'));
  state.prefilled = false; fillSessTypes(); render();
}
$('#x-import').addEventListener('click', () => $('#x-file').click());
$('#x-file').addEventListener('change', async ev => {
  const f = ev.target.files && ev.target.files[0]; if (!f) return;
  await importText(await f.text()); ev.target.value = '';
});
$('#x-paste').addEventListener('click', async () => {
  const txt = $('#x-text').value.trim(); if (!txt) { toast(t('b_paste_first')); return; }
  await importText(txt); $('#x-text').value = '';
});

/* ---------- settings view ---------- */
function typeInUse(id) {
  const inSessions = list => (list || []).some(s => s.type === id);
  return P.blocks.some(b => inSessions(b.sessions) || Object.values(b.overrides || {}).some(inSessions)) ||
    P.templates.some(x => x.type === id) || state.entries.some(e => e.type === 'session' && e.stype === id);
}
function renderSettings() {
  $$('[data-lang]').forEach(b => b.setAttribute('aria-pressed', b.dataset.lang === S.lang));
  $$('[data-scb]').forEach(b => b.setAttribute('aria-pressed', b.dataset.scb === S.scales.boulder));
  $$('[data-scr]').forEach(b => b.setAttribute('aria-pressed', b.dataset.scr === S.scales.route));
  if (document.activeElement !== $('#s-bw')) $('#s-bw').value = S.bw || '';
  [['b', 'boulder'], ['r', 'route']].forEach(([k, kind]) => {
    const g = S.gym[kind];
    $(`#s-g${k}-on`).checked = g.on;
    $(`#s-g${k}-range`).hidden = !g.on;
    if (document.activeElement !== $(`#s-g${k}-min`)) $(`#s-g${k}-min`).value = g.min;
    if (document.activeElement !== $(`#s-g${k}-max`)) $(`#s-g${k}-max`).value = g.max;
    if (document.activeElement !== $(`#s-g${k}-name`)) $(`#s-g${k}-name`).value = g.name || '';
  });
  $('#s-types').innerHTML = P.types.length
    ? P.types.map(x => `<div class="row"><span>${esc(x.name)}</span><button type="button" class="btn danger small" data-deltype="${esc(x.id)}">${esc(t('del'))}</button></div>`).join('')
    : hintP(t('s_types_none'));
  showLastBackup();
}
$('#s-types').addEventListener('click', ev => {
  const b = ev.target.closest('[data-deltype]'); if (!b) return;
  if (typeInUse(b.dataset.deltype)) { toast(t('s_type_used')); return; }
  P.types = P.types.filter(x => x.id !== b.dataset.deltype); savePlan(); fillSessTypes(); renderSettings();
});
function settingsChanged() {
  saveSettings();
  applyI18n();
  refreshLabels();
  setAsc(asc.kind, asc.env);
  render();
}
$$('[data-lang]').forEach(b => b.addEventListener('click', () => { S.lang = b.dataset.lang; settingsChanged(); }));
$$('[data-scb]').forEach(b => b.addEventListener('click', () => { S.scales.boulder = b.dataset.scb; settingsChanged(); }));
$$('[data-scr]').forEach(b => b.addEventListener('click', () => { S.scales.route = b.dataset.scr; settingsChanged(); }));
$('#s-bw').addEventListener('change', () => {
  const v = parseFloat($('#s-bw').value);
  S.bw = Number.isFinite(v) && v > 0 ? v : null; saveSettings(); persist(); fillBw(true);
});
[['b', 'boulder'], ['r', 'route']].forEach(([k, kind]) => {
  $(`#s-g${k}-on`).addEventListener('change', ev => { S.gym[kind].on = ev.target.checked; settingsChanged(); });
  const range = () => {
    const lo = parseInt($(`#s-g${k}-min`).value, 10), hi = parseInt($(`#s-g${k}-max`).value, 10);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo < 0 || hi <= lo || hi > 50) { toast(t('s_range_bad')); renderSettings(); return; }
    S.gym[kind].min = lo; S.gym[kind].max = hi; settingsChanged();
  };
  $(`#s-g${k}-min`).addEventListener('change', range);
  $(`#s-g${k}-max`).addEventListener('change', range);
  $(`#s-g${k}-name`).addEventListener('change', ev => { S.gym[kind].name = ev.target.value.trim(); saveSettings(); fillAreaList(); });
});

/* Texts built by script that must follow a language switch. */
function refreshLabels() {
  fillSelect('#h-proto', PROTOS);
  fillSelect('#h-grip', GRIPS);
  fillSessTypes();
  if (hangNoteEntry) hangPrefillNote(hangNoteEntry);
  if (kraftNoteEntry) kraftPrefillNote(kraftNoteEntry);
  if (ascNoteEntry && $('#a-prefill').textContent) $('#a-prefill').textContent = t('pf_asc', { date: shortDate(ascNoteEntry.ts) });
  renderPlanLink();
  if (!T.iv) idleDisplay(); else if (T.phases[T.idx]) startPhaseLabels();
  if (T.done) finishLabels();
  $('#tm-start').textContent = T.iv ? (T.paused ? t('tm_resume') : t('tm_pause')) : T.done ? t('tm_again') : t('tm_start');
  $('#testbadge').title = t('test_hint');
}

/* ---------- progress: shared chart ---------- */
const mval = (m, v) => m.tick ? m.tick(v) : fmt(v, m.d) + ' ' + m.unit;
const MAX_METRICS = 4;
const keyOf = e => e.type === 'hang' ? e.grip + '|' + armOf(e) : e.ex.trim();
const keyLabel = (type, k) => {
  if (type !== 'hang') return k;
  const [g, a] = k.split('|');
  return nameOf(GRIPS, g) + (a === '1' ? ' · ' + t('one').toLowerCase() : '');
};
function metricDefs(type) {
  if (type === 'hang') return {
    edge: { label: t('m_edge'), unit: 'mm', d: 1, lower: true },
    minedge: { label: t('m_minedge'), unit: 'mm', d: 1, lower: true },
    hangt: { label: t('m_hangt'), unit: 's', d: 0 },
    reps: { label: t('m_reps'), unit: t('u_reps'), d: 0 },
    sets: { label: t('m_sets'), unit: t('u_sets'), d: 0 },
    load: { label: t('m_load'), unit: 'kg', d: 1 },
    maxload: { label: t('m_maxload'), unit: 'kg', d: 1 },
    pct: { label: t('m_pct'), unit: '%', d: 0 },
    time: { label: t('m_time'), unit: 's', d: 0 },
    rpe: { label: t('m_rpe'), unit: 'RPE', d: 0, noBest: true }
  };
  return {
    kg: { label: t('m_kg'), unit: 'kg', d: 1 },
    avgkg: { label: t('m_avgkg'), unit: 'kg', d: 1 },
    reps: { label: t('m_kreps'), unit: t('u_reps'), d: 0 },
    avgreps: { label: t('m_avgreps'), unit: t('u_reps'), d: 1 },
    total: { label: t('m_total'), unit: t('u_reps'), d: 0 },
    sets: { label: t('m_sets'), unit: t('u_sets'), d: 0 },
    vol: { label: t('m_vol'), unit: 'kg', d: 0 }
  };
}
function metricValue(e, m) {
  if (e.type === 'hang') {
    const ed = edgesOf(e), ls = loadsOf(e);
    if (m === 'edge') return avg(ed);
    if (m === 'minedge') return Math.min(...ed);
    if (m === 'hangt') return e.hang;
    if (m === 'reps') return e.reps;
    if (m === 'sets') return ed.length;
    if (m === 'load') return avg(ls);
    if (m === 'maxload') return Math.max(...ls);
    if (m === 'pct') return e.bw ? (e.bw + avg(ls)) / e.bw * 100 : null;
    if (m === 'rpe') return e.rpe || null;
    return e.hang * e.reps * ed.length;
  }
  const s = e.sets;
  if (m === 'kg') return Math.max(...s.map(x => x.kg || 0));
  if (m === 'avgkg') return avg(s.map(x => x.kg || 0));
  if (m === 'reps') return Math.max(...s.map(x => x.r));
  if (m === 'avgreps') return avg(s.map(x => x.r));
  if (m === 'sets') return s.length;
  if (m === 'vol') return s.reduce((a, x) => a + x.r * (x.kg || 0), 0);
  return s.reduce((a, x) => a + x.r, 0);
}

function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw))); const f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; }
/* Four equal intervals per axis, so the grid lines of all axes line up. */
function axisScale(vals, int) {
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (int) {
    // whole-number ticks (grades, counts), never below zero
    const step = Math.max(1, Math.ceil((hi - lo) / 4));
    const a = Math.max(0, lo - Math.floor((4 * step - (hi - lo)) / 2));
    return { lo: a, hi: a + 4 * step, step };
  }
  if (lo === hi) { const p = Math.max(1, Math.abs(lo) * 0.1); lo -= p; hi += p; }
  let step = niceStep((hi - lo) / 4), a = Math.floor(lo / step) * step;
  while (a + 4 * step < hi - 1e-9) { step = niceStep(step * 1.5); a = Math.floor(lo / step) * step; }
  return { lo: a, hi: a + 4 * step, step };
}

/* series: [{color, metric, points:[{x,y}]}], all non-empty.
   Series with the same unit share one axis; axes alternate left/right. */
function chartSVG(series, opt = {}) {
  const W = 340, H = opt.h || 210, AX = 36, pt = 26, pb = 28;
  const multi = series.length > 1;
  const axes = [...new Set(series.map(s => s.metric.unit))].map(u => {
    const ss = series.filter(s => s.metric.unit === u);
    return { metric: ss[0].metric, color: ss.length === 1 ? ss[0].color : 'var(--ink)', sc: axisScale(ss.flatMap(s => s.points.map(p => p.y)), ss[0].metric.int) };
  });
  const axisOf = s => axes.find(a => a.metric.unit === s.metric.unit);
  const n = axes.length;
  const nl = Math.ceil(n / 2), nr = Math.floor(n / 2);
  const pl = 10 + AX * nl, pr = nr ? 10 + AX * nr : 16;
  const x0 = opt.x0, x1 = opt.x1;
  const sx = x => x1 === x0 ? pl + (W - pl - pr) / 2 : pl + (x - x0) / (x1 - x0) * (W - pl - pr);
  const yAt = (v, sc) => pt + (sc.hi - v) / (sc.hi - sc.lo) * (H - pt - pb);
  let g = '';
  for (let i = 0; i <= 4; i++) {
    const y = (pt + i / 4 * (H - pt - pb)).toFixed(1);
    g += `<line class="grid-l" x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}"/>`;
  }
  let body = '';
  axes.forEach((a, ai) => {
    const sc = a.sc, m = a.metric;
    const leftSide = ai % 2 === 0, level = Math.floor(ai / 2);
    const ax = leftSide ? pl - level * AX : W - pr + level * AX;
    const tx = leftSide ? ax - 5 : ax + 5, anchor = leftSide ? 'end' : 'start';
    const tstyle = n > 1 ? ` style="fill:${a.color}"` : '';
    if (n > 1) body += `<line x1="${ax}" x2="${ax}" y1="${pt}" y2="${H - pb}" style="stroke:${a.color};stroke-width:1.5"/>`;
    for (let i = 0; i <= 4; i++) {
      const v = sc.lo + i * sc.step;
      body += `<text x="${tx}" y="${(yAt(v, sc) + 4).toFixed(1)}" text-anchor="${anchor}"${tstyle}>${esc(m.tick ? m.tick(v) : fmt(v, sc.step < 1 ? 1 : 0))}</text>`;
    }
    body += `<text x="${tx}" y="${pt - 10}" text-anchor="${anchor}"${tstyle}>${esc(m.unit)}</text>`;
  });
  series.forEach(s => {
    const sc = axisOf(s).sc;
    const pts = s.points.map(p => [sx(p.x), yAt(p.y, sc)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    if (!multi && pts.length > 1) {
      const base = (H - pb).toFixed(1);
      body += `<path class="ar" style="fill:${s.color}" d="${line} L${pts[pts.length - 1][0].toFixed(1)} ${base} L${pts[0][0].toFixed(1)} ${base} Z"/>`;
    }
    body += `<path class="ln" style="stroke:${s.color}" d="${line}"/>`;
    body += pts.map((p, i) => `<circle class="pt" style="stroke:${s.color}${i === pts.length - 1 ? ';fill:' + s.color : ''}" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${i === pts.length - 1 ? 4.5 : 3.5}"/>`).join('');
    if (!multi) {
      const lp = pts[pts.length - 1];
      const a2 = lp[0] > W - 60 ? 'end' : 'middle';
      body += `<text class="val" x="${(a2 === 'end' ? Math.min(lp[0] + 4, W - 2) : lp[0]).toFixed(1)}" y="${Math.max(12, lp[1] - 10).toFixed(1)}" text-anchor="${a2}">${esc(mval(s.metric, s.points[s.points.length - 1].y))}</text>`;
    }
  });
  g += `<text x="${sx(x0).toFixed(1)}" y="${H - 8}" text-anchor="${x1 === x0 ? 'middle' : 'start'}">${esc(shortDate(x0))}</text>`;
  if (x1 !== x0) g += `<text x="${sx(x1).toFixed(1)}" y="${H - 8}" text-anchor="end">${esc(shortDate(x1))}</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map(s => s.metric.label).join(', '))}">${g}${body}</svg>`;
}
function chartsHTML(series, layout) {
  const xs = series.flatMap(s => s.points.map(p => p.x));
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (layout === 'together' || series.length === 1) return chartSVG(series, { x0, x1 });
  return series.map(s => `<div class="lbl" style="color:${s.color}">${esc(s.metric.label)}</div>${chartSVG([s], { x0, x1, h: 150 })}`).join('');
}
function metricChipsHTML(ms, sel, attr) {
  return Object.entries(ms).map(([k, v]) => {
    const i = sel.indexOf(k);
    const dot = i >= 0 ? `<span class="dot" style="background:${COLORS[i]};border-color:${COLORS[i]}"></span>` : '<span class="dot"></span>';
    return `<button type="button" class="chip" ${attr}="${k}" aria-pressed="${i >= 0}">${dot}${esc(v.label)}</button>`;
  }).join('');
}
function layoutSegHTML(n) {
  return n > 1 ? `<div class="seg" role="group">
      <button type="button" data-layout="together" aria-pressed="${state.progLayout === 'together'}">${esc(t('one_graph'))}</button>
      <button type="button" data-layout="stacked" aria-pressed="${state.progLayout === 'stacked'}">${esc(t('stacked'))}</button>
    </div>` : '';
}
function toggleMetric(type, k) {
  const cur = state.progMetrics[type];
  if (cur.includes(k)) state.progMetrics[type] = cur.filter(x => x !== k);
  else if (cur.length >= MAX_METRICS) { toast(t('max_metrics', { n: MAX_METRICS })); return; }
  else state.progMetrics[type] = [...cur, k];
  renderProg();
}

$$('[data-pt]').forEach(b => b.addEventListener('click', () => {
  state.progType = b.dataset.pt;
  $$('[data-pt]').forEach(x => x.setAttribute('aria-pressed', x === b));
  renderProg();
}));

/* ---------- progress: hangboard + strength ---------- */
function renderProg() {
  if (state.progType === 'ascent') return renderAscentProg();
  if (state.progType === 'plan') return renderPlanProg($('#prog-card'));
  const card = $('#prog-card');
  const type = state.progType;
  const ms = metricDefs(type);
  const typed = sorted().filter(e => e.type === type);
  if (!typed.length) {
    if (!state.entries.length) {
      const now = Date.now();
      const mk = arr => arr.map((y, i) => ({ x: now - (5 - i) * 7 * 864e5, y }));
      const hm = metricDefs('hang');
      const ex = [{ color: COLORS[0], metric: hm.edge, points: mk([22, 21, 20, 20, 18.5, 17]) }, { color: COLORS[1], metric: hm.hangt, points: mk([10, 10, 8, 10, 7, 8]) }];
      card.innerHTML = `<h2>${esc(t('prog'))}</h2><p style="margin:0;color:var(--muted)">${esc(t('empty_prog_intro'))}</p>
        <span class="example-badge">${esc(t('example_badge'))}</span><div class="example">${chartsHTML(ex, 'together')}</div>`;
    } else {
      card.innerHTML = `<h2>${esc(t('prog'))}</h2>${emptyBox(t('empty_type_t'), t('empty_type'))}`;
    }
    return;
  }
  const groups = {};
  typed.forEach(e => { const k = keyOf(e); (groups[k] = groups[k] || []).push(e); });
  const keys = Object.keys(groups);
  let cat = state.progCat[type];
  if (!cat || !groups[cat]) cat = keys[0];
  state.progCat[type] = cat;
  const sel = state.progMetrics[type].filter(k => ms[k]);
  state.progMetrics[type] = sel;
  const list = groups[cat].slice().sort((a, b) => a.ts - b.ts);

  const catChips = keys.map(k => `<button type="button" class="chip" data-cat="${esc(k)}" aria-pressed="${k === cat}">${esc(keyLabel(type, k))} <small>${groups[k].length}</small></button>`).join('');
  const series = sel.map((k, i) => ({
    key: k, metric: ms[k], color: COLORS[i],
    points: list.map(e => ({ x: e.ts, y: metricValue(e, k) })).filter(p => p.y != null && Number.isFinite(p.y))
  }));
  const drawn = series.filter(s => s.points.length);
  let body;
  if (!sel.length) body = emptyBox(t('no_metric_t'), t('no_metric'));
  else if (!drawn.length) body = emptyBox(t('no_data_t'), (sel.includes('pct') ? t('pct_need') : '') + t('pick_other'));
  else {
    const legend = series.map(s => {
      const m = s.metric;
      if (!s.points.length) return `<div class="lg"><i style="background:${s.color}"></i><div><b>${esc(m.label)}</b><span>${esc(t('novals') + (s.key === 'pct' ? t('bw_missing') : ''))}</span></div></div>`;
      const ys = s.points.map(p => p.y);
      const last = ys[ys.length - 1], diff = last - ys[0];
      const best = m.lower ? Math.min(...ys) : Math.max(...ys);
      const diffStr = (diff > 0 ? '+' : diff < 0 ? '−' : '±') + fmt(Math.abs(diff), m.d);
      return `<div class="lg"><i style="background:${s.color}"></i><div><b>${esc(m.label)}</b><span>${esc(t('last'))} ${esc(mval(m, last))}${m.noBest ? '' : ' · ' + esc(t('best')) + ' ' + esc(fmt(best, m.d))} · ${esc(diffStr)} ${esc(t('since', { date: shortDate(s.points[0].x) }))}</span></div></div>`;
    }).join('');
    const rows = list.slice().reverse().slice(0, 12).map(e => `<tr><td>${esc(shortDate(e.ts))}</td>${series.map(s => { const v = metricValue(e, s.key); return `<td>${v == null || !Number.isFinite(v) ? '–' : esc(fmt(v, s.metric.d))}</td>`; }).join('')}</tr>`).join('');
    const table = `<div class="tbl"><table><thead><tr><th>${esc(t('date_col'))}</th>${series.map(s => `<th><i style="background:${s.color}"></i>${esc(s.metric.label)} (${esc(s.metric.unit)})</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
    const single = drawn.every(s => s.points.length === 1);
    body = `${layoutSegHTML(drawn.length)}${chartsHTML(drawn, state.progLayout)}<div class="legend">${legend}</div>
      ${sel.some(k => ms[k].lower) ? hintP(t('lower_hint')) : ''}${single ? hintP(t('second_point')) : ''}
      <div class="lbl">${esc(t('recent'))}</div>${table}`;
  }
  card.innerHTML = `<h2>${esc(t('prog'))}</h2>
    <div class="lbl">${esc(t(type === 'hang' ? 'p_grip' : 'p_ex'))}</div><div class="chips">${catChips}</div>
    <div class="lbl">${esc(t('p_values', { n: MAX_METRICS }))}</div><div class="chips">${metricChipsHTML(ms, sel, 'data-metric')}</div>${body}`;
  $$('[data-cat]', card).forEach(b => b.addEventListener('click', () => { state.progCat[type] = b.dataset.cat; renderProg(); }));
  $$('[data-metric]', card).forEach(b => b.addEventListener('click', () => toggleMetric(type, b.dataset.metric)));
  $$('[data-layout]', card).forEach(b => b.addEventListener('click', () => { state.progLayout = b.dataset.layout; renderProg(); }));
}

/* ---------- progress: ascents ---------- */
function ascentMetrics(sc) {
  return {
    grade: { label: t('m_grade'), unit: t('u_grade'), d: 0, int: true, tick: sc.label },
    flash: { label: t('m_flash'), unit: t('u_grade'), d: 0, int: true, tick: sc.label },
    att: { label: t('m_att'), unit: t('u_att'), d: 1, lower: true },
    count: { label: t('m_count'), unit: t('u_asc'), d: 0, int: true },
    total: { label: t('m_atotal'), unit: t('u_asc'), d: 0, int: true, noBest: true }
  };
}
/* Vertical bars per grade; flashes are the lower, highlighted part of each bar. */
function pyramidSVG(sc, list) {
  const c = {};
  list.forEach(e => {
    const i = sc.value(e); if (i == null || i < 0) return;
    c[i] = c[i] || { all: 0, flash: 0 }; c[i].all++; if (e.flash) c[i].flash++;
  });
  const idx = Object.keys(c).map(Number);
  if (!idx.length) return '';
  const lo = Math.min(...idx), hi = Math.max(...idx);
  const bins = [];
  for (let i = lo; i <= hi; i++) if (sc.numeric || sc.label(i)) bins.push(i);
  const n = bins.length;
  const bw = 24, pl = 34, pr = 10, pt = 20, pb = 30, H = 230;
  const W = Math.max(340, pl + pr + n * 36);
  const slot = (W - pl - pr) / n;
  const step = Math.max(1, Math.ceil(Math.max(...idx.map(i => c[i].all)) / 4)), top = step * 4;
  const yAt = v => pt + (top - v) / top * (H - pt - pb);
  let s = '';
  for (let i = 0; i <= 4; i++) {
    const y = yAt(i * step).toFixed(1);
    s += `<line class="grid-l" x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}"/><text x="${pl - 6}" y="${(+y + 4).toFixed(1)}" text-anchor="end">${i * step}</text>`;
  }
  bins.forEach((gi, k) => {
    const d = c[gi] || { all: 0, flash: 0 };
    const cx = pl + slot * k + slot / 2, x = (cx - bw / 2).toFixed(1);
    if (d.all) {
      const yAll = yAt(d.all), yFl = yAt(d.flash), base = yAt(0);
      if (d.all > d.flash) s += `<rect x="${x}" y="${yAll.toFixed(1)}" width="${bw}" height="${(yFl - yAll).toFixed(1)}" style="fill:var(--c1)"/>`;
      if (d.flash) s += `<rect x="${x}" y="${yFl.toFixed(1)}" width="${bw}" height="${(base - yFl).toFixed(1)}" style="fill:var(--c2)"/>`;
      s += `<text class="val" x="${cx.toFixed(1)}" y="${(yAll - 5).toFixed(1)}" text-anchor="middle">${d.all}</text>`;
    }
    s += `<text x="${cx.toFixed(1)}" y="${H - 10}" text-anchor="middle">${esc(sc.label(gi))}</text>`;
  });
  const minW = W > 340 ? ` style="min-width:${W}px"` : '';
  return `<div class="tbl"><svg class="chart" viewBox="0 0 ${W} ${H}"${minW} role="img" aria-label="${esc(t('pyramid'))}">${s}</svg></div>`;
}
const ASC_CATS = [['boulder', 'rock'], ['boulder', 'gym'], ['route', 'rock'], ['route', 'gym']];
function renderAscentProg() {
  const card = $('#prog-card');
  const all = sorted().filter(e => e.type === 'ascent');
  if (!all.length) { card.innerHTML = `<h2>${esc(t('prog'))}</h2>${emptyBox(t('empty_asc_t'), t('empty_asc'))}`; return; }
  const counts = {};
  all.forEach(e => { const k = e.kind + '|' + e.env; counts[k] = (counts[k] || 0) + 1; });
  let cat = state.progCat.ascent;
  if (!cat || !counts[cat]) cat = all[0].kind + '|' + all[0].env;
  state.progCat.ascent = cat;
  const [kind, env] = cat.split('|');
  const sc = catScale(kind, env);
  const ms = ascentMetrics(sc);
  const sel = state.progMetrics.ascent.filter(k => ms[k]);
  const listAll = all.filter(e => e.kind === kind && e.env === env).sort((a, b) => a.ts - b.ts);
  const list = listAll.filter(e => sc.value(e) != null);
  const hidden = listAll.length - list.length;

  // one point per climbing day
  const days = [];
  list.forEach(e => { const k = dateKey(e.ts), d = days[days.length - 1]; if (d && d.k === k) d.items.push(e); else days.push({ k, x: new Date(k + 'T12:00:00').getTime(), items: [e] }); });
  let run = 0;
  days.forEach(d => {
    const gi = d.items.map(sc.value);
    const fi = d.items.filter(e => e.flash).map(sc.value);
    const at = d.items.filter(e => e.attempts).map(e => e.attempts);
    run += d.items.length;
    d.v = { grade: Math.max(...gi), flash: fi.length ? Math.max(...fi) : null, att: at.length ? avg(at) : null, count: d.items.length, total: run };
  });
  const series = sel.map((k, i) => ({ key: k, metric: ms[k], color: COLORS[i], points: days.filter(d => d.v[k] != null).map(d => ({ x: d.x, y: d.v[k] })) }));
  const drawn = series.filter(s => s.points.length);

  const catChips = ASC_CATS.filter(([k, e]) => counts[k + '|' + e]).map(([k, e]) => `<button type="button" class="chip" data-acat="${k}|${e}" aria-pressed="${k + '|' + e === cat}">${esc(t(k))} · ${esc(t(e))} <small>${counts[k + '|' + e]}</small></button>`).join('');
  let chart;
  if (!sel.length) chart = emptyBox(t('no_metric_t'), t('no_metric'));
  else if (!drawn.length) chart = emptyBox(t('no_data_t'), t('no_flash_yet'));
  else {
    const legend = series.map(s => {
      const m = s.metric;
      if (!s.points.length) return `<div class="lg"><i style="background:${s.color}"></i><div><b>${esc(m.label)}</b><span>${esc(t('novals'))}</span></div></div>`;
      const ys = s.points.map(p => p.y), last = ys[ys.length - 1];
      const best = m.lower ? Math.min(...ys) : Math.max(...ys);
      return `<div class="lg"><i style="background:${s.color}"></i><div><b>${esc(m.label)}</b><span>${esc(t('last'))} ${esc(mval(m, last))}${m.noBest ? '' : ' · ' + esc(t('best')) + ' ' + esc(mval(m, best))} · ${esc(t('since', { date: shortDate(s.points[0].x) }))}</span></div></div>`;
    }).join('');
    chart = `${layoutSegHTML(drawn.length)}${chartsHTML(drawn, state.progLayout)}<div class="legend">${legend}</div>${sel.includes('att') ? hintP(t('att_lower_hint')) : ''}`;
  }

  const per = state.pyrPeriod;
  const from = per === '12m' ? Date.now() - 365 * 864e5 : per === 'year' ? new Date(new Date().getFullYear(), 0, 1).getTime() : 0;
  const inPer = list.filter(e => e.ts >= from);
  const nFlash = inPer.filter(e => e.flash).length;
  const perChips = [['all', 'per_all'], ['12m', 'per_12'], ['year', 'per_year']].map(([k, l]) => `<button type="button" class="chip" data-per="${k}" aria-pressed="${k === per}">${esc(t(l))}</button>`).join('');
  const pyr = inPer.length
    ? `${hintP(t('pyr_count', { n: inPer.length, f: nFlash }))}${pyramidSVG(sc, inPer)}
       <div class="swatches"><span><i style="background:var(--c2)"></i>${esc(t('flash'))}</span><span><i style="background:var(--c1)"></i>${esc(t('not_flashed'))}</span></div>`
    : emptyBox(t('no_asc_period'));

  card.innerHTML = `<h2>${esc(t('prog'))}</h2>
    <div class="lbl">${esc(t('p_type'))}</div><div class="chips">${catChips}</div>
    ${hintP(sc.title)}${hidden ? hintP(t('other_scale', { n: hidden })) : ''}
    <div class="lbl">${esc(t('p_values_asc'))}</div><div class="chips">${metricChipsHTML(ms, sel, 'data-ametric')}</div>${chart}
    <h2 style="margin-top:10px">${esc(t('pyramid'))}</h2><div class="chips">${perChips}</div>${pyr}`;
  $$('[data-acat]', card).forEach(b => b.addEventListener('click', () => { state.progCat.ascent = b.dataset.acat; renderProg(); }));
  $$('[data-ametric]', card).forEach(b => b.addEventListener('click', () => toggleMetric('ascent', b.dataset.ametric)));
  $$('[data-layout]', card).forEach(b => b.addEventListener('click', () => { state.progLayout = b.dataset.layout; renderProg(); }));
  $$('[data-per]', card).forEach(b => b.addEventListener('click', () => { state.pyrPeriod = b.dataset.per; renderProg(); }));
}

function render() {
  fillExList();
  fillAreaList();
  initialPrefill();
  if (state.tab === 'log') renderToday();
  if (state.tab === 'hist') renderHist();
  if (state.tab === 'prog') renderProg();
  if (state.tab === 'settings') renderSettings();
  if (state.tab === 'plan') renderPlan();
}

/* ---------- timer ---------- */
const PRESETS = { rep: { hang: 7, rest: 3, reps: 6, sets: 3, setrest: 180 }, max: { hang: 10, rest: 0, reps: 1, sets: 5, setrest: 180 }, long: { hang: 30, rest: 0, reps: 1, sets: 3, setrest: 120 } };
$$('#tm-presets .chip').forEach(b => b.addEventListener('click', () => {
  const p = PRESETS[b.dataset.p];
  $('#t-hang').value = p.hang; $('#t-rest').value = p.rest; $('#t-reps').value = p.reps; $('#t-sets').value = p.sets; $('#t-setrest').value = p.setrest;
  $$('#tm-presets .chip').forEach(x => x.setAttribute('aria-pressed', x === b));
  idleDisplay();
}));
['#t-hang', '#t-rest', '#t-reps', '#t-sets', '#t-setrest', '#t-prep'].forEach(id => $(id).addEventListener('input', () => {
  $$('#tm-presets .chip').forEach(x => x.setAttribute('aria-pressed', 'false')); idleDisplay();
}));

const T = { phases: [], idx: 0, end: 0, left: 0, iv: null, paused: false, lastBeep: null, cfg: null, done: false };
let actx = null, wake = null;
const PHASE_KEY = { prep: 'tm_prep', hang: 'tm_hang', rest: 'tm_rest', setrest: 'tm_setrest' };

function tcfg() {
  const g = (id, d, min) => { const v = parseFloat($(id).value); return Number.isFinite(v) && v >= min ? Math.round(v) : d; };
  return { hang: g('#t-hang', 7, 1), rest: g('#t-rest', 3, 0), reps: g('#t-reps', 6, 1), sets: g('#t-sets', 3, 1), setrest: g('#t-setrest', 180, 0), prep: g('#t-prep', 5, 0) };
}
function buildPhases(c) {
  const ph = [];
  if (c.prep) ph.push({ k: 'prep', d: c.prep, s: 1, r: 1 });
  for (let s = 1; s <= c.sets; s++) {
    for (let r = 1; r <= c.reps; r++) {
      ph.push({ k: 'hang', d: c.hang, s, r });
      if (r < c.reps && c.rest) ph.push({ k: 'rest', d: c.rest, s, r });
    }
    if (s < c.sets && c.setrest) ph.push({ k: 'setrest', d: c.setrest, s: s + 1, r: 1 });
  }
  return ph;
}
function idleDisplay() {
  if (T.iv || T.done) return;
  const c = tcfg();
  $('#tm').dataset.phase = 'idle'; $('#tm-phase').textContent = t('tm_ready');
  $('#tm-big').textContent = c.hang;
  $('#tm-sub').textContent = t('tm_sub_idle', { s: c.sets, r: c.reps });
  $('#tm-bar').style.width = '0';
}
function beep(freq, dur) {
  if (!actx) return;
  try {
    const o = actx.createOscillator(), g = actx.createGain(), now = actx.currentTime;
    o.frequency.value = freq; o.connect(g); g.connect(actx.destination);
    g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.35, now + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.start(now); o.stop(now + dur + 0.03);
  } catch (e) { }
}
const totalDur = () => T.phases.reduce((a, p) => a + p.d, 0);
function startPhaseLabels() {
  const p = T.phases[T.idx];
  $('#tm').dataset.phase = p.k; $('#tm-phase').textContent = t(PHASE_KEY[p.k]);
  $('#tm-sub').textContent = t('tm_sub', { s: p.s, S: T.cfg.sets, r: p.r, R: T.cfg.reps });
}
function startPhase() {
  T.end = performance.now() + T.phases[T.idx].d * 1000; T.lastBeep = null;
  startPhaseLabels();
}
function tick() {
  if (T.paused) return;
  const p = T.phases[T.idx];
  const left = T.end - performance.now();
  const sec = Math.max(0, Math.ceil(left / 1000));
  $('#tm-big').textContent = sec;
  if (sec <= 3 && sec > 0 && T.lastBeep !== sec) { T.lastBeep = sec; beep(660, 0.1); }
  const elapsed = T.phases.slice(0, T.idx).reduce((a, q) => a + q.d, 0) + (p.d - Math.max(0, left / 1000));
  $('#tm-bar').style.width = Math.min(100, elapsed / totalDur() * 100) + '%';
  if (left <= 0) {
    T.idx++;
    const next = T.phases[T.idx];
    beep(next && next.k === 'hang' ? 1046 : 520, 0.35);
    try { navigator.vibrate && navigator.vibrate(200); } catch (e) { }
    if (!next) return finish();
    startPhase();
  }
}
async function requestWake() { try { if (navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); } catch (e) { wake = null; } }
function releaseWake() { try { wake && wake.release(); } catch (e) { } wake = null; }
function finishLabels() {
  $('#tm').dataset.phase = 'done'; $('#tm-phase').textContent = t('tm_done'); $('#tm-big').textContent = '✓';
  $('#tm-sub').textContent = t('tm_donesub', { s: T.cfg.sets, r: T.cfg.reps }); $('#tm-bar').style.width = '100%';
}
function finish() {
  clearInterval(T.iv); T.iv = null; T.done = true; releaseWake();
  finishLabels();
  $('#tm-start').textContent = t('tm_again'); $('#tm-stop').hidden = true; $('#tm-log').hidden = false;
}
$('#tm-start').addEventListener('click', () => {
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume && actx.resume(); } catch (e) { actx = null; }
  if (T.iv && !T.paused) { T.paused = true; T.left = T.end - performance.now(); $('#tm-start').textContent = t('tm_resume'); releaseWake(); return; }
  if (T.iv && T.paused) { T.paused = false; T.end = performance.now() + T.left; $('#tm-start').textContent = t('tm_pause'); requestWake(); return; }
  T.cfg = tcfg(); T.phases = buildPhases(T.cfg); T.idx = 0; T.paused = false; T.done = false;
  $('#tm-log').hidden = true; $('#tm-stop').hidden = false; $('#tm-start').textContent = t('tm_pause');
  startPhase(); requestWake();
  T.iv = setInterval(tick, 100); tick();
});
$('#tm-stop').addEventListener('click', () => {
  clearInterval(T.iv); T.iv = null; T.paused = false; T.done = false; releaseWake();
  $('#tm-start').textContent = t('tm_start'); $('#tm-stop').hidden = true; idleDisplay();
});
$('#tm-log').addEventListener('click', () => {
  const c = T.cfg;
  $('#h-proto').value = c.reps > 1 ? 'rep' : c.hang >= 20 ? 'long' : 'max';
  onHangCategoryChange();
  $('#h-hang').value = c.hang; $('#h-rest').value = c.rest; $('#h-reps').value = c.reps;
  const rows = currentRows();
  const first = rows[0] || { e: 20, l: 0 };
  const pick = (i, k, d) => (rows[i] && Number.isFinite(rows[i][k]) ? rows[i][k] : (Number.isFinite(first[k]) ? first[k] : d));
  setHangRows(Array.from({ length: c.sets }, (_, i) => pick(i, 'e', 20)), Array.from({ length: c.sets }, (_, i) => pick(i, 'l', 0)));
  T.done = false;
  resetDates(); setLogType('hang'); showTab('log');
  toast(t('tm_logged'));
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && T.iv && !T.paused) requestWake(); });
