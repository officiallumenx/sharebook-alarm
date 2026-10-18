"use client";

import { useEffect, useRef, useState } from "react";
import { Calendar, Check, Clock, Plus, Trash2, X } from "lucide-react";
import { audioSynth } from "@/lib/audio-synth";
import { CompactSelect } from "@/components/ui/CompactSelect";
import {
  type Alarm,
  type AlarmSlot,
  type MainMode,
  type SuiteTab,
  type TodoItem,
  formatDisplayTime,
  todayISO,
} from "@/lib/types";

const LONG_PRESS_MS = 480;

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
const REMINDER_OPTIONS = [
  { value: "at_time", label: "At Exact Time" },
  { value: "5_min", label: "5 Mins Before" },
  { value: "15_min", label: "15 Mins Before" },
  { value: "1_hour", label: "1 Hour Before" },
  { value: "1_day", label: "1 Day Before" },
];

function parseStoredTime(time: string) {
  const [h, m] = time.split(":").map((n) => parseInt(n, 10));
  return {
    hour24: Number.isFinite(h) ? h : 8,
    minute: Number.isFinite(m) ? m : 0,
  };
}

function formatTodoTime(time: string | undefined, is24Hour: boolean) {
  const { hour24, minute } = parseStoredTime(time || "08:00");
  const d = new Date();
  d.setHours(hour24, minute, 0, 0);
  const fmt = formatDisplayTime(d, is24Hour);
  return is24Hour
    ? `${fmt.hoursStr}:${fmt.minutes}`
    : `${fmt.hoursStr}:${fmt.minutes} ${fmt.ampm}`;
}

export function TodoView({
  todos,
  setTodos,
  is24Hour,
}: {
  todos: TodoItem[];
  setTodos: React.Dispatch<React.SetStateAction<TodoItem[]>>;
  is24Hour: boolean;
  setAlarms: React.Dispatch<React.SetStateAction<Alarm[]>>;
  setMainMode: React.Dispatch<React.SetStateAction<MainMode>>;
  setActiveTab: React.Dispatch<React.SetStateAction<SuiteTab>>;
  setAlarmSlot: React.Dispatch<React.SetStateAction<AlarmSlot>>;
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTodo, setEditingTodo] = useState<TodoItem | null>(null);
  const [activeFilter, setActiveFilter] = useState("All");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selecting = selectedIds.size > 0;
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);
  const todayStr = todayISO();

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  useEffect(() => () => clearLongPress(), []);

  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter((id) => todos.some((t) => t.id === id)));
      return next.size === prev.size ? prev : next;
    });
  }, [todos]);

  const toggleComplete = (id: string) => {
    audioSynth.playClick();
    setTodos((prev) => prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)));
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

  const handleRowActivate = (todo: TodoItem) => {
    if (didLongPress.current) {
      didLongPress.current = false;
      return;
    }
    if (selecting) {
      audioSynth.playClick();
      toggleSelect(todo.id);
      return;
    }
    audioSynth.playClick();
    setEditingTodo(todo);
    setIsModalOpen(true);
  };

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    audioSynth.playClick();
    setTodos((prev) => prev.filter((t) => !selectedIds.has(t.id)));
    setSelectedIds(new Set());
  };

  const cancelSelection = () => {
    audioSynth.playClick();
    setSelectedIds(new Set());
  };

  const openAdd = () => {
    audioSynth.playClick();
    setEditingTodo(null);
    setIsModalOpen(true);
  };

  const filteredTodos = todos.filter((t) => {
    if (activeFilter === "Today") return t.date === todayStr;
    if (activeFilter === "Upcoming") return t.date > todayStr && !t.completed;
    if (activeFilter === "Completed") return t.completed;
    return true;
  });

  const groupedByDate = filteredTodos.reduce<Record<string, TodoItem[]>>((groups, todo) => {
    const dateKey = todo.date || "Unscheduled";
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(todo);
    return groups;
  }, {});

  const sortedDateKeys = Object.keys(groupedByDate).sort();

  return (
    <div className="relative flex min-h-[60vh] w-full max-w-4xl animate-fade-in flex-col gap-4 py-2 pb-28 sm:gap-6 sm:py-4 sm:pb-24">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex w-full items-start justify-between gap-3">
          <div className="stack-tight min-w-0">
            <p className="type-eyebrow">Planner</p>
            <h2 className="type-page-title">
              {selecting ? `${selectedIds.size} selected` : "To-Do"}
            </h2>
            <p className="type-caption">
              {selecting
                ? "Tap more to select · Delete when ready"
                : "Tap to edit · Long-press to select"}
            </p>
          </div>
          {selecting ? (
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={cancelSelection}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] text-[var(--muted)]"
                aria-label="Cancel selection"
              >
                <X className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={deleteSelected}
                className="flex items-center gap-1.5 rounded-full bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white shadow-md"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>
          ) : (
            <button type="button" onClick={openAdd} className="btn-premium mb-0.5 shrink-0">
              <Plus className="h-3.5 w-3.5" />
              <span>Add</span>
            </button>
          )}
        </div>
      </div>

      {!selecting && (
        <div className="chip-scroll rounded-xl bg-[var(--surface-2)] p-1">
          {["All", "Today", "Upcoming", "Completed"].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                audioSynth.playClick();
                setActiveFilter(f);
              }}
              className={`shrink-0 rounded-lg px-3 py-1 text-xs font-semibold transition ${
                activeFilter === f
                  ? "bg-[var(--brand)] text-[var(--brand-ink)] shadow"
                  : "text-[var(--muted)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand)]"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-6">
        {sortedDateKeys.length === 0 ? (
          <p className="py-10 text-center type-caption">No tasks yet</p>
        ) : (
          sortedDateKeys.map((dateKey) => (
            <div key={dateKey} className="space-y-3">
              <div className="flex items-center gap-3 border-b border-[var(--border)] pb-2">
                <div className="flex items-center gap-2 rounded-xl bg-[var(--surface-2)] px-3 py-1 text-xs font-bold text-[var(--foreground)]">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>{dateKey === todayStr ? "Today" : dateKey}</span>
                </div>
              </div>
              <div className="space-y-2.5">
                {groupedByDate[dateKey].map((todo) => {
                  const selected = selectedIds.has(todo.id);
                  return (
                    <div
                      key={todo.id}
                      role="button"
                      tabIndex={0}
                      onPointerDown={() => startLongPress(todo.id)}
                      onPointerUp={clearLongPress}
                      onPointerLeave={clearLongPress}
                      onPointerCancel={clearLongPress}
                      onClick={() => handleRowActivate(todo)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleRowActivate(todo);
                        }
                      }}
                      onContextMenu={(e) => e.preventDefault()}
                      className={`flex cursor-pointer items-center gap-3 rounded-2xl border px-3.5 py-3.5 select-none touch-manipulation transition sm:px-4 ${
                        selected
                          ? "border-[var(--brand)] bg-[var(--brand-soft)] ring-1 ring-[var(--brand)]"
                          : todo.completed
                            ? "border-[var(--border)] bg-[var(--surface)] opacity-55"
                            : "border-[var(--border)] bg-[var(--surface)]"
                      }`}
                    >
                      {selecting ? (
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
                      ) : (
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleComplete(todo.id);
                          }}
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition ${
                            todo.completed
                              ? "border-emerald-500 bg-emerald-500 text-white"
                              : "border-[var(--border)] bg-[var(--surface)] text-transparent"
                          }`}
                          aria-label={todo.completed ? "Mark incomplete" : "Mark complete"}
                        >
                          <Check className="h-4 w-4" />
                        </button>
                      )}
                      <div className="min-w-0 flex-1">
                        <h4
                          className={`truncate text-sm font-bold ${
                            todo.completed
                              ? "text-[var(--muted)] line-through"
                              : "text-[var(--foreground)]"
                          }`}
                        >
                          {todo.title}
                        </h4>
                        <div className="mt-1 flex items-center gap-1 text-xs font-semibold text-[var(--brand)]">
                          <Clock className="h-3.5 w-3.5" />
                          <span>{formatTodoTime(todo.time, is24Hour)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      {isModalOpen && (
        <TodoModal
          key={editingTodo?.id ?? "new-todo"}
          editingTodo={editingTodo}
          is24Hour={is24Hour}
          onClose={() => {
            setIsModalOpen(false);
            setEditingTodo(null);
          }}
          onSave={(td) => {
            if (editingTodo) {
              setTodos((prev) =>
                prev.map((t) =>
                  t.id === editingTodo.id
                    ? // Keep list `completed` — modal snapshot can be stale if toggled while open
                      { ...t, ...td, completed: t.completed }
                    : t,
                ),
              );
            } else {
              setTodos((prev) => [...prev, td]);
            }
            setIsModalOpen(false);
            setEditingTodo(null);
          }}
          todayStr={todayStr}
        />
      )}
    </div>
  );
}

export function TodoModal({
  editingTodo,
  onClose,
  onSave,
  todayStr,
  is24Hour,
}: {
  editingTodo: TodoItem | null;
  onClose: () => void;
  onSave: (todo: TodoItem) => void;
  todayStr: string;
  is24Hour: boolean;
}) {
  const [title, setTitle] = useState(editingTodo ? editingTodo.title : "");
  const [date, setDate] = useState(editingTodo ? editingTodo.date : todayStr);
  const initial = parseStoredTime(editingTodo?.time || "08:00");
  const [hour24, setHour24] = useState(initial.hour24);
  const [minute, setMinute] = useState(initial.minute);
  const [reminder, setReminder] = useState(editingTodo ? editingTodo.reminder || "at_time" : "at_time");

  const hour12 = hour24 % 12 || 12;
  const ampm: "AM" | "PM" = hour24 >= 12 ? "PM" : "AM";
  const storedTime = `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  const setFrom12Hour = (h12: number, nextAmpm: "AM" | "PM") => {
    let h = h12 % 12;
    if (nextAmpm === "PM") h += 12;
    setHour24(h);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (title.trim()) {
      onSave({
        id: editingTodo ? editingTodo.id : Date.now().toString(),
        title: title.trim(),
        completed: editingTodo ? editingTodo.completed : false,
        date,
        time: storedTime,
        reminder,
        voiceType: "female",
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-black/45 p-0 backdrop-blur-md sm:items-center sm:p-4">
      <div className="modal-sheet w-full max-w-lg overflow-y-auto rounded-t-[1.75rem] border border-[var(--border)] bg-[var(--surface)] p-5 text-[var(--foreground)] shadow-[var(--shadow-lift)] sm:rounded-3xl sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-3 border-b border-[var(--border)] pb-4">
          <div className="stack-tight min-w-0">
            <p className="type-eyebrow">Planner</p>
            <h3 className="type-modal-title">{editingTodo ? "Edit Task" : "Schedule New Task"}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mt-0.5 shrink-0 rounded-full border border-[var(--border)] p-2 text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="type-field-label">Task Description</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              className="form-field"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="type-field-label">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="form-field !py-2 !text-xs"
              />
            </div>
            <div>
              <label className="type-field-label">
                Time {is24Hour ? "(24H)" : "(12H)"}
              </label>
              {is24Hour ? (
                <div className="flex items-center gap-1">
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
                  <div className="flex items-center gap-1">
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
                        className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition ${
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
            </div>
          </div>
          <div>
            <label className="type-field-label">Reminder</label>
            <CompactSelect
              value={reminder}
              options={REMINDER_OPTIONS}
              onChange={(v) => setReminder(String(v))}
              ariaLabel="Reminder"
            />
          </div>
          <div className="flex items-center gap-3 border-t border-[var(--border)] pt-4">
            <button type="button" onClick={onClose} className="btn-ghost flex-1 !py-2.5">
              Cancel
            </button>
            <button type="submit" className="btn-premium flex-1 !py-2.5">
              <Check className="h-4 w-4" />
              <span>Save Task</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
