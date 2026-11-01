import { useId, type ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { useMotionPrefs } from "@/lib/motion";

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  icon?: ReactNode;
  count?: number;
}

export interface TabsProps<T extends string = string> {
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** "pills": filled sliding pill. "underline": sliding underline. */
  variant?: "pills" | "underline";
  /** Whether the underline glides between tabs (default true); false jumps instantly. */
  animated?: boolean;
  className?: string;
}

/** Tabs with a shared-layout indicator that glides between selections. */
export function Tabs<T extends string = string>({ tabs, value, onChange, variant = "pills", animated = true, className }: TabsProps<T>) {
  const group = useId();
  const m = useMotionPrefs();
  return (
    <div role="tablist" className={cn("flex items-center gap-1", variant === "underline" && "border-b border-white/8", className)}>
      {tabs.map((t) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={cn(
              "focus-ring relative inline-flex cursor-pointer items-center gap-2 px-3.5 py-2 text-sm font-medium transition-colors",
              variant === "pills" ? "rounded-full" : "rounded-t-lg",
              active ? "text-white" : "text-muted hover:text-fg",
            )}
          >
            {active && variant === "pills" && (
              <motion.span
                layoutId={`tab-pill-${group}`}
                transition={m.spring}
                className="accent-gradient absolute inset-0 rounded-full"
                style={{ zIndex: 0 }}
              />
            )}
            {active && variant === "underline" && (
              <motion.span
                layoutId={animated ? `tab-underline-${group}` : undefined}
                transition={m.spring}
                className="accent-gradient absolute right-2 -bottom-px left-2 h-0.5 rounded-full"
              />
            )}
            <span className="relative z-10 flex items-center gap-2">
              {t.icon}
              {t.label}
              {t.count !== undefined && (
                <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", active ? "bg-white/25" : "bg-white/8")}>{t.count}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
