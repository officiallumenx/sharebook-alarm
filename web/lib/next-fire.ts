import type { Alarm, TodoItem } from "./types";
import { spokenAlarmText } from "./spoken-label";

export type ScheduledFire = {
  at: number;
  key: string;
  type: "alarm" | "todo" | "snooze";
  id: string;
  title: string;
  speakText: string;
  voiceType: string;
  voiceURI?: string;
  recordingId?: string;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function dateISO(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseHM(time: string): [number, number] {
  const [h, m] = time.split(":").map((x) => Number(x));
  return [Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0];
}

function alarmMatchesDay(alarm: Alarm, day: Date): boolean {
  const dateStr = dateISO(day);
  const dow = day.getDay();
  const hasDate = Boolean(alarm.date);
  const onDate = hasDate && alarm.date === dateStr;
  const onDay = alarm.repeatDays.length > 0 && alarm.repeatDays.includes(dow);

  if (hasDate && alarm.repeatDays.length === 0) return onDate;
  if (!hasDate && alarm.repeatDays.length > 0) return onDay;
  if (hasDate && alarm.repeatDays.length > 0) return onDate || onDay;
  return false;
}

/** Next fire timestamps for enabled alarms within the horizon. */
export function collectUpcomingFires(
  alarms: Alarm[],
  todos: TodoItem[],
  from = new Date(),
  horizonDays = 8,
  limit = 12,
): ScheduledFire[] {
  const out: ScheduledFire[] = [];
  const fromMs = from.getTime();

  for (const alarm of alarms) {
    if (!alarm.enabled || !alarm.time) continue;
    const [hh, mm] = parseHM(alarm.time);
    const label = spokenAlarmText(alarm.label);
    const title = label || "Alarm";
    const clipId = alarm.recordingId?.trim() || undefined;
    const onceOnly =
      alarm.repeatMode === "once" ||
      (Boolean(alarm.date) && alarm.repeatDays.length === 0);

    for (let d = 0; d < horizonDays; d++) {
      const day = new Date(from);
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() + d);
      if (!alarmMatchesDay(alarm, day)) continue;

      const fire = new Date(day);
      fire.setHours(hh, mm, 0, 0);
      const at = fire.getTime();
      if (at <= fromMs) continue;

      out.push({
        at,
        key: `alarm-${alarm.id}-${at}`,
        type: "alarm",
        id: alarm.id,
        title,
        speakText: label,
        voiceType: alarm.voiceType || "female",
        voiceURI: clipId ? undefined : alarm.voiceURI,
        recordingId: clipId,
      });
      if (onceOnly) break;
    }
  }

  for (const todo of todos) {
    if (todo.completed || !todo.date || !todo.time) continue;
    try {
      const [tHours, tMins] = parseHM(todo.time);
      const [tYear, tMonth, tDay] = todo.date.split("-").map(Number);
      const targetDate = new Date(tYear, tMonth - 1, tDay, tHours, tMins, 0);

      let offsetMs = 0;
      if (todo.reminder === "5_min") offsetMs = 5 * 60 * 1000;
      else if (todo.reminder === "15_min") offsetMs = 15 * 60 * 1000;
      else if (todo.reminder === "1_hour") offsetMs = 60 * 60 * 1000;
      else if (todo.reminder === "1_day") offsetMs = 24 * 60 * 60 * 1000;

      const at = targetDate.getTime() - offsetMs;
      if (at <= fromMs) continue;

      const reminderLabel =
        todo.reminder && todo.reminder !== "at_time"
          ? `Reminder (${todo.reminder.replace("_", " ")} before): ${todo.title}`
          : `Reminder: ${todo.title}`;

      out.push({
        at,
        key: `todo-${todo.id}-${at}`,
        type: "todo",
        id: todo.id,
        title: reminderLabel,
        speakText: reminderLabel,
        voiceType: todo.voiceType || "female",
      });
    } catch {
      /* skip bad todo */
    }
  }

  return out.sort((a, b) => a.at - b.at).slice(0, limit);
}
