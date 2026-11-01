import { Search } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Autocomplete dropdown that sits under a SearchField (position it inside a `relative` wrapper).
 * Mouse-down is swallowed so the input keeps focus while a suggestion is clicked.
 */
export function SuggestionList({
  suggestions,
  active,
  onPick,
}: {
  suggestions: string[];
  active: number;
  onPick: (s: string) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <ul
      role="listbox"
      aria-label="Search suggestions"
      className="glass absolute top-full right-0 left-0 z-20 mt-2 overflow-hidden rounded-[14px] p-1.5 shadow-[0_16px_40px_-12px_#000c]"
    >
      {suggestions.map((s, i) => (
        <li key={s} role="option" aria-selected={i === active}>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(s)}
            className={cn(
              "flex w-full cursor-pointer items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-sm transition-colors hover:bg-white/8",
              i === active && "bg-white/10",
            )}
          >
            <Search size={14} strokeWidth={1.75} className="shrink-0 text-muted" />
            <span className="truncate">{s}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
