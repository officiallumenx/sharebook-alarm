import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { ScheduledFire } from "./next-fire";
import { stableNotificationId } from "./native-alarms";
import { isNativeApp, nativePlatform } from "./native";

export type AlarmFullScreenPayload = {
  notificationId: number;
  key: string;
  type: string;
  fireId: string;
  title: string;
  speakText: string;
  voiceType: string;
  voiceURI?: string;
  recordingId?: string;
  soundType?: string;
  customRingtoneId?: string;
  at?: number;
};

type AlarmFullScreenPlugin = {
  schedule(options: {
    alarms: Array<{
      id: number;
      at: number;
      key: string;
      type: string;
      fireId: string;
      title: string;
      speakText: string;
      voiceType: string;
      voiceURI?: string;
      recordingId?: string;
      soundType?: string;
      customRingtoneId?: string;
      soundLabel?: string;
    }>;
  }): Promise<void>;
  cancelAll(): Promise<void>;
  cancel(options: { ids: number[] }): Promise<void>;
  checkFullScreenPermission(): Promise<{ granted: boolean }>;
  requestFullScreenPermission(): Promise<{ granted: boolean }>;
  requestIgnoreBatteryOptimizations(): Promise<{ requested: boolean }>;
  dismissNotification(options: { id: number }): Promise<void>;
  startAlarmTone(): Promise<void>;
  stopAlarmTone(): Promise<void>;
  isRinging(): Promise<{ ringing: boolean }>;
  presentRingingUi(options: {
    notificationId: number;
    title: string;
    extra?: Record<string, unknown>;
  }): Promise<void>;
  consumePendingEvent(): Promise<{
    hasEvent: boolean;
    event?: string;
    data?: AlarmFullScreenPayload;
  }>;
  addListener(
    eventName: "alarmFired" | "alarmStopped" | "alarmSnoozed",
    listenerFunc: (payload: AlarmFullScreenPayload) => void,
  ): Promise<PluginListenerHandle>;
};

const AlarmFullScreen = registerPlugin<AlarmFullScreenPlugin>("AlarmFullScreen");

export async function scheduleAlarmFullScreen(
  fires: ScheduledFire[],
  options?: { soundType?: string; customRingtoneId?: string },
): Promise<void> {
  if (!isNativeApp() || nativePlatform() !== "android") return;
  const { alarmSoundLabel } = await import("./alarm-sounds");
  const label = alarmSoundLabel(options?.soundType || "digital");
  const alarms = fires.map((fire) => ({
    id: stableNotificationId(fire.key),
    at: fire.at,
    key: fire.key,
    type: fire.type,
    fireId: fire.id,
    title: fire.title || "Alarm",
    speakText: fire.speakText || "",
    voiceType: fire.voiceType || "female",
    voiceURI: fire.voiceURI,
    recordingId: fire.recordingId,
    soundType: options?.soundType,
    customRingtoneId: options?.customRingtoneId,
    soundLabel: label,
  }));
  await AlarmFullScreen.schedule({ alarms });
}

export async function cancelAlarmFullScreen(): Promise<void> {
  if (!isNativeApp() || nativePlatform() !== "android") return;
  await AlarmFullScreen.cancelAll();
}

export async function checkFullScreenIntentPermission(): Promise<boolean> {
  if (!isNativeApp() || nativePlatform() !== "android") return true;
  try {
    const r = await AlarmFullScreen.checkFullScreenPermission();
    return Boolean(r?.granted);
  } catch {
    return true;
  }
}

export async function requestFullScreenIntentPermission(): Promise<boolean> {
  if (!isNativeApp() || nativePlatform() !== "android") return true;
  try {
    const r = await AlarmFullScreen.requestFullScreenPermission();
    return Boolean(r?.granted);
  } catch {
    return false;
  }
}

export async function requestIgnoreBatteryOptimizations(): Promise<void> {
  if (!isNativeApp() || nativePlatform() !== "android") return;
  try {
    await AlarmFullScreen.requestIgnoreBatteryOptimizations();
  } catch {
    /* ignore */
  }
}

export async function dismissFullScreenNotification(id: number): Promise<void> {
  if (!isNativeApp() || nativePlatform() !== "android") return;
  try {
    await AlarmFullScreen.dismissNotification({ id });
  } catch {
    /* ignore */
  }
}

/** Play looping beep on Android STREAM_ALARM (Alarm volume slider). */
export async function startNativeAlarmTone(): Promise<void> {
  if (!isNativeApp() || nativePlatform() !== "android") return;
  try {
    await AlarmFullScreen.startAlarmTone();
  } catch {
    /* ignore */
  }
}

export async function stopNativeAlarmTone(): Promise<void> {
  if (!isNativeApp() || nativePlatform() !== "android") return;
  try {
    await AlarmFullScreen.stopAlarmTone();
  } catch {
    /* ignore */
  }
}

export async function isNativeAlarmRinging(): Promise<boolean> {
  if (!isNativeApp() || nativePlatform() !== "android") return false;
  try {
    const r = await AlarmFullScreen.isRinging();
    return Boolean(r?.ringing);
  } catch {
    return false;
  }
}

/** Force the native lock/home ringing UI while the app process is alive. */
export async function presentNativeRingingUi(options: {
  notificationId: number;
  title: string;
  extra?: Record<string, unknown>;
}): Promise<void> {
  if (!isNativeApp() || nativePlatform() !== "android") return;
  try {
    await AlarmFullScreen.presentRingingUi(options);
  } catch {
    /* ignore */
  }
}

export async function subscribeAlarmFullScreenEvents(handlers: {
  onFired?: (p: AlarmFullScreenPayload) => void;
  onStopped?: (p: AlarmFullScreenPayload) => void;
  onSnoozed?: (p: AlarmFullScreenPayload) => void;
}): Promise<() => void> {
  if (!isNativeApp() || nativePlatform() !== "android") return () => undefined;
  const handles: PluginListenerHandle[] = [];
  try {
    if (handlers.onFired) {
      handles.push(await AlarmFullScreen.addListener("alarmFired", handlers.onFired));
    }
    if (handlers.onStopped) {
      handles.push(await AlarmFullScreen.addListener("alarmStopped", handlers.onStopped));
    }
    if (handlers.onSnoozed) {
      handles.push(await AlarmFullScreen.addListener("alarmSnoozed", handlers.onSnoozed));
    }
    // Replay Stop/Snooze taken while the WebView process was dead
    const pending = await AlarmFullScreen.consumePendingEvent();
    if (pending.hasEvent && pending.data && pending.event) {
      if (pending.event === "alarmStopped") handlers.onStopped?.(pending.data);
      if (pending.event === "alarmSnoozed") handlers.onSnoozed?.(pending.data);
      if (pending.event === "alarmFired") handlers.onFired?.(pending.data);
    }
  } catch (e) {
    console.warn("Full-screen alarm listeners failed", e);
  }
  return () => {
    for (const h of handles) void h.remove();
  };
}
