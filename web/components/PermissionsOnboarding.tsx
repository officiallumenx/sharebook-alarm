"use client";

import { useEffect, useMemo, useState } from "react";
import { AlarmClock, Bell, Check, Mic, Music2, Shield, Smartphone } from "lucide-react";
import { audioSynth } from "@/lib/audio-synth";
import { isNativeApp } from "@/lib/native";
import {
  getPermissionStates,
  isStandaloneDisplay,
  markPermissionsOnboardingDone,
  promptInstallApp,
  requestAllAppPermissions,
  shouldOfferInstall,
  type AppPermissionId,
  type AppPermissionState,
  type PermStatus,
} from "@/lib/permissions";

const WEB_ITEMS: {
  id: AppPermissionId;
  title: string;
  caption: string;
  icon: typeof Bell;
}[] = [
  {
    id: "notifications",
    title: "Notifications",
    caption: "Wake you when the screen is off or the app is in the background",
    icon: Bell,
  },
  {
    id: "microphone",
    title: "Microphone",
    caption: "Record your own voice messages for alarms",
    icon: Mic,
  },
  {
    id: "audio",
    title: "Sound & music",
    caption: "Play ringtones and recorded voices clearly",
    icon: Music2,
  },
  {
    id: "storage",
    title: "Save on this device",
    caption: "Keep alarms and voices if the browser clears temporary data",
    icon: Shield,
  },
];

const NATIVE_ITEMS: {
  id: AppPermissionId;
  title: string;
  caption: string;
  icon: typeof Bell;
}[] = [
  {
    id: "notifications",
    title: "Notifications",
    caption: "Show alarm alerts when the app is closed",
    icon: Bell,
  },
  {
    id: "exactAlarms",
    title: "Exact alarms",
    caption: "Ring at the exact time you set (Alarms & reminders)",
    icon: AlarmClock,
  },
  {
    id: "fullScreen",
    title: "Full-screen alarms",
    caption: "Show Stop / Snooze on the lock screen",
    icon: Smartphone,
  },
  {
    id: "microphone",
    title: "Microphone",
    caption: "Record your own voice messages for alarms",
    icon: Mic,
  },
  {
    id: "audio",
    title: "Sound",
    caption: "Unlock ringtone playback inside the app",
    icon: Music2,
  },
];

function statusLabel(s: PermStatus) {
  if (s === "granted") return "Allowed";
  if (s === "denied") return "Blocked";
  if (s === "unsupported") return "N/A";
  if (s === "prompt") return "Needed";
  return "…";
}

function statusClass(s: PermStatus) {
  if (s === "granted") return "text-emerald-700 dark:text-emerald-300";
  if (s === "denied") return "text-[var(--danger)]";
  return "text-[var(--muted)]";
}

export function PermissionsOnboarding({
  open,
  onClose,
  reason = "setup",
}: {
  open: boolean;
  onClose: () => void;
  reason?: "setup" | "install" | "settings";
}) {
  const native = isNativeApp();
  const items = useMemo(() => (native ? NATIVE_ITEMS : WEB_ITEMS), [native]);
  const [states, setStates] = useState<AppPermissionState | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getPermissionStates().then((next) => {
      if (!cancelled) setStates(next);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const canInstall = !native && shouldOfferInstall() && !isStandaloneDisplay();

  const title = native
    ? reason === "settings"
      ? "App permissions"
      : "Allow Sharebook access"
    : reason === "install"
      ? "Allow access for Home Screen"
      : reason === "settings"
        ? "App permissions"
        : "Allow access for alarms";

  const subtitle = native
    ? "Tap Allow all — Android will ask for each permission. This is required for alarms to ring."
    : reason === "install"
      ? "Installed apps need these so alarms can ring with the screen off."
      : "Tap Allow so notifications, voice recording, and ringtone audio work on your phone.";

  const allowAll = async () => {
    audioSynth.playClick();
    setBusy(true);
    setNote("");
    try {
      const result = await requestAllAppPermissions();
      setStates(result.states);
      setDone(true);

      if (result.states.notifications === "granted") {
        if (result.openedSystemSettings) {
          setNote(
            "Notifications allowed. If Android opened Alarms & reminders or Full-screen settings, turn those on for Sharebook, then tap Continue.",
          );
        } else {
          setNote("You’re set. Alarms can notify and play on this device.");
        }
      } else if (result.states.notifications === "denied") {
        setNote(
          "Notifications were blocked. Tap Allow all again, or enable Notifications for Sharebook in Android Settings → Apps.",
        );
      } else {
        setNote("Permission prompts were shown. Allow Notifications when Android asks, then tap Allow all again if needed.");
      }
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    audioSynth.playClick();
    markPermissionsOnboardingDone();
    onClose();
  };

  const install = async () => {
    audioSynth.playClick();
    const outcome = await promptInstallApp();
    if (outcome === "accepted") {
      setNote("App installed. Tap Allow all so it can wake you reliably.");
    } else if (outcome === "unavailable") {
      setNote(
        "Use your browser menu → Add to Home Screen / Install app, then open it from the icon.",
      );
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex animate-fade-in items-end justify-center bg-black/50 p-0 backdrop-blur-md sm:items-center sm:p-4">
      <div className="modal-sheet w-full max-w-md overflow-y-auto rounded-t-[1.75rem] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-lift)] sm:rounded-3xl sm:p-6">
        <div className="mb-4 stack-tight">
          <p className="type-eyebrow !mb-0">
            {native || isStandaloneDisplay() ? "Installed app" : "Phone access"}
          </p>
          <h3 className="type-modal-title text-[1.4rem]">{title}</h3>
          <p className="type-caption">{subtitle}</p>
        </div>

        <ul className="space-y-2.5">
          {items.map((item) => {
            const Icon = item.icon;
            const status = states?.[item.id] ?? "unknown";
            return (
              <li
                key={item.id}
                className="flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-3"
              >
                <div className="mt-0.5 rounded-xl bg-[var(--brand)] p-2 text-[var(--brand-ink)]">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="type-card-title">{item.title}</p>
                    <span className={`text-[11px] font-semibold ${statusClass(status)}`}>
                      {statusLabel(status)}
                    </span>
                  </div>
                  <p className="type-caption !mt-0.5">{item.caption}</p>
                </div>
              </li>
            );
          })}
        </ul>

        {canInstall && (
          <button
            type="button"
            onClick={() => void install()}
            className="btn-ghost mt-4 flex w-full items-center justify-center gap-2 !py-3"
          >
            <Smartphone className="h-4 w-4" />
            Install to Home Screen
          </button>
        )}

        {note && (
          <p className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--brand-soft)] px-3 py-2.5 text-[12px] leading-snug text-[var(--foreground)]">
            {note}
          </p>
        )}

        <div className="mt-5 flex flex-col gap-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => void allowAll()}
            className="btn-premium w-full !py-3 disabled:opacity-55"
          >
            {busy ? "Requesting…" : done ? "Allow again" : "Allow all"}
          </button>
          <button type="button" disabled={busy} onClick={finish} className="btn-ghost w-full !py-3">
            {done ? (
              <span className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5" />
                Continue
              </span>
            ) : (
              "Not now"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
