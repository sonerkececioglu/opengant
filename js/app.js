import * as store from './store.js';
import {
  COLORS, HOUR, DAY, newItem, byId, children, touch, removeItem, path, visibleRows, computeSpans, sampleState,
} from './model.js';
import {
  pickUnits, ticks, fineLabel, coarseLabel, snapStep, snap, fmtRange, toInput, fromInput, FOREVER, addDays, addMonths,
} from './timescale.js';

const $ = id => document.getElementById(id);
const els = {
  scroller: $('scroller'), timeHead: $('timeHead'), tree: $('tree'), chart: $('chart'),
  grid: $('grid'), bars: $('bars'), nowLine: $('nowLine'), tip: $('tip'),
  todoList: $('todoList'), editor: $('editor'), editForm: $('editForm'),
};

// ---------------- Durum ----------------
let state = null;
let spans = new Map();
let rows = [];
let selectedId = null;

const MIN_PPH = 0.02;   // px / saat (yaklaşık yıllık görünüm)
const MAX_PPH = 240;    // 15 dk = 60 px
const PRESETS = { month: 0.15, week: 1.2, day: 6, hour: 60 };

const view = loadView();

function loadView() {
  let v = {};
  try { v = JSON.parse(localStorage.getItem('gp-view') || '{}'); } catch { /* yok say */ }
  return {
    pxPerMs: (v.pxPerHour || PRESETS.week) / HOUR,
    origin: v.origin ?? null,
    mode: v.mode || 'gantt',
    treeNarrow: !!v.treeNarrow,
    showDone: !!v.showDone,
  };
}
function saveView() {
  try {
    localStorage.setItem('gp-view', JSON.stringify({
      pxPerHour: view.pxPerMs * HOUR, origin: view.origin, mode: view.mode,
      treeNarrow: view.treeNarrow, showDone: view.showDone,
    }));
  } catch { /* yok say */ }
}

function commit() {
  store.save(state);
  renderAll();
}

// ---------------- Yardımcılar ----------------
const chartWidth = () => els.chart.clientWidth || 1;
const rowH = () => parseFloat(getComputedStyle(els.chart).getPropertyValue('--row-h')) || 34;
const xOf = t => (t - view.origin) * view.pxPerMs;
const tOf = x => view.origin + x / view.pxPerMs;
const clampPx = p => Math.min(MAX_PPH / HOUR, Math.max(MIN_PPH / HOUR, p));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function zoomAt(factor, clientX) {
  const rect = els.chart.getBoundingClientRect();
  const x = clientX == null ? rect.width / 2 : clientX - rect.left;
  const t = tOf(x);
  view.pxPerMs = clampPx(view.pxPerMs * factor);
  view.origin = t - x / view.pxPerMs;
  scheduleTime();
}

function setZoom(pph) {
  zoomAt((pph / HOUR) / view.pxPerMs, null);
}

function goToday() {
  view.origin = Date.now() - (chartWidth() * 0.25) / view.pxPerMs;
  scheduleTime();
}

let rafTime = 0;
function scheduleTime() {
  if (rafTime) return;
  rafTime = requestAnimationFrame(() => { rafTime = 0; renderTime(); renderBars(); saveView(); });
}

// ---------------- Çizim ----------------
function renderAll() {
  spans = computeSpans(state);
  rows = visibleRows(state);
  document.body.classList.toggle('todo-mode', view.mode === 'todo');
  document.body.classList.toggle('tree-narrow', view.treeNarrow);
  $('ganttView').hidden = view.mode !== 'gantt';
  $('todoView').hidden = view.mode !== 'todo';
  $('viewGantt').classList.toggle('active', view.mode === 'gantt');
  $('viewTodo').classList.toggle('active', view.mode === 'todo');
  if (view.mode === 'gantt') {
    renderTree();
    renderTime();
    renderBars();
  } else {
    renderTodo();
  }
}

function renderTree() {
  els.tree.innerHTML = rows.map(({ item, depth, hasKids }) => `
    <div class="t-row${item.id === selectedId ? ' sel' : ''}${item.done ? ' done' : ''}${depth === 0 ? ' root' : ''}" data-id="${item.id}" style="padding-left:${4 + depth * 16}px">
      <button class="caret${hasKids ? '' : ' empty'}" data-act="toggle" aria-label="Aç/kapa">${item.collapsed ? '▶' : '▼'}</button>
      <span class="dot" style="background:${item.color}"></span>
      <input type="checkbox" class="chk" data-act="done" ${item.done ? 'checked' : ''} aria-label="Tamamlandı">
      <span class="title" data-act="edit" title="${esc(item.title)}">${esc(item.title)}</span>
      <button class="add" data-act="add" title="Alt görev ekle">＋</button>
    </div>`).join('');
  const h = rows.length * rowH();
  els.chart.style.height = `max(${h}px, calc(100vh - 140px))`;
}

function renderTime() {
  const w = chartWidth();
  const from = view.origin, to = tOf(w);
  const { fine, coarse } = pickUnits(view.pxPerMs);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);

  const fineTicks = ticks(fine, from, to);
  const coarseTicks = ticks(coarse, from, to);

  let fineHtml = '', coarseHtml = '', gridHtml = '';
  for (const [a, b] of fineTicks) {
    const x = xOf(a), cw = (b - a) * view.pxPerMs;
    const today = fine.k === 'day' && a === todayStart.getTime();
    fineHtml += `<div class="th-cell${today ? ' today' : ''}" style="left:${x}px;width:${cw}px">${fineLabel(fine, a)}</div>`;
    gridHtml += `<div class="g-line" style="left:${x}px"></div>`;
  }
  for (const [a, b] of coarseTicks) {
    const x = xOf(a), x2 = xOf(b);
    const l = Math.max(0, x);
    coarseHtml += `<div class="th-cell" style="left:${l}px;width:${Math.max(0, x2 - l)}px">${coarseLabel(coarse, a)}</div>`;
    gridHtml += `<div class="g-line major" style="left:${x}px"></div>`;
  }
  // Hafta sonu gölgesi
  if (view.pxPerMs * DAY >= 4) {
    for (const [a, b] of ticks({ k: 'day', n: 1 }, from, to)) {
      const wd = new Date(a).getDay();
      if (wd === 0 || wd === 6) gridHtml += `<div class="g-weekend" style="left:${xOf(a)}px;width:${(b - a) * view.pxPerMs}px"></div>`;
    }
  }
  els.timeHead.innerHTML = `<div class="th-row coarse">${coarseHtml}</div><div class="th-row fine">${fineHtml}</div>`;
  els.grid.innerHTML = gridHtml;

  const nx = xOf(Date.now());
  els.nowLine.style.display = nx >= 0 && nx <= w ? '' : 'none';
  els.nowLine.style.left = `${nx - 1}px`;

  // Zoom düğmesi vurgusu
  const pph = view.pxPerMs * HOUR;
  document.querySelectorAll('[data-zoom]').forEach(b => {
    const p = PRESETS[b.dataset.zoom];
    b.classList.toggle('active', Math.abs(Math.log(pph / p)) < 0.35);
  });
}

function renderBars() {
  const w = chartWidth();
  const rh = rowH();
  const from = view.origin, to = tOf(w);
  let html = '';
  rows.forEach(({ item }, i) => {
    const sp = spans.get(item.id);
    if (!sp || sp.start == null) return;
    if (sp.end < from - DAY || sp.start > to + DAY) return;
    // Çok uzun çubukları (1 yıl, sonsuz) ekranın biraz dışında kırp: tarayıcı aşırı genişliği çizemez.
    const x = Math.max(xOf(sp.start), -200);
    const bw = Math.max(4, Math.min(xOf(sp.end), w + 200) - x);
    const cls = ['bar'];
    if (sp.summary) cls.push('summary');
    if (item.done) cls.push('done');
    if (item.id === selectedId) cls.push('sel');
    if (!sp.summary && bw < 60) cls.push('narrow');
    html += `<div class="${cls.join(' ')}" data-id="${item.id}" style="--c:${item.color};left:${x}px;width:${bw}px;top:${i * rh}px">
      <div class="fill" style="width:${Math.min(100, sp.progress)}%"></div>
      <div class="lbl">${esc(item.title)}</div>
      ${sp.summary ? '' : '<div class="h l" data-h="l"></div><div class="h r" data-h="r"></div>'}
    </div>`;
  });
  els.bars.innerHTML = html;
}

function renderTodo() {
  const list = state.items
    .filter(i => (view.showDone || !i.done) && spans.get(i.id)?.start == null && children(state, i.id).length === 0)
    .sort((a, b) => (a.done - b.done) || (b.updatedAt - a.updatedAt));
  $('showDone').checked = view.showDone;
  els.todoList.innerHTML = list.map(i => {
    const p = path(state, i).join(' › ');
    return `<li class="${i.done ? 'done' : ''}" data-id="${i.id}">
      <input type="checkbox" data-act="done" ${i.done ? 'checked' : ''} aria-label="Tamamlandı">
      <span class="dot" style="background:${i.color}"></span>
      <span class="tl-main" data-act="edit"><span class="tl-title">${esc(i.title)}</span>${p ? `<span class="tl-path">${esc(p)}</span>` : ''}</span>
    </li>`;
  }).join('');
}

// ---------------- Seçim ----------------
function select(id) {
  selectedId = id;
  document.querySelectorAll('.bar.sel, .t-row.sel').forEach(e => e.classList.remove('sel'));
  if (id) document.querySelectorAll(`[data-id="${id}"]`).forEach(e => {
    if (e.classList.contains('bar') || e.classList.contains('t-row')) e.classList.add('sel');
  });
}

function revealBar(id) {
  const sp = spans.get(id);
  if (!sp || sp.start == null) return;
  const w = chartWidth();
  const x1 = xOf(sp.start), x2 = xOf(sp.end);
  if (x2 < 0 || x1 > w) {
    view.origin = sp.start - (w * 0.15) / view.pxPerMs;
    scheduleTime();
  }
}

// ---------------- Ağaç olayları ----------------
els.tree.addEventListener('click', e => {
  const row = e.target.closest('.t-row');
  if (!row) return;
  const item = byId(state, row.dataset.id);
  const act = e.target.dataset.act;
  if (act === 'toggle') { item.collapsed = !item.collapsed; commit(); return; }
  if (act === 'done') { item.done = e.target.checked; touch(item); commit(); return; }
  if (act === 'add') {
    const kid = newItem(state, item.id);
    store.save(state); renderAll(); openEditor(kid.id, true); return;
  }
  if (act === 'edit') { select(item.id); openEditor(item.id); return; }
  select(item.id);
  revealBar(item.id);
});

// ---------------- Gantt hareketleri ----------------
const pointers = new Map();
let gesture = null;   // {type:'pan'|'drag'|'pinch', ...}
let lastTap = { t: 0, x: 0, y: 0 };

function onDown(e, area) {
  if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 2) {
    // İki parmak: pinch-zoom
    const [a, b] = [...pointers.values()];
    const rect = els.chart.getBoundingClientRect();
    const mid = (a.x + b.x) / 2 - rect.left;
    if (gesture?.type === 'drag') cancelDrag();
    gesture = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, p0: view.pxPerMs, t0: tOf(mid) };
    hideTip();
    return;
  }
  if (pointers.size > 2) return;

  const barEl = area === 'chart' ? e.target.closest('.bar') : null;
  const id = barEl?.dataset.id;
  const sp = id ? spans.get(id) : null;
  const handle = e.target.dataset.h || null;
  const canDrag = barEl && sp && !sp.summary && (e.pointerType === 'mouse' || id === selectedId);

  try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* yok say */ }

  if (canDrag) {
    e.preventDefault();
    const item = byId(state, id);
    gesture = { type: 'drag', area, id, el: barEl, mode: handle || 'move', x0: e.clientX, y0: e.clientY, s0: item.start, e0: item.end, moved: false };
  } else {
    gesture = {
      type: 'pan', area, id, x0: e.clientX, y0: e.clientY, o0: view.origin, st0: els.scroller.scrollTop,
      mouse: e.pointerType === 'mouse', moved: false,
    };
  }
}

function onMove(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!gesture) return;

  if (gesture.type === 'pinch') {
    if (pointers.size < 2) return;
    const [a, b] = [...pointers.values()];
    const rect = els.chart.getBoundingClientRect();
    const mid = (a.x + b.x) / 2 - rect.left;
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    view.pxPerMs = clampPx(gesture.p0 * d / gesture.d0);
    view.origin = gesture.t0 - mid / view.pxPerMs;
    scheduleTime();
    return;
  }

  const dx = e.clientX - gesture.x0, dy = e.clientY - gesture.y0;
  if (!gesture.moved && Math.hypot(dx, dy) < 4) return;
  gesture.moved = true;

  if (gesture.type === 'pan') {
    els.chart.classList.add('panning');
    view.origin = gesture.o0 - dx / view.pxPerMs;
    if (gesture.mouse && gesture.area === 'chart') els.scroller.scrollTop = gesture.st0 - dy;
    scheduleTime();
    return;
  }

  if (gesture.type === 'drag') {
    const item = byId(state, gesture.id);
    const step = snapStep(view.pxPerMs);
    const dt = dx / view.pxPerMs;
    let s = gesture.s0, en = gesture.e0;
    if (gesture.mode === 'move') {
      s = snap(gesture.s0 + dt, step);
      en = gesture.e0 >= FOREVER ? FOREVER : s + (gesture.e0 - gesture.s0);
    } else if (gesture.mode === 'l') {
      s = Math.min(snap(gesture.s0 + dt, step), en - step);
    } else {
      en = Math.max(snap(gesture.e0 + dt, step), s + step);
    }
    item.start = s; item.end = en;
    gesture.el.classList.add('dragging');
    const w = chartWidth();
    const x = Math.max(xOf(s), -200);
    gesture.el.style.left = `${x}px`;
    gesture.el.style.width = `${Math.max(4, Math.min(xOf(en), w + 200) - x)}px`;
    showTip(e.clientX, gesture.el.getBoundingClientRect().top - 6, fmtRange(s, en));
  }
}

function onUp(e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  const g = gesture;
  if (!g) return;

  if (g.type === 'pinch') {
    if (pointers.size === 0) gesture = null;
    else gesture = null; // kalan parmakla yeni hareket başlatma
    return;
  }
  gesture = null;
  els.chart.classList.remove('panning');
  hideTip();

  if (e.type === 'pointercancel') {
    if (g.type === 'drag') cancelDrag(g);
    return;
  }

  if (g.type === 'drag' && g.moved) {
    touch(byId(state, g.id));
    commit();
    return;
  }
  if (g.moved) return;

  // Dokunma / tıklama
  const now = Date.now();
  const dbl = now - lastTap.t < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 25;
  lastTap = { t: dbl ? 0 : now, x: e.clientX, y: e.clientY };
  if (g.area !== 'chart') return;

  const id = g.id;
  if (id) {
    if (id === selectedId && (dbl || e.pointerType !== 'mouse')) openEditor(id);
    else if (dbl) openEditor(id);
    else select(id);
    return;
  }
  select(null);
  if (dbl) quickCreate(e);
}

function cancelDrag(g = gesture) {
  if (!g || g.type !== 'drag') return;
  const item = byId(state, g.id);
  item.start = g.s0; item.end = g.e0;
  hideTip();
  renderBars();
}

// Tarihsiz satırın boş alanına çift tıklama: oraya çubuk oluştur
function quickCreate(e) {
  const rect = els.chart.getBoundingClientRect();
  const i = Math.floor((e.clientY - rect.top) / rowH());
  const r = rows[i];
  if (!r) return;
  const sp = spans.get(r.item.id);
  if (sp.start != null || sp.summary) return;
  const step = snapStep(view.pxPerMs);
  const dur = step < HOUR ? HOUR : step < DAY ? DAY : 7 * DAY;
  const s = snap(tOf(e.clientX - rect.left) - dur / 2, step);
  r.item.start = s; r.item.end = s + dur;
  touch(r.item);
  selectedId = r.item.id;
  commit();
}

function showTip(x, y, text) {
  els.tip.textContent = text;
  els.tip.style.left = `${x}px`;
  els.tip.style.top = `${y}px`;
  els.tip.hidden = false;
}
function hideTip() { els.tip.hidden = true; }

for (const [el, area] of [[els.chart, 'chart'], [els.timeHead, 'head']]) {
  el.addEventListener('pointerdown', e => onDown(e, area));
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
}

function wheelDelta(e, v) {
  return e.deltaMode === 1 ? v * 33 : e.deltaMode === 2 ? v * 400 : v;
}
els.chart.addEventListener('wheel', e => {
  const dy = wheelDelta(e, e.deltaY), dx = wheelDelta(e, e.deltaX);
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    zoomAt(Math.exp(-Math.max(-50, Math.min(50, dy)) * 0.006), e.clientX);
  } else if (e.shiftKey || Math.abs(dx) > Math.abs(dy)) {
    e.preventDefault();
    view.origin += (e.shiftKey && !dx ? dy : dx) / view.pxPerMs;
    scheduleTime();
  }
}, { passive: false });
els.timeHead.addEventListener('wheel', e => {
  e.preventDefault();
  const dy = wheelDelta(e, e.deltaY);
  zoomAt(Math.exp(-Math.max(-50, Math.min(50, dy)) * 0.006), e.clientX);
}, { passive: false });

addEventListener('resize', () => scheduleTime());
setInterval(() => { if (view.mode === 'gantt') renderTime(); }, 60e3);

// ---------------- Klavye ----------------
addEventListener('keydown', e => {
  if (els.editor.open || $('help').open) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
  if (!selectedId) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteItem(selectedId); }
  else if (e.key === 'Enter') { e.preventDefault(); openEditor(selectedId); }
  else if (e.key === 'Escape') select(null);
});

function deleteItem(id) {
  const item = byId(state, id);
  if (!item) return false;
  const n = children(state, id).length;
  const msg = n ? `"${item.title}" ve altındaki tüm görevler silinsin mi?` : `"${item.title}" silinsin mi?`;
  if (!confirm(msg)) return false;
  removeItem(state, id);
  if (selectedId === id) selectedId = null;
  commit();
  return true;
}

// ---------------- Düzenleyici ----------------
let editing = null; // {id, isNew, color}

function descendantIds(id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const i of state.items) if (i.parentId && out.has(i.parentId) && !out.has(i.id)) { out.add(i.id); grew = true; }
  }
  return out;
}

function parentOptions(item) {
  const banned = descendantIds(item.id);
  const opts = ['<option value="">— (Kök: proje)</option>'];
  const walk = (pid, depth) => {
    for (const c of children(state, pid)) {
      if (banned.has(c.id)) continue;
      opts.push(`<option value="${c.id}"${c.id === item.parentId ? ' selected' : ''}>${'  '.repeat(depth * 2)}${esc(c.title)}</option>`);
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return opts.join('');
}

function openEditor(id, isNew = false) {
  const item = byId(state, id);
  if (!item) return;
  const sp = spans.get(id) || computeSpans(state).get(id);
  const f = els.editForm.elements;
  editing = { id, isNew, color: item.color };
  $('edTitle').textContent = isNew ? (item.parentId ? 'Yeni görev' : 'Yeni proje') : 'Düzenle';
  $('edPath').textContent = path(state, item).join(' › ');
  f.title.value = item.title;
  f.parent.innerHTML = parentOptions(item);
  f.parent.value = item.parentId || '';
  const summary = !!sp?.summary;
  f.start.value = toInput(summary ? sp.start : item.start);
  f.end.value = toInput(summary ? sp.end : item.end);
  f.start.disabled = f.end.disabled = summary;
  $('quickDates').hidden = summary;
  $('edSummary').hidden = !summary;
  f.done.checked = item.done;
  f.progress.value = item.progress || 0;
  f.progress.disabled = summary;
  $('progVal').textContent = `${summary ? Math.round(sp.progress) : (item.progress || 0)}%`;
  f.notes.value = item.notes || '';
  renderSwatches();
  els.editor.returnValue = '';
  resetQuick();
  els.editor.showModal();
  if (isNew) { f.title.select(); }
}

function renderSwatches() {
  $('swatches').innerHTML = COLORS.map(c =>
    `<button type="button" style="--c:${c}" data-c="${c}" class="${c === editing.color ? 'on' : ''}" aria-label="Renk ${c}"></button>`).join('');
}
$('swatches').addEventListener('click', e => {
  const c = e.target.dataset.c;
  if (!c) return;
  editing.color = c;
  renderSwatches();
});
els.editForm.elements.progress.addEventListener('input', e => { $('progVal').textContent = `${e.target.value}%`; });

// Hızlı tarihler: başlangıç (şimdi / bu gece) + süre. Başlangıç değişince seçili süre yeniden uygulanır.
const quick = { start: 'now', dur: null };
function renderQuick() {
  document.querySelectorAll('#qdStart button').forEach(b => b.classList.toggle('active', b.dataset.start === quick.start));
  document.querySelectorAll('#quickDates .qd-durs button').forEach(b => b.classList.toggle('active', b.dataset.q === quick.dur));
}
function resetQuick() { quick.start = 'now'; quick.dur = null; renderQuick(); }
function applyQuick() {
  const f = els.editForm.elements;
  const q = quick.dur;
  if (!q) return;
  let s = null, en = null;
  if (q !== 'clear') {
    if (quick.start === 'now') s = snap(Date.now(), 15 * 60e3);
    else { const d = new Date(); d.setHours(0, 0, 0, 0); s = addDays(d.getTime(), 1); }
    if (q === 'hour') en = s + HOUR;
    else if (q === 'day') en = addDays(s, 1);
    else if (q === 'week') en = addDays(s, 7);
    else if (q === 'month') en = addMonths(s, 1);
    else if (q === 'year') en = addMonths(s, 12);
    else if (q === 'forever') en = FOREVER;
  }
  f.start.value = toInput(s);
  f.end.value = toInput(en);
}
$('quickDates').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.start) {
    quick.start = b.dataset.start;
    if (quick.dur === 'clear') quick.dur = null;
  } else if (b.dataset.q) {
    quick.dur = b.dataset.q;
  } else return;
  applyQuick();
  if (quick.dur === 'clear') quick.dur = null;
  renderQuick();
});

function applyEditor() {
  const item = byId(state, editing.id);
  if (!item) return;
  const f = els.editForm.elements;
  item.title = f.title.value.trim() || item.title;
  item.color = editing.color;
  item.done = f.done.checked;
  item.notes = f.notes.value;
  if (!f.progress.disabled) item.progress = Number(f.progress.value);
  if (!f.start.disabled) {
    let s = fromInput(f.start.value), en = fromInput(f.end.value);
    if (s != null && en == null) en = s + HOUR;
    if (en != null && s == null) s = en - HOUR;
    if (s != null && en <= s) en = s + HOUR;
    item.start = s; item.end = en;
  }
  const newParent = f.parent.value || null;
  if (newParent !== item.parentId) {
    const sib = state.items.filter(i => i.parentId === newParent && i.id !== item.id);
    item.parentId = newParent;
    item.order = sib.reduce((m, s) => Math.max(m, s.order ?? 0), 0) + 1;
    if (newParent) byId(state, newParent).collapsed = false;
  }
  touch(item);
}

els.editor.addEventListener('close', () => {
  if (!editing) return;
  const { id, isNew } = editing;
  if (els.editor.returnValue === 'save') {
    applyEditor();
    selectedId = id;
    commit();
    revealBar(id);
  } else if (isNew) {
    removeItem(state, id);
    commit();
  }
  editing = null;
});

$('edDelete').addEventListener('click', () => {
  const id = editing.id;
  editing = null; // close olayında tekrar işlem yapma
  if (deleteItem(id)) els.editor.close();
  else editing = { id, isNew: false, color: byId(state, id)?.color };
});

$('edAddChild').addEventListener('click', () => {
  if (!els.editForm.reportValidity()) return;
  applyEditor();
  const parentId = editing.id;
  editing = null;
  els.editor.close();
  const kid = newItem(state, parentId);
  store.save(state);
  renderAll();
  openEditor(kid.id, true);
});

// ---------------- Araç çubuğu ----------------
$('addProject').addEventListener('click', () => {
  const p = newItem(state, null);
  store.save(state);
  renderAll();
  openEditor(p.id, true);
});
$('viewGantt').addEventListener('click', () => { view.mode = 'gantt'; saveView(); renderAll(); });
$('viewTodo').addEventListener('click', () => { view.mode = 'todo'; saveView(); renderAll(); });
document.querySelectorAll('[data-zoom]').forEach(b => b.addEventListener('click', () => setZoom(PRESETS[b.dataset.zoom])));
$('zoomIn').addEventListener('click', () => zoomAt(1.6, null));
$('zoomOut').addEventListener('click', () => zoomAt(1 / 1.6, null));
$('today').addEventListener('click', goToday);

const menu = $('menu');
$('menuBtn').addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; });
document.addEventListener('click', e => { if (!menu.contains(e.target)) menu.hidden = true; });
$('exportBtn').addEventListener('click', () => { store.exportJson(state); menu.hidden = true; });
$('importFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  menu.hidden = true;
  if (!file) return;
  try {
    const data = await store.importJson(file);
    if (!confirm(`${data.items.length} öğe içe aktarılacak. Mevcut veriler bununla değiştirilsin mi?`)) return;
    state = data;
    selectedId = null;
    commit();
  } catch (err) {
    alert('Dosya okunamadı: ' + err.message);
  }
});
$('toggleTree').addEventListener('click', () => { view.treeNarrow = !view.treeNarrow; menu.hidden = true; saveView(); renderAll(); });
$('helpBtn').addEventListener('click', () => { menu.hidden = true; $('help').showModal(); });

// To-do
$('todoForm').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('todoInput').value.trim();
  if (!v) return;
  newItem(state, null, { title: v });
  $('todoInput').value = '';
  commit();
});
$('showDone').addEventListener('change', e => { view.showDone = e.target.checked; saveView(); renderAll(); });
els.todoList.addEventListener('click', e => {
  const li = e.target.closest('li');
  if (!li) return;
  const item = byId(state, li.dataset.id);
  if (e.target.dataset.act === 'done') { item.done = e.target.checked; touch(item); commit(); }
  else if (e.target.closest('[data-act="edit"]')) openEditor(item.id);
});

// ---------------- Başlat ----------------
async function init() {
  state = await store.load();
  if (!state) {
    state = sampleState();
    store.save(state);
  }
  if (view.origin == null) {
    view.origin = Date.now() - (Math.max(chartWidth(), 600) * 0.2) / view.pxPerMs;
  }
  renderAll();
  // Görünüm gizliyken ölçülen genişlik 0 olabilir; düzen oturunca tekrar çiz
  requestAnimationFrame(() => scheduleTime());

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* yok say */ });
  }
}
init();
