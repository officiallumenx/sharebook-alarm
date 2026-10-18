"use client";

import { useState } from "react";
import { Clock3, Eye, EyeOff } from "lucide-react";
import {
  continueAsGuest,
  genderLabel,
  loginWithPhone,
  MIN_PASSWORD_LENGTH,
  registerUser,
  type Gender,
  type PublicUser,
} from "@/lib/auth";
import { audioSynth } from "@/lib/audio-synth";

type Mode = "login" | "register";

const GENDERS: Gender[] = ["male", "female", "other", "prefer_not"];

function PasswordField({
  id,
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
  show,
  onToggleShow,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete: string;
  show: boolean;
  onToggleShow: () => void;
}) {
  return (
    <div>
      <label className="type-field-label" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="form-field pr-11"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
        <button
          type="button"
          onClick={() => {
            audioSynth.playClick();
            onToggleShow();
          }}
          className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-lg p-1.5 text-[var(--muted)] transition hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

export function AuthScreen({
  onAuth,
  initialMode = "login",
}: {
  onAuth: (user: PublicUser) => void;
  initialMode?: Mode;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const switchMode = (next: Mode) => {
    audioSynth.playClick();
    setMode(next);
    setError(null);
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowConfirm(false);
  };

  const handleSkip = () => {
    audioSynth.playClick();
    setBusy(true);
    setError(null);
    try {
      onAuth(continueAsGuest());
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    audioSynth.playClick();

    try {
      if (mode === "login") {
        const result = await loginWithPhone(phone, password);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        onAuth(result.user);
        return;
      }

      if (!gender) {
        setError("Please select your gender.");
        return;
      }

      const result = await registerUser({
        phone,
        name,
        age,
        gender,
        password,
        confirmPassword,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onAuth(result.user);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-lg flex-col justify-center px-4 py-8 sm:px-6">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--brand)] text-[var(--brand-ink)] shadow-[0_8px_24px_var(--glow)]">
          <Clock3 className="h-6 w-6" />
        </div>
        <p className="type-eyebrow">Smart Voice</p>
        <h1 className="type-page-title mt-1">
          {mode === "login" ? "Welcome back" : "Create account"}
        </h1>
        <p className="type-caption mt-1.5">
          {mode === "login"
            ? "Log in with phone number and password"
            : "Register with your details and a password"}
        </p>
      </div>

      <div className="glass-card rounded-3xl p-5 sm:p-6">
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-full bg-[var(--surface-2)] p-1">
          <button
            type="button"
            onClick={() => switchMode("login")}
            className={`rounded-full py-2.5 text-xs font-semibold transition ${
              mode === "login"
                ? "bg-[var(--brand)] text-[var(--brand-ink)] shadow-sm"
                : "text-[var(--muted)]"
            }`}
          >
            Log in
          </button>
          <button
            type="button"
            onClick={() => switchMode("register")}
            className={`rounded-full py-2.5 text-xs font-semibold transition ${
              mode === "register"
                ? "bg-[var(--brand)] text-[var(--brand-ink)] shadow-sm"
                : "text-[var(--muted)]"
            }`}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="type-field-label" htmlFor="auth-phone">
              Phone number
            </label>
            <input
              id="auth-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 9876543210"
              className="form-field"
              required
            />
          </div>

          {mode === "register" && (
            <>
              <div>
                <label className="type-field-label" htmlFor="auth-name">
                  Name
                </label>
                <input
                  id="auth-name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  className="form-field"
                  required
                />
              </div>

              <div>
                <label className="type-field-label" htmlFor="auth-age">
                  Age
                </label>
                <input
                  id="auth-age"
                  type="number"
                  inputMode="numeric"
                  min={5}
                  max={120}
                  value={age}
                  onChange={(e) => setAge(e.target.value)}
                  placeholder="e.g. 22"
                  className="form-field"
                  required
                />
              </div>

              <div>
                <label className="type-field-label">Gender</label>
                <div className="grid grid-cols-2 gap-2">
                  {GENDERS.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => {
                        audioSynth.playClick();
                        setGender(g);
                      }}
                      className={`rounded-xl border px-3 py-2.5 text-left text-xs font-semibold transition ${
                        gender === g
                          ? "border-transparent bg-[var(--brand)] text-[var(--brand-ink)]"
                          : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--foreground)]"
                      }`}
                    >
                      {genderLabel(g)}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <PasswordField
            id="auth-password"
            label="Password"
            value={password}
            onChange={setPassword}
            placeholder={
              mode === "login" ? "Enter password" : `At least ${MIN_PASSWORD_LENGTH} characters`
            }
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            show={showPassword}
            onToggleShow={() => setShowPassword((v) => !v)}
          />

          {mode === "register" && (
            <PasswordField
              id="auth-confirm"
              label="Confirm password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder="Re-enter password"
              autoComplete="new-password"
              show={showConfirm}
              onToggleShow={() => setShowConfirm((v) => !v)}
            />
          )}

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5">
              <p className="type-caption !mt-0 text-rose-700 dark:text-rose-300">{error}</p>
            </div>
          )}

          <button type="submit" disabled={busy} className="btn-premium w-full !py-3 disabled:opacity-60">
            {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={handleSkip}
            className="btn-ghost w-full !py-3 disabled:opacity-60"
          >
            Skip for now
          </button>
        </form>
      </div>

      <p className="type-caption mt-5 text-center">
        {mode === "login" ? (
          <>
            New here?{" "}
            <button type="button" onClick={() => switchMode("register")} className="font-semibold text-[var(--brand)]">
              Register
            </button>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <button type="button" onClick={() => switchMode("login")} className="font-semibold text-[var(--brand)]">
              Log in
            </button>
          </>
        )}
        {" · "}
        <button
          type="button"
          disabled={busy}
          onClick={handleSkip}
          className="font-semibold text-[var(--brand)] disabled:opacity-60"
        >
          Skip
        </button>
      </p>
    </div>
  );
}
