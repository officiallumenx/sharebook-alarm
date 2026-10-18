"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  FolderPlus,
  Mic,
  MicOff,
  Pencil,
  Play,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import { audioSynth } from "@/lib/audio-synth";
import {
  pickHighQualityRecorderOptions,
  pcmSessionToWav,
  startPcmCapture,
  VOICE_MIC_CONSTRAINTS,
  type PcmCaptureSession,
} from "@/lib/voice-capture";
import { CompactSelect } from "@/components/ui/CompactSelect";
import {
  ALL_CATEGORY_ID,
  DEFAULT_CATEGORY_ID,
  addVoiceCategory,
  deleteVoiceCategory,
  deleteVoiceClip,
  listVoiceCategories,
  listVoiceClips,
  moveVoiceClip,
  pickRecorderMimeType,
  renameVoiceCategory,
  renameVoiceClip,
  saveVoiceBlob,
  type VoiceCategory,
  type VoiceClipMeta,
} from "@/lib/voice-clips";

function formatDuration(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function MyVoicesPanel({
  variant = "page",
  selectedId,
  onSelect,
  onClipsChange,
}: {
  variant?: "page" | "embedded" | "picker";
  selectedId?: string;
  onSelect?: (id: string) => void;
  onClipsChange?: () => void;
}) {
  const [categories, setCategories] = useState<VoiceCategory[]>([]);
  const [clips, setClips] = useState<VoiceClipMeta[]>([]);
  const [activeCategoryId, setActiveCategoryId] = useState(ALL_CATEGORY_ID);
  const [name, setName] = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [pendingClip, setPendingClip] = useState<{
    blob: Blob;
    mimeType: string;
  } | null>(null);
  const [pendingName, setPendingName] = useState("");
  const [savingPending, setSavingPending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef(name);
  const saveCategoryRef = useRef(DEFAULT_CATEGORY_ID);
  /** High-quality PCM session (AudioWorklet) → normalized WAV */
  const pcmRef = useRef<PcmCaptureSession | null>(null);
  const stopCaptureRef = useRef<(() => void | Promise<void>) | null>(null);
  const recordingActiveRef = useRef(false);

  const compact = variant !== "page";

  const onClipsChangeRef = useRef(onClipsChange);
  onClipsChangeRef.current = onClipsChange;

  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  const reload = useCallback(async (notify = false) => {
    try {
      setCategories(listVoiceCategories());
      setClips(await listVoiceClips());
      if (notify) onClipsChangeRef.current?.();
    } catch {
      setError("Could not load saved voices on this browser.");
    }
  }, []);

  useEffect(() => {
    void reload(false);
    return () => {
      stopTracks();
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [reload]);

  const stopPcmCapture = () => {
    const pcm = pcmRef.current;
    pcmRef.current = null;
    void pcm?.stop();
  };

  const stopTracks = () => {
    stopPcmCapture();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const saveCategoryId =
    activeCategoryId === ALL_CATEGORY_ID ? DEFAULT_CATEGORY_ID : activeCategoryId;
  saveCategoryRef.current = saveCategoryId;

  const filteredClips = useMemo(() => {
    const list =
      activeCategoryId === ALL_CATEGORY_ID
        ? [...clips]
        : clips.filter((c) => (c.categoryId || DEFAULT_CATEGORY_ID) === activeCategoryId);
    // Newest recordings first
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }, [clips, activeCategoryId]);

  const categoryLabel = (id?: string) =>
    categories.find((c) => c.id === (id || DEFAULT_CATEGORY_ID))?.name || "My";

  const categoryOptions = categories.map((c) => ({
    value: c.id,
    label: `${c.name} (${clips.filter((x) => (x.categoryId || DEFAULT_CATEGORY_ID) === c.id).length})`,
  }));

  const openNameDialog = (blob: Blob, mimeType: string, suggested: string) => {
    setPendingClip({ blob, mimeType });
    setPendingName(suggested.trim() || nameRef.current.trim() || "");
    setError("");
  };

  const discardPending = () => {
    audioSynth.playClick();
    setPendingClip(null);
    setPendingName("");
    setSavingPending(false);
  };

  const confirmPendingSave = async () => {
    if (!pendingClip) return;
    const clipName = pendingName.trim();
    if (!clipName) {
      setError("Enter a name for this recording.");
      return;
    }
    audioSynth.playClick();
    setSavingPending(true);
    setError("");
    try {
      await audioSynth.prime();
      const saved = await saveVoiceBlob({
        blob: pendingClip.blob,
        name: clipName,
        categoryId: saveCategoryRef.current,
        mimeType: pendingClip.mimeType,
        audioContext: audioSynth.ctx,
      });
      setPendingClip(null);
      setPendingName("");
      setName("");
      setSeconds(0);
      await reload(true);
      onSelect?.(saved.id);
      // Warm decode cache under the same user gesture so alarm ring can play later
      await audioSynth.warmVoiceClip(saved.id);
    } catch {
      setError("Could not save that recording.");
    } finally {
      setSavingPending(false);
    }
  };

  const startRecording = async () => {
    setError("");
    audioSynth.playClick();
    if (!name.trim()) {
      setError("Enter a name for this recording first.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Microphone recording is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: VOICE_MIC_CONSTRAINTS,
      });
      streamRef.current = stream;

      // Prefer high-quality PCM (48 kHz + speech EQ). MediaRecorder only as fallback.
      let pcm: PcmCaptureSession | null = null;
      try {
        pcm = await startPcmCapture(stream);
        pcmRef.current = pcm;
      } catch {
        pcmRef.current = null;
        pcm = null;
      }

      const finishRecording = async () => {
        if (!recordingActiveRef.current) return;
        recordingActiveRef.current = false;
        stopCaptureRef.current = null;

        const session = pcmRef.current;
        pcmRef.current = null;
        // Flush worklet tail before building WAV
        if (session) await session.stop();

        const wavFromPcm =
          session && session.chunks.length ? pcmSessionToWav(session) : null;
        const recorderMime = mediaRef.current?.mimeType;
        const recorderChunks = chunksRef.current.slice();

        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        mediaRef.current = null;
        if (tickRef.current) {
          clearInterval(tickRef.current);
          tickRef.current = null;
        }
        setRecording(false);

        if (wavFromPcm && wavFromPcm.size > 44) {
          openNameDialog(wavFromPcm, "audio/wav", nameRef.current);
          setSeconds(0);
          return;
        }
        const type = recorderMime || pickRecorderMimeType() || "audio/webm";
        const blob = new Blob(recorderChunks, { type });
        if (!blob.size) {
          setError("Recording was empty. Try again.");
          return;
        }
        openNameDialog(blob, type, nameRef.current);
        setSeconds(0);
      };

      stopCaptureRef.current = finishRecording;
      recordingActiveRef.current = true;

      if (!pcm) {
        const mimeType = pickRecorderMimeType();
        const recorder = new MediaRecorder(stream, pickHighQualityRecorderOptions(mimeType));
        mediaRef.current = recorder;
        chunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = () => finishRecording();
        recorder.start(250);
      } else {
        mediaRef.current = null;
      }

      setRecording(true);
      setSeconds(0);
      tickRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s >= 59) {
            void stopCaptureRef.current?.();
            if (mediaRef.current?.state === "recording") mediaRef.current.stop();
            return s;
          }
          return s + 1;
        });
      }, 1000);
    } catch {
      stopTracks();
      recordingActiveRef.current = false;
      setError("Microphone permission denied. Allow mic access and try again.");
    }
  };

  const stopRecording = () => {
    audioSynth.playClick();
    if (mediaRef.current?.state === "recording") {
      mediaRef.current.stop();
      return;
    }
    void stopCaptureRef.current?.();
  };

  const handleUpload = (file: File | null) => {
    if (!file) return;
    setError("");
    audioSynth.playClick();
    if (!file.type.startsWith("audio/") && !/\.(mp3|wav|m4a|ogg|webm|aac)$/i.test(file.name)) {
      setError("Please upload an audio file.");
      return;
    }
    const suggested =
      name.trim() || file.name.replace(/\.[^.]+$/, "") || "Uploaded voice";
    openNameDialog(file, file.type || "audio/*", suggested);
  };

  const playClip = async (id: string) => {
    audioSynth.playClick();
    setBusyId(id);
    setError("");
    try {
      const ok = await audioSynth.playRecordingOnce(id);
      if (!ok) {
        setError("Could not play that clip. Try recording it again.");
      }
    } catch {
      setError("Playback failed. Check device volume and try again.");
    } finally {
      setBusyId(null);
    }
  };

  const removeClip = async (id: string) => {
    audioSynth.playClick();
    await deleteVoiceClip(id);
    audioSynth.evictVoiceClip(id);
    try {
      window.dispatchEvent(new CustomEvent("sva-voice-clip-deleted", { detail: { id } }));
    } catch {
      /* ignore */
    }
    if (selectedId === id) onSelect?.("");
    await reload(true);
  };

  const startRenameClip = (id: string, current: string) => {
    audioSynth.playClick();
    setError("");
    setEditingId(id);
    setEditName(current);
  };

  const cancelRenameClip = () => {
    audioSynth.playClick();
    setEditingId(null);
    setEditName("");
    setSavingEdit(false);
  };

  const confirmRenameClip = async () => {
    if (!editingId) return;
    const next = editName.trim();
    if (!next) {
      setError("Enter a name for this recording.");
      return;
    }
    audioSynth.playClick();
    setSavingEdit(true);
    try {
      await renameVoiceClip(editingId, next);
      setEditingId(null);
      setEditName("");
      await reload(true);
    } catch {
      setError("Could not rename that recording.");
    } finally {
      setSavingEdit(false);
    }
  };

  const moveClip = async (id: string, categoryId: string) => {
    audioSynth.playClick();
    await moveVoiceClip(id, categoryId);
    await reload(true);
  };

  const createCategory = () => {
    audioSynth.playClick();
    const created = addVoiceCategory(newCategoryName);
    if (!created) {
      setError("Enter a unique category name.");
      return;
    }
    setNewCategoryName("");
    setAddingCategory(false);
    setCategories(listVoiceCategories());
    setActiveCategoryId(created.id);
    setError("");
  };

  const renameCategory = () => {
    if (activeCategoryId === DEFAULT_CATEGORY_ID || activeCategoryId === ALL_CATEGORY_ID) return;
    const current = categories.find((c) => c.id === activeCategoryId)?.name || "";
    const next = window.prompt("Rename category", current);
    if (!next || !next.trim()) return;
    if (!renameVoiceCategory(activeCategoryId, next.trim())) {
      setError("Could not rename category (name may already exist).");
      return;
    }
    setCategories(listVoiceCategories());
  };

  const removeCategory = async () => {
    if (activeCategoryId === DEFAULT_CATEGORY_ID || activeCategoryId === ALL_CATEGORY_ID) return;
    const ok = window.confirm("Delete this category? Voices move to My.");
    if (!ok) return;
    audioSynth.playClick();
    await deleteVoiceCategory(activeCategoryId);
    setActiveCategoryId(ALL_CATEGORY_ID);
    await reload(true);
  };

  return (
    <>
    <div className={`flex w-full flex-col ${compact ? "gap-3" : "max-w-3xl animate-fade-in gap-5 sm:gap-6"}`}>
      {variant === "page" && (
        <header className="stack-tight">
          <p className="type-eyebrow">Recordings</p>
          <h2 className="type-page-title">My Voices</h2>
          <p className="type-caption">
            Record or upload messages, organize them by category, and use them on alarms.
          </p>
        </header>
      )}

      {/* Categories */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="type-eyebrow !mb-0">Categories</p>
          <button
            type="button"
            onClick={() => {
              audioSynth.playClick();
              setAddingCategory((v) => !v);
            }}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--brand)]"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>
        <div className="chip-scroll pb-0.5">
          {(
            [
              { id: ALL_CATEGORY_ID, name: "All", count: clips.length },
              ...categories.map((cat) => ({
                id: cat.id,
                name: cat.name,
                count: clips.filter((c) => (c.categoryId || DEFAULT_CATEGORY_ID) === cat.id)
                  .length,
              })),
            ] as const
          ).map((cat) => {
            const active = activeCategoryId === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  audioSynth.playClick();
                  setActiveCategoryId(cat.id);
                }}
                className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                  active
                    ? "bg-[var(--brand)] text-[var(--brand-ink)] shadow-[0_4px_12px_var(--glow)]"
                    : "border border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {cat.name}
                <span className="ml-1 opacity-70">{cat.count}</span>
              </button>
            );
          })}
        </div>
        {addingCategory && (
          <div className="flex gap-2">
            <input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="e.g. Mom, Dad, Work"
              className="form-field !py-2 !text-xs"
            />
            <button type="button" onClick={createCategory} className="btn-premium !px-3 !py-2 !text-xs">
              Save
            </button>
          </div>
        )}
        {activeCategoryId !== DEFAULT_CATEGORY_ID &&
          activeCategoryId !== ALL_CATEGORY_ID && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={renameCategory}
                className="text-[11px] font-medium text-[var(--muted)] hover:text-[var(--brand)]"
              >
                Rename category
              </button>
              <button
                type="button"
                onClick={() => void removeCategory()}
                className="text-[11px] font-medium text-[var(--danger)]"
              >
                Delete category
              </button>
            </div>
          )}
      </div>

      {/* Record / upload */}
      <div className={`rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] ${compact ? "p-3" : "p-4 sm:p-5"}`}>
        <label className="type-field-label">Recording name (only for new record/upload)</label>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          disabled={recording}
          className="form-field mb-3 !py-2 !text-xs"
          placeholder="Optional unless you record or upload"
          // Must NOT be required — this panel sits inside the alarm <form>,
          // and selecting an existing clip should not demand a new name.
        />
        <div className="flex flex-wrap items-center gap-2">
          {!recording ? (
            <button
              type="button"
              onClick={startRecording}
              className="btn-premium !rounded-full !px-3.5 !py-2 !text-xs"
            >
              <Mic className="h-3.5 w-3.5" />
              Record
            </button>
          ) : (
            <button
              type="button"
              onClick={stopRecording}
              className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white"
            >
              <Square className="h-3.5 w-3.5" />
              Stop ({formatDuration(seconds * 1000)})
            </button>
          )}
          <button
            type="button"
            disabled={recording}
            onClick={() => {
              audioSynth.playClick();
              fileInputRef.current?.click();
            }}
            className="btn-ghost !rounded-full !px-3.5 !py-2 !text-xs disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            Upload
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.aac"
            className="hidden"
            onChange={(e) => {
              void handleUpload(e.target.files?.[0] || null);
              e.target.value = "";
            }}
          />
          {recording && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600">
              <MicOff className="h-3.5 w-3.5 animate-pulse" />
              Max 60s · saves to {categoryLabel(saveCategoryId)}
            </span>
          )}
          {!recording && activeCategoryId === ALL_CATEGORY_ID && (
            <span className="text-[11px] text-[var(--muted)]">New clips save to My</span>
          )}
        </div>
        {error && <p className="mt-2 text-[12px] font-medium text-[var(--danger)]">{error}</p>}
      </div>

      {/* Clips */}
      <div className="space-y-2">
        <p className="type-eyebrow !mb-0">
          {activeCategoryId === ALL_CATEGORY_ID
            ? "All voices"
            : `${categoryLabel(activeCategoryId)} voices`}{" "}
          ({filteredClips.length})
          {filteredClips.length > 0 ? " · recent first" : ""}
        </p>
        {filteredClips.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-6 text-center">
            <p className="type-caption">
              No clips here yet. Record live or upload an audio file into this category.
            </p>
          </div>
        ) : (
          filteredClips.map((c) => {
            const selected = selectedId === c.id;
            return (
              <div
                key={c.id}
                className={`rounded-2xl border p-3 transition ${
                  selected
                    ? "border-[var(--brand)] bg-[var(--brand-soft)]"
                    : "border-[var(--border)] bg-[var(--surface)]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!onSelect) return;
                      audioSynth.playClick();
                      onSelect(c.id);
                      void audioSynth.prime().then(() => audioSynth.warmVoiceClip(c.id));
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-1.5">
                      {selected && <Check className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />}
                      <p className="type-card-title truncate">{c.name}</p>
                    </div>
                    <p className="type-caption truncate">
                      {formatDuration(c.durationMs)}
                      {activeCategoryId === ALL_CATEGORY_ID
                        ? ` · ${categoryLabel(c.categoryId)}`
                        : ""}{" "}
                      · {new Date(c.createdAt).toLocaleString()}
                    </p>
                  </button>
                  <div
                    className="flex shrink-0 items-center gap-0.5"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void playClip(c.id);
                      }}
                      disabled={busyId === c.id}
                      className="rounded-xl bg-[var(--brand)] p-2 text-[var(--brand-ink)] disabled:opacity-60"
                      title="Play"
                    >
                      <Play className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        startRenameClip(c.id, c.name);
                      }}
                      className="rounded-xl border border-[var(--border)] p-2 text-[var(--muted)]"
                      title="Rename"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeClip(c.id);
                      }}
                      className="rounded-xl border border-[var(--border)] p-2 text-[var(--danger)]"
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {categories.length > 1 && (
                  <div className="mt-2">
                    <CompactSelect
                      value={c.categoryId || DEFAULT_CATEGORY_ID}
                      options={categoryOptions}
                      onChange={(v) => void moveClip(c.id, String(v))}
                      ariaLabel="Move to category"
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>

    {pendingClip && (
      <div className="fixed inset-0 z-[80] flex animate-fade-in items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-lift)]">
          <div className="mb-4 stack-tight">
            <p className="type-eyebrow !mb-0">Save recording</p>
            <h4 className="type-modal-title text-[1.35rem]">Name this voice</h4>
            <p className="type-caption">
              Give it a clear name so you can find it later in My Voices.
            </p>
          </div>
          <label className="type-field-label">Name</label>
          <input
            autoFocus
            value={pendingName}
            onChange={(e) => {
              setPendingName(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void confirmPendingSave();
              }
            }}
            placeholder="e.g. Wake up, Mom call"
            className="form-field !py-2.5 !text-sm"
          />
          {error && (
            <p className="mt-2 text-[12px] font-medium text-[var(--danger)]">{error}</p>
          )}
          <div className="mt-5 flex items-center gap-3">
            <button type="button" onClick={discardPending} className="btn-ghost flex-1 py-2.5">
              Discard
            </button>
            <button
              type="button"
              disabled={savingPending || !pendingName.trim()}
              onClick={() => void confirmPendingSave()}
              className="btn-premium flex-1 py-2.5 disabled:opacity-45"
            >
              <Check className="h-3.5 w-3.5" />
              <span>{savingPending ? "Saving…" : "Save"}</span>
            </button>
          </div>
        </div>
      </div>
    )}

    {editingId && (
      <div className="fixed inset-0 z-[80] flex animate-fade-in items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
        <div
          className="w-full max-w-sm rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-lift)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 stack-tight">
            <p className="type-eyebrow !mb-0">Edit recording</p>
            <h4 className="type-modal-title text-[1.35rem]">Rename voice</h4>
            <p className="type-caption">Update the name for this saved recording.</p>
          </div>
          <label className="type-field-label">Name</label>
          <input
            autoFocus
            value={editName}
            onChange={(e) => {
              setEditName(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void confirmRenameClip();
              }
            }}
            placeholder="e.g. Wake up, Mom call"
            className="form-field !py-2.5 !text-sm"
          />
          {error && (
            <p className="mt-2 text-[12px] font-medium text-[var(--danger)]">{error}</p>
          )}
          <div className="mt-5 flex items-center gap-3">
            <button type="button" onClick={cancelRenameClip} className="btn-ghost flex-1 py-2.5">
              Cancel
            </button>
            <button
              type="button"
              disabled={savingEdit || !editName.trim()}
              onClick={() => void confirmRenameClip()}
              className="btn-premium flex-1 py-2.5 disabled:opacity-45"
            >
              <Check className="h-3.5 w-3.5" />
              <span>{savingEdit ? "Saving…" : "Save"}</span>
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
