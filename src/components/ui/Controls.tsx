import { useId, useRef } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { useMotionPrefs } from "@/lib/motion";

/** Accessible on/off switch. */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  const m = useMotionPrefs();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "focus-ring relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "accent-gradient" : "bg-white/12",
      )}
    >
      <motion.span
        className="absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow"
        animate={{ x: checked ? 20 : 0 }}
        transition={m.spring}
      />
    </button>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/** Small single-choice segmented control with a gliding highlight. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  const group = useId();
  const m = useMotionPrefs();
  return (
    <div role="radiogroup" className={cn("inline-flex rounded-[12px] bg-white/6 p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "focus-ring relative cursor-pointer rounded-[9px] px-3 py-1.5 text-[13px] font-medium transition-colors",
              active ? "text-white" : "text-muted hover:text-fg",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${group}`}
                transition={m.spring}
                className="accent-gradient absolute inset-0 rounded-[9px]"
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Native range input. `onChange` fires continuously while dragging (use it for live preview);
 * `onCommit` fires once when the user lets go (pointer up, key up or blur) with a changed value.
 */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
  label,
  format,
  disabled,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onCommit: (v: number) => void;
  label: string;
  format?: (v: number) => string;
  disabled?: boolean;
}) {
  const dirty = useRef(false);
  const commit = (v: number) => {
    if (!dirty.current) return;
    dirty.current = false;
    onCommit(v);
  };
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          dirty.current = true;
          onChange(Number(e.target.value));
        }}
        onPointerUp={(e) => commit(Number(e.currentTarget.value))}
        onKeyUp={(e) => commit(Number(e.currentTarget.value))}
        onBlur={(e) => commit(Number(e.currentTarget.value))}
        className="focus-ring h-1.5 w-40 cursor-pointer accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
      />
      <span className="w-12 text-right text-[13px] text-muted tabular-nums">{format ? format(value) : value}</span>
    </div>
  );
}
