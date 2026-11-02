import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

const SIZE = 148;
const RING = 20;
const MID_RADIUS = SIZE / 2 - RING / 2;
const HOLE_PCT = ((SIZE / 2 - RING) / (SIZE / 2)) * 100;
const HOLE_MASK = `radial-gradient(circle closest-side, transparent ${HOLE_PCT - 1}%, #000 ${HOLE_PCT}%)`;

/** Same lightness/chroma as `--accent` in theme.css, so the wheel shows exactly what the app will use. */
const swatch = (hue: number) => `oklch(0.66 0.19 ${hue})`;
const RING_GRADIENT = `conic-gradient(from 0deg, ${Array.from({ length: 37 }, (_, i) => `oklch(0.66 0.19 ${i * 10}) ${(i / 36) * 100}%`).join(", ")})`;

const wrap = (h: number) => ((Math.round(h) % 360) + 360) % 360;

export interface ColorWheelProps {
  /** Hue angle, 0–359. */
  value: number;
  /** Fires continuously while dragging / stepping with the keyboard (use for live preview). */
  onChange: (hue: number) => void;
  /** Fires once when the gesture ends (pointer up, key up, blur) or on Reset, with the final hue. */
  onCommit: (hue: number) => void;
  /** Hue Reset returns to. */
  defaultValue: number;
  label: string;
  className?: string;
}

/**
 * Hue ring. Click or drag anywhere on it to pick (0° at the top, clockwise); with the ring focused,
 * arrows step ±1° (Shift ±10°), PageUp/PageDown ±30°, Home/End jump to 0°/359°.
 */
export function ColorWheel({ value, onChange, onCommit, defaultValue, label, className }: ColorWheelProps) {
  const ring = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const dirty = useRef(false);
  const latest = useRef(value);
  latest.current = value;

  const change = (hue: number) => {
    const h = wrap(hue);
    dirty.current = true;
    latest.current = h;
    onChange(h);
  };
  const commit = () => {
    if (!dirty.current) return;
    dirty.current = false;
    onCommit(latest.current);
  };

  const fromPointer = (e: PointerEvent) => {
    const r = ring.current?.getBoundingClientRect();
    if (!r) return;
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    if (dx === 0 && dy === 0) return;
    change((Math.atan2(dx, -dy) * 180) / Math.PI);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    let next: number | null = null;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = latest.current + step;
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = latest.current - step;
        break;
      case "PageUp":
        next = latest.current + 30;
        break;
      case "PageDown":
        next = latest.current - 30;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = 359;
        break;
    }
    if (next === null) return;
    e.preventDefault();
    change(next);
  };

  const rad = (value * Math.PI) / 180;
  const reset = () => {
    onChange(defaultValue);
    dirty.current = false;
    latest.current = defaultValue;
    onCommit(defaultValue);
  };

  return (
    <div className={cn("flex items-center gap-4", className)}>
      <div
        ref={ring}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={value}
        aria-valuetext={`Hue ${value} degrees`}
        onKeyDown={onKeyDown}
        onKeyUp={commit}
        onBlur={commit}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => {
          if (dragging.current) fromPointer(e);
        }}
        onPointerUp={() => {
          dragging.current = false;
          commit();
        }}
        onPointerCancel={() => {
          dragging.current = false;
          commit();
        }}
        className="focus-ring relative shrink-0 cursor-pointer touch-none rounded-full"
        style={{ width: SIZE, height: SIZE }}
      >
        {/* Masked so only the ring shows; the thumb is a sibling so the mask doesn't clip it. */}
        <div className="pointer-events-none absolute inset-0 rounded-full" style={{ background: RING_GRADIENT, maskImage: HOLE_MASK, WebkitMaskImage: HOLE_MASK }} />
        <span
          aria-hidden
          className="pointer-events-none absolute size-[22px] rounded-full border-[3px] border-white shadow-[0_2px_8px_#0009]"
          style={{
            background: swatch(value),
            left: SIZE / 2 + MID_RADIUS * Math.sin(rad) - 11,
            top: SIZE / 2 - MID_RADIUS * Math.cos(rad) - 11,
          }}
        />
      </div>
      <div className="flex flex-col items-start gap-2">
        <div className="flex items-center gap-2.5">
          <span className="size-9 rounded-[10px] shadow-[inset_0_0_0_1px_#ffffff1f]" style={{ background: swatch(value) }} />
          <span className="w-10 text-[13px] text-muted tabular-nums">{value}°</span>
        </div>
        <Button variant="glass" size="sm" disabled={value === defaultValue} onClick={reset}>
          Reset
        </Button>
      </div>
    </div>
  );
}
