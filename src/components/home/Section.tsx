import type { ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { useMotionPrefs } from "@/lib/motion";
import { useNearViewport } from "@/lib/useProgressive";

export interface SectionProps {
  /** Position on the page; drives the staggered entrance. */
  index: number;
  title: string;
  /** A small SVG shown in a tile before the title. */
  icon?: ReactNode;
  caption?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** Mount the body only once the section is near the viewport (below-the-fold carousels). */
  defer?: boolean;
  children?: ReactNode;
}

/** Titled Home section with a staggered rise-in. */
export function Section({ index, title, icon, caption, actions, className, children, defer = false }: SectionProps) {
  const m = useMotionPrefs();
  const [ref, near] = useNearViewport<HTMLDivElement>(500, !defer);
  return (
    <motion.section
      aria-label={title}
      initial={{ opacity: 0, y: m.full ? 16 : 0 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...m.springSoft, ...m.stagger(index) }}
      className={cn("mt-9", className)}
    >
      <div className="mb-3.5 flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {icon && (
            <span className="flex shrink-0 text-fg [&>svg]:size-6">{icon}</span>
          )}
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold tracking-tight">{title}</h2>
            {caption && <div className="mt-0.5 text-[13px] text-muted">{caption}</div>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {defer && !near ? <div ref={ref} className="h-[260px]" aria-hidden /> : children}
    </motion.section>
  );
}
