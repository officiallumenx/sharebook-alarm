import type { Alarm, TodoItem } from "./types";
import { collectUpcomingFires, type ScheduledFire } from "./next-fire";
import {
  cancelNativeAlarmNotifications,
  syncNativeAlarmNotifications,
} from "./native-alarms";
import { isNativeApp } from "./native";
import { readStoredSnooze, snoozeFireKey } from "./pending-snooze";

export type BgSchedule = {
  fires: ScheduledFire[];
  soundType: string;
  customRingtoneId?: string;
  updatedAt: number;
};

export type BgRingPayload = {
  fire: ScheduledFire;
  soundType?: string;
  customRingtoneId?: string;
};

const BG_PREF_KEY = "chrono_bg_alarms";
const KEEPALIVE_PREF_KEY = "chrono_bg_keepalive";

export function getBackgroundAlarmsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(BG_PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setBackgroundAlarmsEnabled(on: boolean) {
  try {
    localStorage.setItem(BG_PREF_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function getKeepaliveEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(KEEPALIVE_PREF_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setKeepaliveEnabled(on: boolean) {
  try {
    localStorage.setItem(KEEPALIVE_PREF_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined") return "unsupported";
  // Capacitor WebView often has no usable Notification API — status is checked async via LocalNotifications
  if (isNativeApp()) {
    if (!("Notification" in window)) return "default";
    // Prefer not to trust denied from WebView; treat as default so UI still offers Allow
    if (Notification.permission === "granted") return "granted";
    return "default";
  }
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function ensureNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined") return "unsupported";

  if (isNativeApp()) {
    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      const current = await LocalNotifications.checkPermissions();
      if (current.display === "granted") {
        setBackgroundAlarmsEnabled(true);
        return "granted";
      }
      const asked = await LocalNotifications.requestPermissions();
      if (asked.display === "granted") {
        setBackgroundAlarmsEnabled(true);
        return "granted";
      }
      return asked.display === "denied" ? "denied" : "default";
    } catch {
      return "denied";
    }
  }

  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export async function registerAlarmServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    return reg;
  } catch (e) {
    console.warn("Service worker registration failed", e);
    return null;
  }
}

function postToSw(type: string, payload?: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve) => {
    if (!navigator.serviceWorker?.controller) {
      resolve({ ok: false, error: "no-controller" });
      return;
    }
    const channel = new MessageChannel();
    const timer = window.setTimeout(() => resolve({ ok: false, error: "timeout" }), 4000);
    channel.port1.onmessage = (ev) => {
      window.clearTimeout(timer);
      resolve(ev.data);
    };
    try {
      navigator.serviceWorker.controller.postMessage({ type, ...payload }, [channel.port2]);
    } catch (e) {
      window.clearTimeout(timer);
      resolve({ ok: false, error: String(e) });
    }
  });
}

export async function syncBackgroundSchedule(
  alarms: Alarm[],
  todos: TodoItem[],
  soundType: string,
  customRingtoneId?: string,
): Promise<boolean> {
  let fires = collectUpcomingFires(alarms, todos, new Date(), 8, 12);
  // Include pending snooze so SW can wake the app if the tab was killed
  const snooze = readStoredSnooze();
  if (snooze && snooze.at > Date.now() + 1500) {
    const snoozeFire: ScheduledFire = {
      at: snooze.at,
      key: snoozeFireKey(snooze.at),
      type: "snooze",
      id: "snooze",
      title: snooze.title || "Snoozed alarm",
      speakText: snooze.speakText || "",
      voiceType: snooze.voiceType || "female",
      voiceURI: snooze.voiceURI,
      recordingId: snooze.recordingId,
    };
    fires = [snoozeFire, ...fires].sort((a, b) => a.at - b.at).slice(0, 12);
  }

  // Capacitor native: OS local notifications are the kill-proof path — skip SW to avoid double-fire
  if (isNativeApp()) {
    // Never reschedule while a ringtone is actively playing — that used to kill the tone in <1s
    try {
      const { isNativeAlarmRinging } = await import("./alarm-fullscreen");
      if (await isNativeAlarmRinging()) {
        return true;
      }
    } catch {
      /* continue with sync */
    }
    if (!getBackgroundAlarmsEnabled()) {
      await cancelNativeAlarmNotifications();
      return false;
    }
    return syncNativeAlarmNotifications(fires, {
      soundType,
      customRingtoneId: soundType === "custom" ? customRingtoneId : undefined,
    });
  }

  if (!getBackgroundAlarmsEnabled() || notificationPermission() !== "granted") {
    await postToSw("CANCEL_SCHEDULE");
    return false;
  }

  const schedule: BgSchedule = {
    fires,
    soundType,
    customRingtoneId: soundType === "custom" ? customRingtoneId : undefined,
    updatedAt: Date.now(),
  };

  // Ensure SW is ready / controlling
  if (!navigator.serviceWorker?.controller) {
    await registerAlarmServiceWorker();
    // Wait briefly for controller after claim
    await new Promise((r) => setTimeout(r, 200));
  }

  const result = (await postToSw("SYNC_SCHEDULE", { schedule })) as { ok?: boolean };
  return Boolean(result?.ok);
}

export function subscribeBackgroundRing(onRing: (payload: BgRingPayload) => void): () => void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return () => undefined;

  const handler = (event: MessageEvent) => {
    const data = event.data;
    if (!data || data.type !== "ALARM_FIRE") return;
    if (!data.fire) return;
    onRing({
      fire: data.fire as ScheduledFire,
      soundType: data.soundType,
      customRingtoneId: data.customRingtoneId,
    });
  };

  navigator.serviceWorker.addEventListener("message", handler);
  return () => navigator.serviceWorker.removeEventListener("message", handler);
}

/** Keep screen awake while the alarm UI is ringing. */
export async function requestRingWakeLock(): Promise<WakeLockSentinel | null> {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return null;
  try {
    return await navigator.wakeLock.request("screen");
  } catch {
    return null;
  }
}

export async function releaseWakeLock(lock: WakeLockSentinel | null | undefined) {
  if (!lock) return;
  try {
    await lock.release();
  } catch {
    /* ignore */
  }
}

/**
 * Near-silent looping audio so browsers are less aggressive about freezing the tab
 * when the screen is off or the app is backgrounded. Must start after a user gesture.
 */
let keepaliveAudio: HTMLAudioElement | null = null;

export function startBackgroundKeepalive() {
  if (typeof window === "undefined") return;
  if (!getKeepaliveEnabled() || !getBackgroundAlarmsEnabled()) return;
  if (keepaliveAudio) return;

  // Tiny looping silent-ish WAV (very low amplitude) — keeps media session alive on many mobiles
  const audio = new Audio(
    "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=",
  );
  audio.loop = true;
  audio.volume = 0.01;
  audio.setAttribute("playsinline", "true");
  void audio.play().catch(() => {
    keepaliveAudio = null;
  });
  keepaliveAudio = audio;
}

export function stopBackgroundKeepalive() {
  if (!keepaliveAudio) return;
  try {
    keepaliveAudio.pause();
    keepaliveAudio.removeAttribute("src");
    keepaliveAudio.load();
  } catch {
    /* ignore */
  }
  keepaliveAudio = null;
}

export type UrlBgRing = {
  key?: string;
  title: string;
  speakText: string;
  voiceType: string;
  recordingId?: string;
  voiceURI?: string;
};

export function readPendingBgRingFromUrl(): UrlBgRing | null {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("bgRing") !== "1") return null;
    return {
      key: params.get("fireKey") || undefined,
      title: params.get("title") || "Alarm",
      speakText: params.get("speak") || "",
      voiceType: params.get("vt") || "female",
      recordingId: params.get("rid") || undefined,
      voiceURI: params.get("vuri") || undefined,
    };
  } catch {
    return null;
  }
}

export function clearBgRingQuery() {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    const keys = ["bgRing", "fireKey", "title", "speak", "vt", "rid", "vuri"];
    let changed = false;
    for (const k of keys) {
      if (url.searchParams.has(k)) {
        url.searchParams.delete(k);
        changed = true;
      }
    }
    if (changed) window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  } catch {
    /* ignore */
  }
}
