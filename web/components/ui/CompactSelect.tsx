"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { audioSynth } from "@/lib/audio-synth";

export type CompactSelectOption = {
  value: string | number;
  label: string;
};

export function CompactSelect({
  value,
  options,
  onChange,
  ariaLabel,
  className = "",
}: {
  value: string | number;
  options: CompactSelectOption[];
  onChange: (value: string | number) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((o) => String(o.value) === String(value)) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("touchstart", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("touchstart", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = rootRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [open, value]);

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          audioSynth.playClick();
          setOpen((v) => !v);
        }}
        className="flex w-full items-center justify-between gap-1 rounded-xl border border-[var(--border-strong)] bg-[var(--surface-2)] px-2.5 py-2 text-left text-xs font-semibold text-[var(--foreground)] outline-none transition hover:bg-[var(--surface)] focus:border-[color-mix(in_srgb,var(--brand)_55%,var(--border-strong))] focus:shadow-[0_0_0_3px_var(--brand-soft)]"
      >
        <span className="truncate">{selected?.label ?? ""}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-[var(--muted)] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute left-0 right-0 z-[60] mt-1 max-h-40 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-[var(--shadow-lift)]"
        >
          {options.map((opt) => {
            const isSelected = String(opt.value) === String(value);
            return (
              <li key={String(opt.value)} role="option" aria-selected={isSelected}>
                <button
                  type="button"
                  onClick={() => {
                    audioSynth.playClick();
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center px-3 py-2 text-left text-xs font-semibold transition ${
                    isSelected
                      ? "bg-[var(--brand)] text-[var(--brand-ink)]"
                      : "text-[var(--foreground)] hover:bg-[var(--brand-soft)]"
                  }`}
                >
                  {opt.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
