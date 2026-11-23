// Veri katmanı: tüm okuma/yazma buradan geçer.
// Şimdilik IndexedDB; Drive senkronu ileride bu modülün arkasına eklenecek.

const DB_NAME = 'gantt-planner';
const STORE = 'kv';
const KEY = 'state';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function emptyState() {
  return { version: 1, items: [], updatedAt: Date.now() };
}

export async function load() {
  try {
    const s = await idbGet(KEY);
    return s && Array.isArray(s.items) ? s : null;
  } catch (e) {
    console.error('Yükleme hatası', e);
    return null;
  }
}

let timer = null;
let pending = null;

export function save(state) {
  state.updatedAt = Date.now();
  pending = state;
  clearTimeout(timer);
  timer = setTimeout(flush, 300);
}

export async function flush() {
  clearTimeout(timer);
  if (!pending) return;
  const s = pending;
  pending = null;
  try {
    await idbSet(KEY, JSON.parse(JSON.stringify(s)));
  } catch (e) {
    console.error('Kaydetme hatası', e);
  }
}

// Sekme kapanırken bekleyen kaydı yaz
addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});

// --- JSON dışa / içe aktarma ---
export function exportJson(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  a.href = URL.createObjectURL(blob);
  a.download = `gantt-planner-${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function importJson(file) {
  const data = JSON.parse(await file.text());
  if (!data || !Array.isArray(data.items)) throw new Error('Geçersiz dosya');
  return data;
}
