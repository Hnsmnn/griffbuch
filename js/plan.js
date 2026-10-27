'use strict';
/* Training plan: season (list of weeks) → block → week → session → exercise.
   A block has one template week (b.sessions). A single week can be adjusted: it then gets its own
   copy in b.overrides[weekIndex] and no longer follows the template. Done marks live in P.done by date. */

const GOALS = ['endu', 'pe', 'max', 'power', 'tech', 'base', 'recov', 'perf'];
const goalName = b => b.goal === 'custom' ? (b.goalText || t('b_goal_custom')) : t('g_' + b.goal);

/* ---------- model ---------- */
const blockEnd = b => addDays(b.start, b.weeks * 7);
const blockAt = day => P.blocks.find(b => day >= b.start && day < blockEnd(b));
const findBlock = id => P.blocks.find(b => b.id === id);
const weekOf = (b, day) => Math.floor(daysBetween(b.start, day) / 7);
const isDeload = (b, w) => !!b.deload && w === b.weeks - 1;
const isAdjusted = (b, w) => w !== 'tpl' && !!(b.overrides && b.overrides[w]);
const weekSessions = (b, w) => (isAdjusted(b, w) ? b.overrides[w] : b.sessions);
const editableSessions = (b, w) => (w === 'tpl' ? b.sessions : isAdjusted(b, w) ? b.overrides[w] : null);
const findSession = (b, w, sid) => weekSessions(b, w).find(s => s.id === sid);
const sessDate = (b, w, s) => addDays(b.start, w * 7 + s.day);
const countable = s => typeFam(s.type) !== 'rest';
const isDone = (date, sid) => P.done.some(d => d.date === date && d.sid === sid);
const sessLabel = s => s.name || typeName(s.type);
const parseW = v => (v === 'tpl' ? 'tpl' : Number(v));
function overlapping(start, weeks, exceptId) {
  const end = addDays(start, weeks * 7);
  return P.blocks.find(o => o.id !== exceptId && start < blockEnd(o) && o.start < end);
}
/* Countable sessions of a week; with upTo only those on or before that day. */
function weekStats(b, w, upTo) {
  const list = weekSessions(b, w).filter(countable).filter(s => !upTo || sessDate(b, w, s) <= upTo);
  return { n: list.length, d: list.filter(s => isDone(sessDate(b, w, s), s.id)).length };
}
const itemsText = items => (items.length === 0 ? t('items_0') : items.length === 1 ? t('items_1') : t('items_n', { n: items.length }));
function itemSummary(it) {
  if (it.kind === 'hang') return { t: `${gripLabel(it)} · ${edgeStr(it)}`, d: `${nameOf(PROTOS, it.proto)} · ${edgesOf(it).length} × ${it.reps} · ${hangTiming(it)} · ${loadStr(it)}` };
  if (it.kind === 'kraft') return { t: it.ex || t('it_kraft'), d: setsStr(it.sets) };
  return { t: t('it_climb'), d: it.text || '–' };
}
function newItem(kind) {
  if (kind === 'hang') {
    const h = lastHang(() => true);
    return h
      ? { id: newId('i'), kind, proto: h.proto, grip: h.grip, arm: armOf(h), hang: h.hang, rest: h.rest, reps: h.reps, edges: edgesOf(h).slice(), loads: loadsOf(h).slice(), note: '' }
      : { id: newId('i'), kind, proto: 'max', grip: 'half', arm: '2', hang: 10, rest: 0, reps: 1, edges: [20, 20, 20, 20, 20], loads: [0, 0, 0, 0, 0], note: '' };
  }
  if (kind === 'kraft') return { id: newId('i'), kind, ex: '', sets: [{ r: 8, kg: 0 }, { r: 8, kg: 0 }, { r: 8, kg: 0 }], note: '' };
  return { id: newId('i'), kind: 'climb', text: '' };
}
function itemFromEntry(e) {
  if (e.type === 'hang') return { id: newId('i'), kind: 'hang', proto: e.proto, grip: e.grip, arm: armOf(e), hang: e.hang, rest: e.rest, reps: e.reps, edges: edgesOf(e).slice(), loads: loadsOf(e).slice(), note: '' };
  if (e.type === 'kraft') return { id: newId('i'), kind: 'kraft', ex: e.ex, sets: clone(e.sets), note: '' };
  return { id: newId('i'), kind: 'climb', text: e.desc || e.note || '' };
}
/* ---------- automatic progression ----------
   planned weight = latest test value before that week × intensity, rounded to 0.5 kg.
   Intensity starts at auto.start % and rises auto.inc points per week; the deload week drops to
   start − 10 % with a third fewer sets. Hangboard tests only count for the same grip, hand and edge. */
const PROG = {
  max: { hang: [85, 2.5], kraft: [82.5, 2.5], reps: 5 },
  perf: { hang: [85, 2.5], kraft: [82.5, 2.5], reps: 5 },
  power: { hang: [80, 2.5], kraft: [70, 0], reps: 3 },
  pe: { hang: [60, 2.5], kraft: [60, 2.5], reps: 12 },
  endu: { hang: [55, 2], kraft: [67.5, 2], reps: 10 },
  base: { hang: [55, 2], kraft: [67.5, 2], reps: 10 },
  tech: { hang: [55, 2], kraft: [67.5, 2], reps: 10 },
  recov: { hang: [50, 0], kraft: [50, 0], reps: 10 }
};
const progGoal = b => (b && PROG[b.goal] ? b.goal : 'max');
function autoDefaults(it, b) {
  const [start, inc] = PROG[progGoal(b)][it.kind === 'hang' ? 'hang' : 'kraft'];
  return { on: true, start, inc };
}
const round05 = x => Math.round(x * 2) / 2;
const isAuto = it => !!(it.auto && it.auto.on && (it.kind === 'hang' || it.kind === 'kraft'));
/* Latest hangboard test on or before `day` for this grip/hand/edge; otherwise an estimate from
   max-hang style entries (1 rep, 7–13 s) of the six weeks before, assuming they were done at ~90 %. */
function hangBaseline(it, edge, day) {
  const arm = armOf(it);
  const match = e => e.type === 'hang' && e.grip === it.grip && armOf(e) === arm && e.bw && dateKey(e.ts) <= day;
  const test = sorted().find(e => match(e) && e.test && hangTestTotal(e).edge === edge);
  if (test) return { total: hangTestTotal(test).total, bw: test.bw, date: test.ts, est: false };
  const from = addDays(day, -42);
  let best = null;
  sorted().filter(e => match(e) && !e.test && dateKey(e.ts) >= from && e.reps === 1 && e.hang >= 7 && e.hang <= 13).forEach(e => {
    const ls = loadsOf(e);
    edgesOf(e).forEach((ed, i) => { if (ed === edge && (!best || e.bw + ls[i] > best.total)) best = { total: e.bw + ls[i], bw: e.bw, date: e.ts }; });
  });
  return best ? { ...best, total: best.total / 0.9, est: true } : null;
}
/* Latest strength test on or before `day`; otherwise the best estimated 1RM of the six weeks before. */
function kraftBaseline(it, day) {
  const match = e => e.type === 'kraft' && normEx(e.ex) === normEx(it.ex) && dateKey(e.ts) <= day;
  const test = sorted().find(e => match(e) && e.test && kraftOrm(e));
  if (test) return { ...kraftOrm(test), date: test.ts, est: false };
  const from = addDays(day, -42);
  let best = null;
  sorted().filter(e => match(e) && dateKey(e.ts) >= from).forEach(e => { const o = kraftOrm(e); if (o && (!best || o.total > best.total)) best = { ...o, date: e.ts }; });
  return best ? { ...best, est: true } : null;
}
/* The concrete exercise for week w of block b (template items stay as they are). */
function plannedItem(it, b, w) {
  if (!isAuto(it) || w === 'tpl') return { it, auto: false };
  const day = addDays(b.start, w * 7), deload = isDeload(b, w);
  const pct = deload ? it.auto.start - 10 : it.auto.start + w * it.auto.inc;
  const x = clone(it);
  let missing = false, est = false, base = null;
  if (it.kind === 'hang') {
    const ed = edgesOf(it);
    x.loads = ed.map(edge => {
      const bl = hangBaseline(it, edge, day);
      if (!bl) { missing = true; return 0; }
      base = base || bl; est = est || bl.est;
      return round05(bl.total * pct / 100 - (S.bw || bl.bw));
    });
    if (deload) { const n = Math.max(1, Math.round(ed.length * 2 / 3)); x.edges = ed.slice(0, n); x.loads = x.loads.slice(0, n); }
    x.edges = x.edges || ed; x.sets = x.edges.length;
  } else {
    const bl = kraftBaseline(it, day);
    if (!bl) missing = true;
    else {
      base = bl; est = bl.est;
      const kg = round05(bl.total * pct / 100 - (bl.bwex ? (S.bw || bl.bw) : 0));
      x.sets = it.sets.map(s => ({ r: s.r, kg }));
    }
    if (deload) x.sets = x.sets.slice(0, Math.max(1, Math.round(it.sets.length * 2 / 3)));
  }
  return { it: x, auto: true, pct, missing, est, base, deload };
}
/* One summary line for an exercise as planned in week w. */
function itemLine(it, b, w) {
  if (!isAuto(it)) return itemSummary(it);
  if (w === 'tpl') {
    const rule = t('auto_rule', { start: fmt(it.auto.start, 1), inc: fmt(it.auto.inc, 1) });
    if (it.kind === 'hang') return { t: `${gripLabel(it)} · ${edgeStr(it)}`, d: `${nameOf(PROTOS, it.proto)} · ${edgesOf(it).length} × ${it.reps} · ${hangTiming(it)} · ${rule}` };
    return { t: it.ex || t('it_kraft'), d: `${it.sets.length} × ${it.sets.map(s => s.r).join('/')} ${t('u_reps')} · ${rule}` };
  }
  const p = plannedItem(it, b, w), x = itemSummary(p.it);
  if (p.missing) return { t: x.t, d: t('auto_missing') };
  return { t: x.t, d: `${x.d} · ${fmt(p.pct, 1)} %${p.est ? ' (' + t('auto_est') + ')' : ''}${p.deload ? ' · ' + t('deload') : ''}` };
}
function autoSectionHTML(it, b) {
  const on = isAuto(it);
  let html = `<label class="check"><input type="checkbox" id="pi-auto" data-chg="piauto"${on ? ' checked' : ''}><span><b>${esc(t('auto_on'))}</b><span class="hint">${esc(t('auto_hint'))}</span></span></label>`;
  if (!on) return html;
  const today = todayStr();
  let base;
  if (it.kind === 'hang') {
    const edge = edgesOf(it)[0], bl = hangBaseline(it, edge, today);
    base = bl ? `${t(bl.est ? 'auto_base_est' : 'auto_base_test', { date: shortDate(bl.date) })}: ${fmt(bl.total)} kg (${fmt(bl.total / bl.bw * 100, 0)} ${t('pctbw')})`
      : t('auto_missing_hang', { what: `${gripLabel(it)} · ${fmt(edge, 1)} mm` });
  } else {
    const bl = kraftBaseline(it, today);
    base = bl ? `${t(bl.est ? 'auto_base_est' : 'auto_base_test', { date: shortDate(bl.date) })}: ${t('test_orm', { kg: bl.bwex ? signed(bl.total - (S.bw || bl.bw)) : fmt(bl.total) })}`
      : t('auto_missing_kraft', { what: it.ex || '–' });
  }
  const weeks = Array.from({ length: b.weeks }, (_, w) => {
    const p = plannedItem(it, b, w);
    const v = p.missing ? '–' : it.kind === 'hang' ? signed(p.it.loads[0]) + ' kg' : (p.it.sets[0] ? signed(p.it.sets[0].kg) + ' kg' : '–');
    return `W${w + 1}${p.deload ? ' D' : ''}: ${v}`;
  }).join(' · ');
  return html + `<div class="grid">
      <label class="f"><span>${esc(t('auto_start'))}</span><span class="hint">${esc(t('auto_of_test'))}</span><input type="number" id="pi-start" data-chg="piautocfg" inputmode="decimal" step="0.5" value="${esc(it.auto.start)}"></label>
      <label class="f"><span>${esc(t('auto_inc'))}</span><span class="hint">${esc(t('auto_inc_hint'))}</span><input type="number" id="pi-inc" data-chg="piautocfg" inputmode="decimal" step="0.5" value="${esc(it.auto.inc)}"></label>
    </div>
    <div class="banner"><span>${esc(base)}</span><span><b>${esc(t('auto_preview'))}:</b> ${esc(weeks)}</span></div>
    ${hintP(t('auto_goal', { goal: goalName(b) }))}${hintP(t('auto_note'))}`;
}

const reid = list => list.map(s => ({ ...clone(s), id: newId('s'), items: (s.items || []).map(i => ({ ...clone(i), id: newId('i') })) }));
function dupBlock(b) {
  let start = blockEnd(b), guard = 0;
  while (overlapping(start, b.weeks, null) && guard++ < 520) start = addDays(start, 7);
  const nb = { ...clone(b), id: newId('b'), start, color: ((b.color || 0) + 1) % COLORS.length, sessions: reid(b.sessions), overrides: {} };
  Object.entries(b.overrides || {}).forEach(([k, v]) => { nb.overrides[k] = reid(v); });
  P.blocks.push(nb); savePlan();
  return nb;
}
function toggleDone(date, sid) {
  if (isDone(date, sid)) P.done = P.done.filter(d => !(d.date === date && d.sid === sid));
  else P.done.push({ date, sid, iid: null, entryId: null });
  savePlan();
}
/* Two taps for destructive buttons: the first arms it, the second within 3.5 s confirms. */
function armed(el, label) {
  if (el.classList.contains('armed')) return true;
  const old = el.textContent;
  el.classList.add('armed'); el.textContent = label;
  setTimeout(() => { el.classList.remove('armed'); el.textContent = old; }, 3500);
  return false;
}

/* ---------- navigation ---------- */
const navTop = () => state.planNav[state.planNav.length - 1];
function go(page) { state.planNav.push(page); renderPlan(); window.scrollTo(0, 0); }
function goBack() { if (state.planNav.length > 1) state.planNav.pop(); renderPlan(); window.scrollTo(0, 0); }
function replaceTop(page) { state.planNav[state.planNav.length - 1] = page; renderPlan(); window.scrollTo(0, 0); }
function openPlanAt(stack) { state.planNav = [{ p: 'season' }, ...stack]; showTab('plan'); }
function openPlanFromEntry(id) { openPlanAt([{ p: 'fromentry', e: id }]); }
function crumbLabel(pg) {
  const b = pg.id ? findBlock(pg.id) : null;
  if (pg.p === 'block') return b ? b.name : '';
  if (pg.p === 'blockform') return t(pg.id ? 'bf_edit' : 'bf_new');
  if (pg.p === 'newsess') return t('ns_title');
  if (pg.p === 'session' || pg.p === 'item') {
    const s = b && findSession(b, pg.w, pg.s);
    if (!s) return '';
    if (pg.p === 'session') return sessLabel(s);
    const it = s.items.find(i => i.id === pg.i);
    return it ? t('it_' + it.kind) : '';
  }
  if (pg.p === 'templates') return t('tp_title');
  if (pg.p === 'fromentry') return t('fe_title');
  return t('season');
}

function renderPlan() {
  let pg = navTop();
  while (state.planNav.length > 1 && pg.id && !findBlock(pg.id)) { state.planNav.pop(); pg = navTop(); }
  const last = state.planNav.length - 1;
  const crumbs = last > 0
    ? `<nav class="crumbtabs" aria-label="${esc(t('levels'))}">${state.planNav.map((p, i) => `${i ? '<span class="sep" aria-hidden="true">›</span>' : ''}<button type="button" data-act="crumb" data-n="${i}"${i === last ? ' aria-current="page"' : ''}>${esc(crumbLabel(p))}</button>`).join('')}</nav>` : '';
  const pages = { season: seasonHTML, block: blockHTML, blockform: blockFormHTML, newsess: newSessHTML, session: sessionHTML, item: itemHTML, templates: templatesHTML, fromentry: fromEntryHTML };
  $('#v-plan').innerHTML = crumbs + (pages[pg.p] || seasonHTML)(pg);
  const rows = $('#pi-rows'); if (rows) numberRows(rows);
}
/* Leaving an exercise editor (by level tab or the phone's back button) keeps valid changes. */
function saveOpenItem() {
  const pg = navTop();
  if (pg.p === 'item' && editableSessions(findBlock(pg.id), pg.w)) { const it = currentItem(pg); if (it && readItem(it)) savePlan(); }
}
function planUp() { saveOpenItem(); goBack(); }
function planToLevel(n) {
  if (n >= state.planNav.length - 1) return;
  saveOpenItem();
  state.planNav = state.planNav.slice(0, n + 1);
  renderPlan(); window.scrollTo(0, 0);
}

/* ---------- season: one row per week ---------- */
function seasonHTML() {
  const today = todayStr(), thisMon = mondayOf(today);
  let from = addDays(thisMon, -28), to = addDays(thisMon, 26 * 7);
  P.blocks.forEach(b => { if (b.start < from) from = b.start; const e = addDays(blockEnd(b), 28); if (e > to) to = e; });
  from = mondayOf(from);
  let rows = '';
  for (let m = from; m < to; m = addDays(m, 7)) {
    const b = blockAt(m), now = m === thisMon;
    const left = `<span class="kw">${esc(t('kw', { n: isoWeek(m) }))}<small>${esc(dayDate(m))}–${esc(dayDate(addDays(m, 6)))}</small></span>`;
    if (!b) {
      rows += `<button type="button" class="wk free${now ? ' now' : ''}" data-act="newblock" data-start="${m}">${left}<span class="meta">${esc(t('free_week'))}</span><span></span></button>`;
      continue;
    }
    const w = weekOf(b, m), st = weekStats(b, w);
    const right = m <= today ? t('done_n', { d: st.d, n: st.n }) : t('sess_n', { n: st.n });
    rows += `<button type="button" class="wk${now ? ' now' : ''}" style="--blk:${COLORS[b.color || 0]}" data-act="openweek" data-b="${b.id}" data-w="${w}">${left}
      <span><span class="bname">${esc(b.name)}</span>${now ? ` <span class="pill today">${esc(t('today'))}</span>` : ''}${isDeload(b, w) ? ` <span class="pill">${esc(t('deload'))}</span>` : ''}
      <span class="meta" style="display:block">${esc(t('week_n', { w: w + 1, n: b.weeks }))} · ${esc(goalName(b))}</span></span>
      <span class="right">${esc(right)}</span></button>`;
  }
  return `<div class="card"><div class="row" style="justify-content:space-between"><h2>${esc(t('season'))}</h2>
      <div class="row"><button type="button" class="btn ghost small" data-act="templates">${esc(t('templates'))}</button><button type="button" class="btn small" data-act="newblock" data-start="${thisMon}">${esc(t('new_block'))}</button></div></div>
      ${P.blocks.length ? '' : hintP(t('plan_intro'))}</div>
    <div class="weeklist">${rows}</div>`;
}

/* ---------- block form ---------- */
function blockFormHTML(pg) {
  const b = pg.id ? findBlock(pg.id) : null;
  if (pg.color == null) pg.color = b ? (b.color || 0) : P.blocks.length % COLORS.length;
  const v = b || { name: '', goal: 'max', goalText: '', start: pg.start || mondayOf(todayStr()), weeks: 6, deload: true };
  const goalOpts = GOALS.map(g => `<option value="${g}"${v.goal === g ? ' selected' : ''}>${esc(t('g_' + g))}</option>`).join('')
    + `<option value="custom"${v.goal === 'custom' ? ' selected' : ''}>${esc(t('g_custom'))}</option>`;
  return `<div class="card"><h2>${esc(t(b ? 'bf_edit' : 'bf_new'))}</h2><div class="grid">
    <label class="f full"><span>${esc(t('name'))}</span><input id="bf-name" value="${esc(v.name)}" placeholder="${esc(t('ph_bname'))}" autocomplete="off"></label>
    <label class="f"><span>${esc(t('b_goal'))}</span><select id="bf-goal" data-chg="bfgoal">${goalOpts}</select></label>
    <label class="f" id="bf-goalc-l"${v.goal === 'custom' ? '' : ' hidden'}><span>${esc(t('b_goal_custom'))}</span><input id="bf-goalc" value="${esc(v.goalText || '')}" autocomplete="off"></label>
    <label class="f"><span>${esc(t('b_start'))}</span><span class="hint">${esc(t('b_start_hint'))}</span><input type="date" id="bf-start" value="${v.start}"></label>
    <label class="f"><span>${esc(t('b_weeks'))}</span><span class="hint">1–52</span><input type="number" id="bf-weeks" inputmode="numeric" min="1" max="52" value="${v.weeks}"></label>
    <label class="check full"><input type="checkbox" id="bf-deload"${v.deload ? ' checked' : ''}><span><b>${esc(t('b_deload'))}</b><span class="hint">${esc(t('b_deload_hint'))}</span></span></label>
    <div class="full"><div class="lbl">${esc(t('b_color'))}</div><div class="colorpick">${COLORS.map((c, i) => `<button type="button" style="background:${c}" data-act="bfcolor" data-c="${i}" aria-pressed="${i === pg.color}" aria-label="${i + 1}"></button>`).join('')}</div></div>
  </div><p class="err" id="bf-err"></p><button type="button" class="btn" data-act="saveblock">${esc(t('b_save'))}</button></div>`;
}
function saveBlock(pg) {
  const err = $('#bf-err'); err.textContent = '';
  const name = $('#bf-name').value.trim(), weeks = parseInt($('#bf-weeks').value, 10), raw = $('#bf-start').value;
  if (!name) { err.textContent = t('e_bname'); return; }
  if (!raw) { err.textContent = t('e_bstart'); return; }
  if (!(weeks >= 1 && weeks <= 52)) { err.textContent = t('e_bweeks'); return; }
  const start = mondayOf(raw);
  const clash = overlapping(start, weeks, pg.id);
  if (clash) { err.textContent = t('e_overlap', { name: clash.name }); return; }
  const fields = { name, goal: $('#bf-goal').value, goalText: $('#bf-goalc').value.trim(), start, weeks, deload: $('#bf-deload').checked, color: pg.color };
  if (pg.id) {
    const b = findBlock(pg.id);
    Object.assign(b, fields);
    Object.keys(b.overrides || {}).forEach(k => { if (Number(k) >= weeks) delete b.overrides[k]; });
    savePlan(); goBack();
  } else {
    const b = { id: newId('b'), ...fields, sessions: [], overrides: {} };
    P.blocks.push(b); savePlan();
    replaceTop({ p: 'block', id: b.id, w: 'tpl' });
  }
}

/* ---------- block: week chips + seven days ---------- */
function sessRowHTML(b, w, s) {
  const fam = typeFam(s.type), date = w === 'tpl' ? null : sessDate(b, w, s), done = !!date && isDone(date, s.id);
  const attrs = `data-b="${b.id}" data-w="${w}" data-s="${s.id}"`;
  const sub = [s.name ? typeName(s.type) : '', fam === 'rest' ? '' : itemsText(s.items)].filter(Boolean).join(' · ');
  const chk = date && countable(s) ? `<button type="button" class="chk" data-act="toggledone" ${attrs} aria-pressed="${done}" aria-label="${esc(t('se_done'))}">✓</button>` : '<span></span>';
  return `<div class="sess${done ? ' isdone' : ''}"><span class="bar8" style="background:${TYPE_COLOR[fam]}"></span>
    <button type="button" class="open" data-act="opensess" ${attrs}><span class="st">${esc(sessLabel(s))}</span><span class="sd">${esc(sub)}</span></button>${chk}</div>`;
}
function blockHTML(pg) {
  const b = findBlock(pg.id), w = pg.w;
  const today = todayStr(), curW = blockAt(today) === b ? weekOf(b, today) : -1;
  const head = `<div class="card" style="border-left:6px solid ${COLORS[b.color || 0]}"><h2>${esc(b.name)}</h2>
    <p class="prefill">${esc(goalName(b))} · ${esc(dayDate(b.start))}–${esc(dayDate(addDays(blockEnd(b), -1)))} · ${b.weeks} ${esc(t('b_weeks'))}${b.deload ? ' · ' + esc(t('deload')) : ''}</p>
    <div class="row"><button type="button" class="btn ghost small" data-act="editblock">${esc(t('bv_edit'))}</button>
      <button type="button" class="btn ghost small" data-act="dupblock">${esc(t('bv_dup'))}</button>
      <button type="button" class="btn danger small" data-act="delblock">${esc(t('bv_del'))}</button></div></div>`;
  const chips = `<div class="chips"><button type="button" class="chip" data-act="pickweek" data-w="tpl" aria-pressed="${w === 'tpl'}">${esc(t('bv_tpl'))}</button>`
    + Array.from({ length: b.weeks }, (_, i) => `<button type="button" class="chip" data-act="pickweek" data-w="${i}" aria-pressed="${w === i}">W${i + 1}${isDeload(b, i) ? ' · D' : ''}${i === curW ? ' •' : ''}</button>`).join('') + '</div>';
  let banner;
  if (w === 'tpl') banner = `<div class="banner">${esc(t('bv_tpl_hint'))}</div>`;
  else {
    banner = isDeload(b, w) ? `<div class="banner deload">${esc(t('bv_deload_hint'))}</div>` : '';
    banner += isAdjusted(b, w)
      ? `<div class="banner">${esc(t('bv_adjusted'))}<button type="button" class="btn ghost small" data-act="resetweek">${esc(t('bv_reset'))}</button></div>`
      : `<div class="banner">${esc(t('bv_follows'))}<button type="button" class="btn ghost small" data-act="adjustweek">${esc(t('bv_adjust'))}</button></div>`;
  }
  const sessions = weekSessions(b, w), editable = !!editableSessions(b, w);
  let days = '';
  for (let d = 0; d < 7; d++) {
    const date = w === 'tpl' ? null : addDays(b.start, w * 7 + d);
    const list = sessions.filter(s => s.day === d);
    days += `<div class="dayrow"><div class="dayhead"><span>${esc(t('dl' + d))}${date ? ` <small>${esc(dayDate(date))}</small>` : ''}${date === today ? ` <span class="pill today">${esc(t('today'))}</span>` : ''}</span>
      ${editable ? `<button type="button" class="add" data-act="addsess" data-d="${d}">${esc(t('add_session'))}</button>` : ''}</div>
      ${list.map(s => sessRowHTML(b, w, s)).join('')}</div>`;
  }
  return `${head}${chips}${banner}<div class="card">${days}</div>`;
}

/* ---------- new session ---------- */
function newSessHTML(pg) {
  const tpls = P.templates.length
    ? `<div class="items">${P.templates.map(x => `<div class="item"><button type="button" class="open" data-act="fromtpl" data-t="${x.id}"><span class="st">${esc(x.name)}</span><span class="sd">${esc(typeName(x.type))} · ${esc(itemsText(x.items))}</span></button><span></span></div>`).join('')}</div>`
    : hintP(t('ns_no_tpl'));
  return `<div class="card"><h2>${esc(t('ns_title'))} · ${esc(t('dl' + pg.d))}</h2><div class="grid">
      <label class="f"><span>${esc(t('ns_type'))}</span><select id="ns-type" data-chg="nstype">${allTypes().map(x => `<option value="${esc(x.id)}">${esc(typeName(x.id))}</option>`).join('')}<option value="__new">${esc(t('ns_newtype'))}</option></select></label>
      <label class="f" id="ns-typename-l" hidden><span>${esc(t('ns_typename'))}</span><input id="ns-typename" autocomplete="off"></label>
      <label class="f full"><span>${esc(t('ns_name'))}</span><span class="hint">${esc(t('ns_name_hint'))}</span><input id="ns-name" autocomplete="off"></label>
    </div><p class="err" id="ns-err"></p><button type="button" class="btn" data-act="createsess">${esc(t('ns_create'))}</button></div>
    <div class="card"><h2>${esc(t('ns_from_tpl'))}</h2>${tpls}</div>`;
}
function createSession(pg, fromTpl) {
  const b = findBlock(pg.id), list = editableSessions(b, pg.w);
  if (!list) return;
  let s;
  if (fromTpl) {
    s = { id: newId('s'), day: pg.d, type: fromTpl.type, name: fromTpl.name, note: fromTpl.note || '', items: fromTpl.items.map(i => ({ ...clone(i), id: newId('i') })) };
  } else {
    let type = $('#ns-type').value;
    if (type === '__new') {
      const name = $('#ns-typename').value.trim();
      if (!name) { $('#ns-err').textContent = t('e_typename'); return; }
      type = newId('ty'); P.types.push({ id: type, name });
    }
    s = { id: newId('s'), day: pg.d, type, name: $('#ns-name').value.trim(), note: '', items: [] };
  }
  list.push(s); savePlan();
  replaceTop({ p: 'session', id: b.id, w: pg.w, s: s.id });
}

/* ---------- session ---------- */
function sessionHTML(pg) {
  const b = findBlock(pg.id), s = findSession(b, pg.w, pg.s);
  if (!s) return emptyBox(t('novals'));
  const editable = !!editableSessions(b, pg.w), fam = typeFam(s.type);
  const date = pg.w === 'tpl' ? null : sessDate(b, pg.w, s);
  const attrs = `data-b="${b.id}" data-w="${pg.w}" data-s="${s.id}"`;
  let head;
  if (editable) {
    head = `<div class="grid">
      <label class="f"><span>${esc(t('ns_type'))}</span><select data-chg="se" data-f="type">${allTypes().map(x => `<option value="${esc(x.id)}"${x.id === s.type ? ' selected' : ''}>${esc(typeName(x.id))}</option>`).join('')}</select></label>
      <label class="f"><span>${esc(t('se_day'))}</span><select data-chg="se" data-f="day">${[0, 1, 2, 3, 4, 5, 6].map(d => `<option value="${d}"${d === s.day ? ' selected' : ''}>${esc(t('dl' + d))}</option>`).join('')}</select></label>
      <label class="f full"><span>${esc(t('ns_name'))}</span><span class="hint">${esc(t('ns_name_hint'))}</span><input data-chg="se" data-f="name" value="${esc(s.name || '')}" autocomplete="off"></label>
      <label class="f full"><span>${esc(t('note'))}</span><textarea data-chg="se" data-f="note">${esc(s.note || '')}</textarea></label></div>`;
  } else {
    head = `<h2>${esc(sessLabel(s))}</h2>${hintP(typeName(s.type) + ' · ' + t('dl' + s.day))}${s.note ? `<p style="margin:0">${esc(s.note)}</p>` : ''}<div class="banner">${esc(t('se_readonly'))}</div>`;
  }
  const doneRow = date && countable(s)
    ? `<div class="row" style="justify-content:space-between"><span>${esc(dayDate(date))}</span><span class="row"><span class="prefill">${esc(t('se_done'))}</span><button type="button" class="chk" data-act="toggledone" ${attrs} aria-pressed="${isDone(date, s.id)}" aria-label="${esc(t('se_done'))}">✓</button></span></div>` : '';
  const items = s.items.length
    ? `<div class="items">${s.items.map(it => {
        const x = itemLine(it, b, pg.w), canLog = date && (it.kind === 'hang' || it.kind === 'kraft');
        return `<div class="item"><button type="button" class="open" data-act="openitem" data-i="${it.id}"><span class="st">${esc(x.t)}</span><span class="sd">${esc(x.d)}</span></button>
          ${canLog ? `<button type="button" class="btn ghost small" data-act="logitem" ${attrs} data-i="${it.id}">${esc(t('se_log'))}</button>` : '<span></span>'}</div>`;
      }).join('')}</div>`
    : (fam === 'rest' ? '' : hintP(t('se_empty')));
  const adders = editable && fam !== 'rest'
    ? `<div class="row"><button type="button" class="btn ghost small" data-act="additem" data-k="hang">${esc(t('se_add_hang'))}</button><button type="button" class="btn ghost small" data-act="additem" data-k="kraft">${esc(t('se_add_kraft'))}</button><button type="button" class="btn ghost small" data-act="additem" data-k="climb">${esc(t('se_add_climb'))}</button></div>` : '';
  const actions = `<div class="row">
    ${date && (fam === 'climb' || fam === 'other') ? `<button type="button" class="btn small" data-act="logsess" ${attrs}>${esc(t('se_log_sess'))}</button>` : ''}
    <button type="button" class="btn ghost small" data-act="savetpl">${esc(t('se_tpl'))}</button>
    ${editable ? `<button type="button" class="btn danger small" data-act="delsess">${esc(t('se_del'))}</button>` : ''}</div>`;
  return `<div class="card">${head}${doneRow}</div>
    ${fam === 'rest' ? '' : `<div class="card"><h2>${esc(t('se_items'))}</h2>${items}${adders}</div>`}
    <div class="card">${actions}</div>`;
}

/* ---------- exercise editors ---------- */
let piCounter = 0;
function piRow(a, b, kind, auto) {
  piCounter++;
  const [ca, cb, la, lb, sa] = kind === 'hang' ? ['ed', 'ld', 'edge_mm', 'load_kg', '1'] : ['r', 'kg', 'reps_short', 'addkg', '1'];
  return `<div class="setrow"><span class="n"></span>
    <input class="${ca}" id="pi-a-${piCounter}" type="number" inputmode="decimal" step="${sa}" aria-label="${esc(t(la))}" value="${esc(a)}">
    <input class="${cb}" id="pi-b-${piCounter}" type="number" inputmode="decimal" step="0.5" placeholder="${auto ? 'auto' : '0'}" aria-label="${esc(t(lb))}" value="${auto ? '' : esc(b)}"${auto ? ' disabled' : ''}>
    <button type="button" class="x" data-act="pi-delrow" aria-label="−">×</button></div>`;
}
function hangEditorHTML(it, b) {
  const opts = (list, cur) => list.map(x => `<option value="${x.id}"${x.id === cur ? ' selected' : ''}>${esc(x[S.lang])}</option>`).join('');
  const ls = loadsOf(it), auto = isAuto(it);
  return `<div class="grid">
      <label class="f"><span>${esc(t('proto'))}</span><select id="pi-proto">${opts(PROTOS, it.proto)}</select></label>
      <label class="f"><span>${esc(t('grip'))}</span><select id="pi-grip">${opts(GRIPS, it.grip)}</select></label>
      <label class="f"><span>${esc(t('hand'))}</span><select id="pi-arm"><option value="2"${armOf(it) !== '1' ? ' selected' : ''}>${esc(t('both'))}</option><option value="1"${armOf(it) === '1' ? ' selected' : ''}>${esc(t('one'))}</option></select></label>
      <label class="f"><span>${esc(t('hangtime'))}</span><span class="hint">${esc(t('h_sec'))}</span><input type="number" id="pi-hang" inputmode="numeric" min="1" value="${esc(it.hang)}"></label>
      <label class="f"><span>${esc(t('rest'))}</span><span class="hint">${esc(t('h_rest'))}</span><input type="number" id="pi-rest" inputmode="numeric" min="0" value="${esc(it.rest)}"></label>
      <label class="f"><span>${esc(t('reps'))}</span><span class="hint">${esc(t('h_perset'))}</span><input type="number" id="pi-reps" inputmode="numeric" min="1" value="${esc(it.reps)}"></label>
    </div>
    <div class="sets"><div class="sethead"><span>${esc(t('set'))}</span><span>${esc(t('edge_mm'))}</span><span>${esc(t('load_kg'))}</span><span></span></div>
      <div class="sets" id="pi-rows">${edgesOf(it).map((e, i) => piRow(e, ls[i], 'hang', auto)).join('')}</div>
      ${auto ? '' : hintP(t('h_load_hint'))}
      <div class="row"><button type="button" class="btn ghost small" data-act="pi-addrow" data-k="hang">${esc(t('add_set'))}</button></div></div>
    ${autoSectionHTML(it, b)}
    <label class="f"><span>${esc(t('note'))}</span><textarea id="pi-note">${esc(it.note || '')}</textarea></label>`;
}
function kraftEditorHTML(it, b) {
  const auto = isAuto(it);
  return `<label class="f"><span>${esc(t('exercise'))}</span><input id="pi-ex" list="exlist" value="${esc(it.ex || '')}" placeholder="${esc(t('ph_ex'))}" autocomplete="off" data-chg="piautocfg"></label>
    <div class="sets"><div class="sethead"><span>${esc(t('set'))}</span><span>${esc(t('reps_short'))}</span><span>${esc(t('addkg'))}</span><span></span></div>
      <div class="sets" id="pi-rows">${(it.sets || []).map(s => piRow(s.r, s.kg || '', 'kraft', auto)).join('')}</div>
      <div class="row"><button type="button" class="btn ghost small" data-act="pi-addrow" data-k="kraft">${esc(t('add_set'))}</button></div></div>
    ${autoSectionHTML(it, b)}
    <label class="f"><span>${esc(t('note'))}</span><textarea id="pi-note">${esc(it.note || '')}</textarea></label>`;
}
function itemHTML(pg) {
  const b = findBlock(pg.id), s = findSession(b, pg.w, pg.s), it = s && s.items.find(i => i.id === pg.i);
  if (!it) return emptyBox(t('novals'));
  const title = esc(t('it_' + it.kind));
  if (!editableSessions(b, pg.w)) {
    const x = itemSummary(it);
    return `<div class="card"><h2>${title}</h2><p style="margin:0"><b>${esc(x.t)}</b></p>${hintP(x.d)}<div class="banner">${esc(t('se_readonly'))}</div></div>`;
  }
  const body = it.kind === 'hang' ? hangEditorHTML(it, b) : it.kind === 'kraft' ? kraftEditorHTML(it, b)
    : `<label class="f"><span>${esc(t('it_climb'))}</span><textarea id="pi-text" rows="5" placeholder="${esc(t('ph_climb'))}">${esc(it.text || '')}</textarea></label>`;
  return `<div class="card"><h2>${title}</h2>${body}<p class="err" id="pi-err"></p>
    <button type="button" class="btn" data-act="saveitem">${esc(t('it_save'))}</button>
    <button type="button" class="btn danger" data-act="delitem">${esc(t('it_del'))}</button></div>`;
}
/* Reads the open editor into the item; false (with a message) when something required is missing. */
function readItem(it) {
  const err = $('#pi-err');
  if (it.kind === 'climb') { it.text = $('#pi-text').value.trim(); return true; }
  if (it.auto && $('#pi-start')) {
    const st = parseFloat($('#pi-start').value), inc = parseFloat($('#pi-inc').value);
    if (Number.isFinite(st) && st > 0) it.auto.start = st;
    if (Number.isFinite(inc)) it.auto.inc = inc;
  }
  const rows = $$('#pi-rows .setrow').map(r => [parseFloat(r.children[1].value), parseFloat(r.children[2].value)]);
  if (it.kind === 'hang') {
    if (!rows.length) { err.textContent = t('e_sets'); return false; }
    if (rows.some(([e]) => !Number.isFinite(e) || e <= 0)) { err.textContent = t('e_edge'); return false; }
    const hang = parseFloat($('#pi-hang').value);
    if (!(hang > 0)) { err.textContent = t('e_hang'); return false; }
    Object.assign(it, {
      proto: $('#pi-proto').value, grip: $('#pi-grip').value, arm: $('#pi-arm').value, hang,
      rest: parseFloat($('#pi-rest').value) || 0, reps: Math.max(1, Math.round(parseFloat($('#pi-reps').value) || 1)),
      edges: rows.map(r => r[0]),
      loads: isAuto(it) ? rows.map((r, i) => loadsOf(it)[i] ?? 0) : rows.map(r => (Number.isFinite(r[1]) ? r[1] : 0)),
      note: $('#pi-note').value.trim()
    });
    it.sets = it.edges.length;
    return true;
  }
  const ex = $('#pi-ex').value.trim();
  if (!ex) { err.textContent = t('e_ex'); return false; }
  const prevKg = i => (it.sets && it.sets[i] ? it.sets[i].kg || 0 : 0);
  const sets = rows.map((row, i) => [...row, i]).filter(([r]) => Number.isFinite(r) && r > 0)
    .map(([r, kg, i]) => ({ r: Math.round(r), kg: isAuto(it) ? prevKg(i) : (Number.isFinite(kg) ? kg : 0) }));
  if (!sets.length) { err.textContent = t('e_kset'); return false; }
  Object.assign(it, { ex, sets, note: $('#pi-note').value.trim() });
  return true;
}
const currentItem = pg => { const b = findBlock(pg.id), s = b && findSession(b, pg.w, pg.s); return s && s.items.find(i => i.id === pg.i); };

/* ---------- templates ---------- */
function templatesHTML() {
  const list = P.templates.length
    ? `<div class="items">${P.templates.map(x => `<div class="item"><span><span class="st">${esc(x.name)}</span><span class="sd">${esc(typeName(x.type))} · ${esc(itemsText(x.items))}</span></span>
        <button type="button" class="btn danger small" data-act="deltpl" data-t="${x.id}">${esc(t('del'))}</button></div>`).join('')}</div>`
    : hintP(t('ns_no_tpl'));
  return `<div class="card"><h2>${esc(t('tp_title'))}</h2>${hintP(t('tp_used'))}${list}</div>`;
}

/* ---------- logbook entry → plan ---------- */
function fromEntryHTML(pg) {
  const e = state.entries.find(x => x.id === pg.e);
  if (!e) return emptyBox(t('novals'));
  if (!P.blocks.length) return `<div class="card">${emptyBox(t('fe_no_block'))}<button type="button" class="btn" data-act="newblock" data-start="${mondayOf(todayStr())}">${esc(t('new_block'))}</button></div>`;
  const today = todayStr();
  if (!pg.b || !findBlock(pg.b)) pg.b = (blockAt(today) || P.blocks.slice().sort((a, b) => (a.start < b.start ? -1 : 1)).filter(b => b.start <= today).pop() || P.blocks[0]).id;
  const b = findBlock(pg.b);
  if (pg.w == null || (pg.w !== 'tpl' && pg.w >= b.weeks)) pg.w = 'tpl';
  if (pg.d == null) pg.d = dayIdx(dateKey(e.ts));
  const daySess = weekSessions(b, pg.w).filter(s => s.day === pg.d && countable(s));
  if (!pg.s || (pg.s !== '__new' && !daySess.some(s => s.id === pg.s))) pg.s = '__new';
  const x = describe(e);
  const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(label)}</option>`;
  return `<div class="card"><h2>${esc(t('fe_title'))}</h2>
    <div class="entry ${e.type}"><span class="tag"></span><div><div class="t">${esc(x.t)}</div><div class="d">${esc(x.d)}</div></div></div>
    <div class="grid">
      <label class="f full"><span>${esc(t('fe_block'))}</span><select data-chg="fe" data-k="b">${P.blocks.map(o => opt(o.id, o.name, pg.b)).join('')}</select></label>
      <label class="f"><span>${esc(t('fe_week'))}</span><select data-chg="fe" data-k="w">${opt('tpl', t('bv_tpl_long'), pg.w)}${Array.from({ length: b.weeks }, (_, i) => opt(i, t('fe_only_week', { w: i + 1 }), pg.w)).join('')}</select></label>
      <label class="f"><span>${esc(t('fe_day'))}</span><select data-chg="fe" data-k="d">${[0, 1, 2, 3, 4, 5, 6].map(d => opt(d, t('dl' + d), pg.d)).join('')}</select></label>
      <label class="f full"><span>${esc(t('fe_session'))}</span><select data-chg="fe" data-k="s">${opt('__new', t('fe_new_session'), pg.s)}${daySess.map(s => opt(s.id, sessLabel(s), pg.s)).join('')}</select></label>
    </div><button type="button" class="btn" data-act="feadd">${esc(t('fe_add'))}</button></div>`;
}
function addEntryToPlan(pg) {
  const e = state.entries.find(x => x.id === pg.e), b = findBlock(pg.b);
  if (!e || !b) return;
  let list = editableSessions(b, pg.w);
  if (!list) { b.overrides = b.overrides || {}; b.overrides[pg.w] = clone(b.sessions); list = b.overrides[pg.w]; }
  let s = pg.s !== '__new' && list.find(x => x.id === pg.s);
  if (!s) {
    s = { id: newId('s'), day: pg.d, type: e.type === 'hang' ? 'hang' : e.type === 'kraft' ? 'kraft' : (e.stype || 'cfree'), name: '', note: '', items: [] };
    list.push(s);
  }
  s.items.push(itemFromEntry(e));
  savePlan();
  state.planNav = [{ p: 'season' }, { p: 'block', id: b.id, w: pg.w }, { p: 'session', id: b.id, w: pg.w, s: s.id }];
  renderPlan(); window.scrollTo(0, 0);
  toast(t('fe_done'));
}

/* ---------- plan → logbook ---------- */
function logItem(b, w, s, plain) {
  const date = sessDate(b, w, s), isTest = typeFam(s.type) === 'test';
  const it = plannedItem(plain, b, w).it;
  resetDates();
  if (it.kind === 'hang') {
    applyHangFull({ ...it, bw: S.bw }); hangPrefillNote(null);
    $('#h-test').checked = isTest;
    $('#h-date').value = date; setLogType('hang');
  } else {
    $('#k-ex').value = it.ex || '';
    setKraftSets(it.sets && it.sets.length ? it.sets : [{ r: '', kg: '' }]); kraftPrefillNote(null);
    setKraftTest(isTest);
    if (S.bw) $('#k-bw').value = S.bw;
    $('#k-date').value = date; setLogType('kraft');
  }
  it.id = plain.id;
  state.planLink = { kind: it.kind, b: b.id, w, s: s.id, i: it.id, date, label: sessLabel(s) };
  showTab('log'); renderPlanLink();
  toast(t('prefilled_toast'));
}
function logSess(b, w, s) {
  const date = sessDate(b, w, s);
  resetDates(); fillSessTypes();
  if ([...$('#ss-type').options].some(o => o.value === s.type)) $('#ss-type').value = s.type;
  $('#ss-desc').value = [s.note, ...s.items.filter(i => i.kind === 'climb').map(i => i.text)].filter(Boolean).join('\n');
  $('#ss-date').value = date; setLogType('session');
  state.planLink = { kind: 'session', b: b.id, w, s: s.id, i: null, date, label: sessLabel(s) };
  showTab('log'); renderPlanLink();
  toast(t('prefilled_toast'));
}
/* Called after any logbook save: ticks off the planned session the form was opened from. */
function afterSaveLink(entry) {
  const L = state.planLink;
  if (!L || L.kind !== entry.type) return;
  P.done.push({ date: L.date, sid: L.s, iid: L.i, entryId: entry.id });
  savePlan();
  state.planLink = null; renderPlanLink(); renderToday();
  toast(t('linked_done'));
}

/* ---------- "planned for today" card in the logbook ---------- */
function todaySessHTML(b, w, s) {
  const fam = typeFam(s.type);
  if (fam === 'rest') return `<div class="sess"><span class="bar8" style="background:${TYPE_COLOR.rest}"></span><span><span class="st">${esc(sessLabel(s))}</span><span class="sd">${esc(t('today_rest'))}</span></span><span></span></div>`;
  const date = sessDate(b, w, s), done = isDone(date, s.id);
  const attrs = `data-b="${b.id}" data-w="${w}" data-s="${s.id}"`;
  const items = s.items.map(it => {
    const x = itemLine(it, b, w), canLog = it.kind === 'hang' || it.kind === 'kraft';
    return `<div class="today-item"><span><b>${esc(x.t)}</b><br><span class="prefill">${esc(x.d)}</span></span>
      ${canLog ? `<button type="button" class="btn small ghost" data-act="logitem" ${attrs} data-i="${it.id}">${esc(t('se_log'))}</button>` : ''}</div>`;
  }).join('');
  const logBtn = fam === 'climb' || fam === 'other' ? `<div class="row"><button type="button" class="btn small ghost" data-act="logsess" ${attrs}>${esc(t('se_log_sess'))}</button></div>` : '';
  return `<div class="sess${done ? ' isdone' : ''}"><span class="bar8" style="background:${TYPE_COLOR[fam]}"></span>
      <button type="button" class="open" data-act="opensess" ${attrs}><span class="st">${esc(sessLabel(s))}</span><span class="sd">${esc(s.name ? typeName(s.type) : itemsText(s.items))}</span></button>
      <button type="button" class="chk" data-act="toggledone" ${attrs} aria-pressed="${done}" aria-label="${esc(t('se_done'))}">✓</button></div>
    ${items ? `<div>${items}</div>` : ''}${logBtn}`;
}
function renderToday() {
  const box = $('#today'), day = todayStr(), b = blockAt(day);
  const w = b ? weekOf(b, day) : 0;
  const list = b ? weekSessions(b, w).filter(s => s.day === dayIdx(day)) : [];
  if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = `<div class="card"><div class="row" style="justify-content:space-between"><h2>${esc(t('today_title'))}</h2>
      <span class="prefill">${esc(b.name)} · ${esc(t('week_n', { w: w + 1, n: b.weeks }))}${isDeload(b, w) ? ` <span class="pill">${esc(t('deload'))}</span>` : ''}</span></div>
    ${list.map(s => todaySessHTML(b, w, s)).join('')}</div>`;
}

/* ---------- progress: plan adherence ---------- */
function renderPlanProg(card) {
  if (!P.blocks.length) { card.innerHTML = `<h2>${esc(t('pp_title'))}</h2>${emptyBox(t('pp_none'), t('pp_none_txt'))}`; return; }
  const today = todayStr();
  const blocks = P.blocks.slice().sort((a, b) => (a.start < b.start ? -1 : 1));
  if (!findBlock(state.progCat.plan)) state.progCat.plan = (blockAt(today) || blocks.filter(b => b.start <= today).pop() || blocks[0]).id;
  const b = findBlock(state.progCat.plan);
  const weeks = Array.from({ length: b.weeks }, (_, w) => {
    const all = weekStats(b, w), past = weekStats(b, w, today);
    return { w, all: all.n, n: past.n, d: past.d };
  });
  const N = weeks.reduce((a, x) => a + x.n, 0), D = weeks.reduce((a, x) => a + x.d, 0);
  const W = 340, H = 190, pl = 30, pr = 10, pt = 16, pb = 28;
  const top = Math.max(1, ...weeks.map(x => x.all)), step = Math.max(1, Math.ceil(top / 4)), hi = step * 4;
  const slot = (W - pl - pr) / b.weeks, bw = Math.min(28, slot * 0.6);
  const yAt = v => pt + (hi - v) / hi * (H - pt - pb);
  let svg = '';
  for (let i = 0; i <= 4; i++) { const y = yAt(i * step).toFixed(1); svg += `<line class="grid-l" x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}"/><text x="${pl - 6}" y="${(+y + 4).toFixed(1)}" text-anchor="end">${i * step}</text>`; }
  weeks.forEach(x => {
    const cx = pl + slot * x.w + slot / 2, rx = (cx - bw / 2).toFixed(1), base = yAt(0);
    if (x.all) svg += `<rect x="${rx}" y="${yAt(x.all).toFixed(1)}" width="${bw.toFixed(1)}" height="${(base - yAt(x.all)).toFixed(1)}" rx="3" style="fill:var(--sunk);stroke:var(--line)"/>`;
    if (x.d) svg += `<rect x="${rx}" y="${yAt(x.d).toFixed(1)}" width="${bw.toFixed(1)}" height="${(base - yAt(x.d)).toFixed(1)}" rx="3" style="fill:var(--c1)"/>`;
    svg += `<text x="${cx.toFixed(1)}" y="${H - 10}" text-anchor="middle">W${x.w + 1}${isDeload(b, x.w) ? ' D' : ''}</text>`;
  });
  const chips = blocks.map(o => `<button type="button" class="chip" data-pblock="${o.id}" aria-pressed="${o.id === b.id}"><span class="dot" style="background:${COLORS[o.color || 0]};border-color:${COLORS[o.color || 0]}"></span>${esc(o.name)}</button>`).join('');
  card.innerHTML = `<h2>${esc(t('pp_title'))}</h2><div class="chips">${chips}</div>
    ${N ? `<p style="margin:0;font-weight:600">${esc(t('pp_sum', { d: D, n: N, p: Math.round(D / N * 100) }))}</p>` : hintP(t('pp_nothing_yet'))}
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('pp_title'))}">${svg}</svg>
    <div class="swatches"><span><i style="background:var(--sunk);outline:1px solid var(--line)"></i>${esc(t('pp_planned'))}</span><span><i style="background:var(--c1)"></i>${esc(t('pp_done'))}</span></div>
    ${hintP(t('pp_hint'))}`;
  $$('[data-pblock]', card).forEach(x => x.addEventListener('click', () => { state.progCat.plan = x.dataset.pblock; renderProg(); }));
}

/* ---------- actions (delegated; buttons carry data-act) ---------- */
const ctxOf = el => {
  const b = findBlock(el.dataset.b), w = parseW(el.dataset.w);
  const s = b && findSession(b, w, el.dataset.s);
  return { b, w, s, it: s && el.dataset.i ? s.items.find(i => i.id === el.dataset.i) : null };
};
const ACTS = {
  crumb: el => planToLevel(Number(el.dataset.n)),
  newblock: el => go({ p: 'blockform', start: el.dataset.start }),
  templates: () => go({ p: 'templates' }),
  openweek: el => go({ p: 'block', id: el.dataset.b, w: Number(el.dataset.w) }),
  editblock: () => go({ p: 'blockform', id: navTop().id }),
  dupblock() { const nb = dupBlock(findBlock(navTop().id)); state.planNav = [{ p: 'season' }, { p: 'block', id: nb.id, w: 'tpl' }]; renderPlan(); window.scrollTo(0, 0); toast(t('dup_done')); },
  delblock(el) {
    if (!armed(el, t('bv_del_sure'))) return;
    P.blocks = P.blocks.filter(b => b.id !== navTop().id); savePlan();
    state.planNav = [{ p: 'season' }]; renderPlan();
  },
  pickweek: el => { navTop().w = parseW(el.dataset.w); renderPlan(); },
  adjustweek() { const pg = navTop(), b = findBlock(pg.id); b.overrides = b.overrides || {}; b.overrides[pg.w] = clone(b.sessions); savePlan(); renderPlan(); },
  resetweek() { const pg = navTop(), b = findBlock(pg.id); delete b.overrides[pg.w]; savePlan(); renderPlan(); },
  addsess: el => { const pg = navTop(); go({ p: 'newsess', id: pg.id, w: pg.w, d: Number(el.dataset.d) }); },
  opensess(el) {
    const page = { p: 'session', id: el.dataset.b, w: parseW(el.dataset.w), s: el.dataset.s };
    if (el.closest('#today')) openPlanAt([{ p: 'block', id: page.id, w: page.w }, page]);
    else go(page);
  },
  toggledone(el) { const c = ctxOf(el); if (!c.s) return; toggleDone(sessDate(c.b, c.w, c.s), c.s.id); render(); },
  bfcolor(el) { navTop().color = Number(el.dataset.c); $$('[data-act="bfcolor"]').forEach(x => x.setAttribute('aria-pressed', x === el)); },
  saveblock: () => saveBlock(navTop()),
  createsess: () => createSession(navTop()),
  fromtpl: el => { const tp = P.templates.find(x => x.id === el.dataset.t); if (tp) createSession(navTop(), tp); },
  additem(el) {
    const pg = navTop(), b = findBlock(pg.id), list = editableSessions(b, pg.w), s = list && list.find(x => x.id === pg.s);
    if (!s) return;
    const it = newItem(el.dataset.k); s.items.push(it); savePlan();
    go({ p: 'item', id: pg.id, w: pg.w, s: pg.s, i: it.id });
  },
  openitem: el => { const pg = navTop(); go({ p: 'item', id: pg.id, w: pg.w, s: pg.s, i: el.dataset.i }); },
  logitem(el) { const c = ctxOf(el); if (c.it) logItem(c.b, c.w, c.s, c.it); },
  logsess(el) { const c = ctxOf(el); if (c.s) logSess(c.b, c.w, c.s); },
  savetpl() {
    const pg = navTop(), s = findSession(findBlock(pg.id), pg.w, pg.s);
    P.templates.push({ id: newId('t'), name: sessLabel(s), type: s.type, note: s.note || '', items: s.items.map(i => ({ ...clone(i), id: newId('i') })) });
    savePlan(); toast(t('se_tpl_done'));
  },
  delsess(el) {
    if (!armed(el, t('se_del_sure'))) return;
    const pg = navTop(), list = editableSessions(findBlock(pg.id), pg.w);
    const i = list.findIndex(x => x.id === pg.s); if (i >= 0) list.splice(i, 1);
    savePlan(); goBack();
  },
  saveitem() { const it = currentItem(navTop()); if (it && readItem(it)) { savePlan(); goBack(); } },
  delitem(el) {
    if (!armed(el, t('it_del_sure'))) return;
    const pg = navTop(), s = findSession(findBlock(pg.id), pg.w, pg.s);
    s.items = s.items.filter(i => i.id !== pg.i); savePlan();
    state.planNav.pop(); renderPlan(); window.scrollTo(0, 0);
  },
  'pi-addrow'(el) {
    const wrap = $('#pi-rows'), last = wrap.lastElementChild;
    const a = last ? last.children[1].value : (el.dataset.k === 'hang' ? '20' : '8');
    const b = last ? last.children[2].value : '';
    const it = currentItem(navTop());
    wrap.insertAdjacentHTML('beforeend', piRow(a, b, el.dataset.k, it && isAuto(it))); numberRows(wrap);
  },
  'pi-delrow'(el) { const wrap = $('#pi-rows'); el.closest('.setrow').remove(); numberRows(wrap); },
  deltpl(el) { if (!armed(el, t('del_sure'))) return; P.templates = P.templates.filter(x => x.id !== el.dataset.t); savePlan(); renderPlan(); },
  feadd: () => addEntryToPlan(navTop())
};
const CHG = {
  bfgoal: el => { $('#bf-goalc-l').hidden = el.value !== 'custom'; },
  nstype: el => { $('#ns-typename-l').hidden = el.value !== '__new'; },
  se(el) {
    const pg = navTop(), list = editableSessions(findBlock(pg.id), pg.w), s = list && list.find(x => x.id === pg.s);
    if (!s) return;
    const f = el.dataset.f;
    s[f] = f === 'day' ? Number(el.value) : f === 'type' ? el.value : el.value.trim();
    savePlan();
    if (f === 'type' || f === 'day') renderPlan();
    else if (f === 'name' && $('.crumbtabs [aria-current="page"]')) $('.crumbtabs [aria-current="page"]').textContent = crumbLabel(pg);
  },
  fe(el) { const pg = navTop(), k = el.dataset.k; pg[k] = k === 'w' ? parseW(el.value) : k === 'd' ? Number(el.value) : el.value; renderPlan(); },
  /* Turning automatic weights on uses the block goal's defaults; strength reps follow the goal too. */
  piauto(el) {
    const pg = navTop(), it = currentItem(pg), b = findBlock(pg.id);
    if (!it) return;
    readItem(it);
    if (el.checked) {
      const keep = it.auto && it.auto.start != null ? { start: it.auto.start, inc: it.auto.inc } : {};
      const fresh = !it.auto;
      it.auto = { ...autoDefaults(it, b), ...keep, on: true };
      if (it.kind === 'kraft' && fresh) it.sets = it.sets.map(s => ({ ...s, r: PROG[progGoal(b)].reps }));
    } else if (it.auto) it.auto.on = false;
    savePlan(); renderPlan();
  },
  piautocfg() { const it = currentItem(navTop()); if (!it) return; readItem(it); savePlan(); renderPlan(); }
};
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (!el || !(el.closest('#v-plan') || el.closest('#today'))) return;
  const fn = ACTS[el.dataset.act];
  if (fn) fn(el, ev);
});
document.addEventListener('change', ev => {
  const el = ev.target.closest('[data-chg]');
  if (!el || !el.closest('#v-plan')) return;
  const fn = CHG[el.dataset.chg];
  if (fn) fn(el, ev);
});
