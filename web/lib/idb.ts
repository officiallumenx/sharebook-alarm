/** Shared IndexedDB connection for voice clips + ringtones. */

const DB_NAME = "smart-voice-alarm";
export const DB_VERSION = 3;
export const VOICE_CLIPS_STORE = "voiceClips";
export const RINGTONES_STORE = "ringtones";

let dbPromise: Promise<IDBDatabase> | null = null;

function upgrade(db: IDBDatabase, oldVersion: number, tx: IDBTransaction | null) {
  if (!db.objectStoreNames.contains(VOICE_CLIPS_STORE)) {
    db.createObjectStore(VOICE_CLIPS_STORE, { keyPath: "id" });
  }
  if (!db.objectStoreNames.contains(RINGTONES_STORE)) {
    db.createObjectStore(RINGTONES_STORE, { keyPath: "id" });
  }
  if (oldVersion < 2 && db.objectStoreNames.contains(VOICE_CLIPS_STORE) && tx) {
    const store = tx.objectStore(VOICE_CLIPS_STORE);
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      const value = cursor.value as { categoryId?: string };
      if (!value.categoryId) {
        cursor.update({ ...value, categoryId: "my" });
      }
      cursor.continue();
    };
  }
}

export function openAlarmDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB not available"));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        upgrade(req.result, event.oldVersion || 0, req.transaction);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onclose = () => {
          dbPromise = null;
        };
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        dbPromise = null;
        reject(req.error || new Error("Failed to open DB"));
      };
    });
  }
  return dbPromise;
}

export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("Transaction failed"));
    tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
  });
}

/** Cursor walk that never retains blob fields in the result list. */
export function listStoreMeta<T extends { createdAt: number }>(
  storeName: string,
  project: (row: Record<string, unknown>) => T,
): Promise<T[]> {
  return openAlarmDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const rows: T[] = [];
        const req = store.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if (!cursor) {
            rows.sort((a, b) => b.createdAt - a.createdAt);
            resolve(rows);
            return;
          }
          try {
            rows.push(project(cursor.value as Record<string, unknown>));
          } catch {
            /* skip bad row */
          }
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
      }),
  );
}
