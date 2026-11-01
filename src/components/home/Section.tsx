import type { ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { useMotionPrefs } from "@/lib/motion";

export interface SectionProps {
  /** Position on the page; drives the staggered entrance. */
  index: number;
  title: string;
  caption?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/** Titled Home section with a staggered rise-in. */
export function Section({ index, title, caption, actions, className, children }: SectionProps) {
  const m = useMotionPrefs();
  return (
    <motion.section
      aria-label={title}
      initial={{ opacity: 0, y: m.full ? 16 : 0 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...m.springSoft, ...m.stagger(index) }}
      className={cn("mt-9", className)}
    >
      <div className="mb-3.5 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-tight">{title}</h2>
          {caption && <div className="mt-0.5 text-[13px] text-muted">{caption}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </motion.section>
  );
}
