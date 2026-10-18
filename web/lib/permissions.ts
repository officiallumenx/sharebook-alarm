import { audioSynth } from "./audio-synth";
import {
  ensureNotificationPermission,
  notificationPermission,
  registerAlarmServiceWorker,
  setBackgroundAlarmsEnabled,
} from "./background-alarms";
import { isNativeApp, nativePlatform } from "./native";
import { VOICE_MIC_CONSTRAINTS } from "./voice-capture";

export type PermStatus = "granted" | "denied" | "prompt" | "unsupported" | "unknown";

export type AppPermissionId =
  | "notifications"
  | "microphone"
  | "audio"
  | "storage"
  | "exactAlarms"
  | "fullScreen";

export type AppPermissionState = Record<AppPermissionId, PermStatus>;

const ONBOARDED_KEY = "chrono_perms_onboarded";
const INSTALL_PROMPTED_KEY = "chrono_install_prompt_seen";

export function hasCompletedPermissionsOnboarding(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(ONBOARDED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markPermissionsOnboardingDone() {
  try {
    localStorage.setItem(ONBOARDED_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function resetPermissionsOnboarding() {
  try {
    localStorage.removeItem(ONBOARDED_KEY);
  } catch {
    /* ignore */
  }
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  // Capacitor APK is always an installed app
  if (isNativeApp()) return true;
  const mq = window.matchMedia?.("(display-mode: standalone)").matches;
  const iosStandalone = Boolean(
    (navigator as unknown as { standalone?: boolean }).standalone,
  );
  return Boolean(mq || iosStandalone);
}

async function getNativeNotificationStatus(): Promise<PermStatus> {
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display === "granted") return "granted";
    if (perm.display === "denied") return "denied";
    return "prompt";
  } catch {
    return "prompt";
  }
}

async function getNativeExactAlarmStatus(): Promise<PermStatus> {
  if (nativePlatform() !== "android") return "unsupported";
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const exact = await LocalNotifications.checkExactNotificationSetting();
    if (exact.exact_alarm === "granted") return "granted";
    return "prompt";
  } catch {
    return "unsupported";
  }
}

async function getNativeFullScreenStatus(): Promise<PermStatus> {
  if (nativePlatform() !== "android") return "unsupported";
  try {
    const { checkFullScreenIntentPermission } = await import("./alarm-fullscreen");
    const granted = await checkFullScreenIntentPermission();
    return granted ? "granted" : "prompt";
  } catch {
    return "prompt";
  }
}

export async function getPermissionStates(): Promise<AppPermissionState> {
  let notifications: PermStatus;
  let exactAlarms: PermStatus = "unsupported";
  let fullScreen: PermStatus = "unsupported";

  if (isNativeApp()) {
    notifications = await getNativeNotificationStatus();
    exactAlarms = await getNativeExactAlarmStatus();
    fullScreen = await getNativeFullScreenStatus();
  } else {
    notifications = mapNotification(notificationPermission());
  }

  let microphone: PermStatus = "unsupported";
  if (typeof navigator !== "undefined" && navigator.permissions?.query) {
    try {
      const mic = await navigator.permissions.query({
        name: "microphone" as PermissionName,
      });
      microphone = mapPermissionState(mic.state);
    } catch {
      microphone =
        typeof navigator.mediaDevices?.getUserMedia === "function" ? "prompt" : "unsupported";
    }
  } else if (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  ) {
    microphone = "prompt";
  }

  let storage: PermStatus = "unsupported";
  if (!isNativeApp() && typeof navigator !== "undefined" && typeof navigator.storage?.persisted === "function") {
    try {
      storage = (await navigator.storage.persisted()) ? "granted" : "prompt";
    } catch {
      storage = "unknown";
    }
  } else if (isNativeApp()) {
    // App private storage — always available on native
    storage = "granted";
  }

  let audio: PermStatus = "prompt";
  try {
    if (audioSynth.ctx?.state === "running") {
      audio = "granted";
    } else if (typeof window !== "undefined") {
      const hasAC = Boolean(
        window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext,
      );
      audio = hasAC ? "prompt" : "unsupported";
    } else {
      audio = "unsupported";
    }
  } catch {
    audio = "unknown";
  }

  // On native Android, alarm tone uses STREAM_ALARM — audio unlock still helps in-app UI
  if (isNativeApp() && audio === "prompt") {
    // leave as prompt until user taps Allow
  }

  return { notifications, microphone, audio, storage, exactAlarms, fullScreen };
}

function mapNotification(p: NotificationPermission | "unsupported"): PermStatus {
  if (p === "unsupported") return "unsupported";
  if (p === "granted") return "granted";
  if (p === "denied") return "denied";
  return "prompt";
}

function mapPermissionState(state: PermissionState): PermStatus {
  if (state === "granted") return "granted";
  if (state === "denied") return "denied";
  return "prompt";
}

export async function requestNotificationAccess(): Promise<PermStatus> {
  if (isNativeApp()) {
    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");
      const asked = await LocalNotifications.requestPermissions();
      if (asked.display === "granted") {
        setBackgroundAlarmsEnabled(true);
        return "granted";
      }
      return asked.display === "denied" ? "denied" : "prompt";
    } catch {
      return "denied";
    }
  }

  await registerAlarmServiceWorker();
  const result = await ensureNotificationPermission();
  if (result === "granted") {
    setBackgroundAlarmsEnabled(true);
  }
  return mapNotification(result);
}

export async function requestExactAlarmAccess(): Promise<PermStatus> {
  if (!isNativeApp() || nativePlatform() !== "android") return "unsupported";
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const exact = await LocalNotifications.checkExactNotificationSetting();
    if (exact.exact_alarm === "granted") return "granted";
    await LocalNotifications.changeExactNotificationSetting();
    const again = await LocalNotifications.checkExactNotificationSetting();
    return again.exact_alarm === "granted" ? "granted" : "prompt";
  } catch {
    return "unsupported";
  }
}

export async function requestFullScreenAccess(): Promise<PermStatus> {
  if (!isNativeApp() || nativePlatform() !== "android") return "unsupported";
  try {
    const { requestFullScreenIntentPermission, requestIgnoreBatteryOptimizations } =
      await import("./alarm-fullscreen");
    const granted = await requestFullScreenIntentPermission();
    await requestIgnoreBatteryOptimizations();
    try {
      localStorage.setItem("chrono_fsi_ok", granted ? "1" : "0");
    } catch {
      /* ignore */
    }
    return granted ? "granted" : "prompt";
  } catch {
    return "denied";
  }
}

/** Briefly open the mic then stop — unlocks recording for later alarms/voices. */
export async function requestMicrophoneAccess(): Promise<PermStatus> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return "unsupported";
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: VOICE_MIC_CONSTRAINTS,
    });
    stream.getTracks().forEach((t) => t.stop());
    return "granted";
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "PermissionDeniedError") return "denied";
    return "denied";
  }
}

/** Unlock Web Audio so ringtones / voice can play after install. */
export async function requestAudioAccess(): Promise<PermStatus> {
  try {
    await audioSynth.prime();
    audioSynth.playClick();
    if (audioSynth.ctx?.state === "running" || audioSynth.ctx?.state === "suspended") {
      await audioSynth.ctx.resume().catch(() => undefined);
      return audioSynth.ctx.state === "running" ? "granted" : "prompt";
    }
    return audioSynth.ctx ? "granted" : "unsupported";
  } catch {
    return "denied";
  }
}

export async function requestPersistentStorage(): Promise<PermStatus> {
  if (isNativeApp()) return "granted";
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return "unsupported";
  }
  try {
    const ok = await navigator.storage.persist();
    return ok ? "granted" : "prompt";
  } catch {
    return "denied";
  }
}

export type PermissionRequestResult = {
  states: AppPermissionState;
  allCriticalOk: boolean;
  openedSystemSettings: boolean;
};

/** Request every permission the alarm app needs (call from a user tap). */
export async function requestAllAppPermissions(): Promise<PermissionRequestResult> {
  let openedSystemSettings = false;

  // Order matters: audio first (gesture), then OS dialogs
  await requestAudioAccess();
  const notif = await requestNotificationAccess();
  await requestMicrophoneAccess();

  if (isNativeApp() && nativePlatform() === "android") {
    const exactBefore = await getNativeExactAlarmStatus();
    if (exactBefore !== "granted") {
      openedSystemSettings = true;
      await requestExactAlarmAccess();
    }
    const fsi = await requestFullScreenAccess();
    if (fsi !== "granted") openedSystemSettings = true;
  } else {
    await requestPersistentStorage();
  }

  const states = await getPermissionStates();
  if (audioSynth.ctx?.state === "running") states.audio = "granted";
  if (notif === "granted") states.notifications = "granted";

  const allCriticalOk =
    (states.notifications === "granted" || states.notifications === "unsupported") &&
    (states.microphone === "granted" || states.microphone === "unsupported" || states.microphone === "prompt") &&
    (states.audio === "granted" || states.audio === "prompt");

  // Don't mark done if notifications were denied — user should retry
  if (states.notifications === "granted" || states.notifications === "unsupported") {
    markPermissionsOnboardingDone();
  }

  return { states, allCriticalOk, openedSystemSettings };
}

export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferredInstall: InstallPromptEvent | null = null;

export function captureInstallPrompt(e: Event) {
  e.preventDefault();
  deferredInstall = e as InstallPromptEvent;
}

export function getDeferredInstallPrompt() {
  return deferredInstall;
}

export function clearDeferredInstallPrompt() {
  deferredInstall = null;
}

export async function promptInstallApp(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (isNativeApp()) return "unavailable";
  const ev = deferredInstall;
  if (!ev) return "unavailable";
  try {
    await ev.prompt();
    const choice = await ev.userChoice;
    clearDeferredInstallPrompt();
    try {
      localStorage.setItem(INSTALL_PROMPTED_KEY, "1");
    } catch {
      /* ignore */
    }
    return choice.outcome;
  } catch {
    return "unavailable";
  }
}

export function shouldOfferInstall(): boolean {
  if (typeof window === "undefined") return false;
  if (isNativeApp()) return false;
  if (isStandaloneDisplay()) return false;
  return Boolean(deferredInstall);
}
