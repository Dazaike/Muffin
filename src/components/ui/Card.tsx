import { motion, type HTMLMotionProps } from "motion/react";
import { cn } from "@/lib/cn";
import { useMotionPrefs } from "@/lib/motion";

export interface CardProps extends HTMLMotionProps<"div"> {
  /** Disable the hover lift (e.g. for non-interactive panels). */
  flat?: boolean;
}

/** Base interactive surface: lifts on hover with a spring. */
export function Card({ flat, className, children, ...rest }: CardProps) {
  const m = useMotionPrefs();
  return (
    <motion.div
      whileHover={flat || !m.full ? undefined : { y: -4, scale: 1.02 }}
      transition={m.spring}
      className={cn("surface rounded-card", className)}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
