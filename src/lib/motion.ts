import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { useSpring, type Transition, type Variants } from "motion/react";
import { useSettings } from "@/store/settings";
import { formatCompact } from "./format";

export const spring: Transition = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 };
export const springSoft: Transition = { type: "spring", stiffness: 260, damping: 28 };
export const fast: Transition = { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] };
export const stagger = (i: number): Transition => ({ delay: Math.min(i, 6) * 0.015 });

export const pageVariants: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.26, ease: [0.2, 0.8, 0.2, 1] } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.16 } },
};

export interface MotionPrefs {
  /** Springs, stagger. */
  full: boolean;
  reduced: boolean;
  off: boolean;
  spring: Transition;
  springSoft: Transition;
  fast: Transition;
  stagger: (i: number) => Transition;
  pageVariants: Variants;
}

/** Motion settings resolved from the settings store. Components should use this rather than the raw constants. */
export function useMotionPrefs(): MotionPrefs {
  const intensity = useSettings((s) => s.values.animationIntensity);
  const reduceMotion = useSettings((s) => s.values.reduceMotion);
  return useMemo<MotionPrefs>(() => {
    const off = intensity === "off";
    const reduced = intensity === "reduced" || reduceMotion;
    const full = !off && !reduced;
    const flat: Transition = { duration: off ? 0 : 0.12 };
    return {
      full,
      reduced,
      off,
      spring: full ? spring : flat,
      springSoft: full ? springSoft : flat,
      fast: off ? { duration: 0 } : full ? fast : flat,
      stagger: full ? stagger : () => ({ delay: 0 }),
      pageVariants: full
        ? pageVariants
        : {
            initial: { opacity: 0 },
            animate: { opacity: 1, transition: flat },
            exit: { opacity: 0, transition: flat },
          },
    };
  }, [intensity, reduceMotion]);
}

/**
 * Animates a number by writing straight to a text node (no React re-renders).
 * Attach the returned ref to an empty element; it is filled on mount.
 */
export function useAnimatedNumber(
  value: number,
  format: (n: number) => string = formatCompact,
): RefObject<HTMLSpanElement | null> {
  const ref = useRef<HTMLSpanElement | null>(null);
  const off = useSettings((s) => s.values.animationIntensity === "off" || s.values.reduceMotion);
  const mv = useSpring(value, { stiffness: 140, damping: 24, mass: 0.9 });
  const fmt = useRef(format);
  fmt.current = format;
  const first = useRef(true);

  useLayoutEffect(() => {
    if (ref.current) ref.current.textContent = fmt.current(Math.round(mv.get()));
  }, [mv]);

  useEffect(() => {
    return mv.on("change", (v) => {
      if (ref.current) ref.current.textContent = fmt.current(Math.round(v));
    });
  }, [mv]);

  useEffect(() => {
    if (first.current || off) {
      first.current = false;
      mv.jump(value);
      if (ref.current) ref.current.textContent = fmt.current(Math.round(value));
      return;
    }
    mv.set(value);
  }, [value, off, mv]);

  return ref;
}
