"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { audioSynth } from "@/lib/audio-synth";
import {
  type Alarm,
  type AlarmSlot,
  type MainMode,
  type Note,
  type SuiteTab,
} from "@/lib/types";

const UNSAVED_CATEGORY = "Unsaved";
const BUILTIN_CATEGORIES = ["Personal", "Work", "Health"] as const;
const CUSTOM_CATS_KEY = "chrono_note_categories";
const NOTES_STORAGE_KEY = "chrono_notes";
const LONG_PRESS_MS = 480;

function loadCustomCategories(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CUSTOM_CATS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function saveCustomCategories(cats: string[]) {
  localStorage.setItem(CUSTOM_CATS_KEY, JSON.stringify(cats));
}

/** Immediate disk write so drafts survive app kill / power off. */
function mergeNoteIntoNotesStorage(note: Note) {
  try {
    const raw = localStorage.getItem(NOTES_STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as Note[]) : [];
    const arr = Array.isArray(list) ? [...list] : [];
    const i = arr.findIndex((n) => n.id === note.id);
    if (i >= 0) arr[i] = note;
    else arr.unshift(note);
    localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(arr));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Plain text for speech / alarms / search (strips HTML + leftover markdown). */
function notePlainText(htmlOrText: string): string {
  return htmlOrText
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/^#+\s+/gm, "")
    .replace(/[*_~#]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Safe HTML for display; converts legacy markdown if no tags present. */
function noteDisplayHtml(content: string): string {
  const hasTags = /<\/?[a-z][\s\S]*>/i.test(content);
  let html = content;
  if (!hasTags) {
    html = content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/^#\s+(.+)$/gm, "<h1>$1</h1>")
      .replace(/^•\s+(.+)$/gm, "<li>$1</li>")
      .replace(/^\d+\.\s+(.+)$/gm, "<li data-ol=\"1\">$1</li>")
      .replace(/(<li>.*<\/li>\n?)+/g, (block) => `<ul>${block}</ul>`)
      .replace(/(<li data-ol="1">.*<\/li>\n?)+/g, (block) =>
        `<ol>${block.replace(/\sdata-ol="1"/g, "")}</ol>`,
      )
      .replace(/\n/g, "<br/>");
  }
  return html
    .replace(/on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/<(?!\/?(?:b|i|u|strong|em|h[1-3]|ul|ol|li|p|br|div|span)\b)[^>]+>/gi, "");
}

export function NotesView({
  notes,
  setNotes,
  setAlarms,
  setMainMode,
  setActiveTab,
  setAlarmSlot,
}: {
  notes: Note[];
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>;
  setAlarms: React.Dispatch<React.SetStateAction<Alarm[]>>;
  setMainMode: React.Dispatch<React.SetStateAction<MainMode>>;
  setActiveTab: React.Dispatch<React.SetStateAction<SuiteTab>>;
  setAlarmSlot: React.Dispatch<React.SetStateAction<AlarmSlot>>;
}) {
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selecting = selectedIds.size > 0;
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const didLongPress = useRef(false);

  const clearRowLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  useEffect(() => () => clearRowLongPress(), []);

  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set([...prev].filter((id) => notes.some((n) => n.id === id)));
      return next.size === prev.size ? prev : next;
    });
  }, [notes]);

  useEffect(() => {
    const saved = loadCustomCategories();
    const fromNotes = notes
      .map((n) => n.category.trim())
      .filter(
        (c) =>
          c &&
          c !== UNSAVED_CATEGORY &&
          !(BUILTIN_CATEGORIES as readonly string[]).includes(c) &&
          !saved.includes(c),
      );
    const merged = saved.filter((c) => c !== UNSAVED_CATEGORY);
    fromNotes.forEach((c) => {
      if (!merged.includes(c)) merged.push(c);
    });
    setCustomCategories(merged);
    if (fromNotes.length) saveCustomCategories(merged);
  }, []);

  const addCustomCategory = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return trimmed;
    if (trimmed === UNSAVED_CATEGORY) return trimmed;
    setCustomCategories((prev) => {
      if (
        (BUILTIN_CATEGORIES as readonly string[]).includes(trimmed) ||
        prev.some((c) => c.toLowerCase() === trimmed.toLowerCase())
      ) {
        return prev;
      }
      const next = [...prev, trimmed];
      saveCustomCategories(next);
      return next;
    });
    return trimmed;
  };

  const allCategories = [
    UNSAVED_CATEGORY,
    ...BUILTIN_CATEGORIES,
    ...customCategories.filter((c) => c !== UNSAVED_CATEGORY),
  ];

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startRowLongPress = (id: string) => {
    didLongPress.current = false;
    clearRowLongPress();
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

  const handleRowActivate = (note: Note) => {
    if (didLongPress.current) {
      didLongPress.current = false;
      return;
    }
    if (selecting) {
      audioSynth.playClick();
      toggleSelect(note.id);
      return;
    }
    audioSynth.playClick();
    setEditingNote(note);
    setIsEditorOpen(true);
  };

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    audioSynth.playClick();
    setNotes((prev) => prev.filter((n) => !selectedIds.has(n.id)));
    setSelectedIds(new Set());
  };

  const cancelSelection = () => {
    audioSynth.playClick();
    setSelectedIds(new Set());
  };

  const filteredNotes = notes
    .filter((n) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        n.title.toLowerCase().includes(q) || notePlainText(n.content).toLowerCase().includes(q);
      const matchesCat = selectedCategory === "All" || n.category === selectedCategory;
      return matchesSearch && matchesCat;
    })
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  const persistNote = (noteData: Note, closeEditor: boolean) => {
    if (noteData.category !== UNSAVED_CATEGORY) addCustomCategory(noteData.category);
    mergeNoteIntoNotesStorage(noteData);
    setNotes((prev) => {
      const i = prev.findIndex((n) => n.id === noteData.id);
      if (i >= 0) return prev.map((n) => (n.id === noteData.id ? { ...n, ...noteData } : n));
      return [noteData, ...prev];
    });
    if (closeEditor) {
      setIsEditorOpen(false);
      setEditingNote(null);
      setSelectedCategory(noteData.category);
    }
  };

  if (isEditorOpen) {
    return (
      <NoteEditor
        editingNote={editingNote}
        categories={allCategories}
        onAddCategory={addCustomCategory}
        onClose={() => {
          setIsEditorOpen(false);
          setEditingNote(null);
        }}
        onAutosave={(noteData) => persistNote(noteData, false)}
        onSave={(noteData) => persistNote(noteData, true)}
      />
    );
  }

  return (
    <div className="relative flex min-h-[60vh] w-full max-w-none self-stretch animate-fade-in flex-col gap-3 py-1 pb-28 sm:gap-4 sm:py-2 sm:pb-24">
      <div className="flex w-full flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="stack-tight min-w-0">
            <p className="type-eyebrow">Studio</p>
            <h2 className="type-page-title">
              {selecting ? `${selectedIds.size} selected` : "Notes"}
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
            <button
              type="button"
              onClick={() => {
                audioSynth.playClick();
                setEditingNote(null);
                setIsEditorOpen(true);
              }}
              className="btn-premium mb-0.5 shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add</span>
            </button>
          )}
        </div>
        {!selecting && (
          <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="relative w-full sm:min-w-[12rem] sm:flex-1">
              <input
                type="text"
                placeholder="Search notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] py-2 pr-3 pl-9 text-xs font-semibold text-[var(--foreground)] focus:ring-2 focus:ring-brand-500 focus:outline-none"
              />
              <Search className="absolute top-2.5 left-3 h-4 w-4 text-[var(--muted)]" />
            </div>
            <div className="chip-scroll rounded-xl bg-[var(--surface-2)] p-1">
              {["All", ...allCategories].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    audioSynth.playClick();
                    setSelectedCategory(cat);
                  }}
                  className={`shrink-0 rounded-lg px-3 py-1 text-xs font-semibold transition ${
                    selectedCategory === cat
                      ? "bg-[var(--brand)] text-[var(--brand-ink)] shadow"
                      : "text-[var(--muted)]"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid w-full grid-cols-2 gap-2.5 sm:gap-3">
        {filteredNotes.length === 0 ? (
          <p className="col-span-2 py-10 text-center type-caption">No notes yet</p>
        ) : (
          filteredNotes.map((note, index) => {
            const selected = selectedIds.has(note.id);
            const preview = notePlainText(note.content);
            return (
              <div
                key={note.id}
                role="button"
                tabIndex={0}
                onPointerDown={() => startRowLongPress(note.id)}
                onPointerUp={clearRowLongPress}
                onPointerLeave={clearRowLongPress}
                onPointerCancel={clearRowLongPress}
                onClick={() => handleRowActivate(note)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleRowActivate(note);
                  }
                }}
                onContextMenu={(e) => {
                  if (selecting) e.preventDefault();
                }}
                className={`flex min-h-[7.5rem] w-full cursor-pointer flex-col items-start gap-1.5 rounded-2xl border px-3 py-3 touch-manipulation transition sm:min-h-[8.5rem] sm:px-3.5 sm:py-3.5 ${
                  selecting ? "select-none" : ""
                } ${
                  selected
                    ? "border-[var(--brand)] bg-[var(--brand-soft)] ring-1 ring-[var(--brand)]"
                    : index % 2 === 0
                      ? "border-[var(--border)] bg-[var(--surface)]"
                      : "border-[color-mix(in_srgb,var(--brand)_18%,var(--border))] bg-[color-mix(in_srgb,var(--brand)_7%,var(--surface-2))]"
                }`}
              >
                <div className="flex w-full items-start gap-2">
                  {selecting && (
                    <div
                      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                        selected
                          ? "border-transparent bg-[var(--brand)] text-[var(--brand-ink)]"
                          : "border-[var(--border-strong)] bg-[var(--surface)] text-transparent"
                      }`}
                      aria-hidden
                    >
                      <Check className="h-2.5 w-2.5" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-1">
                      <span className="max-w-full truncate rounded-md bg-[var(--brand-soft)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[var(--brand)]">
                        {note.category}
                      </span>
                    </div>
                    {note.title.trim() ? (
                      <h3
                        className={`type-card-title line-clamp-2 text-[0.95rem] leading-snug text-[var(--foreground)] ${
                          selecting ? "" : "select-text"
                        }`}
                      >
                        {note.title.trim()}
                      </h3>
                    ) : null}
                    <p
                      className={`line-clamp-2 text-[12px] leading-relaxed text-[var(--muted)] ${
                        note.title.trim() ? "mt-1" : ""
                      } ${selecting ? "" : "select-text"}`}
                    >
                      {preview}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

    </div>
  );
}

export function NoteEditor({
  editingNote,
  categories,
  onAddCategory,
  onClose,
  onAutosave,
  onSave,
}: {
  editingNote: Note | null;
  categories: string[];
  onAddCategory: (name: string) => string;
  onClose: () => void;
  /** Persist without leaving the editor (app background / feature switch). */
  onAutosave: (note: Note) => void;
  onSave: (note: Note) => void;
}) {
  const [title, setTitle] = useState(editingNote ? editingNote.title : "");
  const [category, setCategory] = useState(editingNote ? editingNote.category : "Personal");
  const [categoryMode, setCategoryMode] = useState<"pick" | "custom">("pick");
  const [customName, setCustomName] = useState("");
  const [hasBody, setHasBody] = useState(Boolean(editingNote && notePlainText(editingNote.content)));
  const [activeTools, setActiveTools] = useState({
    bold: false,
    italic: false,
    underline: false,
    heading: false,
    bullet: false,
    number: false,
  });
  const [editMenu, setEditMenu] = useState<null | {
    mode: "selection" | "paste";
    x: number;
    y: number;
  }>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchMovedRef = useRef(false);
  const committedRef = useRef(false);
  const noteIdRef = useRef(editingNote?.id ?? Date.now().toString());
  const titleRef = useRef(title);
  const categoryRef = useRef(category);
  const categoryModeRef = useRef(categoryMode);
  const customNameRef = useRef(customName);
  const onAutosaveRef = useRef(onAutosave);
  const editingNoteRef = useRef(editingNote);
  titleRef.current = title;
  categoryRef.current = category;
  categoryModeRef.current = categoryMode;
  customNameRef.current = customName;
  onAutosaveRef.current = onAutosave;
  editingNoteRef.current = editingNote;

  const isCoarsePointer = () =>
    typeof window !== "undefined" &&
    window.matchMedia("(hover: none) and (pointer: coarse)").matches;

  const clearLongPress = () => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    const el = editorRef.current;
    const range = savedRangeRef.current;
    if (!el || !range) return;
    el.focus();
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  };

  const syncActiveTools = () => {
    const el = editorRef.current;
    if (!el) return;
    const sel = window.getSelection();
    if (!sel || !sel.anchorNode || !el.contains(sel.anchorNode)) {
      setActiveTools({
        bold: false,
        italic: false,
        underline: false,
        heading: false,
        bullet: false,
        number: false,
      });
      return;
    }
    const block = (document.queryCommandValue("formatBlock") || "").toLowerCase();
    setActiveTools({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
      heading: block === "h1",
      bullet: document.queryCommandState("insertUnorderedList"),
      number: document.queryCommandState("insertOrderedList"),
    });
  };

  const placeEditMenu = (mode: "selection" | "paste", clientX: number, clientY: number) => {
    const pad = 12;
    const menuW = mode === "paste" ? 88 : 220;
    const menuH = 44;
    const x = Math.min(Math.max(pad, clientX - menuW / 2), window.innerWidth - menuW - pad);
    const y = Math.min(Math.max(pad, clientY - menuH - 12), window.innerHeight - menuH - pad);
    setEditMenu({ mode, x, y });
  };

  const refreshBodyState = () => {
    const html = editorRef.current?.innerHTML ?? "";
    setHasBody(Boolean(notePlainText(html)));
    syncActiveTools();
  };

  const insertPlainAtSelection = (text: string, opts?: { restore?: boolean }) => {
    if (opts?.restore !== false) restoreSelection();
    if (!text) return;
    if (!document.execCommand("insertText", false, text)) {
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  };

  const runCopy = () => {
    audioSynth.playClick();
    saveSelection();
    restoreSelection();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    if (!ok) {
      const text = window.getSelection()?.toString() ?? "";
      if (text && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(text).catch(() => undefined);
      }
    }
    setEditMenu(null);
  };

  const runCut = () => {
    audioSynth.playClick();
    saveSelection();
    restoreSelection();
    let ok = false;
    try {
      ok = document.execCommand("cut");
    } catch {
      ok = false;
    }
    if (!ok) {
      const text = window.getSelection()?.toString() ?? "";
      if (text && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(text).catch(() => undefined);
      }
      document.execCommand("delete");
    }
    refreshBodyState();
    setEditMenu(null);
  };

  const runPaste = () => {
    audioSynth.playClick();
    saveSelection();
    restoreSelection();
    // Prefer sync execCommand in the same user gesture; Clipboard API is async fallback.
    let ok = false;
    try {
      ok = document.execCommand("paste");
    } catch {
      ok = false;
    }
    if (ok) {
      refreshBodyState();
      setEditMenu(null);
      return;
    }
    if (navigator.clipboard?.readText) {
      void navigator.clipboard
        .readText()
        .then((text) => {
          if (text) insertPlainAtSelection(text);
          refreshBodyState();
          setEditMenu(null);
        })
        .catch(() => {
          // Coarse pointers: allow system long-press paste next time
          setEditMenu(null);
        });
      return;
    }
    setEditMenu(null);
  };

  const onEditorPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const plain = e.clipboardData.getData("text/plain");
    const html = e.clipboardData.getData("text/html");
    if (!plain && !html) return;
    e.preventDefault();
    if (html && /<(b|i|u|strong|em|ul|ol|li|h1|p|br)\b/i.test(html)) {
      // Safe-ish rich paste: strip scripts via insertHTML of sanitized subset
      const cleaned = html
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
        .replace(/\son\w+="[^"]*"/gi, "")
        .replace(/\son\w+='[^']*'/gi, "");
      if (!document.execCommand("insertHTML", false, cleaned) && plain) {
        insertPlainAtSelection(plain, { restore: false });
      }
    } else if (plain) {
      insertPlainAtSelection(plain, { restore: false });
    }
    refreshBodyState();
  };

  const onEditorTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isCoarsePointer()) return;
    const t = e.touches[0];
    if (!t) return;
    touchStartRef.current = { x: t.clientX, y: t.clientY };
    touchMovedRef.current = false;
    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      if (touchMovedRef.current) return;
      saveSelection();
      const sel = window.getSelection();
      const selected = (sel?.toString() ?? "").trim();
      // Empty / caret only → paste; if somehow selected without move, full menu
      placeEditMenu(selected ? "selection" : "paste", t.clientX, t.clientY);
    }, 480);
  };

  const onEditorTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isCoarsePointer()) return;
    const t = e.touches[0];
    const start = touchStartRef.current;
    if (!t || !start) return;
    if (Math.abs(t.clientX - start.x) > 8 || Math.abs(t.clientY - start.y) > 8) {
      touchMovedRef.current = true;
      clearLongPress();
      if (editMenu?.mode === "paste") setEditMenu(null);
    }
  };

  const onEditorTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isCoarsePointer()) return;
    clearLongPress();
    const t = e.changedTouches[0];
    window.setTimeout(() => {
      saveSelection();
      const sel = window.getSelection();
      const selected = (sel?.toString() ?? "").trim();
      const el = editorRef.current;
      if (!el || !sel || !sel.anchorNode || !el.contains(sel.anchorNode)) return;
      if (selected && touchMovedRef.current) {
        placeEditMenu(
          "selection",
          t?.clientX ?? window.innerWidth / 2,
          t?.clientY ?? 120,
        );
      }
      syncActiveTools();
    }, 40);
  };

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (editingNote?.content) {
      el.innerHTML = noteDisplayHtml(editingNote.content);
    } else {
      el.innerHTML = "";
    }
    setHasBody(Boolean(notePlainText(el.innerHTML)));
    syncActiveTools();
  }, [editingNote]);

  useEffect(() => {
    const onSel = () => {
      syncActiveTools();
      if (editMenu) saveSelection();
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [editMenu]);

  useEffect(() => {
    return () => clearLongPress();
  }, []);

  const applyFormat = (command: string) => {
    audioSynth.playClick();
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    if (command === "heading") {
      const block = (document.queryCommandValue("formatBlock") || "").toLowerCase();
      document.execCommand("formatBlock", false, block === "h1" ? "p" : "h1");
    } else if (command === "bullet") {
      document.execCommand("insertUnorderedList");
    } else if (command === "number") {
      document.execCommand("insertOrderedList");
    } else {
      document.execCommand(command);
    }
    setHasBody(Boolean(notePlainText(el.innerHTML)));
    syncActiveTools();
  };

  function toolbarClass(active: boolean, extra = "") {
    return [
      "px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-sm",
      extra,
      active
        ? "bg-[var(--brand)] text-[var(--brand-ink)] dark:bg-[var(--brand-ink)] dark:text-[var(--brand)]"
        : "bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--brand-soft)]",
    ]
      .filter(Boolean)
      .join(" ");
  }

  const resolveTitle = (_plain: string, rawTitle: string) => rawTitle.trim();

  const buildNote = (forceUnsaved: boolean): Note | null => {
    const html = editorRef.current?.innerHTML ?? "";
    const plain = notePlainText(html);
    if (!plain) return null;

    let finalCategory = categoryRef.current.trim();
    if (forceUnsaved) {
      finalCategory = UNSAVED_CATEGORY;
    } else if (categoryModeRef.current === "custom") {
      finalCategory = onAddCategory(customNameRef.current);
      if (!finalCategory) finalCategory = UNSAVED_CATEGORY;
    } else if (
      finalCategory &&
      finalCategory !== UNSAVED_CATEGORY &&
      !(BUILTIN_CATEGORIES as readonly string[]).includes(finalCategory)
    ) {
      onAddCategory(finalCategory);
    }
    if (!finalCategory) finalCategory = UNSAVED_CATEGORY;

    const current = editingNoteRef.current;
    return {
      id: current?.id ?? noteIdRef.current,
      title: resolveTitle(plain, titleRef.current),
      content: html.trim(),
      category: finalCategory,
      voiceType: "female",
      pinned: current ? current.pinned : false,
      color: "brand",
    };
  };

  /** New note with body, or edited existing note — eligible for Unsaved autosave. */
  const shouldFlushUnsaved = () => {
    const html = editorRef.current?.innerHTML ?? "";
    const plain = notePlainText(html);
    if (!plain) return false;
    const current = editingNoteRef.current;
    if (!current) return true;
    return (
      html.trim() !== (current.content || "").trim() ||
      titleRef.current.trim() !== (current.title || "").trim()
    );
  };

  /** Background / feature switch / power-off: keep non-empty drafts in Unsaved. */
  const flushUnsavedDraft = () => {
    if (committedRef.current) return;
    if (!shouldFlushUnsaved()) return;
    const draft = buildNote(true);
    if (!draft) return;
    onAutosaveRef.current(draft);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const note = buildNote(false);
    if (!note) return;
    committedRef.current = true;
    audioSynth.playClick();
    onSave(note);
  };

  const leaveEditor = () => {
    if (committedRef.current) {
      onClose();
      return;
    }
    if (shouldFlushUnsaved()) {
      const draft = buildNote(true);
      if (draft) {
        committedRef.current = true;
        onSave(draft);
        return;
      }
    }
    onClose();
  };

  useEffect(() => {
    const onHide = () => flushUnsavedDraft();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushUnsavedDraft();
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      // Leaving Notes for Alarm / To-Do / another tab unmounts the editor
      flushUnsavedDraft();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flush helpers use refs
  }, []);

  const saveCustomCategoryOnly = () => {
    audioSynth.playClick();
    const named = onAddCategory(customName);
    if (!named) return;
    setCategory(named);
    setCustomName("");
    setCategoryMode("pick");
  };

  return (
    <div className="flex min-h-[70vh] w-full max-w-none self-stretch animate-fade-in flex-col py-1 pb-8 sm:min-h-[85vh] sm:py-2 sm:pb-24">
      <div className="mb-4 flex items-start justify-between gap-3 border-b border-[var(--border)] pb-3 sm:mb-5 sm:items-center sm:pb-4">
        <div className="min-w-0">
          <h2 className="type-page-title text-xl sm:text-2xl">
            {editingNote ? "Edit Note" : "Create New Note"}
          </h2>
          <p className="type-caption mt-0.5">
            Title optional · Non-empty notes auto-save to Unsaved if you leave or close the app
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            audioSynth.playClick();
            leaveEditor();
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-[var(--surface-2)] px-3 py-2 text-sm font-bold text-[var(--foreground)] transition hover:opacity-90 sm:gap-2 sm:px-4"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back</span>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex w-full flex-1 flex-col gap-4 sm:gap-5">
        <div className="flex flex-1 flex-col gap-4 sm:gap-5">
          <div>
            <label className="mb-2 block text-xs font-bold uppercase text-slate-500">
              Note Title <span className="normal-case tracking-normal text-[var(--muted)]">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="Title (optional)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base font-bold text-slate-900 focus:ring-2 focus:ring-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800/80"
            />
          </div>

          <div className="flex flex-1 flex-col">
            <div className="mb-2">
              <label className="block text-xs font-bold uppercase text-slate-500">Note Body & Formatting</label>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-t-xl border-x border-t border-[var(--border)] bg-[var(--surface-2)] p-2.5">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyFormat("bold")}
                className={toolbarClass(activeTools.bold, "font-black")}
                title="Bold"
                aria-pressed={activeTools.bold}
              >
                B
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyFormat("italic")}
                className={toolbarClass(activeTools.italic, "italic")}
                title="Italic"
                aria-pressed={activeTools.italic}
              >
                I
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyFormat("underline")}
                className={toolbarClass(activeTools.underline, "underline")}
                title="Underline"
                aria-pressed={activeTools.underline}
              >
                U
              </button>
              <div className="mx-1 h-5 w-px bg-[var(--border)]" />
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyFormat("heading")}
                className={toolbarClass(activeTools.heading, "font-extrabold")}
                aria-pressed={activeTools.heading}
              >
                H1
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyFormat("bullet")}
                className={toolbarClass(activeTools.bullet)}
                aria-pressed={activeTools.bullet}
              >
                <span>• List</span>
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applyFormat("number")}
                className={toolbarClass(activeTools.number)}
                aria-pressed={activeTools.number}
              >
                <span>1. List</span>
              </button>
            </div>
            <div className="relative">
              <div
                ref={editorRef}
                contentEditable
                role="textbox"
                aria-multiline="true"
                aria-label="Note body"
                data-placeholder="Start typing your note here..."
                onInput={() => {
                  const html = editorRef.current?.innerHTML ?? "";
                  setHasBody(Boolean(notePlainText(html)));
                  syncActiveTools();
                }}
                onKeyUp={syncActiveTools}
                onMouseUp={syncActiveTools}
                onTouchStart={onEditorTouchStart}
                onTouchMove={onEditorTouchMove}
                onTouchEnd={onEditorTouchEnd}
                onPaste={onEditorPaste}
                onContextMenu={(e) => {
                  if (!isCoarsePointer()) return;
                  // Prefer custom menu, but do not permanently block system paste
                  saveSelection();
                  const selected = (window.getSelection()?.toString() ?? "").trim();
                  e.preventDefault();
                  placeEditMenu(selected ? "selection" : "paste", e.clientX, e.clientY);
                }}
                className="note-editor min-h-[200px] w-full flex-1 resize-y overflow-y-auto rounded-b-xl border-x border-b border-[var(--border)] bg-[var(--surface)] px-3 py-3 text-sm leading-relaxed text-[var(--foreground)] outline-none focus:ring-2 focus:ring-brand-500 sm:min-h-[300px] sm:px-5 sm:py-4 sm:text-base"
              />
              {editMenu && (
                <div
                  className="fixed z-[90] flex items-center gap-0.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-1 py-1 shadow-[var(--shadow-lift)]"
                  style={{ left: editMenu.x, top: editMenu.y }}
                  role="menu"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {editMenu.mode === "selection" && (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={runCopy}
                        className="rounded-full px-3.5 py-1.5 text-xs font-bold text-[var(--foreground)] hover:bg-[var(--brand-soft)]"
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={runCut}
                        className="rounded-full px-3.5 py-1.5 text-xs font-bold text-[var(--foreground)] hover:bg-[var(--brand-soft)]"
                      >
                        Cut
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    onClick={runPaste}
                    className="rounded-full px-3.5 py-1.5 text-xs font-bold text-[var(--brand)] hover:bg-[var(--brand-soft)]"
                  >
                    Paste
                  </button>
                </div>
              )}
            </div>
            {editMenu && (
              <button
                type="button"
                className="fixed inset-0 z-[80] cursor-default bg-transparent"
                aria-label="Dismiss edit menu"
                onClick={() => setEditMenu(null)}
              />
            )}
            {!hasBody && (
              <p className="sr-only" aria-live="polite">
                Note body is required
              </p>
            )}
          </div>

          <div>
            <label className="mb-2 block text-xs font-bold uppercase text-slate-500">Category</label>
            {categoryMode === "pick" ? (
              <select
                value={categories.includes(category) ? category : categories[0] || "Personal"}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "__custom__") {
                    audioSynth.playClick();
                    setCategoryMode("custom");
                    setCustomName("");
                    return;
                  }
                  setCategory(v);
                }}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-semibold text-[var(--foreground)] focus:ring-2 focus:ring-brand-500 focus:outline-none"
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
                <option value="__custom__">+ Custom…</option>
              </select>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="Name your category…"
                  maxLength={32}
                  className="w-full flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm font-semibold text-[var(--foreground)] focus:ring-2 focus:ring-brand-500 focus:outline-none"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={saveCustomCategoryOnly}
                    disabled={!customName.trim()}
                    className="btn-premium flex-1 !py-3 sm:flex-none"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      audioSynth.playClick();
                      setCategoryMode("pick");
                      setCustomName("");
                    }}
                    className="rounded-xl border border-[var(--border)] px-4 py-3 text-sm font-bold text-[var(--muted)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mt-2 flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-4">
          <button
            type="button"
            onClick={() => {
              audioSynth.playClick();
              leaveEditor();
            }}
            className="rounded-xl border border-[var(--border)] px-6 py-3 text-sm font-bold text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
          >
            Close
          </button>
          <button
            type="submit"
            disabled={!hasBody}
            className="flex items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-8 py-3 text-sm font-bold text-[var(--brand-ink)] shadow-lg transition hover:bg-[var(--brand-hover)] disabled:opacity-50"
          >
            <Check className="h-5 w-5" />
            <span>Save Note</span>
          </button>
        </div>
      </form>
    </div>
  );
}
