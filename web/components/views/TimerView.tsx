"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import { audioSynth } from "@/lib/audio-synth";
import { CompactSelect } from "@/components/ui/CompactSelect";

export type TimerInput = {
  hours: number;
  mins: number;
  secs: number;
};

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: String(i).padStart(2, "0"),
}));
const MIN_SEC_OPTIONS = Array.from({ length: 60 }, (_, i) => ({
  value: i,
  label: String(i).padStart(2, "0"),
}));

const PRESETS = [1, 5, 10, 15, 25] as const;

export function TimerView({
  timerInput,
  setTimerInput,
  timerTotalSecs,
  setTimerTotalSecs,
  timerRemainingSecs,
  setTimerRemainingSecs,
  isTimerRunning,
  setIsTimerRunning,
  isTimerPaused,
  setIsTimerPaused,
}: {
  timerInput: TimerInput;
  setTimerInput: React.Dispatch<React.SetStateAction<TimerInput>>;
  timerTotalSecs: number;
  setTimerTotalSecs: React.Dispatch<React.SetStateAction<number>>;
  timerRemainingSecs: number;
  setTimerRemainingSecs: React.Dispatch<React.SetStateAction<number>>;
  isTimerRunning: boolean;
  setIsTimerRunning: React.Dispatch<React.SetStateAction<boolean>>;
  isTimerPaused: boolean;
  setIsTimerPaused: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const handleStart = () => {
    audioSynth.playClick();
    if (isTimerPaused) {
      setIsTimerPaused(false);
      setIsTimerRunning(true);
    } else {
      const total = timerInput.hours * 3600 + timerInput.mins * 60 + (timerInput.secs || 0);
      if (total <= 0) return;
      setTimerTotalSecs(total);
      setTimerRemainingSecs(total);
      setIsTimerRunning(true);
      setIsTimerPaused(false);
    }
  };

  const handlePause = () => {
    audioSynth.playClick();
    setIsTimerPaused(true);
    setIsTimerRunning(false);
  };

  const handleReset = () => {
    audioSynth.playClick();
    setIsTimerRunning(false);
    setIsTimerPaused(false);
    setTimerRemainingSecs(timerTotalSecs);
  };

  const addMinutes = (mins: number) => {
    audioSynth.playClick();
    if (isTimerRunning || isTimerPaused) {
      setTimerRemainingSecs((prev) => prev + mins * 60);
      setTimerTotalSecs((prev) => prev + mins * 60);
    } else {
      const currentMins = timerInput.mins + mins;
      setTimerInput({
        ...timerInput,
        mins: currentMins % 60,
        hours: Math.min(23, timerInput.hours + Math.floor(currentMins / 60)),
      });
    }
  };

  const hrs = Math.floor(timerRemainingSecs / 3600);
  const m = Math.floor((timerRemainingSecs % 3600) / 60);
  const s = timerRemainingSecs % 60;
  const progressPercent = timerTotalSecs > 0 ? (timerRemainingSecs / timerTotalSecs) * 100 : 0;
  const strokeDashoffset = 565.48 - (565.48 * progressPercent) / 100;
  const status =
    isTimerRunning && !isTimerPaused ? "Running" : isTimerPaused ? "Paused" : "Ready";

  return (
    <div className="flex w-full max-w-md animate-fade-in flex-col items-center gap-6 py-2 pb-10 sm:gap-7 sm:py-4 sm:pb-16">
      <header className="stack-tight w-full text-center">
        <p className="type-eyebrow">Countdown</p>
        <h2 className="type-page-title">Timer</h2>
      </header>

      <div className="relative flex h-56 w-56 items-center justify-center sm:h-64 sm:w-64">
        <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 200 200" aria-hidden>
          <circle
            cx="100"
            cy="100"
            r="90"
            stroke="color-mix(in srgb, var(--brand) 18%, var(--border))"
            strokeWidth="7"
            fill="transparent"
          />
          <circle
            cx="100"
            cy="100"
            r="90"
            className="circle-progress"
            stroke="var(--brand)"
            strokeWidth="7"
            strokeDasharray="565.48"
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="transparent"
          />
        </svg>
        <div className="absolute flex flex-col items-center px-4">
          <p className="font-display text-[clamp(1.85rem,7vw,2.45rem)] font-semibold tracking-[-0.03em] tabular-nums text-[var(--foreground)]">
            {String(hrs).padStart(2, "0")}
            <span className="text-[var(--brand)]">:</span>
            {String(m).padStart(2, "0")}
            <span className="text-[var(--brand)]">:</span>
            {String(s).padStart(2, "0")}
          </p>
          <span className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--brand)]">
            {status}
          </span>
        </div>
      </div>

      {!isTimerRunning && !isTimerPaused && (
        <div className="w-full rounded-[1.35rem] border border-[color-mix(in_srgb,var(--brand)_20%,var(--border))] bg-[var(--surface)] p-3.5 shadow-[var(--shadow-soft)] sm:p-4">
          <div className="grid grid-cols-3 gap-2.5">
            {(
              [
                { key: "hours" as const, label: "Hours", options: HOUR_OPTIONS },
                { key: "mins" as const, label: "Mins", options: MIN_SEC_OPTIONS },
                { key: "secs" as const, label: "Secs", options: MIN_SEC_OPTIONS },
              ] as const
            ).map((field) => (
              <div key={field.key} className="min-w-0">
                <label className="type-field-label mb-1.5 block text-center !text-[10px]">
                  {field.label}
                </label>
                <CompactSelect
                  value={timerInput[field.key]}
                  options={field.options}
                  onChange={(v) =>
                    setTimerInput({ ...timerInput, [field.key]: Number(v) })
                  }
                  ariaLabel={field.label}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex w-full flex-wrap justify-center gap-2">
        {PRESETS.map((mins) => (
          <button
            key={mins}
            type="button"
            onClick={() => addMinutes(mins)}
            className="rounded-full border border-[color-mix(in_srgb,var(--brand)_28%,var(--border))] bg-[var(--brand-soft)] px-3.5 py-2 text-[11px] font-semibold tracking-wide text-[var(--brand)] transition hover:bg-[var(--brand)] hover:text-[var(--brand-ink)]"
          >
            +{mins} min
          </button>
        ))}
      </div>

      <div className="flex items-center gap-5">
        {isTimerRunning && !isTimerPaused ? (
          <button
            type="button"
            onClick={handlePause}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--brand)] text-[var(--brand-ink)] shadow-[0_8px_22px_var(--glow)] transition hover:scale-[1.03] active:scale-[0.97]"
            aria-label="Pause timer"
          >
            <Pause className="h-5 w-5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleStart}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--brand)] text-[var(--brand-ink)] shadow-[0_8px_22px_var(--glow)] transition hover:scale-[1.03] active:scale-[0.97]"
            aria-label="Start timer"
          >
            <Play className="ml-0.5 h-5 w-5" />
          </button>
        )}
        <button
          type="button"
          onClick={handleReset}
          className="flex h-14 w-14 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--brand)_30%,var(--border))] bg-[var(--surface)] text-[var(--brand)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--brand-soft)] active:scale-[0.97]"
          aria-label="Reset timer"
        >
          <RotateCcw className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
