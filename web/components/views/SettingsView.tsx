"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Camera,
  ChevronDown,
  Lightbulb,
  LogIn,
  LogOut,
  MessageSquareHeart,
  Pencil,
  Send,
  Upload,
  UserRound,
  Volume2,
  X,
} from "lucide-react";
import { AuthRequiredDialog } from "@/components/auth/AuthRequiredDialog";
import { MyVoicesPanel } from "@/components/voices/MyVoicesPanel";
import { CompactSelect } from "@/components/ui/CompactSelect";
import { audioSynth } from "@/lib/audio-synth";
import { BUILT_IN_ALARM_SOUNDS } from "@/lib/alarm-sounds";
import {
  listRingtones,
  saveRingtoneFile,
  type RingtoneMeta,
} from "@/lib/ringtones";
import {
  compressImageFile,
  genderLabel as userGenderLabel,
  getCurrentUser,
  isGuestUser,
  updateUserProfile,
  type PublicUser,
} from "@/lib/auth";
import {
  genderLabel,
  groupVoicesByGender,
  listSystemVoices,
  type ListedVoice,
  waitForVoices,
} from "@/lib/voices";
import { Toggle } from "@/components/ui/Toggle";
import { THEME_PALETTES, type ThemeMode, type ThemePalette } from "@/lib/types";
import {
  ensureNotificationPermission,
  getBackgroundAlarmsEnabled,
  getKeepaliveEnabled,
  notificationPermission,
  registerAlarmServiceWorker,
  setBackgroundAlarmsEnabled,
  setKeepaliveEnabled,
  stopBackgroundKeepalive,
} from "@/lib/background-alarms";

/** Change this when you have a real inbox for feedback / requests. */
const SUPPORT_EMAIL = "support@smartvoice.app";
const DEFAULT_TAGLINE = "hello ALL";

function displayTagline(tagline?: string) {
  const t = tagline?.trim();
  return t || DEFAULT_TAGLINE;
}

const FAQS: { q: string; a: string }[] = [
  {
    q: "Why do some devices show both male and female voices?",
    a: "Voices come from your phone or computer (Windows, Chrome, Android, etc.). Some devices install both genders; others only one or unlabeled voices. The list always reflects what is available here.",
  },
  {
    q: "How do I use my own voice on an alarm?",
    a: "Open Settings → My Voices (or choose My voice while creating an alarm). Record live or upload audio, optionally put it in a category like My or Mom, then select that clip for the alarm.",
  },
  {
    q: "How do I change the alarm ringtone?",
    a: "Open Settings → Ringtone. Pick one sound from the dropdown (waterfall, birds, custom file, etc.). That single ringtone is used for every alarm, timer, and reminder.",
  },
  {
    q: "How do I edit or delete an alarm?",
    a: "Tap an alarm to edit it. Long-press to select one or more alarms, then tap Delete in the header.",
  },
  {
    q: "Why didn’t my alarm ring?",
    a: "Turn on Background alarms in Settings and allow notifications. On phones, install the app to your Home Screen (Add to Home Screen / Install app), leave notifications allowed, and keep volume up. Browsers can still miss alarms if the OS force-stops the app — Android is more reliable than iOS for web alarms.",
  },
  {
    q: "Can alarms ring when the screen is off?",
    a: "Yes, best-effort via notifications and a quiet keepalive. Install the PWA, allow Notifications + Microphone + sound in the permissions sheet, enable Background alarms, and tap the notification if the full custom voice does not start automatically.",
  },
  {
    q: "Which permissions does the app need?",
    a: "Notifications (background alarms), Microphone (My Voices), and sound/music unlock (ringtones). Optional: persistent storage so alarms survive browser cleanup. Open Settings → Phone permissions → Review anytime.",
  },
  {
    q: "Is my data private?",
    a: "Alarms, notes, and recorded voices stay on this device (local storage / IndexedDB). Nothing is uploaded unless you send feedback or a feature request by email.",
  },
  {
    q: "Can I use the app offline?",
    a: "Yes for timers, stopwatch, saved alarms, and recorded clips. System speech voices need the browser’s speech engine; some work offline if the OS voice pack is installed.",
  },
];

type SectionId = "myvoices" | "voices" | "faqs" | "feedback" | "request";

function openMail(subject: string, body: string) {
  const href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = href;
}

function AccordionSection({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: SectionId;
  title: string;
  open: boolean;
  onToggle: (id: SectionId) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-card overflow-hidden rounded-2xl">
      <button
        type="button"
        onClick={() => {
          audioSynth.playClick();
          onToggle(id);
        }}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left sm:px-5"
        aria-expanded={open}
      >
        <span className="type-card-title">{title}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-[var(--muted)] transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && <div className="border-t border-[var(--border)] px-4 py-4 sm:px-5">{children}</div>}
    </div>
  );
}

export function SettingsView({
  is24Hour,
  setIs24Hour,
  theme,
  setTheme,
  palette,
  setPalette,
  soundType,
  setSoundType,
  customRingtoneId,
  setCustomRingtoneId,
  onUserUpdated,
  onBackgroundPrefsChanged,
  onOpenPermissions,
  onGoToAuth,
  onLogout,
}: {
  is24Hour: boolean;
  setIs24Hour: React.Dispatch<React.SetStateAction<boolean>>;
  theme: ThemeMode;
  setTheme: React.Dispatch<React.SetStateAction<ThemeMode>>;
  palette: ThemePalette;
  setPalette: React.Dispatch<React.SetStateAction<ThemePalette>>;
  soundType: string;
  setSoundType: React.Dispatch<React.SetStateAction<string>>;
  customRingtoneId: string;
  setCustomRingtoneId: React.Dispatch<React.SetStateAction<string>>;
  onUserUpdated?: (user: PublicUser) => void;
  onBackgroundPrefsChanged?: () => void;
  onOpenPermissions?: () => void;
  /** Leave guest session and open login / register */
  onGoToAuth?: (mode: "login" | "register") => void;
  onLogout?: () => void;
}) {
  const [voices, setVoices] = useState<ListedVoice[]>([]);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [openSection, setOpenSection] = useState<SectionId | null>(null);
  const [ringtones, setRingtones] = useState<RingtoneMeta[]>([]);
  const [ringtoneError, setRingtoneError] = useState("");
  const ringtoneInputRef = useRef<HTMLInputElement>(null);

  const [user, setUser] = useState<PublicUser | null>(null);
  const [photoZoomOpen, setPhotoZoomOpen] = useState(false);
  const [profileDetailsOpen, setProfileDetailsOpen] = useState(false);
  const [profileEditing, setProfileEditing] = useState(false);
  const [authPromptOpen, setAuthPromptOpen] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftTagline, setDraftTagline] = useState("");
  const [draftBio, setDraftBio] = useState("");
  const photoInputRef = useRef<HTMLInputElement>(null);

  const [feedback, setFeedback] = useState("");
  const [request, setRequest] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [bgAlarms, setBgAlarms] = useState(true);
  const [bgKeepalive, setBgKeepalive] = useState(true);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | "unsupported">("default");
  const [portalReady, setPortalReady] = useState(false);

  const guest = isGuestUser(user);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  const promptAuth = () => {
    audioSynth.playClick();
    setAuthPromptOpen(true);
  };

  const startProfileEdit = () => {
    if (!user) return;
    if (guest) {
      promptAuth();
      return;
    }
    audioSynth.playClick();
    setDraftName(user.name);
    setDraftTagline(user.tagline ?? "");
    setDraftBio(user.bio ?? "");
    setProfileEditing(true);
    setProfileDetailsOpen(false);
  };

  const discardProfileEdit = () => {
    audioSynth.playClick();
    setProfileEditing(false);
    setProfileDetailsOpen(false);
    setDraftName("");
    setDraftTagline("");
    setDraftBio("");
  };

  const saveProfileEdit = () => {
    if (!user) return;
    const name = draftName.trim() || user.name;
    const tagline = draftTagline.trim();
    const bio = draftBio.trim();
    const updated = updateUserProfile(user.phone, { name, tagline, bio });
    if (updated) {
      setUser(updated);
      onUserUpdated?.(updated);
    }
    audioSynth.playClick();
    setProfileEditing(false);
    setProfileDetailsOpen(false);
  };

  const pickPhoto = () => {
    if (guest) {
      promptAuth();
      return;
    }
    audioSynth.playClick();
    photoInputRef.current?.click();
  };

  const onPhotoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user || guest) return;
    try {
      const photo = await compressImageFile(file);
      const updated = updateUserProfile(user.phone, { photo });
      if (updated) {
        setUser(updated);
        onUserUpdated?.(updated);
      }
      audioSynth.playClick();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not update photo.");
    }
  };

  useEffect(() => {
    setUser(getCurrentUser());
    setBgAlarms(getBackgroundAlarmsEnabled());
    setBgKeepalive(getKeepaliveEnabled());
    setNotifPerm(notificationPermission());
    void waitForVoices().then(() => setVoices(listSystemVoices()));
    void listRingtones().then(setRingtones).catch(() => setRingtones([]));
    void registerAlarmServiceWorker();
  }, []);

  const toggleBackgroundAlarms = async () => {
    audioSynth.playClick();
    const next = !bgAlarms;
    if (next) {
      const { isNativeApp } = await import("@/lib/native");
      const native = isNativeApp();
      if (native) {
        const { requestNativeAlarmPermissions } = await import("@/lib/native-alarms");
        const ok = await requestNativeAlarmPermissions();
        if (!ok) {
          setNotice("Allow notifications so alarms can ring when the app is closed.");
          return;
        }
        setNotifPerm("granted");
      } else {
        const perm = await ensureNotificationPermission();
        setNotifPerm(perm);
        if (perm !== "granted" && perm !== "unsupported") {
          setNotice("Allow notifications so alarms can wake the phone when the screen is off.");
          return;
        }
      }
      setBackgroundAlarmsEnabled(true);
      setBgAlarms(true);
      if (!native) await registerAlarmServiceWorker();
      void audioSynth.prime();
      if (bgKeepalive) {
        audioSynth.startKeepaliveBed();
        stopBackgroundKeepalive();
      }
      setNotice(
        native
          ? "Background alarms on. Alarms can ring after you leave the app."
          : "Background alarms on. Install this app to your Home Screen for best results.",
      );
    } else {
      setBackgroundAlarmsEnabled(false);
      setBgAlarms(false);
      audioSynth.stopKeepaliveBed();
      stopBackgroundKeepalive();
      setNotice("Background alarms off. Alarms only ring while this tab is open.");
    }
    onBackgroundPrefsChanged?.();
  };

  const toggleKeepalive = () => {
    audioSynth.playClick();
    const next = !bgKeepalive;
    setKeepaliveEnabled(next);
    setBgKeepalive(next);
    if (next && bgAlarms) {
      void audioSynth.prime();
      audioSynth.startKeepaliveBed();
      stopBackgroundKeepalive();
    } else {
      audioSynth.stopKeepaliveBed();
      stopBackgroundKeepalive();
    }
    onBackgroundPrefsChanged?.();
  };

  const ringtoneSelectValue =
    soundType === "custom" && customRingtoneId
      ? `custom:${customRingtoneId}`
      : soundType === "custom"
        ? "custom"
        : soundType;

  const ringtoneOptions = [
    ...BUILT_IN_ALARM_SOUNDS.filter((s) => s.id !== "custom").map((s) => ({
      value: s.id,
      label: `${s.title} — ${s.caption}`,
    })),
    { value: "custom", label: "Custom ringtone — your file" },
    ...ringtones.map((r) => ({
      value: `custom:${r.id}`,
      label: `Custom — ${r.name}`,
    })),
  ];

  const onRingtoneChange = (raw: string | number) => {
    const value = String(raw);
    setRingtoneError("");
    if (value.startsWith("custom:")) {
      setSoundType("custom");
      setCustomRingtoneId(value.slice("custom:".length));
      return;
    }
    if (value === "custom") {
      setSoundType("custom");
      if (!customRingtoneId && ringtones[0]) setCustomRingtoneId(ringtones[0].id);
      return;
    }
    setSoundType(value);
    setCustomRingtoneId("");
  };

  const previewRingtone = () => {
    audioSynth.playClick();
    if (soundType === "custom" && !customRingtoneId) {
      setRingtoneError("Upload a ringtone file first.");
      return;
    }
    void audioSynth.previewSound(
      soundType,
      soundType === "custom" ? customRingtoneId || undefined : undefined,
    );
  };

  const handleUploadRingtone = async (file: File | null) => {
    if (!file) return;
    setRingtoneError("");
    audioSynth.playClick();
    if (!file.type.startsWith("audio/") && !/\.(mp3|wav|m4a|ogg|webm|aac)$/i.test(file.name)) {
      setRingtoneError("Please upload an audio file.");
      return;
    }
    try {
      const saved = await saveRingtoneFile(file);
      setRingtones(await listRingtones());
      setSoundType("custom");
      setCustomRingtoneId(saved.id);
      const { syncNativeRingtone } = await import("@/lib/native-ringtone");
      await syncNativeRingtone("custom", saved.id);
    } catch {
      setRingtoneError("Could not save that ringtone.");
    }
  };

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(t);
  }, [notice]);

  const toggleSection = (id: SectionId) => {
    setOpenSection((prev) => (prev === id ? null : id));
  };

  const preview = async (v: ListedVoice) => {
    audioSynth.playClick();
    // Stop ringtone preview bed so TTS is not layered over it
    audioSynth.stopAlarmLoop();
    setPreviewing(v.voiceURI);
    await audioSynth.speakSentence(
      `Hello, I am ${v.name}. This is a system voice on this device.`,
      v.persona,
      null,
      v.voiceURI,
    );
    setPreviewing(null);
  };

  const submitFeedback = () => {
    const text = feedback.trim();
    if (!text) {
      setNotice("Please write a short message first.");
      return;
    }
    audioSynth.playClick();
    openMail("Smart Voice — Feedback", text);
    setFeedback("");
    setNotice("Opening your email app to send feedback…");
  };

  const submitRequest = () => {
    const text = request.trim();
    if (!text) {
      setNotice("Please describe the feature you’d like.");
      return;
    }
    audioSynth.playClick();
    openMail("Smart Voice — Feature request", text);
    setRequest("");
    setNotice("Opening your email app to send your request…");
  };

  const groups = groupVoicesByGender(voices);
  const voiceSections = [
    { title: "Female", items: groups.female },
    { title: "Male", items: groups.male },
    { title: groups.female.length || groups.male.length ? "Other" : "All voices", items: groups.other },
  ].filter((s) => s.items.length > 0);

  return (
    <div className="flex w-full max-w-2xl animate-fade-in flex-col gap-3 py-2 pb-8 sm:gap-3.5 sm:py-4 sm:pb-16">
      <header className="stack-tight mb-2">
        <p className="type-eyebrow">Preferences</p>
        <h2 className="type-page-title">Settings</h2>
        <p className="type-caption">Tap a section below to expand</p>
      </header>

      {notice && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--brand-soft)] px-4 py-3">
          <p className="type-caption !mt-0 text-[var(--foreground)]">{notice}</p>
        </div>
      )}

      <div className="relative overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--brand)_28%,var(--border))] px-3 py-3 shadow-[0_8px_28px_var(--glow)] sm:px-4">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background: `
              radial-gradient(ellipse 90% 70% at 50% -20%, color-mix(in srgb, var(--brand) 38%, transparent), transparent 58%),
              radial-gradient(circle at 100% 100%, color-mix(in srgb, var(--brand) 22%, transparent), transparent 42%),
              radial-gradient(circle at 0% 80%, color-mix(in srgb, var(--brand) 14%, transparent), transparent 40%),
              linear-gradient(160deg, color-mix(in srgb, var(--brand) 16%, var(--surface)) 0%, var(--surface) 48%, color-mix(in srgb, var(--brand) 10%, var(--surface-2)) 100%)
            `,
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: `repeating-linear-gradient(
              -28deg,
              transparent,
              transparent 10px,
              color-mix(in srgb, var(--brand) 55%, transparent) 10px,
              color-mix(in srgb, var(--brand) 55%, transparent) 11px
            )`,
          }}
        />
        <div className="relative">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <h4 className="type-card-title text-[0.9rem]">Profile</h4>
            {user && !profileEditing ? (
              <button
                type="button"
                onClick={startProfileEdit}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--brand)_30%,var(--border))] bg-[color-mix(in_srgb,var(--surface)_55%,transparent)] text-[var(--brand)] transition hover:bg-[var(--brand-soft)]"
                aria-label={guest ? "Log in to edit profile" : "Edit profile"}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          {user ? (
            <div className="relative flex flex-col items-center text-center pb-1">
              <div className="relative h-16 w-16">
                <button
                  type="button"
                  onClick={() => {
                    audioSynth.playClick();
                    setPhotoZoomOpen(true);
                  }}
                  className="h-16 w-16 overflow-hidden rounded-full bg-[var(--brand)] text-[var(--brand-ink)] shadow-[0_6px_18px_var(--glow)] ring-2 ring-[color-mix(in_srgb,var(--brand)_40%,var(--surface))] transition hover:opacity-95"
                  aria-label="View profile photo"
                >
                  {user.photo && !guest ? (
                    <img src={user.photo} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center">
                      <UserRound className={`h-7 w-7 ${guest ? "opacity-70" : ""}`} />
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={pickPhoto}
                  className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--brand)_30%,transparent)] bg-[color-mix(in_srgb,var(--surface)_55%,transparent)] text-[var(--brand)] shadow-sm backdrop-blur-[2px] transition hover:bg-[color-mix(in_srgb,var(--surface)_75%,transparent)]"
                  aria-label={guest ? "Log in to change photo" : "Change profile photo"}
                >
                  <Camera className="h-2.5 w-2.5" />
                </button>
              </div>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onPhotoSelected}
              />

              {profileEditing ? (
                <div className="mt-3 w-full max-w-sm space-y-2.5 text-left">
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                      Name
                    </span>
                    <input
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      className="form-field w-full text-center sm:text-left"
                      aria-label="Profile name"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                      Tagline
                    </span>
                    <input
                      value={draftTagline}
                      onChange={(e) => setDraftTagline(e.target.value)}
                      placeholder={DEFAULT_TAGLINE}
                      maxLength={80}
                      className="form-field w-full text-center text-[var(--foreground)] placeholder:text-[color-mix(in_srgb,var(--foreground)_45%,transparent)] sm:text-left"
                      aria-label="Tagline"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                      Bio
                    </span>
                    <textarea
                      value={draftBio}
                      onChange={(e) => setDraftBio(e.target.value)}
                      placeholder="Add a short bio…"
                      rows={3}
                      maxLength={280}
                      className="form-field w-full resize-none text-left text-[12px] leading-relaxed placeholder:text-[color-mix(in_srgb,var(--foreground)_45%,transparent)]"
                      aria-label="Bio"
                    />
                  </label>
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={discardProfileEdit}
                      className="flex-1 rounded-xl border border-[var(--border)] py-2.5 text-xs font-bold text-[var(--muted)] transition hover:bg-[var(--surface-2)]"
                    >
                      Discard
                    </button>
                    <button type="button" onClick={saveProfileEdit} className="btn-premium flex-1 !py-2.5">
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="type-card-title mt-2.5 text-[1rem]">
                    {guest ? "Guest" : user.name}
                  </p>
                  <p className="mt-1 max-w-[15rem] text-center text-[13px] font-medium leading-snug tracking-tight text-[var(--brand)]">
                    {guest ? "Log in to set your profile" : displayTagline(user.tagline)}
                  </p>
                  {guest ? (
                    <p className="mt-2 max-w-xs text-center text-[11px] leading-relaxed text-[var(--muted)]">
                      Name, photo, tagline, age, and gender unlock after login or register.
                    </p>
                  ) : null}
                  {!guest && profileDetailsOpen && (
                    <div className="mt-2.5 w-full max-w-sm space-y-1.5">
                      <p className="type-caption text-center text-[11px]">
                        {user.phone} · {user.age} yrs · {userGenderLabel(user.gender)}
                      </p>
                      {user.bio?.trim() ? (
                        <p className="px-1 text-center text-[12px] leading-relaxed text-[var(--muted)]">
                          {user.bio.trim()}
                        </p>
                      ) : null}
                    </div>
                  )}
                  {!guest ? (
                    <button
                      type="button"
                      onClick={() => {
                        audioSynth.playClick();
                        setProfileDetailsOpen((v) => !v);
                      }}
                      className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)] transition hover:bg-[var(--brand-soft)] hover:text-[var(--brand)]"
                      aria-expanded={profileDetailsOpen}
                      aria-label={profileDetailsOpen ? "Hide details" : "Show phone, age & gender"}
                    >
                      <ChevronDown
                        className={`h-4 w-4 transition-transform duration-200 ${
                          profileDetailsOpen ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                  ) : null}
                </>
              )}
            </div>
          ) : (
            <p className="type-caption !mt-0 text-center">Not signed in</p>
          )}

          <div className="relative mt-4 border-t border-[var(--border)] pt-3">
            {guest || !user ? (
              <button
                type="button"
                onClick={() => {
                  audioSynth.playClick();
                  onGoToAuth?.("login");
                }}
                className="btn-premium flex w-full items-center justify-center gap-2 !py-2.5"
              >
                <LogIn className="h-3.5 w-3.5" />
                Log in / Register
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  audioSynth.playClick();
                  onLogout?.();
                }}
                className="btn-ghost flex w-full items-center justify-center gap-2 !py-2.5"
              >
                <LogOut className="h-3.5 w-3.5" />
                Log out
              </button>
            )}
          </div>
        </div>
      </div>

      <AuthRequiredDialog
        open={authPromptOpen}
        onClose={() => setAuthPromptOpen(false)}
        onLogin={() => {
          setAuthPromptOpen(false);
          onGoToAuth?.("login");
        }}
        onRegister={() => {
          setAuthPromptOpen(false);
          onGoToAuth?.("register");
        }}
      />

      {portalReady &&
        photoZoomOpen &&
        user &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] flex h-[100dvh] w-screen items-center justify-center bg-black/50 p-4"
            style={{ top: 0, left: 0 }}
            role="dialog"
            aria-modal="true"
            aria-label="Profile photo"
            onClick={() => {
              audioSynth.playClick();
              setPhotoZoomOpen(false);
            }}
          >
            <div
              className="relative w-[min(18.5rem,calc(100vw-2rem))] shrink-0 rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-4 pt-5 shadow-[var(--shadow-lift)]"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  audioSynth.playClick();
                  setPhotoZoomOpen(false);
                }}
                className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border)] text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                aria-label="Close"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <div className="flex flex-col items-center gap-3">
                <div className="relative h-28 w-28 overflow-hidden rounded-full bg-[var(--brand)] shadow-[0_6px_20px_var(--glow)] ring-2 ring-[color-mix(in_srgb,var(--brand)_35%,var(--surface))]">
                  {user.photo && !guest ? (
                    <img src={user.photo} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-[var(--brand-ink)]">
                      <UserRound className={`h-12 w-12 ${guest ? "blur-[5px]" : ""}`} />
                    </span>
                  )}
                </div>
                <div className="stack-tight px-1 text-center">
                  <p className="type-card-title text-[1rem]">{guest ? "Guest" : user.name}</p>
                  <p className="type-caption text-[11px]">
                    {guest ? "Log in to set your photo" : displayTagline(user.tagline)}
                  </p>
                </div>
                <button type="button" onClick={pickPhoto} className="btn-premium w-full !py-2.5 !text-xs">
                  <Camera className="h-3.5 w-3.5" />
                  <span>{guest ? "Log in to change photo" : "Change photo"}</span>
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      <div className="glass-card overflow-hidden rounded-2xl">
        <div className="border-b border-[var(--border)] px-4 py-3.5 sm:px-5">
          <div className="stack-tight mb-3">
            <h4 className="type-card-title">Color theme</h4>
            <p className="type-caption">Bronze, olive, or black & white — each has light and dark</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {THEME_PALETTES.map((item) => {
              const active = palette === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    audioSynth.playClick();
                    setPalette(item.id);
                  }}
                  className={`rounded-2xl border p-2.5 text-left transition ${
                    active
                      ? "border-[var(--brand)] bg-[var(--brand-soft)] shadow-[0_4px_14px_var(--glow)]"
                      : "border-[var(--border)] bg-[var(--surface-2)] hover:border-[color-mix(in_srgb,var(--brand)_35%,var(--border))]"
                  }`}
                  aria-pressed={active}
                >
                  <div className="mb-2 flex gap-1">
                    {item.swatch.map((color) => (
                      <span
                        key={color}
                        className="h-4 flex-1 rounded-full border border-[var(--border)]"
                        style={{ background: color }}
                      />
                    ))}
                  </div>
                  <p className="text-[12px] font-semibold tracking-tight text-[var(--foreground)]">
                    {item.title}
                  </p>
                  <p className="mt-0.5 text-[10px] leading-snug text-[var(--muted)]">{item.caption}</p>
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-4 py-3.5 sm:px-5">
          <div className="stack-tight min-w-0">
            <h4 className="type-card-title">Dark mode</h4>
            <p className="type-caption">Dark version of the selected theme</p>
          </div>
          <Toggle
            checked={theme === "dark"}
            onChange={() => setTheme(theme === "dark" ? "light" : "dark")}
            label="Dark mode"
          />
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
          <div className="stack-tight min-w-0">
            <h4 className="type-card-title">24-hour clock</h4>
            <p className="type-caption">{is24Hour ? "14:30 style" : "2:30 PM style"}</p>
          </div>
          <Toggle checked={is24Hour} onChange={() => setIs24Hour(!is24Hour)} label="24-hour clock" />
        </div>
      </div>

      <div className="glass-card overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3.5 sm:px-5">
          <div className="stack-tight min-w-0">
            <h4 className="type-card-title">Phone permissions</h4>
            <p className="type-caption">
              Notifications, microphone, and sound for mobile alarms
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              audioSynth.playClick();
              onOpenPermissions?.();
            }}
            className="shrink-0 rounded-full bg-[var(--brand)] px-3.5 py-2 text-[11px] font-semibold text-[var(--brand-ink)]"
          >
            Review
          </button>
        </div>
        <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-4 py-3.5 sm:px-5">
          <div className="stack-tight min-w-0">
            <h4 className="type-card-title">Background alarms</h4>
            <p className="type-caption">
              Notifications when the screen is off
              {notifPerm === "granted"
                ? " · notifications allowed"
                : notifPerm === "denied"
                  ? " · notifications blocked in browser settings"
                  : notifPerm === "unsupported"
                    ? " · notifications unsupported here"
                    : " · tap to allow notifications"}
            </p>
          </div>
          <Toggle checked={bgAlarms} onChange={() => void toggleBackgroundAlarms()} label="Background alarms" />
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
          <div className="stack-tight min-w-0">
            <h4 className="type-card-title">Keepalive</h4>
            <p className="type-caption">
              Quiet audio so the browser is less likely to freeze this tab in the background
            </p>
          </div>
          <Toggle
            checked={bgKeepalive}
            onChange={toggleKeepalive}
            label="Keepalive"
            disabled={!bgAlarms}
          />
        </div>
      </div>

      <div className="glass-card overflow-hidden rounded-2xl">
        <div className="px-4 py-3.5 sm:px-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="stack-tight min-w-0">
              <h4 className="type-card-title">Ringtone</h4>
              <p className="type-caption">One sound for every alarm, timer, and reminder</p>
            </div>
            <button
              type="button"
              onClick={previewRingtone}
              disabled={soundType === "custom" && !customRingtoneId}
              className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-[var(--brand)] disabled:opacity-40"
            >
              <Volume2 className="h-3.5 w-3.5" />
              Preview
            </button>
          </div>
          <CompactSelect
            value={ringtoneSelectValue}
            options={ringtoneOptions}
            onChange={onRingtoneChange}
            ariaLabel="App ringtone"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => ringtoneInputRef.current?.click()}
              className="btn-ghost !rounded-full !px-3.5 !py-2 !text-xs"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload custom
            </button>
            <input
              ref={ringtoneInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.aac"
              className="hidden"
              onChange={(e) => {
                void handleUploadRingtone(e.target.files?.[0] || null);
                e.target.value = "";
              }}
            />
            {soundType === "custom" && customRingtoneId ? (
              <p className="type-caption !mt-0">
                Using: {ringtones.find((r) => r.id === customRingtoneId)?.name || "Custom file"}
              </p>
            ) : null}
          </div>
          {ringtoneError && (
            <p className="mt-2 text-[12px] font-medium text-[var(--danger)]">{ringtoneError}</p>
          )}
        </div>
      </div>

      <AccordionSection
        id="myvoices"
        title="My Voices"
        open={openSection === "myvoices"}
        onToggle={toggleSection}
      >
        <p className="type-caption !mt-0 mb-3">
          Record or upload messages, add categories (My, Mom, …), and use them on alarms.
        </p>
        <MyVoicesPanel variant="embedded" />
      </AccordionSection>

      <AccordionSection
        id="voices"
        title="Voices on this device"
        open={openSection === "voices"}
        onToggle={toggleSection}
      >
        <p className="type-caption !mt-0 mb-3">
          System voices installed here. Found {voices.length} voice{voices.length === 1 ? "" : "s"}
          {groups.female.length || groups.male.length
            ? ` (${groups.female.length} female, ${groups.male.length} male${groups.other.length ? `, ${groups.other.length} other` : ""})`
            : ""}
          .
        </p>
        {voices.length === 0 ? (
          <p className="type-body text-[var(--muted)]">Loading voices…</p>
        ) : (
          <div className="max-h-[40vh] space-y-4 overflow-y-auto sm:max-h-64">
            {voiceSections.map((section) => (
              <div key={section.title}>
                <p className="type-eyebrow mb-2">{section.title}</p>
                <div className="space-y-1.5">
                  {section.items.map((v) => (
                    <div
                      key={v.voiceURI}
                      className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5"
                    >
                      <div className="stack-tight min-w-0">
                        <p className="type-card-title truncate">{v.name}</p>
                        <p className="type-caption">
                          {v.lang}
                          {genderLabel(v.gender) ? ` · ${genderLabel(v.gender)}` : ""}
                          {v.localService ? " · offline" : " · browser"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => preview(v)}
                        disabled={previewing === v.voiceURI}
                        className="btn-premium shrink-0 !px-2.5 !py-1.5 !text-[11px] disabled:opacity-60"
                      >
                        <Volume2 className="h-3.5 w-3.5" />
                        {previewing === v.voiceURI ? "…" : "Test"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </AccordionSection>

      <AccordionSection id="faqs" title="FAQs" open={openSection === "faqs"} onToggle={toggleSection}>
        <div className="space-y-1.5">
          {FAQS.map((item, idx) => {
            const open = openFaq === idx;
            return (
              <div
                key={item.q}
                className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)]"
              >
                <button
                  type="button"
                  onClick={() => {
                    audioSynth.playClick();
                    setOpenFaq(open ? null : idx);
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left"
                  aria-expanded={open}
                >
                  <span className="type-card-title pr-2 text-[0.875rem]">{item.q}</span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`}
                  />
                </button>
                {open && (
                  <div className="border-t border-[var(--border)] px-3.5 py-3">
                    <p className="type-caption !mt-0 leading-relaxed">{item.a}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </AccordionSection>

      <AccordionSection
        id="feedback"
        title="Send feedback"
        open={openSection === "feedback"}
        onToggle={toggleSection}
      >
        <div className="mb-3 flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
            <MessageSquareHeart className="h-4 w-4" />
          </div>
          <p className="type-caption !mt-1">Tell us what feels good or what broke</p>
        </div>
        <textarea
          rows={3}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Your feedback…"
          className="form-field mb-3 resize-none"
        />
        <button type="button" onClick={submitFeedback} className="btn-premium w-full sm:w-auto">
          <Send className="h-3.5 w-3.5" />
          <span>Send feedback</span>
        </button>
      </AccordionSection>

      <AccordionSection
        id="request"
        title="Report / feature request"
        open={openSection === "request"}
        onToggle={toggleSection}
      >
        <div className="mb-3 flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)]">
            <Lightbulb className="h-4 w-4" />
          </div>
          <p className="type-caption !mt-1">Suggest something you’d like us to build next</p>
        </div>
        <textarea
          rows={3}
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="Describe the feature…"
          className="form-field mb-3 resize-none"
        />
        <button type="button" onClick={submitRequest} className="btn-premium w-full sm:w-auto">
          <Send className="h-3.5 w-3.5" />
          <span>Send request</span>
        </button>
      </AccordionSection>
    </div>
  );
}
