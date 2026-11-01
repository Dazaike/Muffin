import { AnimatePresence, motion } from "motion/react";
import { LoaderCircle, Play, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { toGameRef } from "@/lib/launch";
import { useMotionPrefs } from "@/lib/motion";
import type { GameRef } from "@/lib/types";
import { useLaunch } from "@/store/launch";

export interface PlayButtonProps {
  game: GameRef;
  /** `icon` is a round icon-only button for cards and strips. */
  size?: "icon" | "sm" | "md" | "lg";
  className?: string;
  /** Overrides the default public-experience launch (e.g. to launch a private server via `useLaunch().launchPrivate`). */
  onPlay?: () => void;
  label?: string;
}

const SIZE: Record<NonNullable<PlayButtonProps["size"]>, string> = {
  icon: "size-10 rounded-[12px]",
  sm: "h-8 px-3.5 text-[13px] gap-1.5 rounded-[10px]",
  md: "h-10 px-5 text-sm gap-2 rounded-[12px]",
  lg: "h-13 px-8 text-base gap-2.5 rounded-[14px]",
};

/**
 * Play button driven by the launch phase machine. Only the button for the active place changes;
 * every other Play button is disabled while a launch is in flight.
 */
export function PlayButton({ game, size = "md", className, onPlay, label = "Play" }: PlayButtonProps) {
  const m = useMotionPrefs();
  const { phase, placeId } = useLaunch((s) => s.state);
  const launch = useLaunch((s) => s.launch);
  const mine = placeId === game.placeId && phase !== "idle";
  const shown = mine ? phase : "idle";
  const disabled = phase !== "idle";
  const iconOnly = size === "icon";

  const content = {
    idle: { icon: <Play size={iconOnly ? 18 : 16} fill="currentColor" strokeWidth={1.75} />, text: label },
    launching: { icon: <LoaderCircle size={16} strokeWidth={2} className="spin" />, text: "Opening Roblox…" },
    error: { icon: <TriangleAlert size={16} strokeWidth={2} />, text: "Couldn't launch" },
  }[shown];

  return (
    <motion.button
      layout
      type="button"
      disabled={disabled}
      aria-label={iconOnly ? `${label} ${game.name}` : undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        if (onPlay) onPlay();
        else void launch(toGameRef(game));
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      whileHover={disabled || !m.full ? undefined : { scale: 1.03 }}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      animate={shown === "error" && m.full ? { x: [0, -6, 6, -4, 4, 0] } : { x: 0 }}
      transition={{ layout: m.spring, x: { duration: 0.4 } }}
      className={cn(
        "focus-ring relative inline-flex shrink-0 cursor-pointer items-center justify-center overflow-hidden font-semibold whitespace-nowrap text-white select-none",
        shown === "error" ? "bg-danger" : "bg-accent",
        shown === "idle" && "transition-[filter] hover:brightness-110",
        disabled && !mine && "cursor-not-allowed opacity-45",
        mine && "cursor-default",
        SIZE[size],
        className,
      )}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={shown}
          layout="position"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={m.fast}
          className="inline-flex items-center gap-[inherit]"
        >
          {content.icon}
          {!iconOnly && <span>{content.text}</span>}
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}
