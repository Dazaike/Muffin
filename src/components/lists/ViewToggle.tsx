import { useId } from "react";
import { motion } from "motion/react";
import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/cn";
import { useMotionPrefs } from "@/lib/motion";

export type ViewMode = "grid" | "list";

const OPTIONS: { value: ViewMode; label: string; icon: typeof List }[] = [
  { value: "grid", label: "Grid view", icon: LayoutGrid },
  { value: "list", label: "List view", icon: List },
];

/** Grid / list segmented icon toggle; the highlight glides between options unless `animated` is false. */
export function ViewToggle({ value, onChange, animated = true }: { value: ViewMode; onChange: (v: ViewMode) => void; animated?: boolean }) {
  const group = useId();
  const m = useMotionPrefs();
  return (
    <div role="radiogroup" aria-label="View" className="inline-flex h-10 items-center rounded-[12px] bg-white/6 p-1">
      {OPTIONS.map(({ value: v, label, icon: Icon }) => {
        const active = v === value;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            title={label}
            onClick={() => onChange(v)}
            className={cn(
              "focus-ring relative flex h-8 w-9 cursor-pointer items-center justify-center rounded-[9px] transition-colors",
              active ? "text-white" : "text-muted hover:text-fg",
            )}
          >
            {active && <motion.span layoutId={animated ? `view-${group}` : undefined} transition={m.spring} className="accent-gradient absolute inset-0 rounded-[9px]" />}
            <Icon size={17} strokeWidth={1.75} className="relative" />
          </button>
        );
      })}
    </div>
  );
}
