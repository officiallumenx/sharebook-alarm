import { openAlarmDb, RINGTONES_STORE, txDone } from "./idb";

export type RingtoneMeta = {
  id: string;
  name: string;
  mimeType: string;
  createdAt: number;
  durationMs: number;
};

export type Ringtone = RingtoneMeta & {
  blob: Blob;
};

const META_KEY = "chrono_ringtone_meta";

function readMetaIndex(): RingtoneMeta[] {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RingtoneMeta[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeMetaIndex(rows: RingtoneMeta[]) {
  try {
    localStorage.setItem(
      META_KEY,
      JSON.stringify(rows.sort((a, b) => b.createdAt - a.createdAt)),
    );
  } catch {
    /* quota */
  }
}

function upsertMeta(meta: RingtoneMeta) {
  const next = readMetaIndex().filter((r) => r.id !== meta.id);
  next.push(meta);
  writeMetaIndex(next);
}

function removeMeta(id: string) {
  writeMetaIndex(readMetaIndex().filter((r) => r.id !== id));
}

async function measureBlobDuration(blob: Blob): Promise<number> {
  const url = URL.createObjectURL(blob);
  try {
    const audio = new Audio();
    audio.preload = "metadata";
    return await new Promise<number>((resolve) => {
      audio.onloadedmetadata = () => {
        resolve(Number.isFinite(audio.duration) ? audio.duration * 1000 : 0);
      };
      audio.onerror = () => resolve(0);
      audio.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Fast list from local index — never loads audio blobs. */
export async function listRingtones(): Promise<RingtoneMeta[]> {
  const indexed = readMetaIndex();
  if (indexed.length) return indexed.sort((a, b) => b.createdAt - a.createdAt);

  // One-time key-only rebuild if index empty (avoids loading audio blobs)
  try {
    const db = await openAlarmDb();
    const ids = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction(RINGTONES_STORE, "readonly");
      const req = tx.objectStore(RINGTONES_STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    if (!ids.length) return [];
    const rebuilt = ids.map((key, i) => ({
      id: String(key),
      name: `Saved ringtone ${i + 1}`,
      mimeType: "audio/*",
      createdAt: Date.now() - i,
      durationMs: 0,
    }));
    writeMetaIndex(rebuilt);
    return rebuilt;
  } catch {
    return [];
  }
}

export async function getRingtone(id: string): Promise<Ringtone | null> {
  const db = await openAlarmDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RINGTONES_STORE, "readonly");
    const req = tx.objectStore(RINGTONES_STORE).get(id);
    req.onsuccess = () => resolve((req.result as Ringtone) || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveRingtoneFile(file: File): Promise<RingtoneMeta> {
  const durationMs = await measureBlobDuration(file);
  const id = `rt-${Date.now()}`;
  const name = file.name.replace(/\.[^.]+$/, "") || "My ringtone";
  const mimeType = file.type || "audio/mpeg";
  const blob = file.slice(0, file.size, mimeType);
  const meta: RingtoneMeta = {
    id,
    name,
    mimeType,
    createdAt: Date.now(),
    durationMs,
  };
  const row: Ringtone = { ...meta, blob };
  const db = await openAlarmDb();
  const tx = db.transaction(RINGTONES_STORE, "readwrite");
  tx.objectStore(RINGTONES_STORE).put(row);
  await txDone(tx);
  upsertMeta(meta);
  return meta;
}

export async function deleteRingtone(id: string): Promise<void> {
  const db = await openAlarmDb();
  const tx = db.transaction(RINGTONES_STORE, "readwrite");
  tx.objectStore(RINGTONES_STORE).delete(id);
  await txDone(tx);
  removeMeta(id);
}
