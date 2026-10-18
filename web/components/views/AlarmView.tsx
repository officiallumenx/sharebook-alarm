"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlarmClockOff,
  Bell,
  Check,
  Plus,
  Volume2,
  X,
} from "lucide-react";
import { audioSynth } from "@/lib/audio-synth";
import {
  type Alarm,
  type AlarmRepeatMode,
  type AlarmVoiceSource,
  type RingEvent,
  DAYS_SHORT,
  formatDisplayTime,
} from "@/lib/types";
import { groupVoicesByGender, listSystemVoices, type ListedVoice, waitForVoices } from "@/lib/voices";
import { CompactSelect } from "@/components/ui/CompactSelect";
import { Toggle } from "@/components/ui/Toggle";
import { MyVoicesPanel } from "@/components/voices/MyVoicesPanel";

const LONG_PRESS_MS = 480;

const fieldClass = "form-field";

const HOUR24_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: String(i).padStart(2, "0"),
}));
const HOUR12_OPTIONS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: String(i + 1).padStart(2, "0"),
}));
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => ({
  value: i,
  label: String(i).padStart(2, "0"),
}));

export function AlarmView({
  alarms,
  setAlarms,
  is24Hour,
  setIsAddAlarmOpen,
  setEditingAlarm,
}: {
  alarms: Alarm[];
  setAlarms: React.Dispatch<React.SetStateAction<Alarm[]>>;
  is24Hour: boolean;
  setIsAddAlarmOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setEditingAlarm: React.Dispatch<React.SetStateAction<Alarm | null>>;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selecting = selectedIds.size > 0;
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  useEffect(() => () => clearLongPress(), []);

  // Drop selection for alarms that no longer exist
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter((id) => alarms.some((a) => a.id === id)));
      return next.size === prev.size ? prev : next;
    });
  }, [alarms]);

  const toggleAlarm = (id: string) => {
    audioSynth.playClick();
    setAlarms((prev) => prev.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a)));
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startLongPress = (id: string) => {
    didLongPress.current = false;
    clearLongPress();
    longPressTimer.current = setTimeout(() => {
      didLongPress.current = true;
      audioSynth.playClick();
      try {
        navigator.vibrate?.(12);
      } catch {
        /* ignore */
      }
      setSelectedIds((prev) => new Set(prev).add(id));
    }, LONG_PRESS_MS);
  };

  const handleRowActivate = (alarm: Alarm) => {
    if (didLongPress.current) {
      didLongPress.current = false;
      return;
    }
    if (selecting) {
      audioSynth.playClick();
      toggleSelect(alarm.id);
      return;
    }
    audioSynth.playClick();
    setEditingAlarm(alarm);
  };

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    audioSynth.playClick();
    setAlarms((prev) => prev.filter((a) => !selectedIds.has(a.id)));
    setSelectedIds(new Set());
  };

  const cancelSelection = () => {
    audioSynth.playClick();
    setSelectedIds(new Set());
  };

  return (
    <div className="flex w-full max-w-3xl animate-fade-in flex-col gap-5 py-2 pb-8 sm:gap-6 sm:py-4 sm:pb-16">
      <header className="page-header">
        <div className="page-header__text stack-tight">
          <p className="type-eyebrow">Schedule</p>
          <h2 className="type-page-title">{selecting ? `${selectedIds.size} selected` : "Alarms"}</h2>
          <p className="type-caption">
            {selecting ? "Tap more to select · Delete when ready" : "Tap to edit · Long-press to select"}
          </p>
        </div>
        {selecting ? (
          <div className="mb-0.5 flex shrink-0 items-center gap-2">
            <button type="button" onClick={cancelSelection} className="btn-ghost">
              Cancel
            </button>
            <button
              type="button"
              onClick={deleteSelected}
              className="rounded-full bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-md transition hover:bg-rose-700"
            >
              Delete
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              audioSynth.playClick();
              setIsAddAlarmOpen(true);
            }}
            className="btn-premium mb-0.5"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add</span>
          </button>
        )}
      </header>

      {alarms.length === 0 ? (
        <div className="glass-card rounded-2xl border-dashed px-6 py-12 text-center">
          <AlarmClockOff className="mx-auto mb-3 h-8 w-8 text-[var(--muted)] opacity-60" />
          <h3 className="type-modal-title">No alarms yet</h3>
          <p className="type-caption mx-auto max-w-[16rem]">Create one to wake with your voice</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {alarms.map((alarm) => {
            const [h, m] = alarm.time.split(":");
            const d = new Date();
            d.setHours(parseInt(h, 10), parseInt(m, 10));
            const formatted = formatDisplayTime(d, is24Hour);
            const selected = selectedIds.has(alarm.id);
            const voiceBadge = alarm.recordingId
              ? "My voice"
              : !(alarm.label || "").trim()
                ? "Ringtone only"
                : "System voice";
            return (
              <div
                key={alarm.id}
                role="button"
                tabIndex={0}
                onPointerDown={() => startLongPress(alarm.id)}
                onPointerUp={clearLongPress}
                onPointerLeave={clearLongPress}
                onPointerCancel={clearLongPress}
                onClick={() => handleRowActivate(alarm)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleRowActivate(alarm);
                  }
                }}
                onContextMenu={(e) => e.preventDefault()}
                className={`glass-card flex cursor-pointer items-center gap-3 rounded-2xl px-4 py-3.5 select-none touch-manipulation sm:gap-4 sm:px-5 sm:py-4 ${
                  selected ? "bg-[var(--brand-soft)] ring-1 ring-[var(--brand)]" : alarm.enabled ? "" : "opacity-50"
                }`}
              >
                {selecting && (
                  <div
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      selected
                        ? "border-transparent bg-[var(--brand)] text-[var(--brand-ink)]"
                        : "border-[var(--border-strong)] bg-[var(--surface)] text-transparent"
                    }`}
                    aria-hidden
                  >
                    <Check className="h-3 w-3" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="type-time">
                      {formatted.hoursStr}:{formatted.minutes}
                    </span>
                    {!is24Hour && <span className="type-ampm">{formatted.ampm}</span>}
                  </div>
                  <p className="type-caption mt-1 truncate">{alarm.label || "Alarm"}</p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <span className="type-meta rounded-full bg-[var(--brand-soft)] px-2.5 py-1 text-[var(--brand)]">
                      {voiceBadge}
                    </span>
                    <span className="type-meta rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[var(--muted)]">
                      {alarm.repeatMode === "once" ? "Once" : "Repeat"}
                    </span>
                    {alarm.date && (
                      <span className="type-meta rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-[var(--muted)]">
                        {alarm.date}
                      </span>
                    )}
                    {alarm.repeatDays.length > 0 && (
                      <div className="ml-0.5 flex gap-1">
                        {DAYS_SHORT.map((day, idx) => (
                          <span
                            key={day}
                            className={`day-dot ${alarm.repeatDays.includes(idx) ? "day-dot--on" : ""}`}
                          >
                            {day[0]}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                {!selecting && (
                  <div
                    className="flex shrink-0 items-center self-center pl-1"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <Toggle
                      checked={alarm.enabled}
                      onChange={() => toggleAlarm(alarm.id)}
                      label={alarm.enabled ? "Disable alarm" : "Enable alarm"}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function toISODate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Today if the clock time is still ahead; tomorrow if that time already passed. */
function suggestedScheduleForTime(hour24: number, minute: number) {
  const now = new Date();
  const candidate = new Date(now);
  candidate.setHours(hour24, minute, 0, 0);
  const useTomorrow = candidate.getTime() <= now.getTime();
  if (useTomorrow) candidate.setDate(candidate.getDate() + 1);
  return {
    date: toISODate(candidate),
    day: candidate.getDay(),
    isTomorrow: useTomorrow,
  };
}

export function AlarmModal({
  alarm,
  onClose,
  onSave,
  is24Hour,
}: {
  alarm: Alarm | null;
  onClose: () => void;
  onSave: (alarm: Alarm) => void;
  is24Hour: boolean;
}) {
  const isNew = !alarm;
  const initial = (() => {
    if (alarm?.time) return parseStoredTime(alarm.time);
    const now = new Date();
    return { hour24: now.getHours(), minute: now.getMinutes() };
  })();
  const [hour24, setHour24] = useState(initial.hour24);
  const [minute, setMinute] = useState(initial.minute);
  const [label, setLabel] = useState(alarm ? alarm.label : "");
  const [voiceURI, setVoiceURI] = useState(alarm?.voiceURI || "");
  const [voiceSource, setVoiceSource] = useState<AlarmVoiceSource>(
    alarm?.voiceSource === "recording" || alarm?.recordingId ? "recording" : "tts",
  );
  const [recordingId, setRecordingId] = useState(alarm?.recordingId || "");
  const [systemVoices, setSystemVoices] = useState<ListedVoice[]>([]);
  const [repeatDays, setRepeatDays] = useState<number[]>(() => {
    if (alarm) return alarm.repeatDays;
    return [suggestedScheduleForTime(initial.hour24, initial.minute).day];
  });
  const [date, setDate] = useState(alarm?.date || "");
  const [daysManual, setDaysManual] = useState(Boolean(alarm));
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [showRepeatPopup, setShowRepeatPopup] = useState(false);
  const [repeatMode, setRepeatMode] = useState<AlarmRepeatMode | null>(
    alarm?.repeatMode ?? null,
  );
  const [scheduleError, setScheduleError] = useState("");

  useEffect(() => {
    void waitForVoices().then(() => setSystemVoices(listSystemVoices()));
  }, []);

  // Suggest weekday from chosen time for new alarms (until user edits days). Date stays empty unless set.
  useEffect(() => {
    if (!isNew || daysManual) return;
    const suggested = suggestedScheduleForTime(hour24, minute);
    setRepeatDays([suggested.day]);
  }, [hour24, minute, isNew, daysManual]);

  const voiceGroups = groupVoicesByGender(systemVoices);
  const hour12 = hour24 % 12 || 12;
  const ampm: "AM" | "PM" = hour24 >= 12 ? "PM" : "AM";
  const labelTrimmed = label.trim();

  const setFrom12Hour = (h12: number, nextAmpm: "AM" | "PM") => {
    let h = h12 % 12;
    if (nextAmpm === "PM") h += 12;
    setHour24(h);
  };

  const storedTime = `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  const toggleDay = (idx: number) => {
    audioSynth.playClick();
    setScheduleError("");
    setDaysManual(true);
    if (repeatDays.includes(idx)) setRepeatDays(repeatDays.filter((d) => d !== idx));
    else setRepeatDays([...repeatDays, idx].sort((a, b) => a - b));
  };

  const testVoicePreview = async () => {
    audioSynth.playClick();
    if (!labelTrimmed && voiceSource === "tts") {
      alert("Add a spoken label to preview voice, or leave it empty for ringtone only.");
      return;
    }
    setIsPreviewing(true);
    if (voiceSource === "recording" && recordingId) {
      await audioSynth.playRecordingOnce(recordingId);
    } else if (labelTrimmed) {
      await audioSynth.speakSentence(labelTrimmed, "female", null, voiceURI || undefined);
    }
    setIsPreviewing(false);
  };

  const validateSchedule = () => {
    if (!date && repeatDays.length === 0) {
      setScheduleError("Select a date or at least one day.");
      return false;
    }
    setScheduleError("");
    return true;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (voiceSource === "recording" && !recordingId) {
      alert("Pick a recorded voice, or switch to System voice.");
      return;
    }
    if (!validateSchedule()) return;
    setRepeatMode(null);
    setShowRepeatPopup(true);
  };

  const confirmSave = (mode: AlarmRepeatMode) => {
    audioSynth.playClick();
    audioSynth.stopAlarmLoop();
    const useRecording = voiceSource === "recording" && Boolean(recordingId);
    const clipId = useRecording ? String(recordingId).trim() : undefined;
    if (clipId) {
      void audioSynth.prime();
      void audioSynth.warmVoiceClip(clipId);
    }
    // Repeat with only a calendar date (no weekdays) would never recur — save as once
    const effectiveMode: AlarmRepeatMode =
      mode === "repeat" && repeatDays.length === 0 ? "once" : mode;
    onSave({
      id: alarm ? alarm.id : Date.now().toString(),
      time: storedTime,
      label: labelTrimmed,
      enabled: alarm?.enabled ?? true,
      repeatDays,
      date: date || undefined,
      repeatMode: effectiveMode,
      sound: "digital",
      voiceType: "female",
      // Keep selected clip even when label is empty — voice plays over the ringtone
      voiceURI: !useRecording && voiceSource === "tts" ? voiceURI || undefined : undefined,
      voiceSource: useRecording ? "recording" : "tts",
      recordingId: clipId,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-black/45 p-0 backdrop-blur-md sm:items-center sm:p-4">
      <div className="modal-sheet w-full max-w-lg overflow-y-auto rounded-t-[1.75rem] border border-[var(--border)] p-5 text-[var(--foreground)] sm:rounded-3xl sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-3 border-b border-[var(--border)] pb-4">
          <div className="stack-tight min-w-0">
            <p className="type-eyebrow">Voice alarm</p>
            <h3 className="type-modal-title">{alarm ? "Edit alarm" : "Set alarm"}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mt-0.5 shrink-0 rounded-full border border-[var(--border)] p-2 text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="stack-form" noValidate>
          <div>
            <label className="type-field-label">Time {is24Hour ? "(24H)" : "(12H)"}</label>
            {is24Hour ? (
              <div className="flex items-center gap-1.5">
                <CompactSelect
                  value={hour24}
                  options={HOUR24_OPTIONS}
                  onChange={(v) => setHour24(Number(v))}
                  ariaLabel="Hour"
                  className="flex-1"
                />
                <span className="text-xs font-semibold text-[var(--muted)]">:</span>
                <CompactSelect
                  value={minute}
                  options={MINUTE_OPTIONS}
                  onChange={(v) => setMinute(Number(v))}
                  ariaLabel="Minute"
                  className="flex-1"
                />
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1.5">
                  <CompactSelect
                    value={hour12}
                    options={HOUR12_OPTIONS}
                    onChange={(v) => setFrom12Hour(Number(v), ampm)}
                    ariaLabel="Hour"
                    className="flex-1"
                  />
                  <span className="text-xs font-semibold text-[var(--muted)]">:</span>
                  <CompactSelect
                    value={minute}
                    options={MINUTE_OPTIONS}
                    onChange={(v) => setMinute(Number(v))}
                    ariaLabel="Minute"
                    className="flex-1"
                  />
                </div>
                <div className="flex overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--surface-2)] p-0.5">
                  {(["AM", "PM"] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        audioSynth.playClick();
                        setFrom12Hour(hour12, p);
                      }}
                      className={`flex-1 rounded-[0.65rem] px-3 py-2 text-xs font-semibold transition ${
                        ampm === p
                          ? "bg-[var(--brand)] text-[var(--brand-ink)] shadow-sm"
                          : "text-[var(--muted)]"
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="type-caption mt-2.5 text-center font-mono">Saves as {storedTime}</p>
          </div>

          <div>
            <label className="type-field-label">
              Date {repeatDays.length === 0 ? "(required if no day)" : "(optional)"}
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setScheduleError("");
              }}
              className={fieldClass}
            />
            {date ? (
              <button
                type="button"
                onClick={() => {
                  setDate("");
                  setScheduleError("");
                }}
                className="mt-1.5 text-[11px] font-medium text-[var(--brand)]"
              >
                Clear date
              </button>
            ) : (
              <p className="type-caption mt-1.5 text-center sm:text-left">
                Leave empty unless you want a specific calendar day.
              </p>
            )}
          </div>

          <div>
            <label className="type-field-label">
              Days {date ? "(optional)" : "(required if no date)"}
            </label>
            <div className="flex flex-wrap justify-center gap-2 sm:justify-between">
              {DAYS_SHORT.map((day, idx) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(idx)}
                  className={`day-chip ${repeatDays.includes(idx) ? "day-chip--on" : ""}`}
                  aria-pressed={repeatDays.includes(idx)}
                >
                  {day}
                </button>
              ))}
            </div>
            <p className="type-caption mt-2 text-center sm:text-left">
              {date && repeatDays.length > 0
                ? "Rings on this date and on the selected weekdays."
                : date
                  ? "Rings on the selected date. Days stay optional."
                  : repeatDays.length > 0
                    ? "Rings on the selected weekdays."
                    : "Choose a date or at least one day."}
            </p>
            {scheduleError && (
              <p className="mt-1.5 text-center text-[12px] font-medium text-[var(--danger)] sm:text-left">
                {scheduleError}
              </p>
            )}
          </div>

          <div>
            <label className="type-field-label">Alarm voice</label>
            <div className="mb-3 grid grid-cols-2 gap-2 rounded-full bg-[var(--surface-2)] p-1">
              {(
                [
                  ["recording", "My voice"],
                  ["tts", "System"],
                ] as const
              ).map(([id, text]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    audioSynth.playClick();
                    setVoiceSource(id);
                  }}
                  className={`rounded-full px-3 py-2.5 text-xs font-semibold transition ${
                    voiceSource === id
                      ? "bg-[var(--brand)] text-[var(--brand-ink)] shadow-sm"
                      : "text-[var(--muted)]"
                  }`}
                >
                  {text}
                </button>
              ))}
            </div>

            {voiceSource === "recording" ? (
              <>
                <p className="type-caption !mt-0 mb-2">
                  Record a message live, upload audio, or pick a saved clip. Add categories like My
                  or Mom and move voices into them.
                </p>
                <div className="max-h-[min(52vh,28rem)] overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
                  <MyVoicesPanel
                    variant="picker"
                    selectedId={recordingId}
                    onSelect={(id) => setRecordingId(id)}
                  />
                </div>
                {!recordingId && (
                  <p className="mt-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                    Select a clip above (or record/upload one) before saving.
                  </p>
                )}
                {recordingId && (
                  <p className="type-caption mt-1.5">
                    Selected voice will play over your ringtone when the alarm rings.
                  </p>
                )}
                <label className="type-field-label mt-3">Label (optional)</label>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Shown on screen — voice still plays without it"
                  className={`${fieldClass} text-sm`}
                />
              </>
            ) : (
              <>
                <label className="type-field-label">Spoken label (optional)</label>
                <textarea
                  rows={2}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Empty = ringtone only, no voice"
                  className={`${fieldClass} mb-3 resize-none type-body`}
                />
                <label className="type-field-label">System voice</label>
                <p className="type-caption mb-1.5">
                  Male and female voices depend on this device.
                </p>
                <CompactSelect
                  value={voiceURI}
                  options={[
                    { value: "", label: "Default device voice" },
                    ...voiceGroups.female.map((v) => ({
                      value: v.voiceURI,
                      label: `Female · ${v.name} (${v.lang})`,
                    })),
                    ...voiceGroups.male.map((v) => ({
                      value: v.voiceURI,
                      label: `Male · ${v.name} (${v.lang})`,
                    })),
                    ...voiceGroups.other.map((v) => ({
                      value: v.voiceURI,
                      label: `${v.name} (${v.lang})`,
                    })),
                  ]}
                  onChange={(v) => setVoiceURI(String(v))}
                  ariaLabel="System voice"
                />
              </>
            )}
          </div>

          <div>
            <button
              type="button"
              onClick={testVoicePreview}
              disabled={isPreviewing || (voiceSource === "recording" && !recordingId)}
              className="btn-ghost flex w-full justify-center gap-1.5 py-2.5 disabled:opacity-50"
            >
              <Volume2 className="h-4 w-4" />
              <span>{isPreviewing ? "Testing..." : "Test voice"}</span>
            </button>
          </div>
          <div className="flex items-center gap-3 border-t border-[var(--border)] pt-5">
            <button type="button" onClick={onClose} className="btn-ghost flex-1 py-2.5">
              Cancel
            </button>
            <button type="submit" className="btn-premium flex-1 py-2.5">
              <Check className="h-3.5 w-3.5" />
              <span>Continue</span>
            </button>
          </div>
        </form>
      </div>

      {showRepeatPopup && (
        <div className="fixed inset-0 z-[60] flex animate-fade-in items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-lift)] sm:p-6">
            <div className="mb-4 stack-tight">
              <p className="type-eyebrow !mb-0">Almost done</p>
              <h4 className="type-modal-title text-[1.35rem]">Repeat or once?</h4>
              <p className="type-caption">
                Choose how this alarm should run, then save.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {(
                [
                  {
                    id: "once" as const,
                    title: "Once",
                    caption: "Rings one time, then turns off",
                  },
                  {
                    id: "repeat" as const,
                    title: "Repeat",
                    caption: "Keeps ringing on the schedule",
                  },
                ] as const
              ).map((option) => {
                const selected = repeatMode === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      audioSynth.playClick();
                      setRepeatMode(option.id);
                    }}
                    className={`rounded-2xl border px-3.5 py-4 text-left transition ${
                      selected
                        ? "border-[var(--brand)] bg-[var(--brand-soft)] shadow-[0_4px_14px_var(--glow)]"
                        : "border-[var(--border)] bg-[var(--surface-2)] hover:border-[color-mix(in_srgb,var(--brand)_35%,var(--border))]"
                    }`}
                  >
                    <p className="font-display text-[1.15rem] font-semibold tracking-tight text-[var(--foreground)]">
                      {option.title}
                    </p>
                    <p className="mt-1 text-[11px] leading-snug text-[var(--muted)]">
                      {option.caption}
                    </p>
                  </button>
                );
              })}
            </div>

            {!repeatMode && (
              <p className="mt-3 text-center text-[12px] font-medium text-[var(--danger)]">
                Select Once or Repeat to save.
              </p>
            )}

            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  audioSynth.playClick();
                  setShowRepeatPopup(false);
                  setRepeatMode(null);
                }}
                className="btn-ghost flex-1 py-2.5"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!repeatMode}
                onClick={() => {
                  if (!repeatMode) return;
                  confirmSave(repeatMode);
                }}
                className="btn-premium flex-1 py-2.5 disabled:opacity-45"
              >
                <Check className="h-3.5 w-3.5" />
                <span>Save</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function parseStoredTime(time: string) {
  const [h, m] = time.split(":").map((n) => parseInt(n, 10));
  return {
    hour24: Number.isFinite(h) ? h : 7,
    minute: Number.isFinite(m) ? m : 0,
  };
}

export function RingingModal({
  event,
  onDismiss,
  onSnooze,
}: {
  event: RingEvent;
  onDismiss: () => void;
  onSnooze: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/70 p-4 backdrop-blur-md">
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center shadow-[var(--shadow-lift)] sm:p-8">
        <div className="animate-ring-alarm mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--brand)] text-[var(--brand-ink)] shadow-[0_8px_28px_var(--glow)] sm:mb-5 sm:h-[4.5rem] sm:w-[4.5rem]">
          <Bell className="h-7 w-7 sm:h-8 sm:w-8" />
        </div>
        <p className="type-eyebrow">Alarm</p>
        <h2 className="type-modal-title mt-1 mb-2 break-words px-1 sm:text-[1.85rem]">
          {(() => {
            const t = event.title.trim();
            if (!t || /^alarm$/i.test(t)) return "Playing ringtone";
            return <>&ldquo;{t}&rdquo;</>;
          })()}
        </h2>
        <div className="mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:items-center sm:gap-4">
          <button
            type="button"
            onClick={onSnooze}
            className="flex-1 rounded-2xl border border-[color-mix(in_srgb,var(--brand)_30%,var(--border))] bg-[var(--brand-soft)] py-3.5 text-sm font-bold text-[var(--brand)] shadow-[var(--shadow-soft)]"
          >
            Snooze (5m)
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="flex-1 rounded-2xl bg-[var(--brand)] py-3.5 text-sm font-bold text-[var(--brand-ink)] shadow-[0_8px_22px_var(--glow)]"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
