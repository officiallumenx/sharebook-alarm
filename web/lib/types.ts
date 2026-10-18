export type VoiceType = "female" | "male" | "child";
export type MainMode = "suite" | "notes" | "todo" | "voices";
export type SuiteTab = "clock" | "alarm" | "timer" | "stopwatch" | "settings";
/** Alarm tab slot: dashboard hub or one feature at a time. */
export type AlarmSlot = "dashboard" | "alarm" | "notes" | "todo";
export type AlarmVoiceSource = "tts" | "recording";
/** Light / dark appearance */
export type ThemeMode = "light" | "dark";
/** Color family — bronze is the original luxury brown theme */
export type ThemePalette = "bronze" | "olive" | "mono";

export const THEME_PALETTES: {
  id: ThemePalette;
  title: string;
  caption: string;
  swatch: [string, string, string];
}[] = [
  {
    id: "bronze",
    title: "Bronze",
    caption: "Warm luxury brown",
    swatch: ["#f8f6f2", "#8b7355", "#1c1917"],
  },
  {
    id: "olive",
    title: "Olive",
    caption: "Olive green & white",
    swatch: ["#f6f8f2", "#6b7f3a", "#1a1f14"],
  },
  {
    id: "mono",
    title: "Mono",
    caption: "Black & white",
    swatch: ["#f5f5f5", "#171717", "#ffffff"],
  },
];

export type AlarmRepeatMode = "once" | "repeat";

export interface Alarm {
  id: string;
  time: string;
  label: string;
  enabled: boolean;
  repeatDays: number[];
  /** Specific calendar date as YYYY-MM-DD; empty/undefined = no fixed date */
  date?: string;
  /** Chosen on save popup: rings once then off, or keeps repeating */
  repeatMode?: AlarmRepeatMode;
  /** Built-in id (digital, waterfall, birds…) or "custom" */
  sound: string;
  /** IndexedDB custom ringtone id when sound === "custom" */
  customRingtoneId?: string;
  voiceType: VoiceType;
  /** Optional free OS voice URI from speechSynthesis.getVoices() */
  voiceURI?: string;
  /** Use recorded clip instead of TTS when set to recording */
  voiceSource?: AlarmVoiceSource;
  /** IndexedDB voice clip id */
  recordingId?: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  category: string;
  color: string;
  pinned: boolean;
  voiceType: VoiceType;
}

export interface TodoItem {
  id: string;
  title: string;
  category?: string;
  priority?: string;
  completed: boolean;
  date: string;
  time: string;
  reminder: string;
  voiceType: VoiceType;
}

export interface RingEvent {
  id: string;
  type: string;
  title: string;
  sound: string;
  voiceType: VoiceType;
  recordingId?: string;
}

export const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const WORLD_CITIES = [
  { name: "New York", zone: "America/New_York" },
  { name: "London", zone: "Europe/London" },
  { name: "Tokyo", zone: "Asia/Tokyo" },
  { name: "Sydney", zone: "Australia/Sydney" },
  { name: "Dubai", zone: "Asia/Dubai" },
] as const;

export function formatStopwatchTime(ms: number) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const centiseconds = Math.floor((ms % 1000) / 10);
  return {
    mins: String(minutes).padStart(2, "0"),
    secs: String(seconds).padStart(2, "0"),
    ms: String(centiseconds).padStart(2, "0"),
  };
}

export function formatDisplayTime(dateObj: Date, is24Hour: boolean) {
  let hours = dateObj.getHours();
  const minutes = String(dateObj.getMinutes()).padStart(2, "0");
  const seconds = String(dateObj.getSeconds()).padStart(2, "0");
  let ampm = "";

  if (!is24Hour) {
    ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
  }

  return {
    hoursStr: String(hours).padStart(2, "0"),
    minutes,
    seconds,
    ampm,
  };
}

export function todayISO() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}
