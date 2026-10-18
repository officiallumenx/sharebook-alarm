import { alarmSoundLabel } from "./alarm-sounds";
import { isNativeApp, nativePlatform } from "./native";
import { getRingtone } from "./ringtones";

/** Safe base64 for large audio blobs (avoid spread-arg stack limits). */
export async function blobToBase64(blob: Blob): Promise<string> {
  // FileReader path — reliable for multi‑MB ringtone files
  if (typeof FileReader !== "undefined") {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("read failed"));
      reader.readAsDataURL(blob);
    });
    const comma = dataUrl.indexOf(",");
    if (comma >= 0) return dataUrl.slice(comma + 1);
  }

  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x2000; // 8KB — safe for apply/spread limits
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, Array.from(slice) as unknown as number[]);
  }
  return btoa(binary);
}

type SetRingtonePlugin = {
  setRingtone(options: {
    useBuiltIn?: boolean;
    base64?: string;
    mimeType?: string;
    soundType: string;
    label: string;
  }): Promise<void>;
};

/**
 * Push the user's selected Sharebook ringtone to Android so kill-state
 * alarms play that file on STREAM_ALARM (not the phone default ringtone).
 */
export async function syncNativeRingtone(
  soundType: string,
  customRingtoneId?: string,
): Promise<void> {
  if (!isNativeApp() || nativePlatform() !== "android") return;

  try {
    const { registerPlugin } = await import("@capacitor/core");
    const AlarmFullScreen = registerPlugin<SetRingtonePlugin>("AlarmFullScreen");

    if (soundType === "custom" && customRingtoneId?.trim()) {
      const tone = await getRingtone(customRingtoneId.trim());
      if (tone?.blob && tone.blob.size > 0) {
        const base64 = await blobToBase64(tone.blob);
        await AlarmFullScreen.setRingtone({
          base64,
          mimeType: tone.mimeType || "audio/mpeg",
          soundType: "custom",
          label: alarmSoundLabel("custom", tone.name),
        });
        return;
      }
    }

    await AlarmFullScreen.setRingtone({
      useBuiltIn: true,
      soundType: soundType || "digital",
      label: alarmSoundLabel(soundType || "digital"),
    });
  } catch (e) {
    console.warn("syncNativeRingtone failed", e);
  }
}

export function nativeSoundLabel(soundType: string, customName?: string) {
  return alarmSoundLabel(soundType, customName);
}
