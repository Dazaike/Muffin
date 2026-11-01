import { Check, ChevronDown } from "lucide-react";
import { Menu } from "@/components/ui/Menu";

export interface SortOption<T extends string> {
  value: T;
  label: string;
}

/** Compact "Sort: X" dropdown built on Menu. */
export function SortSelect<T extends string>({
  options,
  value,
  onChange,
  label = "Sort",
}: {
  options: SortOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <Menu
      trigger={(props, open) => (
        <button
          type="button"
          {...props}
          aria-label={`${label}: ${current?.label ?? ""}`}
          className="focus-ring glass inline-flex h-10 cursor-pointer items-center gap-2 rounded-[12px] px-3.5 text-sm transition-colors hover:bg-white/10"
        >
          <span className="text-muted">{label}:</span>
          <span className="font-medium">{current?.label}</span>
          <ChevronDown size={15} strokeWidth={1.75} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
        </button>
      )}
      entries={options.map((o) => ({
        label: o.label,
        icon: o.value === value ? <Check size={16} strokeWidth={2} /> : undefined,
        onSelect: () => onChange(o.value),
      }))}
    />
  );
}
