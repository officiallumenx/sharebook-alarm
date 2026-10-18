"use client";

type ToggleProps = {
  checked: boolean;
  onChange: () => void;
  label?: string;
  disabled?: boolean;
  className?: string;
};

/** Compact iOS-style switch — keep on the right of list rows. */
export function Toggle({ checked, onChange, label, disabled, className = "" }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`ui-toggle ${checked ? "ui-toggle--on" : ""} ${className}`.trim()}
    >
      <span className="ui-toggle__knob" />
    </button>
  );
}
