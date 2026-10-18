import type { VoiceType } from "./types";

export const SNOOZE_STORAGE_KEY = "chrono_pending_snooze";
export const SNOOZE_MS = 5 * 60 * 1000;

export type PendingSnooze = {
  at: number;
  type: string;
  title: string;
  voiceType: VoiceType;
  voiceURI?: string;
  recordingId?: string;
  speakText: string;
};

function parseSnooze(raw: string): PendingSnooze | null {
  try {
    const parsed = JSON.parse(raw) as PendingSnooze;
    if (!parsed || typeof parsed.at !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persist snooze in localStorage so it survives tab/process kill (migrate from session). */
export function readStoredSnooze(): PendingSnooze | null {
  if (typeof window === "undefined") return null;
  try {
    const local = localStorage.getItem(SNOOZE_STORAGE_KEY);
    if (local) return parseSnooze(local);
    const session = sessionStorage.getItem(SNOOZE_STORAGE_KEY);
    if (session) {
      localStorage.setItem(SNOOZE_STORAGE_KEY, session);
      sessionStorage.removeItem(SNOOZE_STORAGE_KEY);
      return parseSnooze(session);
    }
    return null;
  } catch {
    return null;
  }
}

export function writeStoredSnooze(payload: PendingSnooze | null) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SNOOZE_STORAGE_KEY);
    if (!payload) localStorage.removeItem(SNOOZE_STORAGE_KEY);
    else localStorage.setItem(SNOOZE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

export function snoozeFireKey(at: number) {
  return `snooze-${at}`;
}
