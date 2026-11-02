import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "motion/react";
import { ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { useMotionPrefs } from "@/lib/motion";

/*
 * Slide-to-confirm control for actions that can't be undone (e.g. spending Robux).
 * Adapted from Kokonut UI's "Slide to Confirm" (MIT, https://kokonutui.com), restyled to Muffin's tokens.
 */

const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];
const EASE_IN_OUT: [number, number, number, number] = [0.65, 0, 0.35, 1];
const HEIGHT = 52;
const INSET = 4;
const THUMB = HEIGHT - INSET * 2;
/** Share of the track the thumb must cross before letting go commits. */
const COMMIT_AT = 0.9;
/** A flick this fast (px/s) commits from FLICK_FROM of the way along. */
const FLICK_SPEED = 900;
const FLICK_FROM = 0.45;
/** How far past either end the thumb stretches, at most. */
const OVERDRAG = 8;
/** A press that moves less than this is a tap. */
const TAP_SLOP = 4;

type Phase = "idle" | "dragging" | "confirming" | "done";

export interface SlideToConfirmProps {
  /** What sliding does, e.g. "Slide to buy for 100 Robux". */
  label: string;
  /** Read out while `onConfirm` runs. */
  confirmingLabel?: string;
  /** Shown once it's done, e.g. "Bought". */
  doneLabel?: string;
  /**
   * The real work. Return a promise to keep the spinner up until it settles;
   * a rejected promise sends the thumb back to the start.
   */
  onConfirm: () => Promise<unknown> | unknown;
  /** Go back to the start this many ms after it's done. `null` stays done. */
  resetAfter?: number | null;
  disabled?: boolean;
  className?: string;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Past the ends the thumb follows less and less, so it stretches instead of stopping dead against the edge.
function band(raw: number, max: number) {
  if (raw > max) return max + OVERDRAG * (1 - Math.exp(-(raw - max) / 40));
  if (raw < 0) return -OVERDRAG * (1 - Math.exp(raw / 40));
  return raw;
}

export function SlideToConfirm({
  label,
  confirmingLabel = "Working",
  doneLabel = "Done",
  onConfirm,
  resetAfter = 2600,
  disabled = false,
  className,
}: SlideToConfirmProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [armed, setArmed] = useState(false);
  const prefs = useMotionPrefs();
  const reduceMotion = !prefs.full;

  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({ pointer: 0, from: 0, moved: false });
  const phaseRef = useRef<Phase>("idle");
  const runRef = useRef(0);
  const confirmRef = useRef(onConfirm);
  confirmRef.current = onConfirm;

  const x = useMotionValue(0);
  const width = useMotionValue(0);
  // 0: the ink ends at the thumb. 1: it fills the whole track, thumb and all.
  const cover = useMotionValue(0);

  const max = () => Math.max(0, width.get() - THUMB - INSET * 2);

  const go = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  // The ink runs from the left edge to just past the thumb; once committed it floods the rest.
  const fillClip = useTransform(() => {
    const total = width.get();
    return `inset(0px ${(1 - cover.get()) * Math.max(0, total - x.get() - INSET - THUMB / 2)}px 0px 0px round ${HEIGHT}px)`;
  });
  // Hidden at rest, so no ink shows round the thumb before it moves.
  const fillOpacity = useTransform(x, (value) => Math.min(1, value / 20));
  const labelOpacity = useTransform(() => {
    const progress = x.get() / Math.max(1, width.get() - THUMB - INSET * 2);
    return Math.max(0, 1 - progress * 0.55);
  });

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new ResizeObserver(() => {
      const before = width.get();
      width.set(track.offsetWidth);
      // Keep a thumb that sits at the end at the end when the track resizes.
      if (before > 0 && x.get() >= before - THUMB - INSET * 2) {
        x.set(track.offsetWidth - THUMB - INSET * 2);
      }
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, [width, x]);

  // Invalidates any in-flight commit so nothing is set after unmount.
  useEffect(
    () => () => {
      runRef.current += 1;
    },
    [],
  );

  const spring = (velocity = 0) =>
    reduceMotion
      ? { duration: 0.15, ease: EASE_OUT }
      : { type: "spring" as const, stiffness: 520, damping: 42, velocity };

  // The ink drains back behind the thumb as it springs home.
  const settleBack = (velocity = 0) => {
    setArmed(false);
    go("idle");
    animate(cover, 0, { duration: reduceMotion ? 0 : 0.3, ease: EASE_OUT });
    animate(x, 0, spring(velocity));
  };

  // The reset nobody asked for runs slower, so it reads as a rewind.
  const rewind = () => {
    setArmed(false);
    go("idle");
    const duration = reduceMotion ? 0 : 0.6;
    animate(cover, 0, { duration: duration * 0.6, ease: EASE_OUT });
    animate(x, 0, { duration, ease: EASE_IN_OUT });
  };

  // One motion from release to result: the thumb carries on to the end while the ink floods the track,
  // and the work starts at once instead of waiting for the thumb to land.
  const commit = async (velocity: number, glide = false) => {
    const run = ++runRef.current;
    const alive = () => runRef.current === run;
    go("confirming");
    setArmed(true);

    const landing = animate(x, max(), glide && !reduceMotion ? { duration: 0.42, ease: EASE_IN_OUT } : spring(velocity));
    const flooding = animate(cover, 1, { duration: reduceMotion ? 0 : 0.36, ease: EASE_OUT });

    try {
      // A floor on the wait, so a fast handler doesn't flash the spinner.
      await Promise.all([confirmRef.current(), wait(800), landing, flooding]);
    } catch {
      if (alive()) settleBack();
      return;
    }
    if (!alive()) return;
    go("done");
    if (resetAfter === null) return;
    await wait(resetAfter);
    if (alive()) rewind();
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled || phaseRef.current !== "idle" || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    x.stop();
    dragRef.current = { pointer: event.clientX, from: x.get(), moved: false };
    go("dragging");
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (phaseRef.current !== "dragging") return;
    const drag = dragRef.current;
    const delta = event.clientX - drag.pointer;
    if (Math.abs(delta) > TAP_SLOP) drag.moved = true;
    const raw = drag.from + delta;
    x.set(band(raw, max()));
    const isArmed = raw >= max() * COMMIT_AT;
    if (isArmed !== armed) setArmed(isArmed);
  };

  const onPointerUp = () => {
    if (phaseRef.current !== "dragging") return;
    if (!dragRef.current.moved) {
      go("idle");
      return;
    }
    const velocity = x.getVelocity();
    const progress = x.get() / Math.max(1, max());
    const flicked = velocity > FLICK_SPEED && progress > FLICK_FROM;
    if (progress >= COMMIT_AT || flicked) void commit(velocity);
    else settleBack(velocity);
  };

  const onClick = async (event: MouseEvent<HTMLButtonElement>) => {
    if (disabled || phaseRef.current !== "idle") return;
    // Enter and Space click with no pointer, and confirm in one go. A mouse click never gets here with
    // detail 0, so a single click can't commit.
    if (event.detail === 0) {
      void commit(0, true);
      return;
    }
    if (dragRef.current.moved || reduceMotion) return;
    // A tap shows which way to go: a short nudge that springs back.
    await animate(x, 28, { duration: 0.18, ease: EASE_OUT });
    if (phaseRef.current === "idle") void animate(x, 0, spring());
  };

  const done = phase === "done";
  const busy = phase === "confirming";
  let stage = "slide";
  let stageLabel = label;
  if (busy) {
    stage = "busy";
    stageLabel = `${confirmingLabel}…`;
  } else if (done) {
    stage = "done";
    stageLabel = doneLabel;
  }

  return (
    <div className={cn("relative w-full select-none", className)} data-phase={phase}>
      <div
        ref={trackRef}
        className={cn(
          "relative overflow-hidden rounded-full border border-white/8 bg-white/6 transition-opacity",
          disabled && "opacity-50",
        )}
        style={{ height: HEIGHT }}
      >
        {/* The label as it reads on the empty track, nudged off the thumb so it reads as centered. */}
        <motion.span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center whitespace-nowrap pl-6 text-sm font-medium text-muted"
          style={{ opacity: labelOpacity }}
        >
          {label}
        </motion.span>

        {/* The ink the thumb leaves behind, with the label on it. It turns green in place when done. */}
        <motion.div
          aria-hidden
          className={cn(
            "absolute inset-0 transition-colors duration-300 ease-out motion-reduce:transition-none",
            done ? "bg-success" : "bg-accent",
          )}
          style={{ clipPath: fillClip, opacity: fillOpacity }}
        >
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={stage}
              initial={{ opacity: 0, y: 8, filter: "blur(2px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -8, filter: "blur(2px)" }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.26, ease: EASE_OUT }}
              className={cn(
                "absolute inset-0 flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium",
                done ? "text-black/75" : "text-white",
                phase === "idle" || phase === "dragging" ? "pl-6" : "pr-6",
              )}
            >
              {stageLabel}
            </motion.span>
          </AnimatePresence>
        </motion.div>

        <motion.button
          type="button"
          aria-disabled={disabled || phase !== "idle"}
          aria-label={`${label}. Press Enter to confirm.`}
          className={cn(
            "focus-ring absolute flex touch-none items-center justify-center rounded-full bg-white text-black/80 outline-none",
            "shadow-[0_1px_2px_rgb(0_0_0/0.5),0_0_0_1px_rgb(255_255_255/0.08)]",
            phase === "idle" && !disabled && "cursor-grab",
            phase === "dragging" && "cursor-grabbing",
          )}
          onClick={onClick}
          onPointerCancel={onPointerUp}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          // Offsets are from inside the 1px border.
          style={{ x, left: INSET - 1, top: INSET - 1, width: THUMB, height: THUMB }}
        >
          <span className="relative size-5">
            <ArrowRight
              aria-hidden
              className={cn(
                "absolute inset-0 size-5 transition-[opacity,translate,filter] duration-200 ease-out motion-reduce:transition-none",
                armed && !busy && !done && "translate-x-0.5",
                (busy || done) && "translate-x-1.5 opacity-0 blur-[2px]",
              )}
            />
            <Check
              aria-hidden
              strokeWidth={2.5}
              className={cn(
                "absolute inset-0 size-5 text-[#13805a] transition-[opacity,scale,filter] duration-200 ease-out motion-reduce:transition-none",
                done ? "scale-100 opacity-100" : "scale-50 opacity-0 blur-[2px]",
              )}
            />
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className={cn(
                "absolute -inset-0.5 size-6 animate-spin transition-opacity duration-200 [animation-duration:700ms]",
                // Paused, not removed, so it fades out without snapping back.
                busy ? "opacity-100 delay-100" : "opacity-0 [animation-play-state:paused]",
              )}
            >
              <circle cx="12" cy="12" r="9" fill="none" strokeWidth="2.5" className="stroke-black/15" />
              <circle
                cx="12"
                cy="12"
                r="9"
                fill="none"
                strokeWidth="2.5"
                strokeDasharray="14 43"
                strokeLinecap="round"
                className="stroke-current"
              />
            </svg>
          </span>
        </motion.button>
      </div>

      <span aria-live="polite" className="sr-only">
        {busy && `${confirmingLabel}…`}
        {done && doneLabel}
      </span>
    </div>
  );
}
