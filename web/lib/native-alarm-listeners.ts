import type { PluginListenerHandle } from "@capacitor/core";
import type { ScheduledFire } from "./next-fire";
import type { VoiceType } from "./types";
import { isNativeApp } from "./native";
import {
  ALARM_ACTION_SNOOZE,
  ALARM_ACTION_STOP,
  cancelDeliveredNativeNotification,
  ensureAlarmActionTypes,
  stableNotificationId,
} from "./native-alarms";
import {
  subscribeAlarmFullScreenEvents,
  type AlarmFullScreenPayload,
} from "./alarm-fullscreen";
import { SNOOZE_MS, type PendingSnooze } from "./pending-snooze";

export type NativeRingPayload = {
  fire: ScheduledFire;
  soundType?: string;
  customRingtoneId?: string;
  notificationId?: number;
};

export type NativeAlarmListenerHandlers = {
  onRing: (payload: NativeRingPayload) => void;
  onSnooze: (payload: PendingSnooze, notificationId?: number) => void;
  onStop: (payload: { fire?: ScheduledFire; notificationId?: number }) => void;
};

function extraToFire(extra: Record<string, unknown> | undefined, fallbackTitle?: string): ScheduledFire | null {
  if (!extra) return null;
  const key = String(extra.key || "");
  if (!key) return null;
  const typeRaw = String(extra.type || "alarm");
  const type: ScheduledFire["type"] =
    typeRaw === "todo" || typeRaw === "snooze" ? typeRaw : "alarm";
  return {
    at: Number(extra.at) || Date.now(),
    key,
    type,
    id: String(extra.fireId || extra.id || ""),
    title: String(extra.title || fallbackTitle || "Alarm"),
    speakText: String(extra.speakText || ""),
    voiceType: String(extra.voiceType || "female"),
    voiceURI: extra.voiceURI ? String(extra.voiceURI) : undefined,
    recordingId: extra.recordingId ? String(extra.recordingId) : undefined,
  };
}

function payloadFromFullScreen(p: AlarmFullScreenPayload): NativeRingPayload {
  return {
    fire: {
      at: p.at || Date.now(),
      key: p.key,
      type: (p.type === "todo" || p.type === "snooze" ? p.type : "alarm") as ScheduledFire["type"],
      id: p.fireId,
      title: p.title || "Alarm",
      speakText: p.speakText || "",
      voiceType: p.voiceType || "female",
      voiceURI: p.voiceURI,
      recordingId: p.recordingId,
    },
    soundType: p.soundType,
    customRingtoneId: p.customRingtoneId,
    notificationId: p.notificationId,
  };
}

function snoozeFromFire(fire: ScheduledFire): PendingSnooze {
  return {
    at: Date.now() + SNOOZE_MS,
    type: fire.type === "todo" ? "todo" : "alarm",
    title: fire.title || "Alarm",
    voiceType: (fire.voiceType as VoiceType) || "female",
    voiceURI: fire.voiceURI,
    recordingId: fire.recordingId,
    speakText: fire.speakText || "",
  };
}

/**
 * Wire Capacitor LocalNotifications + lock-screen activity into the ring/snooze/stop path.
 */
export async function subscribeNativeAlarmListeners(
  handlers: NativeAlarmListenerHandlers,
): Promise<() => void> {
  if (!isNativeApp()) return () => undefined;

  await ensureAlarmActionTypes();

  const handles: PluginListenerHandle[] = [];
  const { LocalNotifications } = await import("@capacitor/local-notifications");

  const ringFromExtra = (
    extra: Record<string, unknown> | undefined,
    notificationId?: number,
    title?: string,
  ) => {
    const fire = extraToFire(extra, title);
    if (!fire) return;
    handlers.onRing({
      fire,
      soundType: extra?.soundType ? String(extra.soundType) : undefined,
      customRingtoneId: extra?.customRingtoneId
        ? String(extra.customRingtoneId)
        : undefined,
      notificationId: notificationId ?? stableNotificationId(fire.key),
    });
  };

  handles.push(
    await LocalNotifications.addListener("localNotificationReceived", (notification) => {
      const extra = notification.extra as Record<string, unknown> | undefined;
      ringFromExtra(extra, notification.id, notification.title);
    }),
  );

  handles.push(
    await LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
      const notification = action.notification;
      const extra = notification.extra as Record<string, unknown> | undefined;
      const fire = extraToFire(extra, notification.title);
      const notificationId = notification.id;
      const actionId = action.actionId;

      if (actionId === ALARM_ACTION_SNOOZE && fire) {
        void cancelDeliveredNativeNotification(notificationId);
        handlers.onSnooze(snoozeFromFire(fire), notificationId);
        return;
      }

      if (actionId === ALARM_ACTION_STOP) {
        void cancelDeliveredNativeNotification(notificationId);
        handlers.onStop({ fire: fire || undefined, notificationId });
        return;
      }

      // Tap on notification body — open / ring
      if (actionId === "tap" && fire) {
        ringFromExtra(extra, notificationId, notification.title);
      }
    }),
  );

  const unsubFs = await subscribeAlarmFullScreenEvents({
    onFired: (p) => handlers.onRing(payloadFromFullScreen(p)),
    onStopped: (p) => {
      void cancelDeliveredNativeNotification(p.notificationId);
      handlers.onStop({
        fire: payloadFromFullScreen(p).fire,
        notificationId: p.notificationId,
      });
    },
    onSnoozed: (p) => {
      void cancelDeliveredNativeNotification(p.notificationId);
      const ring = payloadFromFullScreen(p);
      handlers.onSnooze(snoozeFromFire(ring.fire), p.notificationId);
    },
  });

  return () => {
    for (const h of handles) void h.remove();
    unsubFs();
  };
}
