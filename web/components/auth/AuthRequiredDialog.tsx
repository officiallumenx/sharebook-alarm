"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { audioSynth } from "@/lib/audio-synth";

/** Popup when a guest tries to edit profile — send them to login or register. */
export function AuthRequiredDialog({
  open,
  onClose,
  onLogin,
  onRegister,
}: {
  open: boolean;
  onClose: () => void;
  onLogin: () => void;
  onRegister: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex h-[100dvh] w-screen items-center justify-center bg-black/50 p-4"
      style={{ top: 0, left: 0 }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-required-title"
      onClick={() => {
        audioSynth.playClick();
        onClose();
      }}
    >
      <div
        className="relative w-[min(20rem,calc(100vw-2rem))] shrink-0 overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-lift)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="stack-tight min-w-0">
            <p className="type-eyebrow">Account</p>
            <h3 id="auth-required-title" className="type-modal-title">
              Log in or register
            </h3>
          </div>
          <button
            type="button"
            onClick={() => {
              audioSynth.playClick();
              onClose();
            }}
            className="mt-0.5 shrink-0 rounded-full border border-[var(--border)] p-2 text-[var(--muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-5 text-sm leading-relaxed text-[var(--muted)]">
          Name, photo, tagline, age, and gender are only available after you create an account or
          log in. Guest mode keeps alarms on this device but cannot edit a full profile.
        </p>
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <button
            type="button"
            className="btn-premium flex-1 !py-3"
            onClick={() => {
              audioSynth.playClick();
              onLogin();
            }}
          >
            Log in
          </button>
          <button
            type="button"
            className="flex-1 rounded-2xl border border-[color-mix(in_srgb,var(--brand)_30%,var(--border))] bg-[var(--brand-soft)] py-3 text-sm font-bold text-[var(--brand)]"
            onClick={() => {
              audioSynth.playClick();
              onRegister();
            }}
          >
            Register
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            audioSynth.playClick();
            onClose();
          }}
          className="mt-3 w-full py-2 text-center text-xs font-semibold text-[var(--muted)]"
        >
          Not now
        </button>
      </div>
    </div>,
    document.body,
  );
}
