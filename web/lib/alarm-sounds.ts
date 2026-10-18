export type BuiltInAlarmSoundId =
  | "digital"
  | "gentle"
  | "chime"
  | "waterfall"
  | "birds"
  | "rain"
  | "ocean"
  | "forest";

export type AlarmSoundKind = "beep" | "nature" | "custom";

export type AlarmSoundOption = {
  id: BuiltInAlarmSoundId | "custom";
  title: string;
  caption: string;
  kind: AlarmSoundKind;
};

export const BUILT_IN_ALARM_SOUNDS: AlarmSoundOption[] = [
  { id: "digital", title: "Digital", caption: "Classic beep", kind: "beep" },
  { id: "gentle", title: "Gentle", caption: "Soft rise", kind: "beep" },
  { id: "chime", title: "Chime", caption: "Light bell", kind: "beep" },
  { id: "waterfall", title: "Waterfall", caption: "Flowing water", kind: "nature" },
  { id: "birds", title: "Birds", caption: "Morning cheer", kind: "nature" },
  { id: "rain", title: "Rain", caption: "Soft rainfall", kind: "nature" },
  { id: "ocean", title: "Ocean", caption: "Waves & breeze", kind: "nature" },
  { id: "forest", title: "Forest", caption: "Leaves & birds", kind: "nature" },
  { id: "custom", title: "Custom", caption: "Your ringtone file", kind: "custom" },
];

export function isNatureSound(id: string): boolean {
  return ["waterfall", "birds", "rain", "ocean", "forest"].includes(id);
}

export function isBeepSound(id: string): boolean {
  return id === "digital" || id === "gentle" || id === "chime";
}

export function alarmSoundLabel(id: string, customName?: string): string {
  if (id === "custom") return customName?.trim() || "Custom ringtone";
  return BUILT_IN_ALARM_SOUNDS.find((s) => s.id === id)?.title || id;
}
