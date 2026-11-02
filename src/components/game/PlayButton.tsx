import { useMemo } from "react";
import { motion } from "motion/react";
import { Loader2, Play } from "lucide-react";
import { cn } from "@/lib/cn";
import { toGameRef } from "@/lib/launch";
import { useMotionPrefs } from "@/lib/motion";
import type { GameRef } from "@/lib/types";
import { ActionSwap, type ActionSwapState } from "@/components/ui/ActionSwap";
import { useLaunch } from "@/store/launch";

export interface PlayButtonProps {
  game: GameRef;
  /** `icon` is a round icon-only button for cards and strips. */
  size?: "icon" | "sm" | "md" | "lg";
  className?: string;
  /** Overrides the default public-experience launch (e.g. to launch a private server via `useLaunch().launchPrivate`). Return the launch promise to show the working phase until hand-off. */
  onPlay?: () => void | PromiseLike<unknown>;
  label?: string;
}

const ICON_SIZE = "size-10 rounded-[12px]";

/**
 * Play button. It always looks the same (play icon + label); launch progress and errors are shown
 * by the status island and toasts. While a launch is in flight further clicks are ignored.
 * Labelled sizes are an `ActionSwap` driven by the launch store; `icon` stays a plain round button.
 */
export function PlayButton({ game, size = "md", className, onPlay, label = "Play" }: PlayButtonProps) {
  const m = useMotionPrefs();
  const phase = useLaunch((s) => s.state.phase);
  const launch = useLaunch((s) => s.launch);
  const busy = phase !== "idle";
  const play = () => (onPlay ? onPlay() : launch(toGameRef(game)));
  const states = useMemo<ActionSwapState[]>(
    () => [
      { id: "play", label, icon: <Play size={16} fill="currentColor" strokeWidth={1.75} />, tone: "accent" },
      { id: "launching", label: "Launching", icon: <Loader2 size={16} strokeWidth={1.75} className="animate-spin" />, tone: "accent", pendingLabel: "Launching" },
    ],
    [label],
  );

  if (size === "icon") {
    return (
      <motion.button
        type="button"
        aria-label={`${label} ${game.name}`}
        onClick={(e) => {
          e.stopPropagation();
          if (busy) return;
          void play();
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        whileHover={m.full ? { scale: 1.03 } : undefined}
        whileTap={{ scale: 0.96 }}
        className={cn(
          "focus-ring relative inline-flex shrink-0 cursor-pointer items-center justify-center overflow-hidden bg-accent font-semibold whitespace-nowrap text-white transition-[filter] select-none hover:brightness-110",
          ICON_SIZE,
          className,
        )}
      >
        <Play size={18} fill="currentColor" strokeWidth={1.75} />
      </motion.button>
    );
  }

  // The wrapper keeps clicks from reaching a clickable parent card and carries the caller's layout classes.
  return (
    <span
      className={cn("relative inline-flex shrink-0 [&>button]:flex-1", className)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <ActionSwap
        size={size}
        states={states}
        value={phase === "launching" ? "launching" : "play"}
        onAction={(next) => {
          // Presses while a launch is in flight (or showing its error) are ignored; the store owns the state.
          if (busy || next.id !== "launching") return;
          return play();
        }}
      />
    </span>
  );
}
