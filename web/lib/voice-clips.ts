import { toPlayableVoiceBlob } from "./audio-wav";
import { openAlarmDb, txDone, VOICE_CLIPS_STORE } from "./idb";

export type VoiceCategory = {
  id: string;
  name: string;
  createdAt: number;
};

export type VoiceClipMeta = {
  id: string;
  name: string;
  mimeType: string;
  createdAt: number;
  durationMs: number;
  categoryId: string;
};

export type VoiceClip = VoiceClipMeta & {
  blob: Blob;
};

export const DEFAULT_CATEGORY_ID = "my";
export const DEFAULT_CATEGORY_NAME = "My";
/** Filter id for showing every clip (not a stored category). */
export const ALL_CATEGORY_ID = "all";

const CATEGORIES_KEY = "chrono_voice_categories";
const META_KEY = "chrono_voice_meta";

function readClipMetaIndex(): VoiceClipMeta[] {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as VoiceClipMeta[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeClipMetaIndex(rows: VoiceClipMeta[]) {
  try {
    localStorage.setItem(
      META_KEY,
      JSON.stringify(rows.sort((a, b) => b.createdAt - a.createdAt)),
    );
  } catch {
    /* quota */
  }
}

function upsertClipMeta(meta: VoiceClipMeta) {
  const next = readClipMetaIndex().filter((r) => r.id !== meta.id);
  next.push(meta);
  writeClipMetaIndex(next);
}

function removeClipMeta(id: string) {
  writeClipMetaIndex(readClipMetaIndex().filter((r) => r.id !== id));
}

function defaultCategories(): VoiceCategory[] {
  return [
    {
      id: DEFAULT_CATEGORY_ID,
      name: DEFAULT_CATEGORY_NAME,
      createdAt: 0,
    },
  ];
}

export function listVoiceCategories(): VoiceCategory[] {
  if (typeof window === "undefined") return defaultCategories();
  try {
    const raw = localStorage.getItem(CATEGORIES_KEY);
    if (!raw) {
      const seed = defaultCategories();
      localStorage.setItem(CATEGORIES_KEY, JSON.stringify(seed));
      return seed;
    }
    const parsed = JSON.parse(raw) as VoiceCategory[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      const seed = defaultCategories();
      localStorage.setItem(CATEGORIES_KEY, JSON.stringify(seed));
      return seed;
    }
    const hasDefault = parsed.some((c) => c.id === DEFAULT_CATEGORY_ID);
    if (!hasDefault) {
      const merged = [...defaultCategories(), ...parsed];
      localStorage.setItem(CATEGORIES_KEY, JSON.stringify(merged));
      return merged;
    }
    return parsed.sort((a, b) => {
      if (a.id === DEFAULT_CATEGORY_ID) return -1;
      if (b.id === DEFAULT_CATEGORY_ID) return 1;
      return a.createdAt - b.createdAt;
    });
  } catch {
    return defaultCategories();
  }
}

function writeCategories(categories: VoiceCategory[]) {
  try {
    localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
  } catch {
    /* quota / private mode */
  }
}

export function addVoiceCategory(name: string): VoiceCategory | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const categories = listVoiceCategories();
  if (categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
    return null;
  }
  const next: VoiceCategory = {
    id: `cat-${Date.now()}`,
    name: trimmed,
    createdAt: Date.now(),
  };
  writeCategories([...categories, next]);
  return next;
}

export function renameVoiceCategory(id: string, name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed || id === DEFAULT_CATEGORY_ID) return false;
  const categories = listVoiceCategories();
  if (categories.some((c) => c.id !== id && c.name.toLowerCase() === trimmed.toLowerCase())) {
    return false;
  }
  writeCategories(categories.map((c) => (c.id === id ? { ...c, name: trimmed } : c)));
  return true;
}

export async function deleteVoiceCategory(id: string): Promise<boolean> {
  if (id === DEFAULT_CATEGORY_ID) return false;
  const categories = listVoiceCategories().filter((c) => c.id !== id);
  writeCategories(categories.length ? categories : defaultCategories());

  const clips = await listVoiceClips();
  await Promise.all(
    clips
      .filter((c) => c.categoryId === id)
      .map((c) => moveVoiceClip(c.id, DEFAULT_CATEGORY_ID)),
  );
  return true;
}

function toMeta(clip: VoiceClip): VoiceClipMeta {
  return {
    id: clip.id,
    name: clip.name,
    mimeType: clip.mimeType,
    createdAt: clip.createdAt,
    durationMs: clip.durationMs,
    categoryId: clip.categoryId || DEFAULT_CATEGORY_ID,
  };
}

/** Fast list from local index — never loads audio blobs. */
export async function listVoiceClips(): Promise<VoiceClipMeta[]> {
  const indexed = readClipMetaIndex();
  if (indexed.length) {
    return indexed
      .map((c) => ({ ...c, categoryId: c.categoryId || DEFAULT_CATEGORY_ID }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  try {
    const db = await openAlarmDb();
    const ids = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction(VOICE_CLIPS_STORE, "readonly");
      const req = tx.objectStore(VOICE_CLIPS_STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    if (!ids.length) return [];
    const rebuilt = ids.map((key, i) => ({
      id: String(key),
      name: `Saved voice ${i + 1}`,
      mimeType: "audio/*",
      createdAt: Date.now() - i,
      durationMs: 0,
      categoryId: DEFAULT_CATEGORY_ID,
    }));
    writeClipMetaIndex(rebuilt);
    return rebuilt;
  } catch {
    return [];
  }
}

export async function listVoiceClipsByCategory(categoryId: string): Promise<VoiceClipMeta[]> {
  const all = await listVoiceClips();
  return all.filter((c) => (c.categoryId || DEFAULT_CATEGORY_ID) === categoryId);
}

function normalizeClip(clip: VoiceClip | undefined): VoiceClip | null {
  if (!clip) return null;
  return { ...clip, categoryId: clip.categoryId || DEFAULT_CATEGORY_ID };
}

export async function getVoiceClip(id: string): Promise<VoiceClip | null> {
  const db = await openAlarmDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VOICE_CLIPS_STORE, "readonly");
    const store = tx.objectStore(VOICE_CLIPS_STORE);
    const req = store.get(id);
    req.onsuccess = () => {
      const found = normalizeClip(req.result as VoiceClip | undefined);
      if (found) {
        resolve(found);
        return;
      }
      // Older rows may have been stored with a numeric keyPath
      if (/^\d+$/.test(id)) {
        const reqNum = store.get(Number(id));
        reqNum.onsuccess = () => resolve(normalizeClip(reqNum.result as VoiceClip | undefined));
        reqNum.onerror = () => reject(reqNum.error);
        return;
      }
      resolve(null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveVoiceClip(clip: VoiceClip): Promise<void> {
  const normalized = {
    ...clip,
    categoryId: clip.categoryId || DEFAULT_CATEGORY_ID,
  };
  const db = await openAlarmDb();
  const tx = db.transaction(VOICE_CLIPS_STORE, "readwrite");
  tx.objectStore(VOICE_CLIPS_STORE).put(normalized);
  await txDone(tx);
  upsertClipMeta(toMeta(normalized));
}

export async function saveVoiceBlob(options: {
  blob: Blob;
  name: string;
  categoryId?: string;
  mimeType?: string;
  /** Unlocked AudioContext improves webm→wav conversion success */
  audioContext?: AudioContext | null;
}): Promise<VoiceClipMeta> {
  // Convert webm/opus → WAV when possible so ringing can always decode without a tap
  const playable = await toPlayableVoiceBlob(
    options.blob,
    options.mimeType || options.blob.type || "audio/webm",
    options.audioContext,
  );
  const durationMs = await measureBlobDuration(playable.blob);
  const id = `vc-${Date.now()}`;
  const clip: VoiceClip = {
    id,
    name: options.name.trim() || "Voice message",
    mimeType: playable.mimeType,
    createdAt: Date.now(),
    durationMs,
    categoryId: options.categoryId || DEFAULT_CATEGORY_ID,
    blob: playable.blob,
  };
  await saveVoiceClip(clip);
  return toMeta(clip);
}

export async function saveVoiceFile(file: File, categoryId?: string): Promise<VoiceClipMeta> {
  const name = file.name.replace(/\.[^.]+$/, "") || "Uploaded voice";
  return saveVoiceBlob({
    blob: file,
    name,
    categoryId,
    mimeType: file.type || "audio/*",
  });
}

export async function renameVoiceClip(id: string, name: string): Promise<void> {
  const existing = await getVoiceClip(id);
  if (!existing) return;
  await saveVoiceClip({ ...existing, name: name.trim() || existing.name });
}

export async function moveVoiceClip(id: string, categoryId: string): Promise<void> {
  const existing = await getVoiceClip(id);
  if (!existing) return;
  const categories = listVoiceCategories();
  const target = categories.some((c) => c.id === categoryId)
    ? categoryId
    : DEFAULT_CATEGORY_ID;
  await saveVoiceClip({ ...existing, categoryId: target });
}

export async function deleteVoiceClip(id: string): Promise<void> {
  const db = await openAlarmDb();
  const tx = db.transaction(VOICE_CLIPS_STORE, "readwrite");
  tx.objectStore(VOICE_CLIPS_STORE).delete(id);
  await txDone(tx);
  removeClipMeta(id);
}

export function pickRecorderMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  // Prefer Opus in WebM — best quality/size when PCM capture is unavailable
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

export async function measureBlobDuration(blob: Blob): Promise<number> {
  const url = URL.createObjectURL(blob);
  try {
    const audio = new Audio();
    audio.preload = "metadata";
    const duration = await new Promise<number>((resolve) => {
      audio.onloadedmetadata = () => {
        resolve(Number.isFinite(audio.duration) ? audio.duration * 1000 : 0);
      };
      audio.onerror = () => resolve(0);
      audio.src = url;
    });
    return duration;
  } finally {
    URL.revokeObjectURL(url);
  }
}
