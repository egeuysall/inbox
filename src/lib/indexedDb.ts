import type { LocalThought } from "@/lib/types";

const DB_NAME = "mg-inbox-db";
const DB_VERSION = 1;
const THOUGHTS_STORE = "localThoughts";

let cachedDbPromise: Promise<IDBDatabase> | null = null;

function openDatabase() {
  if (cachedDbPromise) {
    return cachedDbPromise;
  }

  cachedDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(THOUGHTS_STORE)) {
        const store = db.createObjectStore(THOUGHTS_STORE, {
          keyPath: "externalId",
        });
        store.createIndex("by_createdAt", "createdAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return cachedDbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore, resolve: (value: T) => void, reject: (error: unknown) => void) => void,
) {
  const db = await openDatabase();

  return await new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(THOUGHTS_STORE, mode);
    const store = transaction.objectStore(THOUGHTS_STORE);
    handler(store, resolve, reject);
  });
}

export async function listLocalThoughts() {
  return withStore<LocalThought[]>("readonly", (store, resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => {
      const rows = (request.result as LocalThought[]).toSorted(
        (a, b) => b.createdAt - a.createdAt,
      );
      resolve(rows);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function upsertLocalThought(thought: LocalThought) {
  return withStore<void>("readwrite", (store, resolve, reject) => {
    const request = store.put(thought);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function upsertManyLocalThoughts(thoughts: LocalThought[]) {
  if (thoughts.length === 0) {
    return;
  }

  const db = await openDatabase();

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(THOUGHTS_STORE, "readwrite");
    const store = transaction.objectStore(THOUGHTS_STORE);

    for (const thought of thoughts) {
      store.put(thought);
    }

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function clearLocalThoughts() {
  return withStore<void>("readwrite", (store, resolve, reject) => {
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
