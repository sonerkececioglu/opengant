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
    title: parentId ? 'Yeni görev' : 'Yeni proje',
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
  newItem(s, null, { title: 'Market alışverişi', color: COLORS[5] });
  newItem(s, null, { title: 'Faturaları öde', color: COLORS[3], due: t + 2 * DAY });
  return s;
}

// ---------------- Proje / gelen kutusu ----------------
// Kök seviyedeki öğe ya projedir (kind: 'project') ya da projesiz to-do'dur.
// Projesiz to-do Gantt ağacında sadece tarihi (aralık ya da son tarih) varsa görünür.
export function isProject(it) {
  return !it.parentId && it.kind === 'project';
}
function showAtRoot(it, kids) {
  return it.kind === 'project' || kids.length > 0 || it.start != null || it.due != null;
}
export function projects(state) {
  return children(state, null).filter(isProject);
}

// Eski verileri yeni alanlara taşı (bir kez, yüklemede / içe aktarmada)
export function migrate(state) {
  if (!Array.isArray(state.categories)) state.categories = [];
  for (const it of state.items) {
    if (it.parentId || it.kind) continue;
    const hasKids = state.items.some(k => k.parentId === it.id);
    it.kind = hasKids || it.start != null ? 'project' : 'todo';
  }
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
