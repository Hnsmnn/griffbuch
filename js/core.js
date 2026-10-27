'use strict';
/* Shared helpers, settings, grades, storage. Loaded before logbook.js and plan.js. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const dateKey = ts => { const d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const todayStr = () => dateKey(Date.now());
const newId = (p = 'e') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
const clone = x => JSON.parse(JSON.stringify(x));
const COLORS = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];

/* Calendar days as 'YYYY-MM-DD' strings; weeks start on Monday. */
const parseDay = s => new Date(s + 'T12:00:00');
const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return dateKey(d.getTime()); };
const dayIdx = s => (parseDay(s).getDay() + 6) % 7;
const mondayOf = s => addDays(s, -dayIdx(s));
const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 864e5);
function isoWeek(s) {
  const d = parseDay(s); d.setDate(d.getDate() - dayIdx(s) + 3);
  const jan4 = new Date(d.getFullYear(), 0, 4, 12);
  return 1 + Math.round((daysBetween(dateKey(jan4.getTime()), dateKey(d.getTime())) + ((jan4.getDay() + 6) % 7) - 3) / 7);
}

/* The test copy (…/griffbuch-test/) keeps its own data so it never touches the real app. */
const IS_TEST = /griffbuch-test/.test(location.pathname);
const NS = IS_TEST ? 'griffbuch-test' : 'griffbuch';

/* ---------- settings ---------- */
const SET_KEY = NS + '.settings';
function defaultSettings() {
  const lang = (navigator.language || '').toLowerCase().startsWith('de') ? 'de' : 'en';
  return {
    lang, bw: null,
    lvl: { top: 5, weeks: 8 },
    scales: { boulder: 'font', route: 'french' },
    gym: { boulder: { on: false, min: 1, max: 9, name: '' }, route: { on: false, min: 1, max: 9, name: '' } }
  };
}
function loadSettings() {
  const d = defaultSettings();
  let s = null; try { s = JSON.parse(localStorage.getItem(SET_KEY) || 'null'); } catch (e) { }
  if (!s) return d;
  return {
    lang: s.lang === 'en' || s.lang === 'de' ? s.lang : d.lang,
    bw: s.bw || null,
    lvl: { ...d.lvl, ...(s.lvl || {}) },
    scales: { ...d.scales, ...(s.scales || {}) },
    gym: { boulder: { ...d.gym.boulder, ...((s.gym || {}).boulder || {}) }, route: { ...d.gym.route, ...((s.gym || {}).route || {}) } }
  };
}
let S = loadSettings();
const saveSettings = () => { try { localStorage.setItem(SET_KEY, JSON.stringify(S)); } catch (e) { } };
const locale = () => S.lang === 'de' ? 'de-DE' : 'en-GB';
const fmt = (n, d = 1) => Number(n).toLocaleString(locale(), { maximumFractionDigits: d });
const shortDate = ts => new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
const dayDate = s => parseDay(s).toLocaleDateString(locale(), { day: 'numeric', month: 'numeric' });

const t = (k, v) => {
  let s = (I18N[S.lang] && I18N[S.lang][k]) ?? I18N.de[k] ?? k;
  if (v) s = s.replace(/\{(\w+)\}/g, (m, x) => v[x] ?? m);
  return s;
};
function applyI18n() {
  document.documentElement.lang = S.lang;
  $$('[data-i]').forEach(el => { el.textContent = t(el.dataset.i); });
  $$('[data-iph]').forEach(el => { el.placeholder = t(el.dataset.iph); });
  $$('[data-ial]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.ial)); });
}

/* ---------- catalogues (stored by id, shown in the current language) ---------- */
const GRIPS = [
  { id: 'half', de: 'Halbcrimp', en: 'Half crimp' }, { id: 'open3', de: 'Offen (3 Finger)', en: 'Open hand (3 fingers)' },
  { id: 'open4', de: 'Offen (4 Finger)', en: 'Open hand (4 fingers)' }, { id: 'full', de: 'Volle Crimp', en: 'Full crimp' },
  { id: 'pinch', de: 'Zange / Pinch', en: 'Pinch' }, { id: 'sloper', de: 'Sloper', en: 'Sloper' },
  { id: '2front', de: '2 Finger (Front)', en: '2 fingers (front)' }, { id: '2mid', de: '2 Finger (Mitte)', en: '2 fingers (middle)' }
];
const PROTOS = [
  { id: 'max', de: 'Max Hangs', en: 'Max hangs' }, { id: 'rep', de: 'Repeater', en: 'Repeaters' },
  { id: 'minedge', de: 'Min Edge', en: 'Min edge' }, { id: 'long', de: 'Dauerhang', en: 'Long hangs' }, { id: 'other', de: 'Sonstiges', en: 'Other' }
];
const nameOf = (list, id) => { const x = list.find(g => g.id === id); return x ? x[S.lang] : String(id || ''); };
const BASE_EX = {
  de: ['Klimmzüge', 'Einarmige Klimmzüge', 'Lock-off', 'Front Lever', 'Campus Board', 'Hanging Leg Raises', 'Liegestütze', 'Dips', 'Schulterdrücken', 'Bankdrücken', 'Rudern', 'Kreuzheben', 'Kniebeugen', 'Unterarm-Strecker (Reverse Curls)'],
  en: ['Pull-ups', 'One-arm pull-ups', 'Lock-offs', 'Front lever', 'Campus board', 'Hanging leg raises', 'Push-ups', 'Dips', 'Overhead press', 'Bench press', 'Rows', 'Deadlift', 'Squats', 'Reverse wrist curls']
};

/* ---------- grades ----------
   Rock grades are stored as `diff`: an index into FONT (boulder) or FR (route).
   Other scales are display conversions of that index. Gym grades are stored as plain numbers (`gnum`). */
const FONT = ['3', '4', '4+', '5', '5+', '6A', '6A+', '6B', '6B+', '6C', '6C+', '7A', '7A+', '7B', '7B+', '7C', '7C+', '8A', '8A+', '8B', '8B+', '8C', '8C+', '9A'];
const FONT_V = ['VB', 'V0', 'V0', 'V1', 'V2', 'V3', 'V3', 'V4', 'V4', 'V5', 'V5', 'V6', 'V7', 'V8', 'V8', 'V9', 'V10', 'V11', 'V12', 'V13', 'V14', 'V15', 'V16', 'V17'];
const VLIST = ['VB', 'V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9', 'V10', 'V11', 'V12', 'V13', 'V14', 'V15', 'V16', 'V17'];
const FR = ['3', '4a', '4b', '4c', '5a', '5b', '5c', '6a', '6a+', '6b', '6b+', '6c', '6c+', '7a', '7a+', '7b', '7b+', '7c', '7c+', '8a', '8a+', '8b', '8b+', '8c', '8c+', '9a', '9a+', '9b', '9b+', '9c'];
const FR_UIAA = ['3', '4', '4+', '5-', '5', '5+', '6-', '6', '6+', '7-', '7', '7+', '8-', '8', '8+', '8+/9-', '9-', '9', '9+', '9+/10-', '10-', '10', '10+', '10+/11-', '11-', '11', '11+', '11+/12-', '12-', '12'];
const FR_YDS = ['5.3', '5.5', '5.6', '5.7', '5.8', '5.9', '5.10a', '5.10b', '5.10c', '5.10d', '5.11a', '5.11b', '5.11c', '5.11d', '5.12a', '5.12b', '5.12c', '5.12d', '5.13a', '5.13b', '5.13c', '5.13d', '5.14a', '5.14b', '5.14c', '5.14d', '5.15a', '5.15b', '5.15c', '5.15d'];
const ident = list => ({ list, fromDiff: d => d, toDiff: i => i });
const SCALES = {
  font: { ...ident(FONT), title: 'sc_font' },
  v: { list: VLIST, fromDiff: d => VLIST.indexOf(FONT_V[d]), toDiff: i => FONT_V.indexOf(VLIST[i]), title: 'sc_v' },
  french: { ...ident(FR), title: 'sc_french_long' },
  uiaa: { ...ident(FR_UIAA), title: 'sc_uiaa' },
  yds: { ...ident(FR_YDS), title: 'sc_yds' }
};
const rockScale = kind => SCALES[S.scales[kind]] || SCALES[kind === 'boulder' ? 'font' : 'french'];
const gymNumeric = kind => S.gym[kind] && S.gym[kind].on;

/* The scale a category (kind + rock/gym) is shown in right now.
   value(e) gives a whole-number position for charts, label(v) its text, options the grades to pick from. */
function catScale(kind, env) {
  if (env === 'gym' && gymNumeric(kind)) {
    const g = S.gym[kind];
    const opts = []; for (let i = g.min; i <= g.max; i++) opts.push({ v: i, label: String(i) });
    return { numeric: true, title: t('sc_gym', { min: g.min, max: g.max }), value: e => (e.gnum != null ? e.gnum : null), label: v => String(Math.round(v)), options: opts };
  }
  const sc = rockScale(kind);
  return {
    numeric: false, title: env === 'gym' ? t('sc_gym_fallback', { scale: t(sc.title) }) : t(sc.title),
    value: e => (e.diff != null && e.gnum == null ? sc.fromDiff(e.diff) : null),
    label: v => sc.list[Math.round(v)] || '',
    options: sc.list.map((g, i) => ({ v: i, label: g })).filter((o, i, a) => a.findIndex(x => x.label === o.label) === i),
    toDiff: i => sc.toDiff(i)
  };
}
function gradeText(e) {
  if (e.gnum != null) return String(e.gnum);
  if (e.diff == null) return e.grade || '?';
  const sc = rockScale(e.kind); return sc.list[sc.fromDiff(e.diff)] || e.grade || '?';
}

/* ---------- logbook storage + migration ---------- */
const LS_KEY = NS + '.v1';
const lsGet = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { return null; } };
const lsSet = v => { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); return true; } catch (e) { return false; } };
const GRIP_OLD = { 'Halbcrimp': 'half', 'Offen (3 Finger)': 'open3', 'Offen (4 Finger)': 'open4', 'Volle Crimp': 'full', 'Zange / Pinch': 'pinch', 'Sloper': 'sloper', '2 Finger (Front)': '2front', '2 Finger (Mitte)': '2mid' };
const PROTO_OLD = { 'Max Hangs': 'max', 'Repeater': 'rep', 'Min Edge': 'minedge', 'Dauerhang': 'long', 'Sonstiges': 'other' };
const edgesOf = e => Array.isArray(e.edges) && e.edges.length ? e.edges : Array(e.sets || 1).fill(e.edge);
const loadsOf = e => { const n = edgesOf(e).length; return Array.isArray(e.loads) && e.loads.length === n ? e.loads : Array(n).fill(e.load || 0); };
const armOf = e => e.arm || '2';

/* Brings entries from older versions (German labels, single load, Font/French strings) to the current shape. */
function migrate(e) {
  if (!e || typeof e !== 'object') return e;
  const x = { ...e };
  if (x.type === 'hang') {
    if (GRIP_OLD[x.grip]) x.grip = GRIP_OLD[x.grip];
    if (PROTO_OLD[x.proto]) x.proto = PROTO_OLD[x.proto];
    x.edges = edgesOf(x); x.loads = loadsOf(x); x.sets = x.edges.length;
  }
  if (x.type === 'ascent') {
    if (!x.env) x.env = 'rock';
    if (x.diff == null && x.gnum == null && x.grade) {
      const i = (x.kind === 'route' ? FR : FONT).indexOf(x.grade);
      if (i >= 0) x.diff = i;
    }
  }
  return x;
}

/* ---------- plan storage ---------- */
const PLAN_KEY = NS + '.plan';
const emptyPlan = () => ({ blocks: [], templates: [], types: [], done: [] });
function loadPlan() {
  let p = null; try { p = JSON.parse(localStorage.getItem(PLAN_KEY) || 'null'); } catch (e) { }
  return p ? { ...emptyPlan(), ...p } : emptyPlan();
}
let P = loadPlan();
function savePlan() {
  try { localStorage.setItem(PLAN_KEY, JSON.stringify(P)); return true; } catch (e) { toast(t('quota')); return false; }
}

/* Session types: built-in ones by id (texts in I18N as ty_<id>) plus the user's own. fam decides how it is logged. */
const BASE_TYPES = [
  { id: 'hang', fam: 'hang' }, { id: 'kraft', fam: 'kraft' }, { id: 'cfree', fam: 'climb' }, { id: 'cend', fam: 'climb' },
  { id: 'cmax', fam: 'climb' }, { id: 'proj', fam: 'climb' }, { id: 'anta', fam: 'other' }, { id: 'rest', fam: 'rest' }
];
const allTypes = () => [...BASE_TYPES, ...P.types.map(x => ({ id: x.id, fam: 'other' }))];
const typeName = id => {
  if (BASE_TYPES.some(x => x.id === id)) return t('ty_' + id);
  const c = P.types.find(x => x.id === id); return c ? c.name : String(id || '');
};
const typeFam = id => (allTypes().find(x => x.id === id) || { fam: 'other' }).fam;
const TYPE_COLOR = { hang: 'var(--hang)', kraft: 'var(--c1)', climb: 'var(--c3)', other: 'var(--c5)', rest: 'var(--line)' };

/* ---------- app state ---------- */
const state = {
  entries: [], prefilled: false,
  tab: 'log', prevTab: 'log', lastLogTab: 'log', logType: 'hang', histFilter: 'all',
  progType: 'hang', progCat: { hang: null, kraft: null, ascent: null, plan: null },
  progMetrics: { hang: ['edge', 'hangt'], kraft: ['kg', 'reps'], ascent: ['level', 'pts'] }, progLayout: 'together',
  pyrPeriod: 'all',
  planNav: [{ p: 'season' }], planLink: null
};
const dirty = { hang: false, kraft: false, ascent: false };
function persist() { return lsSet({ entries: state.entries, bw: S.bw }); }
function loadData() {
  const d = lsGet() || {};
  state.entries = (Array.isArray(d.entries) ? d.entries : []).map(migrate);
  if (d.bw && !S.bw) { S.bw = d.bw; saveSettings(); }
  persist();
}
async function saveRecord(e) {
  state.entries = [e, ...state.entries.filter(x => x.id !== e.id)];
  if (!persist()) { state.entries = state.entries.filter(x => x.id !== e.id); throw { code: 'quota_exceeded' }; }
  render();
}
async function removeRecord(id) { state.entries = state.entries.filter(x => x.id !== id); persist(); render(); }

function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { el.hidden = true; }, 2600);
}
function sorted() { return state.entries.slice().sort((a, b) => b.ts - a.ts); }
const num = id => { const v = parseFloat($(id).value); return Number.isFinite(v) ? v : null; };
function dateToTs(str) {
  if (!str || str === todayStr()) return Date.now();
  return new Date(str + 'T12:00:00').getTime();
}
const emptyBox = (title, text) => `<div class="empty"><b>${esc(title)}</b>${text ? `<span>${esc(text)}</span>` : ''}</div>`;
const hintP = s => `<p class="prefill">${esc(s)}</p>`;
