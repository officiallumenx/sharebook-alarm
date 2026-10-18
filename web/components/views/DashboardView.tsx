"use client";

import { AlarmClock, BookOpen, CheckSquare, type LucideIcon } from "lucide-react";
import { audioSynth } from "@/lib/audio-synth";
import { formatDisplayTime, type AlarmSlot } from "@/lib/types";

type FeatureSlot = Exclude<AlarmSlot, "dashboard">;

type DashCard = {
  id: FeatureSlot;
  title: string;
  caption: string;
  count: number;
  countLabel: string;
  icon: LucideIcon;
};

export function DashboardView({
  userName,
  currentTime,
  is24Hour,
  alarmCount,
  noteCount,
  todoCount,
  onOpen,
}: {
  userName: string;
  currentTime: Date;
  is24Hour: boolean;
  alarmCount: number;
  noteCount: number;
  todoCount: number;
  onOpen: (slot: FeatureSlot) => void;
}) {
  const firstName = userName.trim().split(/\s+/)[0] || "there";
  const time = formatDisplayTime(currentTime, is24Hour);
  const dateStr = currentTime.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const cards: DashCard[] = [
    {
      id: "alarm",
      title: "Alarms",
      caption: "Rings & schedules",
      count: alarmCount,
      countLabel: "active",
      icon: AlarmClock,
    },
    {
      id: "notes",
      title: "Notes",
      caption: "Voice studio",
      count: noteCount,
      countLabel: "saved",
      icon: BookOpen,
    },
    {
      id: "todo",
      title: "To-Do",
      caption: "Tasks & plans",
      count: todoCount,
      countLabel: "open",
      icon: CheckSquare,
    },
  ];

  return (
    <>
      <div className="dash-backdrop" aria-hidden>
        <div className="dash-backdrop__wash" />
        <div className="dash-backdrop__orb dash-backdrop__orb--a" />
        <div className="dash-backdrop__orb dash-backdrop__orb--b" />
        <div className="dash-backdrop__orb dash-backdrop__orb--c" />
        <div className="dash-backdrop__ring dash-backdrop__ring--lg" />
        <div className="dash-backdrop__ring dash-backdrop__ring--md" />
        <div className="dash-backdrop__arc" />
        <div className="dash-backdrop__mesh" />
        <div className="dash-backdrop__lines" />
        <p className="dash-backdrop__mark">SV</p>
        <div className="dash-backdrop__vignette" />
      </div>

      <div className="dash-home relative z-[1] flex w-full max-w-xl animate-fade-in flex-col gap-8 py-3 pb-10 sm:gap-10 sm:py-6 sm:pb-16">
        <header className="relative space-y-4 pt-1 sm:pt-2">
          <div>
            <p className="type-eyebrow !mb-1.5 tracking-[0.2em] text-[var(--brand)]">{dateStr}</p>
            <div className="flex items-baseline gap-2">
              <p className="font-display text-[clamp(3rem,14vw,4.5rem)] font-semibold leading-none tracking-[-0.04em] text-[var(--foreground)] tabular-nums">
                {time.hoursStr}
                <span className="text-[var(--brand)]">:</span>
                {time.minutes}
              </p>
              <div className="flex items-baseline gap-1.5 pb-1">
                <span className="font-mono text-[1.05rem] font-semibold tabular-nums text-[var(--muted)] sm:text-[1.2rem]">
                  :{time.seconds}
                </span>
                {!is24Hour && time.ampm && (
                  <span className="text-[0.8rem] font-semibold tracking-[0.12em] text-[var(--brand)] sm:text-[0.9rem]">
                    {time.ampm}
                  </span>
                )}
              </div>
            </div>
          </div>
          <h2 className="font-display text-[clamp(1.85rem,7vw,2.75rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-[var(--foreground)]">
            Welcome home,
            <br />
            <span className="text-[var(--brand)]">{firstName}</span>
          </h2>
          <div className="dash-home__rule" aria-hidden />
        </header>

        <section className="relative">
          <div className="mb-3.5 flex items-end justify-between gap-3 sm:mb-4">
            <p className="type-eyebrow !mb-0">Spaces</p>
            <p className="text-[11px] font-medium tracking-wide text-[var(--muted)]">Tap to enter</p>
          </div>

          <div className="grid grid-cols-2 gap-3.5 sm:gap-4">
            {cards.map((card, index) => {
              const Icon = card.icon;
              return (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => {
                    audioSynth.playClick();
                    onOpen(card.id);
                  }}
                  className="dash-card group relative flex aspect-square flex-col justify-between overflow-hidden rounded-[1.6rem] border border-[color-mix(in_srgb,var(--brand)_22%,var(--border))] p-4 text-left shadow-[var(--shadow-soft)] transition duration-300 hover:-translate-y-1 hover:shadow-[var(--shadow-lift)] active:scale-[0.98] sm:rounded-[1.85rem] sm:p-5"
                  style={{ animationDelay: `${index * 70}ms` }}
                >
                  <div className="dash-card__shine" aria-hidden />
                  <Icon
                    className="relative h-8 w-8 text-[var(--brand)] sm:h-9 sm:w-9"
                    strokeWidth={1.6}
                  />
                  <div className="relative min-w-0">
                    <h3 className="font-display text-[1.35rem] font-semibold tracking-[-0.02em] text-[var(--foreground)] sm:text-[1.55rem]">
                      {card.title}
                    </h3>
                    <p className="mt-1 text-[12px] leading-snug text-[var(--muted)] sm:text-[13px]">
                      {card.caption}
                    </p>
                    <p className="mt-2.5 text-[12px] font-semibold tracking-wide text-[var(--brand)] sm:text-[13px]">
                      {card.count} {card.countLabel}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}
