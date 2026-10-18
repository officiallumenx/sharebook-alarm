"use client";

import { Flag, Pause, Play, RotateCcw } from "lucide-react";
import { audioSynth } from "@/lib/audio-synth";
import { formatStopwatchTime } from "@/lib/types";

export type StopwatchLap = {
  id: number;
  totalTime: number;
  lapTime: number;
};

export function StopwatchView({
  swTime,
  setSwTime,
  isSwRunning,
  setIsSwRunning,
  swLaps,
  setSwLaps,
}: {
  swTime: number;
  setSwTime: React.Dispatch<React.SetStateAction<number>>;
  isSwRunning: boolean;
  setIsSwRunning: React.Dispatch<React.SetStateAction<boolean>>;
  swLaps: StopwatchLap[];
  setSwLaps: React.Dispatch<React.SetStateAction<StopwatchLap[]>>;
}) {
  const formatted = formatStopwatchTime(swTime);

  const handleToggle = () => {
    audioSynth.playClick();
    setIsSwRunning(!isSwRunning);
  };

  const handleReset = () => {
    audioSynth.playClick();
    setIsSwRunning(false);
    setSwTime(0);
    setSwLaps([]);
  };

  const handleLap = () => {
    audioSynth.playClick();
    if (!isSwRunning) return;
    const prevLapTotal = swLaps.reduce((acc, curr) => acc + curr.lapTime, 0);
    const currentLapTime = swTime - prevLapTotal;
    setSwLaps([{ id: swLaps.length + 1, totalTime: swTime, lapTime: currentLapTime }, ...swLaps]);
  };

  const lapTimes = swLaps.map((l) => l.lapTime);
  const minLap = lapTimes.length > 1 ? Math.min(...lapTimes) : null;
  const maxLap = lapTimes.length > 1 ? Math.max(...lapTimes) : null;

  return (
    <div className="flex w-full max-w-md animate-fade-in flex-col items-center gap-6 py-2 pb-10 sm:gap-7 sm:py-4 sm:pb-16">
      <header className="stack-tight w-full text-center">
        <p className="type-eyebrow">Precision</p>
        <h2 className="type-page-title">Stopwatch</h2>
      </header>

      <div
        className="w-full rounded-[1.75rem] border border-[color-mix(in_srgb,var(--brand)_22%,var(--border))] px-5 py-8 text-center shadow-[var(--shadow-soft)] sm:px-7 sm:py-10"
        style={{
          background: `
            radial-gradient(ellipse 90% 70% at 50% -20%, color-mix(in srgb, var(--brand) 22%, transparent), transparent 55%),
            linear-gradient(165deg, color-mix(in srgb, var(--brand) 8%, var(--surface)) 0%, var(--surface) 55%, color-mix(in srgb, var(--brand) 6%, var(--surface-2)) 100%)
          `,
        }}
      >
        <div className="flex items-baseline justify-center gap-1.5">
          <span className="font-display text-[clamp(2.75rem,12vw,4rem)] font-semibold leading-none tracking-[-0.04em] tabular-nums text-[var(--foreground)]">
            {formatted.mins}
            <span className="text-[var(--brand)]">:</span>
            {formatted.secs}
          </span>
          <span className="pb-1 font-mono text-[1.15rem] font-semibold tabular-nums text-[var(--brand)] sm:text-[1.35rem]">
            .{formatted.ms}
          </span>
        </div>
        <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
          {isSwRunning ? "Running" : swTime > 0 ? "Paused" : "Ready"}
        </p>
      </div>

      <div className="flex items-center gap-5">
        <button
          type="button"
          onClick={handleToggle}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--brand)] text-[var(--brand-ink)] shadow-[0_8px_22px_var(--glow)] transition hover:scale-[1.03] active:scale-[0.97]"
          aria-label={isSwRunning ? "Pause stopwatch" : "Start stopwatch"}
        >
          {isSwRunning ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
        </button>
        <button
          type="button"
          onClick={handleLap}
          disabled={!isSwRunning}
          className="flex h-14 w-14 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--brand)_30%,var(--border))] bg-[var(--brand-soft)] text-[var(--brand)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--brand)] hover:text-[var(--brand-ink)] disabled:opacity-35 disabled:hover:bg-[var(--brand-soft)] disabled:hover:text-[var(--brand)] active:scale-[0.97]"
          aria-label="Lap"
        >
          <Flag className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={handleReset}
          className="flex h-14 w-14 items-center justify-center rounded-full border border-[color-mix(in_srgb,var(--brand)_30%,var(--border))] bg-[var(--surface)] text-[var(--brand)] shadow-[var(--shadow-soft)] transition hover:bg-[var(--brand-soft)] active:scale-[0.97]"
          aria-label="Reset stopwatch"
        >
          <RotateCcw className="h-5 w-5" />
        </button>
      </div>

      {swLaps.length > 0 && (
        <div className="w-full space-y-2 rounded-[1.35rem] border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-[var(--shadow-soft)] sm:p-4">
          <p className="type-eyebrow !mb-1 px-0.5">Laps</p>
          <div className="max-h-48 space-y-1.5 overflow-y-auto sm:max-h-60">
            {swLaps.map((lap) => {
              const lapFmt = formatStopwatchTime(lap.lapTime);
              const totalFmt = formatStopwatchTime(lap.totalTime);
              const isFastest = minLap !== null && lap.lapTime === minLap;
              const isSlowest = maxLap !== null && lap.lapTime === maxLap;
              return (
                <div
                  key={lap.id}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 font-mono text-xs sm:text-sm ${
                    isFastest
                      ? "border-[color-mix(in_srgb,var(--brand)_40%,var(--border))] bg-[var(--brand-soft)] text-[var(--brand)]"
                      : isSlowest
                        ? "border-[color-mix(in_srgb,var(--danger)_35%,var(--border))] bg-[color-mix(in_srgb,var(--danger)_8%,var(--surface))] text-[var(--danger)]"
                        : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--foreground)]"
                  }`}
                >
                  <span className="shrink-0 font-sans text-[11px] font-semibold text-[var(--muted)]">
                    Lap {lap.id}
                  </span>
                  <div className="flex min-w-0 items-center gap-3 tabular-nums">
                    <span className="truncate text-[11px] text-[var(--muted)]">
                      +{lapFmt.mins}:{lapFmt.secs}.{lapFmt.ms}
                    </span>
                    <span className="shrink-0 font-semibold">
                      {totalFmt.mins}:{totalFmt.secs}.{totalFmt.ms}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
