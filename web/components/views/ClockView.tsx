"use client";

import { WORLD_CITIES, formatDisplayTime } from "@/lib/types";

export default function ClockView({
  currentTime,
  is24Hour,
}: {
  currentTime: Date;
  is24Hour: boolean;
}) {
  const timeObj = formatDisplayTime(currentTime, is24Hour);
  const dateStr = currentTime.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const secs = currentTime.getSeconds();
  const mins = currentTime.getMinutes();
  const hrs = currentTime.getHours();
  const secDeg = (secs / 60) * 360;
  const minDeg = ((mins + secs / 60) / 60) * 360;
  const hrDeg = (((hrs % 12) + mins / 60) / 12) * 360;

  return (
    <div className="flex w-full max-w-4xl animate-fade-in flex-col gap-5 py-2 pb-8 sm:gap-6 sm:py-4 sm:pb-16">
      <div className="glass-card flex w-full flex-col items-center gap-6 rounded-3xl px-5 py-6 sm:gap-7 sm:px-7 sm:py-8 md:flex-row md:items-center md:justify-between md:px-8">
        <div className="flex w-full min-w-0 flex-col items-center text-center md:items-start md:text-left">
          <p className="type-eyebrow">Local time</p>
          <div className="mt-1 flex max-w-full flex-wrap items-baseline justify-center gap-x-1.5 md:justify-start">
            <span className="type-time-hero">
              {timeObj.hoursStr}:{timeObj.minutes}
            </span>
            <span className="type-time-sec">:{timeObj.seconds}</span>
            {!is24Hour && <span className="type-ampm ml-1 self-end pb-1.5 sm:pb-2">{timeObj.ampm}</span>}
          </div>
          <p className="type-caption mt-2.5 max-w-sm md:max-w-none">{dateStr}</p>
        </div>
        <div className="relative flex h-36 w-36 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface-2)] shadow-[inset_0_2px_12px_rgba(0,0,0,0.06)] sm:h-44 sm:w-44 md:h-48 md:w-48">
          {[...Array(12)].map((_, i) => (
            <div key={i} className="absolute inset-0" style={{ transform: `rotate(${i * 30}deg)` }}>
              <div className="mx-auto mt-[7%] h-2 w-0.5 rounded-sm bg-stone-300 dark:bg-stone-600 sm:h-2.5" />
            </div>
          ))}
          <div
            className="absolute bottom-1/2 left-1/2 h-[28%] w-1.5 origin-bottom rounded-sm bg-stone-800 dark:bg-stone-200"
            style={{ transform: `translateX(-50%) rotate(${hrDeg}deg)` }}
          />
          <div
            className="absolute bottom-1/2 left-1/2 h-[38%] w-1 origin-bottom rounded-sm bg-stone-600 dark:bg-stone-400"
            style={{ transform: `translateX(-50%) rotate(${minDeg}deg)` }}
          />
          <div
            className="absolute bottom-1/2 left-1/2 h-[42%] w-0.5 origin-bottom rounded-sm bg-[var(--brand)]"
            style={{ transform: `translateX(-50%) rotate(${secDeg}deg)` }}
          />
          <div className="absolute z-10 h-2 w-2 rounded-full border-2 border-white bg-[var(--brand)] sm:h-2.5 sm:w-2.5" />
        </div>
      </div>

      <section className="w-full">
        <p className="type-eyebrow mb-3 px-0.5">World clocks</p>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3">
          {WORLD_CITIES.map((city) => {
            const cityTime = new Date(currentTime.toLocaleString("en-US", { timeZone: city.zone }));
            const cFmt = formatDisplayTime(cityTime, is24Hour);
            return (
              <div
                key={city.name}
                className="glass-card flex items-center justify-between gap-3 rounded-2xl px-4 py-3.5"
              >
                <div className="min-w-0">
                  <h4 className="type-card-title truncate">{city.name}</h4>
                  <p className="type-caption mt-0.5">
                    {cityTime.toLocaleDateString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <span className="font-mono text-[1.05rem] font-medium tracking-tight text-[var(--foreground)] tabular-nums">
                    {cFmt.hoursStr}:{cFmt.minutes}
                  </span>
                  {!is24Hour && <span className="type-ampm ml-1">{cFmt.ampm}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
