import type { ScheduledFire } from "./next-fire";
import { isNativeApp, nativePlatform } from "./native";

export const ALARM_CHANNEL_ID = "smart_voice_alarms_v4";
export const ALARM_ACTION_TYPE_ID = "ALARM_RING";
export const ALARM_ACTION_SNOOZE = "SNOOZE";
export const ALARM_ACTION_STOP = "STOP";

/** Stable positive notification id from fire key (Android-safe range). */
export function stableNotificationId(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (Math.abs(h) % 90_000) + 10_000;
}

export async function ensureAlarmActionTypes(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.registerActionTypes({
      types: [
        {
          id: ALARM_ACTION_TYPE_ID,
          actions: [
            { id: ALARM_ACTION_SNOOZE, title: "Snooze 5m" },
            { id: ALARM_ACTION_STOP, title: "Stop", destructive: true },
          ],
        },
      ],
    });
  } catch (e) {
    console.warn("Alarm action types failed", e);
  }
}

/**
 * Schedule exact local notifications on native.
 * Android uses the AlarmFullScreen plugin (sound + actions + lock-screen UI).
 * Other platforms use Capacitor LocalNotifications.
 */
export async function syncNativeAlarmNotifications(
  fires: ScheduledFire[],
  options?: { soundType?: string; customRingtoneId?: string },
): Promise<boolean> {
  if (!isNativeApp()) return false;

  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");

    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== "granted") {
      const asked = await LocalNotifications.requestPermissions();
      if (asked.display !== "granted") return false;
    }

    try {
      const exact = await LocalNotifications.checkExactNotificationSetting();
      if (exact.exact_alarm !== "granted") {
        await LocalNotifications.changeExactNotificationSetting();
      }
    } catch {
      /* API level / plugin may not support */
    }

    await ensureAlarmActionTypes();

    try {
      await LocalNotifications.createChannel({
        id: ALARM_CHANNEL_ID,
        name: "Alarms",
        description: "Sharebook alarm and reminder alerts",
        importance: 5,
        visibility: 1,
        vibration: true,
        sound: "beep.wav",
      });
    } catch {
      /* channel may already exist */
    }

    const now = Date.now();
    const upcomingFires = fires.filter((f) => f.at > now + 2000).slice(0, 20);

    // Android: custom plugin owns schedule (full-screen intent + actions + tone)
    if (nativePlatform() === "android") {
      try {
        const { syncNativeRingtone } = await import("./native-ringtone");
        await syncNativeRingtone(
          options?.soundType || "digital",
          options?.customRingtoneId,
        );
      } catch {
        /* ringtone sync best-effort */
      }
      const { scheduleAlarmFullScreen, cancelAlarmFullScreen } = await import(
        "./alarm-fullscreen"
      );
      await cancelAlarmFullScreen();
      // Clear any leftover Capacitor-scheduled alarms from older builds
      try {
        const pending = await LocalNotifications.getPending();
        if (pending.notifications.length) {
          await LocalNotifications.cancel({
            notifications: pending.notifications.map((n) => ({ id: n.id })),
          });
        }
      } catch {
        /* ignore */
      }
      if (upcomingFires.length) {
        await scheduleAlarmFullScreen(upcomingFires, {
          soundType: options?.soundType,
          customRingtoneId: options?.customRingtoneId,
        });
      }
      return true;
    }

    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) {
      await LocalNotifications.cancel({
        notifications: pending.notifications.map((n) => ({ id: n.id })),
      });
    }

    const upcoming = upcomingFires.map((fire) => ({
      id: stableNotificationId(fire.key),
      title: fire.title || "Alarm",
      body:
        options?.soundType === "custom"
          ? "Custom ringtone — open Sharebook to hear your voice"
          : "Alarm is ringing",
      schedule: {
        at: new Date(fire.at),
        allowWhileIdle: true,
      },
      channelId: ALARM_CHANNEL_ID,
      sound: "beep.wav",
      ongoing: true,
      autoCancel: false,
      actionTypeId: ALARM_ACTION_TYPE_ID,
      isExactMandatory: true,
      extra: {
        key: fire.key,
        type: fire.type,
        fireId: fire.id,
        recordingId: fire.recordingId || "",
        speakText: fire.speakText || "",
        voiceType: fire.voiceType || "female",
        voiceURI: fire.voiceURI || "",
        title: fire.title || "Alarm",
        at: fire.at,
        soundType: options?.soundType || "nature",
        customRingtoneId: options?.customRingtoneId || "",
      },
    }));

    if (upcoming.length) {
      await LocalNotifications.schedule({ notifications: upcoming });
    }
    return true;
  } catch (e) {
    console.warn("Native alarm schedule failed", e);
    return false;
  }
}

export async function cancelNativeAlarmNotifications(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) {
      await LocalNotifications.cancel({
        notifications: pending.notifications.map((n) => ({ id: n.id })),
      });
    }
  } catch {
    /* ignore */
  }
  if (nativePlatform() === "android") {
    try {
      const { cancelAlarmFullScreen } = await import("./alarm-fullscreen");
      await cancelAlarmFullScreen();
    } catch {
      /* ignore */
    }
  }
}

export async function cancelDeliveredNativeNotification(id: number): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.removeDeliveredNotifications({
      notifications: [{ id, title: "", body: "" }],
    });
  } catch {
    /* ignore */
  }
  if (nativePlatform() === "android") {
    try {
      const { dismissFullScreenNotification } = await import("./alarm-fullscreen");
      await dismissFullScreenNotification(id);
    } catch {
      /* ignore */
    }
  }
}

export async function requestNativeAlarmPermissions(): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const asked = await LocalNotifications.requestPermissions();
    if (asked.display !== "granted") return false;
    try {
      const exact = await LocalNotifications.checkExactNotificationSetting();
      if (exact.exact_alarm !== "granted") {
        await LocalNotifications.changeExactNotificationSetting();
      }
    } catch {
      /* ignore */
    }
    if (nativePlatform() === "android") {
      try {
        const { requestFullScreenIntentPermission, requestIgnoreBatteryOptimizations } =
          await import("./alarm-fullscreen");
        await requestFullScreenIntentPermission();
        await requestIgnoreBatteryOptimizations();
      } catch {
        /* ignore */
      }
    }
    return true;
  } catch {
    return false;
  }
}
