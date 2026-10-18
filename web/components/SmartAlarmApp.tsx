"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  AlarmClock,
  CheckSquare,
  Clock3,
  BookOpen,
  Globe,
  Home,
  LogIn,
  LogOut,
  Menu,
  Mic,
  Settings,
  Timer,
  UserRound,
  Watch,
  X,
} from "lucide-react";
import { audioSynth } from "@/lib/audio-synth";
import {
  clearBgRingQuery,
  ensureNotificationPermission,
  getBackgroundAlarmsEnabled,
  getKeepaliveEnabled,
  notificationPermission,
  readPendingBgRingFromUrl,
  registerAlarmServiceWorker,
  releaseWakeLock,
  requestRingWakeLock,
  startBackgroundKeepalive,
  stopBackgroundKeepalive,
  subscribeBackgroundRing,
  syncBackgroundSchedule,
} from "@/lib/background-alarms";
import { collectUpcomingFires } from "@/lib/next-fire";
import { presentNativeRingingUi, stopNativeAlarmTone } from "@/lib/alarm-fullscreen";
import { initNativeShell, isNativeApp, nativePlatform } from "@/lib/native";
import { subscribeNativeAlarmListeners } from "@/lib/native-alarm-listeners";
import { stableNotificationId } from "@/lib/native-alarms";
import {
  readStoredSnooze,
  snoozeFireKey,
  SNOOZE_MS,
  writeStoredSnooze,
  type PendingSnooze,
} from "@/lib/pending-snooze";
import { spokenAlarmText } from "@/lib/spoken-label";
import {
  getCurrentUser,
  isGuestUser,
  logout as authLogout,
  updateUserProfile,
  type PublicUser,
} from "@/lib/auth";
import type {
  Alarm,
  AlarmSlot,
  MainMode,
  Note,
  RingEvent,
  SuiteTab,
  ThemeMode,
  ThemePalette,
  TodoItem,
  VoiceType,
} from "@/lib/types";
import { todayISO } from "@/lib/types";

const PALETTE_CLASSES = ["theme-olive", "theme-mono"] as const;

function applyTheme(mode: ThemeMode, palette: ThemePalette) {
  const root = document.documentElement;
  root.classList.remove(...PALETTE_CLASSES);
  if (palette === "olive") root.classList.add("theme-olive");
  if (palette === "mono") root.classList.add("theme-mono");
  root.classList.toggle("dark", mode === "dark");
  root.style.colorScheme = mode === "dark" ? "dark" : "light";
  root.dataset.palette = palette;
}
import { AuthRequiredDialog } from "@/components/auth/AuthRequiredDialog";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { PermissionsOnboarding } from "@/components/PermissionsOnboarding";
import ClockView from "@/components/views/ClockView";
import { AlarmModal, AlarmView, RingingModal } from "@/components/views/AlarmView";
import { TimerView, type TimerInput } from "@/components/views/TimerView";
import { StopwatchView, type StopwatchLap } from "@/components/views/StopwatchView";
import { SettingsView } from "@/components/views/SettingsView";
import { NotesView } from "@/components/views/NotesView";
import { TodoView } from "@/components/views/TodoView";
import { DashboardView } from "@/components/views/DashboardView";
import { MyVoicesView } from "@/components/views/MyVoicesView";
import {
  captureInstallPrompt,
  hasCompletedPermissionsOnboarding,
  isStandaloneDisplay,
} from "@/lib/permissions";
function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function loadJsonArray<T>(key: string, fallback: T[]): T[] {
  const parsed = loadJson<unknown>(key, fallback);
  return Array.isArray(parsed) ? (parsed as T[]) : fallback;
}

function safeSetItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.warn(`localStorage write failed for ${key}`, e);
    return false;
  }
}

const defaultAlarms: Alarm[] = [
  {
    id: "1",
    time: "07:00",
    label: "",
    enabled: true,
    repeatDays: [1, 2, 3, 4, 5],
    repeatMode: "repeat",
    sound: "digital",
    voiceType: "female",
  },
];

const defaultNotes: Note[] = [
  {
    id: "1",
    title: "Morning Affirmation",
    content: "Drink 500ml water and focus on deep work blocks today.",
    category: "Personal",
    color: "brand",
    pinned: true,
    voiceType: "female",
  },
];

function defaultTodos(): TodoItem[] {
  return [
    {
      id: "1",
      title: "Morning Smoothie & Workout",
      category: "Health",
      priority: "High",
      completed: false,
      date: todayISO(),
      time: "07:00",
      reminder: "at_time",
      voiceType: "female",
    },
  ];
}

export default function SmartAlarmApp() {
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [palette, setPalette] = useState<ThemePalette>("bronze");
  const [is24Hour, setIs24Hour] = useState(false);
  const [soundType, setSoundType] = useState("digital");
  const [customRingtoneId, setCustomRingtoneId] = useState("");
  const [mainMode, setMainMode] = useState<MainMode>("suite");
  const [activeTab, setActiveTab] = useState<SuiteTab>("alarm");
  const [alarmSlot, setAlarmSlot] = useState<AlarmSlot>("dashboard");
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const triggeredRef = useRef<Record<string, boolean>>({});
  const triggeredMinuteRef = useRef("");

  const [alarms, setAlarms] = useState<Alarm[]>(defaultAlarms);
  const [notes, setNotes] = useState<Note[]>(defaultNotes);
  const [todos, setTodos] = useState<TodoItem[]>([]);

  const [isAddAlarmOpen, setIsAddAlarmOpen] = useState(false);
  const [editingAlarm, setEditingAlarm] = useState<Alarm | null>(null);
  const [activeRingEvent, setActiveRingEvent] = useState<RingEvent | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authPromptOpen, setAuthPromptOpen] = useState(false);

  const goToAuth = (mode: "login" | "register" = "login") => {
    authLogout();
    setAuthMode(mode);
    setUser(null);
    setIsMenuOpen(false);
    setAuthPromptOpen(false);
  };
  const [permsOpen, setPermsOpen] = useState(false);
  const [permsReason, setPermsReason] = useState<"setup" | "install" | "settings">("setup");

  const alarmsRef = useRef(alarms);
  const todosRef = useRef(todos);
  const soundTypeRef = useRef(soundType);
  const customRingtoneIdRef = useRef(customRingtoneId);
  /** Temporary snooze — rings again without adding an alarm to the list */
  const snoozeRef = useRef<PendingSnooze | null>(null);
  const snoozeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const bgRingHandledRef = useRef<Record<string, number>>({});
  const lastRingRef = useRef<{
    type: string;
    title: string;
    voiceType: VoiceType;
    voiceURI?: string;
    recordingId?: string;
    speakText: string;
  } | null>(null);
  const triggerRingingRef = useRef<
    (
      type: string,
      title: string,
      sound: string,
      voiceType: VoiceType,
      voiceURI?: string,
      recordingId?: string,
      customRingtoneId?: string,
      speakText?: string,
    ) => void
  >(() => undefined);
  const dismissRingRef = useRef<() => void>(() => undefined);
  /** True while native AlarmRingService is already owning tone + lock UI */
  const nativeRingSessionRef = useRef(false);
  alarmsRef.current = alarms;
  todosRef.current = todos;
  soundTypeRef.current = soundType;
  customRingtoneIdRef.current = customRingtoneId;

  const [timerInput, setTimerInput] = useState<TimerInput>({ hours: 0, mins: 5, secs: 0 });
  const [timerTotalSecs, setTimerTotalSecs] = useState(300);
  const [timerRemainingSecs, setTimerRemainingSecs] = useState(300);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [isTimerPaused, setIsTimerPaused] = useState(false);
  /** Prevents Strict Mode double-fire when countdown hits zero */
  const timerFiredRef = useRef(false);

  const setIsTimerRunningSafe: typeof setIsTimerRunning = (update) => {
    setIsTimerRunning((prev) => {
      const next = typeof update === "function" ? update(prev) : update;
      if (next) timerFiredRef.current = false;
      return next;
    });
  };

  const [swTime, setSwTime] = useState(0);
  const [isSwRunning, setIsSwRunning] = useState(false);
  const [swLaps, setSwLaps] = useState<StopwatchLap[]>([]);

  // useLayoutEffect runs before paint on the client — avoids getting stuck on SSR "Loading…"
  useLayoutEffect(() => {
    try {
      // Drop corrupt pending snooze that could wedge boot
      try {
        const snooze = readStoredSnooze();
        if (snooze && (typeof snooze.at !== "number" || Number.isNaN(snooze.at))) {
          writeStoredSnooze(null);
        }
      } catch {
        writeStoredSnooze(null);
      }

      const savedTheme = localStorage.getItem("chrono_theme");
      const nextMode: ThemeMode = savedTheme === "dark" ? "dark" : "light";
      const savedPalette = localStorage.getItem("chrono_palette");
      const nextPalette: ThemePalette =
        savedPalette === "olive" || savedPalette === "mono" || savedPalette === "bronze"
          ? savedPalette
          : "bronze";
      setTheme(nextMode);
      setPalette(nextPalette);
      applyTheme(nextMode, nextPalette);
      setIs24Hour(localStorage.getItem("chrono_24h") === "true");
      setSoundType(localStorage.getItem("chrono_sound") || "digital");
      setCustomRingtoneId(localStorage.getItem("chrono_custom_ringtone") || "");
      setAlarms(
        loadJsonArray<Alarm>("chrono_alarms", defaultAlarms).map((a) => {
          const recordingId =
            typeof a?.recordingId === "string" && a.recordingId.trim()
              ? a.recordingId.trim()
              : undefined;
          return {
            ...a,
            id: String(a?.id ?? Date.now()),
            time: typeof a?.time === "string" ? a.time : "07:00",
            enabled: Boolean(a?.enabled),
            repeatDays: Array.isArray(a?.repeatDays) ? a.repeatDays : [],
            // Old saves auto-filled a label; treat those as ringtone-only
            label: spokenAlarmText(a?.label),
            sound: typeof a?.sound === "string" ? a.sound : "digital",
            voiceType: a?.voiceType === "male" || a?.voiceType === "child" ? a.voiceType : "female",
            recordingId,
            voiceSource: recordingId
              ? ("recording" as const)
              : a?.voiceSource === "recording"
                ? ("recording" as const)
                : ("tts" as const),
          };
        }),
      );
      setNotes(loadJsonArray<Note>("chrono_notes", defaultNotes));
      setTodos(loadJsonArray<TodoItem>("chrono_todos", defaultTodos()));
      setUser(getCurrentUser());
    } catch (e) {
      console.error("Failed to restore local data", e);
    } finally {
      setReady(true);
    }
  }, []);

  // Absolute failsafe: never stay on Loading longer than 1s after mount
  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), 1000);
    return () => window.clearTimeout(id);
  }, []);

  // Capacitor Android/iOS chrome (status bar / splash) — no-op on web
  useEffect(() => {
    if (!ready) return;
    void initNativeShell();
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    safeSetItem("chrono_theme", theme);
    safeSetItem("chrono_palette", palette);
    applyTheme(theme, palette);
  }, [theme, palette, ready]);

  useEffect(() => {
    if (!ready) return;
    safeSetItem("chrono_24h", String(is24Hour));
  }, [is24Hour, ready]);

  useEffect(() => {
    if (!ready) return;
    safeSetItem("chrono_sound", soundType);
  }, [soundType, ready]);

  useEffect(() => {
    if (!ready) return;
    safeSetItem("chrono_custom_ringtone", customRingtoneId);
  }, [customRingtoneId, ready]);

  // Keep Android STREAM_ALARM file in sync with the selected Sharebook ringtone
  useEffect(() => {
    if (!ready || !isNativeApp()) return;
    void import("@/lib/native-ringtone").then(({ syncNativeRingtone }) =>
      syncNativeRingtone(soundType, customRingtoneId || undefined),
    );
  }, [soundType, customRingtoneId, ready]);

  useEffect(() => {
    if (!ready) return;
    safeSetItem("chrono_alarms", JSON.stringify(alarms));
  }, [alarms, ready]);

  useEffect(() => {
    if (!ready) return;
    safeSetItem("chrono_notes", JSON.stringify(notes));
  }, [notes, ready]);

  useEffect(() => {
    if (!ready) return;
    safeSetItem("chrono_todos", JSON.stringify(todos));
  }, [todos, ready]);

  type QueuedRing = {
    type: string;
    title: string;
    sound: string;
    voiceType: VoiceType;
    voiceURI?: string;
    recordingId?: string;
    customRingtoneId?: string;
    speakText: string;
  };
  const ringQueueRef = useRef<QueuedRing[]>([]);
  const activeRingEventRef = useRef<RingEvent | null>(null);

  const startRingPlayback = (
    type: string,
    title: string,
    sound: string,
    voiceType: VoiceType,
    voiceURI?: string,
    recordingId?: string,
    customRingtoneId?: string,
    speakText = "",
  ) => {
    void audioSynth.prime();
    const toSpeak = speakText.trim();
    const clipId = recordingId?.trim() || undefined;
    lastRingRef.current = {
      type,
      title,
      voiceType,
      voiceURI: clipId ? undefined : voiceURI,
      recordingId: clipId,
      speakText: toSpeak,
    };
    const ringEvent: RingEvent = {
      id: Date.now().toString(),
      type,
      title,
      sound,
      voiceType,
      recordingId: clipId,
    };
    activeRingEventRef.current = ringEvent;
    setActiveRingEvent(ringEvent);

    // Android: native service plays system alarm ringtone on STREAM_ALARM
    // and shows lock/home Stop–Snooze UI. Never use Web Audio (music volume).
    if (isNativeApp() && nativePlatform() === "android") {
      if (!nativeRingSessionRef.current) {
        nativeRingSessionRef.current = true;
        const notificationId = stableNotificationId(
          `ring-${type}-${title}-${Math.floor(Date.now() / 60_000)}`,
        );
        void (async () => {
          const { syncNativeRingtone } = await import("@/lib/native-ringtone");
          const { alarmSoundLabel } = await import("@/lib/alarm-sounds");
          await syncNativeRingtone(sound, customRingtoneId);
          await presentNativeRingingUi({
            notificationId,
            title: title || "Alarm",
            extra: {
              key: `ring-${ringEvent.id}`,
              type,
              fireId: ringEvent.id,
              title: title || "Alarm",
              speakText: toSpeak,
              voiceType,
              recordingId: clipId || "",
              soundType: sound,
              customRingtoneId: customRingtoneId || "",
              soundLabel: alarmSoundLabel(sound),
            },
          });
        })();
      }
      return;
    }

    void audioSynth.startAlarmLoop(
      sound,
      toSpeak,
      voiceType,
      clipId ? undefined : voiceURI,
      clipId,
      customRingtoneId,
    );
  };

  const triggerRinging = (
    type: string,
    title: string,
    sound: string,
    voiceType: VoiceType,
    voiceURI?: string,
    recordingId?: string,
    customRingtoneId?: string,
    speakText = "",
  ) => {
    if (activeRingEventRef.current) {
      ringQueueRef.current.push({
        type,
        title,
        sound,
        voiceType,
        voiceURI,
        recordingId,
        customRingtoneId,
        speakText,
      });
      return;
    }
    startRingPlayback(
      type,
      title,
      sound,
      voiceType,
      voiceURI,
      recordingId,
      customRingtoneId,
      speakText,
    );
  };
  triggerRingingRef.current = triggerRinging;

  /** Disable once-alarms / clear spent dates for every ring path (poll, SW, precise timer, URL). */
  const consumeFiredAlarm = (alarmId: string) => {
    const d = new Date();
    const currentDateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const minuteKey = `${currentDateStr}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    triggeredRef.current.__ring = true;
    triggeredRef.current[`alarm-${alarmId}-${minuteKey}`] = true;

    setAlarms((prev) =>
      prev.map((a) => {
        if (a.id !== alarmId) return a;
        const mode =
          a.repeatMode ?? (a.date && a.repeatDays.length === 0 ? "once" : "repeat");
        if (mode === "once") return { ...a, enabled: false };
        if (a.date === currentDateStr) {
          const cleared = { ...a, date: undefined as string | undefined };
          // Date-only “repeat” would become a permanent zombie — turn it off
          if (cleared.repeatDays.length === 0) return { ...cleared, enabled: false };
          return cleared;
        }
        return a;
      }),
    );
  };
  const consumeFiredAlarmRef = useRef(consumeFiredAlarm);
  consumeFiredAlarmRef.current = consumeFiredAlarm;

  const snoozeFiringRef = useRef(false);

  const clearSnoozeTimer = () => {
    if (snoozeTimerRef.current != null) {
      clearTimeout(snoozeTimerRef.current);
      snoozeTimerRef.current = null;
    }
  };

  const firePendingSnooze = () => {
    if (snoozeFiringRef.current) return;
    const snooze = snoozeRef.current ?? readStoredSnooze();
    if (!snooze) return;
    snoozeFiringRef.current = true;
    snoozeRef.current = null;
    writeStoredSnooze(null);
    clearSnoozeTimer();
    bgRingHandledRef.current[snoozeFireKey(snooze.at)] = Date.now();
    try {
      triggerRingingRef.current(
        snooze.type || "alarm",
        snooze.title || "Alarm",
        soundTypeRef.current,
        snooze.voiceType || "female",
        snooze.voiceURI,
        snooze.recordingId,
        soundTypeRef.current === "custom" ? customRingtoneIdRef.current || undefined : undefined,
        snooze.speakText || "",
      );
    } finally {
      // Allow a later snooze after this ring is handled
      snoozeFiringRef.current = false;
      void syncBackgroundSchedule(
        alarmsRef.current,
        todosRef.current,
        soundTypeRef.current,
        customRingtoneIdRef.current || undefined,
      );
    }
  };

  const armSnooze = (payload: PendingSnooze) => {
    snoozeFiringRef.current = false;
    clearSnoozeTimer();
    snoozeRef.current = payload;
    writeStoredSnooze(payload);
    const delay = Math.max(0, payload.at - Date.now());
    snoozeTimerRef.current = setTimeout(() => {
      firePendingSnooze();
    }, delay);
    void syncBackgroundSchedule(
      alarmsRef.current,
      todosRef.current,
      soundTypeRef.current,
      customRingtoneIdRef.current || undefined,
    );
  };

  // Keep wall clock fresh without tying it to stopwatch precision
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Stopwatch uses its own fast ticker so alarm checks stay light
  useEffect(() => {
    if (!isSwRunning) return;
    // ~30fps is smooth enough and avoids starving the UI thread
    const id = setInterval(() => setSwTime((prev) => prev + 32), 32);
    return () => clearInterval(id);
  }, [isSwRunning]);

  // Countdown timer tick — only mutate remaining here (no side effects in setState)
  useEffect(() => {
    if (!isTimerRunning || isTimerPaused) return;
    const id = setInterval(() => {
      setTimerRemainingSecs((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [isTimerRunning, isTimerPaused]);

  // Fire timer ring when countdown hits zero (outside setState — Strict Mode safe)
  // Keep exactly 3 deps — Turbopack HMR errors if this array size changes mid-session.
  useEffect(() => {
    if (!isTimerRunning || isTimerPaused || timerRemainingSecs > 0) return;
    if (timerFiredRef.current) return;
    timerFiredRef.current = true;
    setIsTimerRunning(false);
    setIsTimerPaused(false);
    triggerRinging(
      "timer",
      "Timer finished",
      soundTypeRef.current,
      "female",
      undefined,
      undefined,
      soundTypeRef.current === "custom" ? customRingtoneIdRef.current || undefined : undefined,
      "",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerRemainingSecs, isTimerRunning, isTimerPaused]);

  // Alarm / todo schedule — poll often; per-alarm keys prevent double rings
  useEffect(() => {
    const checkSchedule = () => {
      const now = new Date();
      const currentHoursStr = String(now.getHours()).padStart(2, "0");
      const currentMinsStr = String(now.getMinutes()).padStart(2, "0");
      const currentTimeStr = `${currentHoursStr}:${currentMinsStr}`;
      const currentDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const minuteKey = `${currentDateStr}T${currentTimeStr}`;
      const currentDay = now.getDay();
      // Reset per-minute trigger map so long sessions cannot grow without bound
      if (triggeredMinuteRef.current !== minuteKey) {
        triggeredRef.current = {};
        triggeredMinuteRef.current = minuteKey;
      }

      // Backup: if dedicated snooze timer was throttled, still fire when due
      const snooze = snoozeRef.current ?? readStoredSnooze();
      if (snooze && Date.now() >= snooze.at) {
        snoozeRef.current = snooze;
        firePendingSnooze();
      }

      for (const alarm of alarmsRef.current) {
        if (!alarm.enabled || alarm.time !== currentTimeStr) continue;

        const hasDate = Boolean(alarm.date);
        const onDate = hasDate && alarm.date === currentDateStr;
        const onDay =
          alarm.repeatDays.length > 0 && alarm.repeatDays.includes(currentDay);

        // Date-only: must be that calendar day. Days: match weekday.
        // Both: either match is enough.
        if (hasDate && alarm.repeatDays.length === 0) {
          if (!onDate) continue;
        } else if (!hasDate && alarm.repeatDays.length > 0) {
          if (!onDay) continue;
        } else if (hasDate && alarm.repeatDays.length > 0) {
          if (!onDate && !onDay) continue;
        } else {
          // No schedule — should not happen after validation; skip
          continue;
        }

        const triggerKey = `alarm-${alarm.id}-${minuteKey}`;
        if (triggeredRef.current[triggerKey]) continue;
        triggeredRef.current[triggerKey] = true;

        // Same disable/clear rules as SW / precise / URL ring paths
        consumeFiredAlarmRef.current(alarm.id);

        const spokenLabel = spokenAlarmText(alarm.label);
        // Any saved clip id rings the recording over the tone (label optional)
        const clipId = alarm.recordingId?.trim() || undefined;
        // Queues if another alarm is already ringing this minute
        triggerRingingRef.current(
          "alarm",
          spokenLabel || "Alarm",
          soundTypeRef.current,
          alarm.voiceType || "female",
          clipId ? undefined : alarm.voiceURI,
          clipId,
          soundTypeRef.current === "custom" ? customRingtoneIdRef.current || undefined : undefined,
          spokenLabel,
        );
      }

      for (const todo of todosRef.current) {
        if (todo.completed || !todo.date || !todo.time) continue;
        try {
          const [tHours, tMins] = todo.time.split(":").map(Number);
          const [tYear, tMonth, tDay] = todo.date.split("-").map(Number);
          const targetDate = new Date(tYear, tMonth - 1, tDay, tHours, tMins, 0);

          let offsetMs = 0;
          if (todo.reminder === "5_min") offsetMs = 5 * 60 * 1000;
          else if (todo.reminder === "15_min") offsetMs = 15 * 60 * 1000;
          else if (todo.reminder === "1_hour") offsetMs = 60 * 60 * 1000;
          else if (todo.reminder === "1_day") offsetMs = 24 * 60 * 60 * 1000;

          const triggerDateObj = new Date(targetDate.getTime() - offsetMs);
          const triggerDateStr = `${triggerDateObj.getFullYear()}-${String(triggerDateObj.getMonth() + 1).padStart(2, "0")}-${String(triggerDateObj.getDate()).padStart(2, "0")}`;
          const triggerTimeStr = `${String(triggerDateObj.getHours()).padStart(2, "0")}:${String(triggerDateObj.getMinutes()).padStart(2, "0")}`;

          if (currentDateStr === triggerDateStr && currentTimeStr === triggerTimeStr) {
            const triggerKey = `todo-${todo.id}-${triggerDateStr}-${triggerTimeStr}`;
            if (triggeredRef.current[triggerKey]) continue;
            triggeredRef.current[triggerKey] = true;
            const reminderLabel =
              todo.reminder && todo.reminder !== "at_time"
                ? `Reminder (${todo.reminder.replace("_", " ")} before): ${todo.title}`
                : `Reminder: ${todo.title}`;
            triggerRingingRef.current(
              "alarm",
              reminderLabel,
              soundTypeRef.current,
              todo.voiceType || "female",
              undefined,
              undefined,
              soundTypeRef.current === "custom" ? customRingtoneIdRef.current || undefined : undefined,
              reminderLabel,
            );
          }
        } catch {
          /* ignore */
        }
      }
    };

    checkSchedule();
    // 1s is enough for minute-boundary alarms; snooze uses its own timer
    const id = setInterval(checkSchedule, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unlock audio early so the first ring is not delayed by a suspended AudioContext
  useEffect(() => {
    if (!ready) return;
    const unlock = () => {
      void audioSynth.prime();
      // Warm only enabled clips, staggered so first tap stays snappy
      const ids = [
        ...new Set(
          alarmsRef.current
            .filter((a) => a.enabled && a.recordingId)
            .map((a) => a.recordingId!)
            .slice(0, 6),
        ),
      ];
      ids.forEach((id, i) => {
        window.setTimeout(() => void audioSynth.warmVoiceClip(id), i * 120);
      });
    };
    window.addEventListener("pointerdown", unlock, { once: true, passive: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [ready]);

  // Capture PWA install prompt + ask permissions after install / first session
  useEffect(() => {
    if (!ready) return;
    const onBeforeInstall = (e: Event) => {
      captureInstallPrompt(e);
    };
    const onInstalled = () => {
      setPermsReason("install");
      setPermsOpen(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [ready]);

  // First login / skip / standalone open → permissions sheet
  useEffect(() => {
    if (!ready || !user) return;
    if (hasCompletedPermissionsOnboarding()) return;
    const t = window.setTimeout(() => {
      setPermsReason(isStandaloneDisplay() ? "install" : "setup");
      setPermsOpen(true);
    }, 450);
    return () => window.clearTimeout(t);
  }, [ready, user]);

  // Keep enabled-alarm voice clips warm (idle / staggered — avoid decode storms)
  useEffect(() => {
    if (!ready) return;
    const ids = [
      ...new Set(
        alarms.filter((a) => a.enabled && a.recordingId).map((a) => a.recordingId!),
      ),
    ].slice(0, 6);

    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      ids.forEach((id, i) => {
        window.setTimeout(() => {
          if (!cancelled) void audioSynth.warmVoiceClip(id);
        }, i * 150);
      });
    };

    const ric = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    const handle =
      typeof ric === "function"
        ? ric(run, { timeout: 1500 })
        : window.setTimeout(run, 200);

    return () => {
      cancelled = true;
      if (typeof ric === "function" && typeof handle === "number") {
        (
          window as unknown as { cancelIdleCallback?: (id: number) => void }
        ).cancelIdleCallback?.(handle);
      } else {
        window.clearTimeout(handle as number);
      }
    };
  }, [alarms, ready]);

  // PWA service worker + OS notification schedule (screen-off / background)
  useEffect(() => {
    if (!ready || !user) return;
    let cancelled = false;

    const bootBg = async () => {
      await registerAlarmServiceWorker();
      if (cancelled) return;
      if (getBackgroundAlarmsEnabled() && notificationPermission() === "default") {
        // Don't auto-prompt on boot — Settings will ask
      }
      await syncBackgroundSchedule(
        alarmsRef.current,
        todosRef.current,
        soundTypeRef.current,
        customRingtoneIdRef.current || undefined,
      );
    };
    void bootBg();

    const handleBgRing = (payload: {
      fire: {
        key?: string;
        type?: string;
        id?: string;
        title?: string;
        speakText?: string;
        voiceType?: string;
        voiceURI?: string;
        recordingId?: string;
      };
      soundType?: string;
      customRingtoneId?: string;
    }) => {
      const fire = payload.fire;
      if (!fire?.key) return;
      const now = Date.now();
      if (bgRingHandledRef.current[fire.key] && now - bgRingHandledRef.current[fire.key] < 55_000) {
        return;
      }
      bgRingHandledRef.current[fire.key] = now;

      if (fire.type === "snooze") {
        snoozeRef.current = null;
        writeStoredSnooze(null);
        clearSnoozeTimer();
        void audioSynth.prime();
        triggerRingingRef.current(
          "alarm",
          fire.title || "Snoozed alarm",
          payload.soundType || soundTypeRef.current,
          (fire.voiceType as VoiceType) || "female",
          fire.recordingId ? undefined : fire.voiceURI,
          fire.recordingId,
          (payload.soundType || soundTypeRef.current) === "custom"
            ? payload.customRingtoneId || customRingtoneIdRef.current || undefined
            : undefined,
          fire.speakText || "",
        );
        void syncBackgroundSchedule(
          alarmsRef.current,
          todosRef.current,
          soundTypeRef.current,
          customRingtoneIdRef.current || undefined,
        );
        return;
      }

      if (fire.type === "alarm" && fire.id) {
        consumeFiredAlarmRef.current(fire.id);
      } else if (fire.id) {
        const d = new Date();
        const minuteKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        triggeredRef.current[`${fire.type}-${fire.id}-${minuteKey}`] = true;
      }
      void audioSynth.prime();
      triggerRingingRef.current(
        "alarm",
        fire.title || "Alarm",
        payload.soundType || soundTypeRef.current,
        (fire.voiceType as VoiceType) || "female",
        fire.recordingId ? undefined : fire.voiceURI,
        fire.recordingId,
        (payload.soundType || soundTypeRef.current) === "custom"
          ? payload.customRingtoneId || customRingtoneIdRef.current || undefined
          : undefined,
        fire.speakText || "",
      );
    };

    const unsub = isNativeApp() ? () => undefined : subscribeBackgroundRing(handleBgRing);

    let unsubNative: (() => void) | undefined;
    if (isNativeApp()) {
      void subscribeNativeAlarmListeners({
        onRing: (payload) => {
          // Native AlarmRingService already plays ringtone + shows lock/home UI.
          // Only sync app state — do NOT relaunch UI (that was flashing Home and killing the ring).
          const fire = payload.fire;
          if (!fire?.key) return;
          const now = Date.now();
          if (
            bgRingHandledRef.current[fire.key] &&
            now - bgRingHandledRef.current[fire.key] < 55_000
          ) {
            return;
          }
          bgRingHandledRef.current[fire.key] = now;
          nativeRingSessionRef.current = true;

          if (fire.type === "snooze") {
            snoozeRef.current = null;
            writeStoredSnooze(null);
            clearSnoozeTimer();
          } else if (fire.type === "alarm" && fire.id) {
            consumeFiredAlarmRef.current(fire.id);
          }

          const ringEvent = {
            id: fire.id || Date.now().toString(),
            type: "alarm",
            title: fire.title || "Alarm",
            sound: payload.soundType || soundTypeRef.current,
            voiceType: (fire.voiceType as VoiceType) || "female",
            recordingId: fire.recordingId,
          };
          lastRingRef.current = {
            type: "alarm",
            title: ringEvent.title,
            voiceType: ringEvent.voiceType,
            voiceURI: fire.recordingId ? undefined : fire.voiceURI,
            recordingId: fire.recordingId,
            speakText: fire.speakText || "",
          };
          activeRingEventRef.current = ringEvent;
          setActiveRingEvent(ringEvent);
        },
        onSnooze: (payload) => {
          nativeRingSessionRef.current = false;
          dismissRingRef.current?.();
          armSnooze(payload);
        },
        onStop: () => {
          nativeRingSessionRef.current = false;
          dismissRingRef.current?.();
          // Reschedule now that ringing finished (sync was skipped while ringing)
          void syncBackgroundSchedule(
            alarmsRef.current,
            todosRef.current,
            soundTypeRef.current,
            customRingtoneIdRef.current || undefined,
          );
        },
      }).then((unsub) => {
        if (cancelled) unsub();
        else unsubNative = unsub;
      });
    }

    return () => {
      cancelled = true;
      unsub();
      unsubNative?.();
    };
  }, [ready, user]);

  // Capacitor: re-sync exact alarms when returning to foreground
  useEffect(() => {
    if (!ready || !user || !isNativeApp()) return;
    let handle: { remove: () => Promise<void> } | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { App } = await import("@capacitor/app");
        handle = await App.addListener("appStateChange", ({ isActive }) => {
          if (!isActive) return;
          void syncBackgroundSchedule(
            alarmsRef.current,
            todosRef.current,
            soundTypeRef.current,
            customRingtoneIdRef.current || undefined,
          );
        });
        if (cancelled) void handle.remove();
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
      void handle?.remove();
    };
  }, [ready, user]);

  // Re-sync SW schedule whenever alarms / todos / ringtone change (debounced)
  useEffect(() => {
    if (!ready || !user) return;
    const t = window.setTimeout(() => {
      // Skip while native alarm is ringing — resync was stopping the tone immediately
      if (nativeRingSessionRef.current) return;
      void syncBackgroundSchedule(alarms, todos, soundType, customRingtoneId || undefined);
    }, 280);
    return () => window.clearTimeout(t);
  }, [alarms, todos, soundType, customRingtoneId, ready, user]);

  // Near-silent keepalive + re-sync when returning from background
  useEffect(() => {
    if (!ready || !user) return;

    const refreshKeepalive = () => {
      const armed =
        getBackgroundAlarmsEnabled() &&
        getKeepaliveEnabled() &&
        alarmsRef.current.some((a) => a.enabled);
      if (armed) {
        audioSynth.startKeepaliveBed();
        // HTML media keepalive as a fallback on mobile suspend paths
        startBackgroundKeepalive();
      } else {
        audioSynth.stopKeepaliveBed();
        stopBackgroundKeepalive();
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void audioSynth.prime();
        void syncBackgroundSchedule(
          alarmsRef.current,
          todosRef.current,
          soundTypeRef.current,
          customRingtoneIdRef.current || undefined,
        );
        // Catch up: if an alarm is due in this minute and UI wasn't polling
        // (throttled), the existing 1s checker will pick it up on resume.
        refreshKeepalive();
      }
    };

    // Start keepalive after first user gesture (autoplay policies)
    const onGesture = () => {
      refreshKeepalive();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pointerdown", onGesture, { passive: true });
    window.addEventListener("keydown", onGesture);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
      audioSynth.stopKeepaliveBed();
      stopBackgroundKeepalive();
    };
  }, [ready, user, alarms]);

  // Screen wake lock while ringing UI is open
  useEffect(() => {
    if (!activeRingEvent) {
      void releaseWakeLock(wakeLockRef.current);
      wakeLockRef.current = null;
      return;
    }
    let cancelled = false;
    void requestRingWakeLock().then((lock) => {
      if (cancelled) {
        void releaseWakeLock(lock);
        return;
      }
      wakeLockRef.current = lock;
    });
    return () => {
      cancelled = true;
      void releaseWakeLock(wakeLockRef.current);
      wakeLockRef.current = null;
    };
  }, [activeRingEvent]);

  // Opened from notification tap (?bgRing=1)
  useEffect(() => {
    if (!ready || !user) return;
    const pending = readPendingBgRingFromUrl();
    if (!pending) return;
    clearBgRingQuery();
    const dedupeKey = pending.key || `url-${pending.title}-${pending.recordingId || ""}`;
    if (bgRingHandledRef.current[dedupeKey] && Date.now() - bgRingHandledRef.current[dedupeKey] < 55_000) {
      return;
    }
    bgRingHandledRef.current[dedupeKey] = Date.now();
    // fireKey looks like `alarm-${id}-${at}` — recover id for once/date cleanup
    const alarmIdMatch = pending.key?.match(/^alarm-(.+)-\d+$/);
    const alarmId = alarmIdMatch?.[1];
    if (alarmId) consumeFiredAlarmRef.current(alarmId);
    else {
      const d = new Date();
      const minuteKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      triggeredRef.current.__ring = true;
      triggeredRef.current[`url-${minuteKey}`] = true;
    }
    triggerRingingRef.current(
      "alarm",
      pending.title || "Alarm",
      soundTypeRef.current,
      (pending.voiceType as VoiceType) || "female",
      pending.recordingId ? undefined : pending.voiceURI,
      pending.recordingId,
      soundTypeRef.current === "custom" ? customRingtoneIdRef.current || undefined : undefined,
      pending.speakText || "",
    );
  }, [ready, user]);

  // Client-side precise timers for the next few fires (helps when tab is backgrounded but not killed)
  useEffect(() => {
    if (!ready || !user || !getBackgroundAlarmsEnabled()) return;
    const fires = collectUpcomingFires(alarms, todos, new Date(), 2, 4);
    const timers: Array<ReturnType<typeof setTimeout>> = [];

    for (const fire of fires) {
      const delay = fire.at - Date.now();
      if (delay < 400 || delay > 86_400_000) continue;
      timers.push(
        setTimeout(() => {
          const key = fire.key;
          const alreadyHandled =
            Boolean(bgRingHandledRef.current[key]) &&
            Date.now() - bgRingHandledRef.current[key] < 55_000;

          // Always consume/disable this fire even if audio was handled elsewhere
          if (fire.type === "alarm" && fire.id) {
            consumeFiredAlarmRef.current(fire.id);
          } else if (fire.type !== "snooze") {
            const d = new Date();
            const minuteKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
            triggeredRef.current[`${fire.type}-${fire.id}-${minuteKey}`] = true;
          }

          if (alreadyHandled) return;
          bgRingHandledRef.current[key] = Date.now();
          void audioSynth.prime();
          triggerRingingRef.current(
            "alarm",
            fire.title || "Alarm",
            soundTypeRef.current,
            (fire.voiceType as VoiceType) || "female",
            fire.recordingId ? undefined : fire.voiceURI,
            fire.recordingId,
            soundTypeRef.current === "custom" ? customRingtoneIdRef.current || undefined : undefined,
            fire.speakText || "",
          );
          if (notificationPermission() === "granted" && typeof Notification !== "undefined") {
            try {
              new Notification(fire.title || "Alarm", {
                body: "Alarm is ringing — open the app if you don’t hear sound",
                tag: `sva-live-${fire.key}`,
                requireInteraction: true,
                silent: false,
              });
            } catch {
              /* ignore */
            }
          }
        }, delay),
      );
    }

    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [alarms, todos, ready, user, soundType, customRingtoneId]);

  // Restore a snooze that was armed before a refresh / remount
  useEffect(() => {
    if (!ready) return;
    const stored = readStoredSnooze();
    if (!stored) return;
    if (Date.now() >= stored.at) {
      snoozeRef.current = stored;
      firePendingSnooze();
    } else {
      armSnooze(stored);
    }
    return () => {
      // Drop only the timeout handle — localStorage keeps the pending snooze
      // so Strict Mode remount / refresh can re-arm it.
      clearSnoozeTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // When a voice clip is deleted from any panel, scrub alarm refs + decode cache
  useEffect(() => {
    if (!ready) return;
    const onDeleted = (ev: Event) => {
      const id = (ev as CustomEvent<{ id?: string }>).detail?.id?.trim();
      if (!id) return;
      audioSynth.evictVoiceClip(id);
      setAlarms((prev) =>
        prev.map((a) =>
          a.recordingId === id
            ? { ...a, recordingId: undefined, voiceSource: "tts" as const }
            : a,
        ),
      );
    };
    window.addEventListener("sva-voice-clip-deleted", onDeleted);
    return () => window.removeEventListener("sva-voice-clip-deleted", onDeleted);
  }, [ready]);

  const dismissRing = () => {
    audioSynth.stopAlarmLoop();
    const wasNativeRing = nativeRingSessionRef.current;
    nativeRingSessionRef.current = false;
    void stopNativeAlarmTone();
    const next = ringQueueRef.current.shift();
    if (next) {
      startRingPlayback(
        next.type,
        next.title,
        next.sound,
        next.voiceType,
        next.voiceURI,
        next.recordingId,
        next.customRingtoneId,
        next.speakText,
      );
      return;
    }
    activeRingEventRef.current = null;
    setActiveRingEvent(null);
    if (wasNativeRing) {
      void syncBackgroundSchedule(
        alarmsRef.current,
        todosRef.current,
        soundTypeRef.current,
        customRingtoneIdRef.current || undefined,
      );
    }
  };
  dismissRingRef.current = dismissRing;

  const snoozeRing = () => {
    audioSynth.playClick();
    audioSynth.stopAlarmLoop();
    nativeRingSessionRef.current = false;
    void stopNativeAlarmTone();
    ringQueueRef.current = [];
    const last = lastRingRef.current;
    const title = activeRingEvent?.title || last?.title || "Alarm";
    armSnooze({
      at: Date.now() + SNOOZE_MS,
      type: last?.type || activeRingEvent?.type || "alarm",
      title,
      voiceType: last?.voiceType || activeRingEvent?.voiceType || "female",
      voiceURI: last?.voiceURI,
      recordingId: last?.recordingId || activeRingEvent?.recordingId,
      speakText: last?.speakText || spokenAlarmText(title),
    });
    activeRingEventRef.current = null;
    setActiveRingEvent(null);
  };

  if (!ready) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--background)] px-6 text-center text-[var(--muted)]">
        <p>Loading…</p>
        <button
          type="button"
          className="text-xs font-semibold text-[var(--brand)] underline"
          onClick={() => setReady(true)}
        >
          Tap if this takes too long
        </button>
      </div>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        key={authMode}
        initialMode={authMode}
        onAuth={(u) => setUser(u)}
      />
    );
  }

  const onDashboard =
    mainMode === "suite" && activeTab === "alarm" && alarmSlot === "dashboard";
  const hideTabBar = mainMode !== "suite" || onDashboard;

  return (
    <div
      className={`app-shell relative mx-auto flex min-h-[100dvh] w-full max-w-7xl flex-col sm:px-6 sm:py-6 lg:px-8 ${
        hideTabBar ? "app-shell--no-tabbar" : ""
      }`}
    >
      <header
        className={`relative z-20 mb-4 flex animate-fade-in items-center gap-2 py-2.5 sm:mb-6 sm:gap-3 sm:py-3.5 ${
          onDashboard ? "border-b border-transparent" : "border-b border-[var(--border)]"
        }`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-[var(--brand-ink)] shadow-[0_4px_14px_var(--glow)] sm:h-10 sm:w-10">
            <Clock3 className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
          <div className="stack-tight min-w-0 flex-1">
            <h1 className="type-brand truncate">Sharebook</h1>
            <p className="type-caption truncate !mt-0">
              {mainMode === "voices"
                ? "My voices"
                : alarmSlot === "notes"
                  ? "Notes"
                  : alarmSlot === "todo"
                    ? "To-do"
                    : alarmSlot === "alarm"
                      ? "Alarms"
                      : "Home"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => {
              audioSynth.playClick();
              setMainMode("suite");
              setActiveTab("alarm");
              setAlarmSlot("dashboard");
            }}
            className={`rounded-full border p-2 shadow-[var(--shadow-soft)] transition ${
              onDashboard
                ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--brand-ink)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--surface-2)]"
            }`}
            aria-label="Go home"
          >
            <Home className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              audioSynth.playClick();
              setIsMenuOpen(true);
            }}
            className="rounded-full border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--foreground)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--surface-2)]"
            aria-label="Open menu"
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>
      </header>

      {isMenuOpen && (
        <div className="fixed inset-0 z-50 flex justify-end animate-fade-in">
          <button
            type="button"
            className="fixed inset-0 bg-black/45 backdrop-blur-sm"
            aria-label="Close menu"
            onClick={() => setIsMenuOpen(false)}
          />
          <aside className="animate-in slide-in-from-right relative z-10 flex h-[100dvh] w-[min(20rem,90vw)] flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lift)]">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3.5 pt-[max(0.85rem,env(safe-area-inset-top))] sm:px-5">
              <p className="type-eyebrow !mb-0">Menu</p>
              <button
                type="button"
                onClick={() => setIsMenuOpen(false)}
                className="rounded-full border border-[var(--border)] p-1.5 text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-5">
              {/* Profile */}
              <section className="glass-card rounded-2xl p-3.5">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      audioSynth.playClick();
                      setMainMode("suite");
                      setActiveTab("settings");
                      setIsMenuOpen(false);
                    }}
                    className="relative h-14 w-14 shrink-0 overflow-hidden rounded-full bg-[var(--brand)] text-[var(--brand-ink)] shadow-[0_4px_14px_var(--glow)]"
                    aria-label="Open settings"
                  >
                    {user.photo && !isGuestUser(user) ? (
                      <img src={user.photo} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center">
                        <UserRound className="h-6 w-6 opacity-70" />
                      </span>
                    )}
                  </button>
                  <div className="stack-tight min-w-0 flex-1">
                    <p className="type-eyebrow !mb-0">Profile</p>
                    {isGuestUser(user) ? (
                      <button
                        type="button"
                        onClick={() => {
                          audioSynth.playClick();
                          setAuthPromptOpen(true);
                        }}
                        className="type-card-title w-full border-0 bg-transparent p-0 text-left outline-none"
                        aria-label="Log in to set profile name"
                      >
                        Guest
                      </button>
                    ) : (
                      <input
                        value={user.name}
                        onChange={(e) => {
                          const next = e.target.value;
                          const updated = updateUserProfile(user.phone, { name: next || user.name });
                          if (updated) setUser(updated);
                        }}
                        className="type-card-title w-full border-0 bg-transparent p-0 outline-none focus:ring-0"
                        aria-label="Profile name"
                      />
                    )}
                    <p className="truncate text-[12px] text-[var(--brand)]">
                      {isGuestUser(user)
                        ? "Log in to set your profile"
                        : user.tagline?.trim() || "hello ALL"}
                    </p>
                    <p className="type-caption !mt-0.5 text-[10px]">
                      {isGuestUser(user) ? "Tap to log in or register" : "Tap photo for settings"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    audioSynth.playClick();
                    if (isGuestUser(user)) {
                      goToAuth("login");
                      return;
                    }
                    authLogout();
                    setAuthMode("login");
                    setUser(null);
                    setIsMenuOpen(false);
                  }}
                  className="btn-ghost mt-3 flex w-full items-center justify-center gap-2 !py-2.5"
                >
                  {isGuestUser(user) ? (
                    <LogIn className="h-3.5 w-3.5" />
                  ) : (
                    <LogOut className="h-3.5 w-3.5" />
                  )}
                  {isGuestUser(user) ? "Log in / Register" : "Log out"}
                </button>
              </section>

              {/* Preferences */}
              <section className="glass-card overflow-hidden rounded-2xl">
                <button
                  type="button"
                  onClick={() => {
                    audioSynth.playClick();
                    setIs24Hour((v) => !v);
                  }}
                  className="flex w-full items-center justify-between gap-3 border-b border-[var(--border)] px-3.5 py-3.5 text-left transition hover:bg-[var(--surface-2)]"
                  aria-pressed={is24Hour}
                >
                  <div className="stack-tight min-w-0">
                    <h4 className="type-card-title">Time format</h4>
                    <p className="type-caption">{is24Hour ? "24-hour clock" : "12-hour clock"}</p>
                  </div>
                  <div
                    className="pointer-events-none flex shrink-0 rounded-full bg-[var(--surface-2)] p-0.5"
                    aria-hidden
                  >
                    <span
                      className={`rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition ${
                        !is24Hour
                          ? "bg-[var(--brand)] text-[var(--brand-ink)]"
                          : "text-[var(--muted)]"
                      }`}
                    >
                      12H
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1.5 text-[11px] font-semibold transition ${
                        is24Hour
                          ? "bg-[var(--brand)] text-[var(--brand-ink)]"
                          : "text-[var(--muted)]"
                      }`}
                    >
                      24H
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    audioSynth.playClick();
                    setTheme(theme === "dark" ? "light" : "dark");
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3.5 py-3.5 text-left transition hover:bg-[var(--surface-2)]"
                  aria-pressed={theme === "dark"}
                >
                  <div className="stack-tight min-w-0">
                    <h4 className="type-card-title">Dark mode</h4>
                    <p className="type-caption">{theme === "dark" ? "On" : "Off"}</p>
                  </div>
                  <span
                    className={`ui-toggle pointer-events-none ${theme === "dark" ? "ui-toggle--on" : ""}`}
                    aria-hidden
                  >
                    <span className="ui-toggle__knob" />
                  </span>
                </button>
              </section>

              <section>
                <p className="type-eyebrow mb-2 px-0.5">Library</p>
                <button
                  type="button"
                  onClick={() => {
                    audioSynth.playClick();
                    setMainMode("voices");
                    setIsMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--brand)_28%,var(--border))] bg-[var(--brand-soft)] px-3.5 py-3.5 text-left text-[var(--foreground)] transition hover:bg-[color-mix(in_srgb,var(--brand)_20%,var(--surface))]"
                >
                  <div className="rounded-xl bg-[var(--brand)] p-2.5 text-[var(--brand-ink)]">
                    <Mic className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="truncate text-sm font-medium tracking-tight text-[var(--foreground)]">
                      My Voices
                    </h4>
                    <p className="mt-0.5 text-[11px] text-[var(--brand)]">
                      Record, upload & categories
                    </p>
                  </div>
                </button>
              </section>

              {/* Features — all three on dashboard; otherwise the two not active */}
              <section>
                <p className="type-eyebrow mb-2 px-0.5">More features</p>
                <div className="space-y-2">
                  {(
                    [
                      {
                        id: "alarm" as const,
                        title: "Alarms",
                        caption: "Rings & schedules",
                        icon: AlarmClock,
                        count: alarms.filter((a) => a.enabled).length,
                      },
                      {
                        id: "notes" as const,
                        title: "Notes",
                        caption: "Voice notes studio",
                        icon: BookOpen,
                        count: notes.length,
                      },
                      {
                        id: "todo" as const,
                        title: "To-Do List",
                        caption: "Tasks & reminders",
                        icon: CheckSquare,
                        count: todos.filter((t) => !t.completed).length,
                      },
                    ] as const
                  )
                    .filter((item) => alarmSlot === "dashboard" || item.id !== alarmSlot)
                    .map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            audioSynth.playClick();
                            setMainMode("suite");
                            setActiveTab("alarm");
                            setAlarmSlot(item.id);
                            setIsMenuOpen(false);
                          }}
                          className="flex w-full items-center gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--brand)_28%,var(--border))] bg-[var(--brand-soft)] px-3.5 py-3.5 text-left text-[var(--foreground)] transition hover:bg-[color-mix(in_srgb,var(--brand)_20%,var(--surface))]"
                        >
                          <div className="rounded-xl bg-[var(--brand)] p-2.5 text-[var(--brand-ink)]">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h4 className="truncate text-sm font-medium tracking-tight text-[var(--foreground)]">
                              {item.title}
                            </h4>
                            <p className="mt-0.5 text-[11px] text-[var(--brand)]">
                              {item.caption} · {item.count}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                </div>
              </section>
            </div>
          </aside>
        </div>
      )}

      <main
        className={`flex w-full min-w-0 flex-1 flex-col ${
          alarmSlot === "notes" ? "items-stretch" : "items-stretch sm:items-center"
        }`}
      >
        {mainMode === "suite" && (
          <>
            {activeTab === "clock" && <ClockView currentTime={currentTime} is24Hour={is24Hour} />}
            {activeTab === "alarm" && alarmSlot === "dashboard" && (
              <DashboardView
                userName={user.name}
                currentTime={currentTime}
                is24Hour={is24Hour}
                alarmCount={alarms.filter((a) => a.enabled).length}
                noteCount={notes.length}
                todoCount={todos.filter((t) => !t.completed).length}
                onOpen={(slot) => setAlarmSlot(slot)}
              />
            )}
            {activeTab === "alarm" && alarmSlot === "alarm" && (
              <AlarmView
                alarms={alarms}
                setAlarms={setAlarms}
                is24Hour={is24Hour}
                setIsAddAlarmOpen={setIsAddAlarmOpen}
                setEditingAlarm={setEditingAlarm}
              />
            )}
            {activeTab === "alarm" && alarmSlot === "notes" && (
              <NotesView
                notes={notes}
                setNotes={setNotes}
                setAlarms={setAlarms}
                setMainMode={setMainMode}
                setActiveTab={setActiveTab}
                setAlarmSlot={setAlarmSlot}
              />
            )}
            {activeTab === "alarm" && alarmSlot === "todo" && (
              <TodoView
                todos={todos}
                setTodos={setTodos}
                is24Hour={is24Hour}
                setAlarms={setAlarms}
                setMainMode={setMainMode}
                setActiveTab={setActiveTab}
                setAlarmSlot={setAlarmSlot}
              />
            )}
            {activeTab === "timer" && (
              <TimerView
                timerInput={timerInput}
                setTimerInput={setTimerInput}
                timerTotalSecs={timerTotalSecs}
                setTimerTotalSecs={setTimerTotalSecs}
                timerRemainingSecs={timerRemainingSecs}
                setTimerRemainingSecs={setTimerRemainingSecs}
                isTimerRunning={isTimerRunning}
                setIsTimerRunning={setIsTimerRunningSafe}
                isTimerPaused={isTimerPaused}
                setIsTimerPaused={setIsTimerPaused}
              />
            )}
            {activeTab === "stopwatch" && (
              <StopwatchView
                swTime={swTime}
                setSwTime={setSwTime}
                isSwRunning={isSwRunning}
                setIsSwRunning={setIsSwRunning}
                swLaps={swLaps}
                setSwLaps={setSwLaps}
              />
            )}
            {activeTab === "settings" && (
              <SettingsView
                is24Hour={is24Hour}
                setIs24Hour={setIs24Hour}
                theme={theme}
                setTheme={setTheme}
                palette={palette}
                setPalette={setPalette}
                soundType={soundType}
                setSoundType={setSoundType}
                customRingtoneId={customRingtoneId}
                setCustomRingtoneId={setCustomRingtoneId}
                onUserUpdated={setUser}
                onGoToAuth={goToAuth}
                onLogout={() => {
                  authLogout();
                  setAuthMode("login");
                  setUser(null);
                }}
                onOpenPermissions={() => {
                  setPermsReason("settings");
                  setPermsOpen(true);
                }}
                onBackgroundPrefsChanged={() => {
                  void syncBackgroundSchedule(
                    alarmsRef.current,
                    todosRef.current,
                    soundTypeRef.current,
                    customRingtoneIdRef.current || undefined,
                  );
                  const armed =
                    getBackgroundAlarmsEnabled() &&
                    getKeepaliveEnabled() &&
                    alarmsRef.current.some((a) => a.enabled);
                  if (armed) {
                    audioSynth.startKeepaliveBed();
                    stopBackgroundKeepalive();
                  } else {
                    audioSynth.stopKeepaliveBed();
                    stopBackgroundKeepalive();
                  }
                }}
              />
            )}
          </>
        )}
        {mainMode === "voices" && <MyVoicesView />}
      </main>

      {mainMode === "suite" && !onDashboard && (
        <nav className="bottom-nav fixed z-30 mx-auto max-w-xl animate-slide-up sm:left-1/2 sm:w-[94%] sm:-translate-x-1/2">
          <div className="glass-panel flex items-stretch justify-between gap-0.5 rounded-full p-1 sm:justify-around sm:gap-1 sm:p-1.5">
            {(
              [
                { id: "clock" as const, label: "Clock", short: "Clock", icon: Globe },
                {
                  id: "alarm" as const,
                  label:
                    alarmSlot === "notes"
                      ? "Notes"
                      : alarmSlot === "todo"
                        ? "To-Do"
                        : "Alarm",
                  short:
                    alarmSlot === "notes"
                      ? "Notes"
                      : alarmSlot === "todo"
                        ? "To-Do"
                        : "Alarm",
                  icon:
                    alarmSlot === "notes"
                      ? BookOpen
                      : alarmSlot === "todo"
                        ? CheckSquare
                        : AlarmClock,
                },
                { id: "timer" as const, label: "Timer", short: "Timer", icon: Timer },
                { id: "stopwatch" as const, label: "Watch", short: "Watch", icon: Watch },
                { id: "settings" as const, label: "Settings", short: "Set", icon: Settings },
              ]
            ).map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    audioSynth.playClick();
                    if (tab.id === "alarm") {
                      setActiveTab("alarm");
                      // Second tap on Notes/To-Do returns home; otherwise open that feature.
                      // Alarm tab always opens Alarms (never the dashboard).
                      if (alarmSlot === "notes" || alarmSlot === "todo") {
                        if (activeTab === "alarm") {
                          setAlarmSlot("dashboard");
                        }
                      } else {
                        setAlarmSlot("alarm");
                      }
                      return;
                    }
                    setActiveTab(tab.id);
                  }}
                  className={`type-nav flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-1 py-1.5 transition sm:flex-row sm:gap-1.5 sm:px-2.5 sm:py-2 sm:text-[0.7rem] ${
                    active
                      ? "bg-[var(--brand)] font-semibold text-[var(--brand-ink)] shadow-[0_4px_14px_var(--glow)]"
                      : "text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="max-w-full truncate sm:hidden">{tab.short}</span>
                  <span className="hidden truncate sm:inline">{tab.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}

      {(isAddAlarmOpen || editingAlarm) && (
        <AlarmModal
          key={editingAlarm?.id ?? "new-alarm"}
          alarm={editingAlarm}
          is24Hour={is24Hour}
          onClose={() => {
            setIsAddAlarmOpen(false);
            setEditingAlarm(null);
          }}
          onSave={(newAlarm) => {
            void audioSynth.prime();
            if (newAlarm.recordingId) void audioSynth.warmVoiceClip(newAlarm.recordingId);
            if (getBackgroundAlarmsEnabled() && notificationPermission() === "default") {
              void ensureNotificationPermission();
            }
            if (editingAlarm) {
              setAlarms((prev) => prev.map((a) => (a.id === editingAlarm.id ? newAlarm : a)));
            } else {
              setAlarms((prev) => [...prev, newAlarm]);
            }
            // Allow this alarm to ring in the current minute if time matches
            const now = new Date();
            const minuteKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
            delete triggeredRef.current[`alarm-${newAlarm.id}-${minuteKey}`];
            setIsAddAlarmOpen(false);
            setEditingAlarm(null);
          }}
        />
      )}
      {activeRingEvent && <RingingModal event={activeRingEvent} onDismiss={dismissRing} onSnooze={snoozeRing} />}
      {permsOpen && (
        <PermissionsOnboarding
          open
          reason={permsReason}
          onClose={() => setPermsOpen(false)}
        />
      )}
      <AuthRequiredDialog
        open={authPromptOpen}
        onClose={() => setAuthPromptOpen(false)}
        onLogin={() => goToAuth("login")}
        onRegister={() => goToAuth("register")}
      />
    </div>
  );
}
