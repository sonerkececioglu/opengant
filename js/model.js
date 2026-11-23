// Görev modeli ve ağaç işlemleri

export const COLORS = ['#4f7cff', '#22a06b', '#e5793a', '#d6455d', '#8e5cd9', '#1fa3b5', '#c49a1a', '#6b7280'];

export const HOUR = 3600e3;
export const DAY = 24 * HOUR;

export function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) || Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function newItem(state, parentId = null, fields = {}) {
  const siblings = state.items.filter(i => i.parentId === parentId);
  const parent = parentId ? byId(state, parentId) : null;
  const item = {
    id: uid(),
    parentId,
    // Tür: 'project' (kök), 'task' (Gantt görevi, aralıklı), 'todo' (sadece son tarih). Oluşturulunca değişmez.
    kind: fields.kind ?? (parentId ? 'task' : 'project'),
    title: fields.kind === 'todo' ? 'Yeni iş' : parentId ? 'Yeni görev' : 'Yeni proje',
    start: null,
    end: null,
    color: parent ? parent.color : COLORS[siblings.length % COLORS.length],
    notes: '',
    done: false,
    progress: 0,
    collapsed: false,
    order: siblings.reduce((m, s) => Math.max(m, s.order ?? 0), 0) + 1,
    deps: [], // bağımlılıklar için ayrıldı (sonraki sürüm)
    updatedAt: Date.now(),
    ...fields,
  };
  state.items.push(item);
  if (parent) parent.collapsed = false;
  return item;
}

export function byId(state, id) {
  return state.items.find(i => i.id === id);
}

export function children(state, id) {
  return state.items.filter(i => i.parentId === id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function touch(item) {
  item.updatedAt = Date.now();
}

export function removeItem(state, id) {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const i of state.items) {
      if (i.parentId && ids.has(i.parentId) && !ids.has(i.id)) { ids.add(i.id); grew = true; }
    }
  }
  state.items = state.items.filter(i => !ids.has(i.id));
  for (const i of state.items) if (i.deps?.length) i.deps = i.deps.filter(d => !ids.has(d));
}

export function path(state, item) {
  const parts = [];
  let p = item.parentId ? byId(state, item.parentId) : null;
  while (p) { parts.unshift(p.title); p = p.parentId ? byId(state, p.parentId) : null; }
  return parts;
}

// Görünür satırlar (kapalı dalların altı gizli)
export function visibleRows(state) {
  const rows = [];
  const walk = (parentId, depth) => {
    for (const it of children(state, parentId)) {
      const kids = children(state, it.id);
      if (!parentId && !showAtRoot(it, kids)) continue;
      rows.push({ item: it, depth, hasKids: kids.length > 0 });
      if (kids.length && !it.collapsed) walk(it.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

// Her öğe için zaman aralığı.
// Üst öğenin kendi tarihi varsa o kullanılır; alt görevler onu değiştirmez, dışına taşan alt görev `out` ile işaretlenir.
// Kendi tarihi yoksa aralık alt görevlerden hesaplanır (`auto`).
export function computeSpans(state) {
  const map = new Map();
  const kidsOf = new Map();
  for (const i of state.items) {
    if (!kidsOf.has(i.parentId)) kidsOf.set(i.parentId, []);
    kidsOf.get(i.parentId).push(i);
  }
  const calc = (it) => {
    if (map.has(it.id)) return map.get(it.id);
    let s = Infinity, e = -Infinity, pSum = 0, pW = 0;
    const dated = [];
    for (const k of kidsOf.get(it.id) || []) {
      const r = calc(k);
      if (r.start != null) {
        dated.push(r);
        s = Math.min(s, r.start); e = Math.max(e, r.end);
        const w = Math.max(r.end - r.start, 1);
        pSum += r.progress * w; pW += w;
      }
    }
    const own = it.start != null && it.end != null;
    let res;
    if (dated.length) {
      const progress = pW ? pSum / pW : 0;
      if (own) {
        let outCount = 0;
        for (const r of dated) {
          r.out = r.start < it.start || r.end > it.end;
          if (r.out) outCount++;
        }
        res = { start: it.start, end: it.end, summary: true, auto: false, outCount, kidsStart: s, kidsEnd: e, progress };
      } else {
        res = { start: s, end: e, summary: true, auto: true, outCount: 0, progress };
      }
    } else if (own) {
      res = { start: it.start, end: it.end, summary: false, progress: it.done ? 100 : (it.progress || 0) };
    } else {
      res = { start: null, end: null, summary: false, progress: it.done ? 100 : (it.progress || 0) };
    }
    map.set(it.id, res);
    return res;
  };
  for (const i of state.items) calc(i);
  return map;
}

export function sampleState() {
  const s = { version: 1, items: [], updatedAt: Date.now() };
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const t = d0.getTime();
  const p = newItem(s, null, { title: 'Örnek proje', color: COLORS[0], kind: 'project' });
  const a = newItem(s, p.id, { title: 'Planlama' });
  newItem(s, a.id, { title: 'Kapsamı yaz', start: t + 9 * HOUR, end: t + 12 * HOUR, done: true });
  newItem(s, a.id, { title: 'Ekranları çiz', start: t + 13 * HOUR, end: t + DAY + 11 * HOUR, progress: 40 });
  newItem(s, p.id, { title: 'Geliştirme', start: t + 2 * DAY, end: t + 6 * DAY, color: COLORS[1] });
  newItem(s, p.id, { title: 'Test', start: t + 6 * DAY, end: t + 7 * DAY + 12 * HOUR, color: COLORS[2] });
  newItem(s, null, { title: 'Market alışverişi', color: COLORS[5], kind: 'todo' });
  newItem(s, null, { title: 'Faturaları öde', color: COLORS[3], due: t + 2 * DAY, kind: 'todo' });
  return s;
}

// ---------------- Proje / gelen kutusu ----------------
// Kök seviyedeki öğe ya projedir (kind: 'project') ya da projesiz to-do'dur (kind: 'todo').
// Projesiz to-do Gantt ağacında sadece tarihi (aralık ya da son tarih) varsa görünür.
export function isProject(it) {
  return !it.parentId && it.kind === 'project';
}
function showAtRoot(it, kids) {
  return it.kind === 'project' || kids.length > 0 || it.start != null || it.due != null;
}
export const isTodo = it => it.kind === 'todo';
export function projects(state) {
  return children(state, null).filter(isProject);
}

// Eski verileri yeni alanlara taşı (bir kez, yüklemede / içe aktarmada)
export function migrate(state) {
  if (!Array.isArray(state.categories)) state.categories = [];
  for (const it of state.items) {
    const hasKids = state.items.some(k => k.parentId === it.id);
    const ranged = it.start != null;
    const asTask = it.parentId ? 'task' : 'project';
    if (!it.kind) it.kind = hasKids || ranged ? asTask : 'todo';
    // Onarım: to-do'nun aralığı ya da alt görevi olamaz; proje/görev sadece kendi seviyesinde
    else if (it.kind === 'todo' && (hasKids || ranged)) it.kind = asTask;
    else if (it.kind !== 'todo') it.kind = asTask;
    if (it.parentId && it.categoryId) delete it.categoryId; // kategori projeden gelir
    if (it.kind !== 'todo' && it.due != null) delete it.due; // son tarih sadece to-do'da
    if (!Array.isArray(it.deps)) it.deps = [];
  }
  // Bağımlılık: sadece görevler arasında, var olan öğelere
  const tasks = new Set(state.items.filter(i => i.kind === 'task').map(i => i.id));
  for (const it of state.items) it.deps = it.kind === 'task' ? it.deps.filter(d => tasks.has(d) && d !== it.id) : [];
  return state;
}

// ---------------- Kategoriler (ağaç) ----------------
export function categoryById(state, id) {
  return state.categories.find(c => c.id === id);
}
export function categoryChildren(state, parentId) {
  return state.categories.filter(c => (c.parentId || null) === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}
export function categoryPath(state, id) {
  const parts = [];
  let c = id ? categoryById(state, id) : null;
  while (c) { parts.unshift(c.name); c = c.parentId ? categoryById(state, c.parentId) : null; }
  return parts.join(' › ');
}
// Kategori sadece projelere ve projesiz to-do'lara verilir.
// Projeye bağlı görev ve to-do'lar kategorisini projesinden alır.
export const canHaveCategory = it => !it.parentId;
export function rootOf(state, it) {
  let r = it;
  while (r.parentId) { const p = byId(state, r.parentId); if (!p) break; r = p; }
  return r;
}
export function effectiveCategoryId(state, it) {
  return rootOf(state, it).categoryId || null;
}

// Kategori ve tüm alt kategorilerinin id'leri
export function categoryDescendants(state, id) {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of state.categories) {
      if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) { ids.add(c.id); grew = true; }
    }
  }
  return ids;
}
// Kategoriyi alt kategorileriyle siler; bu kategorilere bağlı öğeler kategorisiz kalır.
export function deleteCategory(state, id) {
  const ids = categoryDescendants(state, id);
  state.categories = state.categories.filter(c => !ids.has(c.id));
  for (const it of state.items) if (it.categoryId && ids.has(it.categoryId)) it.categoryId = null;
}

// "İş / Müşteri A" gibi bir yol: yoksa her seviyeyi oluşturur, son kategorinin id'sini döner.
export function ensureCategoryPath(state, text) {
  const names = text.split(/[\/›>]/).map(t => t.trim()).filter(Boolean);
  let parentId = null, cat = null;
  for (const name of names) {
    cat = state.categories.find(c => (c.parentId || null) === parentId && c.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'));
    if (!cat) {
      cat = { id: uid(), name, parentId };
      state.categories.push(cat);
    }
    parentId = cat.id;
  }
  return cat ? cat.id : null;
}

// ---------------- Kokpit süzgeci ----------------
// f: { project: '' | 'none' | id, category: '' | 'none' | id, type: '' | 'task' | 'todo',
//      status: '' | 'open' | 'done' | 'late', range: '' | 'today' | 'week' | 'month' }
// Eşleşen görev/to-do'lar ve onları içeren üst öğeler (bağlam için) satır olur.
// Projesiz to-do'lar son tarihi olmasa da listelenir.
export function cockpitRows(state, spans, f, now = Date.now()) {
  const kidsOf = new Map();
  for (const i of state.items) {
    if (!kidsOf.has(i.parentId)) kidsOf.set(i.parentId, []);
    kidsOf.get(i.parentId).push(i);
  }
  for (const arr of kidsOf.values()) arr.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const catSet = f.category && f.category !== 'none' ? categoryDescendants(state, f.category) : null;
  const [ra, rb] = rangeBounds(f.range, now);
  const dueDeadline = t => (t !== startOfDayMs(t) ? t : t + DAY);

  const matches = it => {
    const root = rootOf(state, it);
    if (f.project === 'none' ? root.kind === 'project' : f.project && root.id !== f.project) return false;
    const cat = root.categoryId || null;
    if (f.category === 'none' ? cat : catSet && !(cat && catSet.has(cat))) return false;
    if (f.type && it.kind !== f.type) return false;
    if (f.status === 'open' && it.done) return false;
    if (f.status === 'done' && !it.done) return false;
    const sp = spans.get(it.id);
    if (f.status === 'late') {
      if (it.done) return false;
      const late = it.kind === 'todo' ? it.due != null && dueDeadline(it.due) < now : sp?.end != null && sp.end < now;
      if (!late) return false;
    }
    if (ra != null) {
      if (it.kind === 'todo') { if (it.due == null || it.due < ra || it.due >= rb) return false; }
      else if (sp?.start == null || sp.start >= rb || sp.end <= ra) return false;
    }
    return true;
  };

  // Eşleşenler + üst öğeleri
  const keep = new Set();
  for (const it of state.items) {
    const leafLike = it.kind !== 'project';
    // Proje kendi başına: sadece tür süzgeci yokken ve projede hiç öğe yokken eşleşebilir
    const lonelyProject = it.kind === 'project' && !f.type && !(kidsOf.get(it.id) || []).length;
    if ((leafLike || lonelyProject) && matches(it)) {
      let p = it;
      while (p && !keep.has(p.id)) { keep.add(p.id); p = p.parentId ? byId(state, p.parentId) : null; }
    }
  }

  const rows = [];
  const walk = (parentId, depth) => {
    for (const it of kidsOf.get(parentId) || []) {
      if (!keep.has(it.id)) continue;
      const kids = (kidsOf.get(it.id) || []).filter(k => keep.has(k.id));
      rows.push({ item: it, depth, hasKids: kids.length > 0 });
      if (kids.length && !it.collapsed) walk(it.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

function startOfDayMs(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
// Tarih aralığı: [başlangıç, bitiş) — hafta pazartesi başlar
export function rangeBounds(range, now = Date.now()) {
  if (!range) return [null, null];
  const d = new Date(startOfDayMs(now));
  if (range === 'today') return [d.getTime(), d.getTime() + DAY];
  if (range === 'week') {
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const a = d.getTime(); d.setDate(d.getDate() + 7);
    return [a, d.getTime()];
  }
  if (range === 'month') {
    d.setDate(1); const a = d.getTime(); d.setMonth(d.getMonth() + 1);
    return [a, d.getTime()];
  }
  return [null, null];
}

// ---------------- Bağımlılıklar (bitiş → başlangıç) ----------------
// it.deps: önce bitmesi gereken görevlerin id'leri. Sadece görevler arasında.
const isAncestor = (state, a, b) => { // a, b'nin üst öğelerinden biri mi
  let p = b.parentId ? byId(state, b.parentId) : null;
  while (p) { if (p.id === a.id) return true; p = p.parentId ? byId(state, p.parentId) : null; }
  return false;
};
// a, (dolaylı olarak) b'ye bağımlı mı
export function dependsOn(state, a, b, seen = new Set()) {
  if (seen.has(a.id)) return false;
  seen.add(a.id);
  for (const d of a.deps || []) {
    if (d === b.id) return true;
    const p = byId(state, d);
    if (p && dependsOn(state, p, b, seen)) return true;
  }
  return false;
}
// cand, item'ın öncülü olabilir mi
export function canPrecede(state, item, cand) {
  return cand.kind === 'task' && item.kind === 'task' && cand.id !== item.id &&
    !isAncestor(state, cand, item) && !isAncestor(state, item, cand) && !dependsOn(state, cand, item);
}
// Öncüllerin en geç bitişi (yoksa null)
export function predecessorsEnd(state, it, spans) {
  let e = null;
  for (const d of it.deps || []) {
    const sp = spans.get(d);
    if (sp?.end != null) e = e == null ? sp.end : Math.max(e, sp.end);
  }
  return e;
}
// Kuralı uygula: öncülü bitmeden başlayan görev, süresi korunarak ileri itilir (geri çekilmez).
// Zincirleme etkiler için kararlı olana kadar tekrarlar. Değişen öğe sayısını döner.
export function enforceDeps(state) {
  let moved = 0;
  for (let pass = 0; pass < state.items.length + 1; pass++) {
    const spans = computeSpans(state);
    let changed = false;
    for (const it of state.items) {
      if (it.kind !== 'task' || !it.deps?.length || it.start == null || it.end == null) continue;
      const pe = predecessorsEnd(state, it, spans);
      if (pe != null && it.start < pe && it.end < 9e15) {
        const dur = it.end - it.start;
        it.start = pe; it.end = pe + dur; it.updatedAt = Date.now();
        changed = true; moved++;
      } else if (pe != null && it.start < pe) { // sonsuz bitiş: sadece başlangıç
        it.start = pe; changed = true; moved++;
      }
    }
    if (!changed) break;
  }
  return moved;
}
