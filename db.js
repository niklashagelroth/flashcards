// db.js — IndexedDB-lager. Primär lagring för kort + metadata.
// All data lever här. localStorage används medvetet INTE (rensas lättare).

const DB_NAME = 'franska-flashcards';
const DB_VERSION = 1;
const STORE_CARDS = 'cards';
const STORE_META = 'meta';

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_CARDS)) {
        db.createObjectStore(STORE_CARDS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ---- Kort ----

export async function getAllCards() {
  const store = await tx(STORE_CARDS, 'readonly');
  return reqToPromise(store.getAll());
}

export async function getCard(id) {
  const store = await tx(STORE_CARDS, 'readonly');
  return reqToPromise(store.get(id));
}

export async function putCard(card) {
  const store = await tx(STORE_CARDS, 'readwrite');
  await reqToPromise(store.put(card));
  return card;
}

export async function deleteCard(id) {
  const store = await tx(STORE_CARDS, 'readwrite');
  return reqToPromise(store.delete(id));
}

export async function clearCards() {
  const store = await tx(STORE_CARDS, 'readwrite');
  return reqToPromise(store.clear());
}

// Skriv många kort i en transaktion (används vid import).
export async function bulkPutCards(cards) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE_CARDS, 'readwrite');
    const store = t.objectStore(STORE_CARDS);
    for (const c of cards) store.put(c);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

// ---- Metadata (nyckel/värde) ----

export async function getMeta(key, fallback = null) {
  const store = await tx(STORE_META, 'readonly');
  const row = await reqToPromise(store.get(key));
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  const store = await tx(STORE_META, 'readwrite');
  return reqToPromise(store.put({ key, value }));
}

// ---- Persistent lagring ----
// Be webbläsaren att inte vräka ut datan. Viktigt mot iOS Safaris rensning.
export async function requestPersistentStorage() {
  if (!navigator.storage || !navigator.storage.persist) return null;
  try {
    const already = await navigator.storage.persisted();
    if (already) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function storageEstimate() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  try {
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}
