/**
 * Undo affordances whose remaining time is drawn around their own outline.
 * Adapted from Kokonut UI's "Undo Button" (MIT, https://kokonutui.com/docs/buttons/undo-button).
 *
 * - `UndoButton`: an action pill. Press it -> "<doneLabel> | Undo <n>" while the outline drains; the action
 *   commits when the clock runs out. Ctrl/Cmd+Z or pressing the pill undoes.
 * - `UndoCountdown`: just the draining "Undo <n>" chip, for places that already report the action (toasts).
 *
 * The clock holds while the pointer is over the control (or `paused`) and while the window is hidden.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { Archive, Check, Undo2, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";
import { useMotionPrefs } from "@/lib/motion";

const EASE_OUT = [0.23, 1, 0.32, 1] as const;
const STROKE = 1.5;
const IS_APPLE = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const SHORTCUT = IS_APPLE ? "Cmd+Z" : "Ctrl+Z";

type Phase = "idle" | "pending" | "done";

/** A pill outline starting at the top centre and running clockwise, so the countdown drains back to its start. */
function pillPath(width: number, height: number): string {
  const s = STROKE / 2;
  const r = height / 2 - s;
  const left = s + r;
  const right = width - s - r;
  return [
    `M ${width / 2} ${s}`,
    `H ${right}`,
    `A ${r} ${r} 0 0 1 ${right} ${height - s}`,
    `H ${left}`,
    `A ${r} ${r} 0 0 1 ${left} ${s}`,
    "Z",
  ].join(" ");
}

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Keeps an SVG path glued to the outline of `boxRef`, drawn `remaining` (0..1) of the way round. */
function useOutline<T extends HTMLElement>() {
  const boxRef = useRef<T>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const remaining = useRef(1);

  // Real dash lengths rather than pathLength, which Chrome scales inconsistently when the path resizes.
  const paint = useCallback(() => {
    const path = pathRef.current;
    if (!path) return;
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length * remaining.current} ${length}`;
  }, []);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const sync = () => {
      if (box.offsetWidth === 0 || box.offsetHeight === 0) return;
      pathRef.current?.setAttribute("d", pillPath(box.offsetWidth, box.offsetHeight));
      paint();
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(box);
    return () => observer.disconnect();
  }, [paint]);

  return { boxRef, pathRef, remaining, paint };
}

interface ClockOptions {
  active: boolean;
  duration: number;
  paused: boolean;
  /** Whether Ctrl/Cmd+Z undoes while this clock runs. */
  shortcut: boolean;
  remaining: RefObject<number>;
  paint: () => void;
  onUndo: () => void;
  onExpire: () => void;
}

/** Runs the undo window while `active`; returns whole seconds left. Restarts each time `active` turns on. */
function useUndoClock({ active, duration, paused, shortcut, remaining, paint, onUndo, onExpire }: ClockOptions): number {
  const [seconds, setSeconds] = useState(Math.ceil(duration / 1000));
  const live = useRef({ paused, shortcut, onUndo, onExpire });
  live.current = { paused, shortcut, onUndo, onExpire };

  useEffect(() => {
    if (!active) return;
    let elapsed = 0;
    remaining.current = 1;
    paint();
    setSeconds(Math.ceil(duration / 1000));

    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      // Hovering the control, or leaving the window, holds the clock: nobody should lose their chance mid-read.
      if (!(live.current.paused || document.hidden)) elapsed += now - last;
      last = now;
      const left = Math.max(0, duration - elapsed);
      remaining.current = left / duration;
      paint();
      setSeconds(Math.ceil(left / 1000));
      if (left === 0) {
        live.current.onExpire();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    // Frames stop while hidden; don't count the gap once they resume.
    const onVisibility = () => {
      last = performance.now();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!live.current.shortcut) return;
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "z" && !isEditable(event.target)) {
        event.preventDefault();
        live.current.onUndo();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [active, duration, paint, remaining]);

  return seconds;
}

function Outline({ pathRef, active, fade }: { pathRef: RefObject<SVGPathElement | null>; active: boolean; fade: number }) {
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 size-full overflow-visible">
      <motion.path
        ref={pathRef}
        fill="none"
        className="stroke-accent"
        strokeWidth={STROKE}
        strokeLinecap="round"
        initial={false}
        animate={{ opacity: active ? 1 : 0 }}
        transition={{ duration: fade }}
      />
    </svg>
  );
}

function Digit({ value, animate }: { value: number; animate: boolean }) {
  return (
    <span aria-hidden className="relative inline-flex h-5 min-w-[1ch] justify-center overflow-hidden text-muted tabular-nums">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={value}
          className="leading-5"
          initial={{ y: animate ? 10 : 0, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: animate ? -10 : 0, opacity: 0 }}
          transition={animate ? { duration: 0.2, ease: EASE_OUT } : { duration: 0 }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export interface UndoCountdownProps {
  /** How long the action can be undone, in ms. */
  duration: number;
  onUndo: () => void;
  /** Called once when the window closes without an undo. */
  onExpire?: () => void;
  /** Hold the clock from outside (e.g. while the whole toast is hovered). */
  paused?: boolean;
  /** Whether Ctrl/Cmd+Z triggers this chip. Give it to one chip at a time. Default true. */
  shortcut?: boolean;
  className?: string;
}

/** The draining-outline "Undo <n>" chip. Settles exactly once: either `onUndo` or `onExpire`. */
export function UndoCountdown({ duration, onUndo, onExpire, paused = false, shortcut = true, className }: UndoCountdownProps) {
  const m = useMotionPrefs();
  const { boxRef, pathRef, remaining, paint } = useOutline<HTMLButtonElement>();
  const [hovered, setHovered] = useState(false);
  const settled = useRef(false);
  const callbacks = useRef({ onUndo, onExpire });
  callbacks.current = { onUndo, onExpire };

  const undo = useCallback(() => {
    if (settled.current) return;
    settled.current = true;
    callbacks.current.onUndo();
  }, []);
  const expire = useCallback(() => {
    if (settled.current) return;
    settled.current = true;
    callbacks.current.onExpire?.();
  }, []);

  const seconds = useUndoClock({
    active: true,
    duration,
    paused: paused || hovered,
    shortcut,
    remaining,
    paint,
    onUndo: undo,
    onExpire: expire,
  });

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <button
        ref={boxRef}
        type="button"
        onClick={undo}
        onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        title={`Undo (${SHORTCUT})`}
        aria-label="Undo"
        className="focus-ring inline-flex h-7 cursor-pointer select-none items-center gap-1.5 rounded-full border border-white/8 bg-white/6 px-2.5 text-[13px] font-semibold text-fg transition-colors hover:bg-white/10"
      >
        <Undo2 aria-hidden size={14} strokeWidth={1.75} />
        Undo
        <Digit value={seconds} animate={m.full} />
      </button>
      <Outline pathRef={pathRef} active fade={m.off ? 0 : 0.15} />
    </span>
  );
}

export interface UndoButtonProps {
  /** What the button does, e.g. "Archive". */
  label?: string;
  /** The same action in the past tense, e.g. "Archived". */
  doneLabel?: string;
  icon?: LucideIcon;
  /** How long the action can be undone, in ms. */
  duration?: number;
  /** After the action commits, go back to the start after this many ms. `null` stays on the done state. */
  resetAfter?: number | null;
  /** Called when the button is pressed and the undo window opens. */
  onAction?: () => void;
  /** Called when the window closes without an undo: do the real work here. */
  onCommit?: () => void;
  onUndo?: () => void;
  className?: string;
}

export function UndoButton({
  label = "Archive",
  doneLabel = "Archived",
  icon: Icon = Archive,
  duration = 5000,
  resetAfter = 2400,
  onAction,
  onCommit,
  onUndo,
  className,
}: UndoButtonProps) {
  const m = useMotionPrefs();
  const [phase, setPhase] = useState<Phase>("idle");
  const [width, setWidth] = useState<number>();
  const [hovered, setHovered] = useState(false);
  const { boxRef, pathRef, remaining, paint } = useOutline<HTMLButtonElement>();
  const contentRef = useRef<HTMLSpanElement>(null);

  const callbacks = useRef({ onAction, onCommit, onUndo });
  callbacks.current = { onAction, onCommit, onUndo };

  // The pill's width follows its label, so it grows into "Archived | Undo 5" instead of jumping.
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    // +2 for the 1px border on each side.
    const observer = new ResizeObserver(() => setWidth(content.offsetWidth + 2));
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const undo = useCallback(() => {
    setPhase("idle");
    callbacks.current.onUndo?.();
  }, []);
  const expire = useCallback(() => {
    setPhase("done");
    callbacks.current.onCommit?.();
  }, []);

  const seconds = useUndoClock({
    active: phase === "pending",
    duration,
    paused: hovered,
    shortcut: true,
    remaining,
    paint,
    onUndo: undo,
    onExpire: expire,
  });

  useEffect(() => {
    if (phase !== "done" || resetAfter === null) return;
    const timer = setTimeout(() => setPhase("idle"), resetAfter);
    return () => clearTimeout(timer);
  }, [phase, resetAfter]);

  const press = () => {
    if (phase === "idle") {
      setPhase("pending");
      callbacks.current.onAction?.();
    } else if (phase === "pending") {
      undo();
    }
  };

  const setHover = (event: PointerEvent, value: boolean) => {
    if (event.pointerType === "mouse") setHovered(value);
  };

  const swap = m.full ? { duration: 0.22, ease: EASE_OUT } : m.fast;
  const lift = m.full ? 8 : 0;
  const blur = m.full ? "blur(2px)" : "blur(0px)";

  const ariaLabel = {
    idle: label,
    pending: `${doneLabel}. Undo, ${seconds} second${seconds === 1 ? "" : "s"} left`,
    done: doneLabel,
  }[phase];

  return (
    <span className="relative inline-flex">
      <motion.button
        ref={boxRef}
        type="button"
        initial={false}
        animate={{ width: width ?? "auto" }}
        transition={swap}
        aria-disabled={phase === "done"}
        aria-label={ariaLabel}
        onClick={press}
        onPointerEnter={(e) => setHover(e, true)}
        onPointerLeave={(e) => setHover(e, false)}
        className={cn(
          "focus-ring relative inline-flex h-10 select-none items-center justify-center overflow-hidden whitespace-nowrap rounded-full border border-white/8 text-sm font-medium transition-[background-color,color] duration-150",
          phase === "done" ? "cursor-default bg-white/4 text-muted" : "cursor-pointer bg-white/6 text-fg hover:bg-white/10 active:bg-white/14",
          className,
        )}
      >
        <span ref={contentRef} className="inline-flex px-4">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={phase}
              className="inline-flex items-center gap-2"
              initial={{ opacity: 0, y: lift, filter: blur }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -lift, filter: blur }}
              transition={swap}
            >
              {phase === "idle" && (
                <>
                  <Icon aria-hidden size={16} strokeWidth={1.75} />
                  {label}
                </>
              )}
              {phase === "pending" && (
                <>
                  <span className="text-muted">{doneLabel}</span>
                  <span aria-hidden className="h-4 w-px bg-white/10" />
                  <Undo2 aria-hidden size={16} strokeWidth={1.75} />
                  Undo
                  <Digit value={seconds} animate={m.full} />
                  <kbd className="hidden rounded border border-white/10 px-1 font-sans text-[11px] text-muted sm:inline">{SHORTCUT}</kbd>
                </>
              )}
              {phase === "done" && (
                <>
                  <Check aria-hidden size={16} strokeWidth={1.75} />
                  {doneLabel}
                </>
              )}
            </motion.span>
          </AnimatePresence>
        </span>
      </motion.button>
      <Outline pathRef={pathRef} active={phase === "pending"} fade={m.off ? 0 : phase === "pending" ? 0.15 : 0.2} />
      <span aria-live="polite" className="sr-only">
        {phase === "pending" && `${doneLabel}. Press the button or ${IS_APPLE ? "Command" : "Control"} Z to undo.`}
        {phase === "done" && doneLabel}
      </span>
    </span>
  );
}
