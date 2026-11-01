import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatCompact } from "@/lib/format";
import { isFiltering, MIN_PLAYER_STEPS, NO_FILTERS, type ResultFilters, type ResultSort } from "@/lib/gameFilters";
import { SortSelect, type SortOption } from "./SortSelect";

const SORTS: SortOption<ResultSort>[] = [
  { value: "default", label: "Roblox order" },
  { value: "players", label: "Most players" },
  { value: "rating", label: "Best rated" },
];

const MIN_OPTIONS: SortOption<string>[] = MIN_PLAYER_STEPS.map((n) => ({
  value: String(n),
  label: n === 0 ? "Any" : `${formatCompact(n)}+`,
}));

/** Client-side sort and min-players filter over the games already loaded. */
export function ResultFilterBar({ value, onChange }: { value: ResultFilters; onChange: (f: ResultFilters) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SortSelect options={SORTS} value={value.sort} onChange={(sort) => onChange({ ...value, sort })} />
      <SortSelect
        label="Players"
        options={MIN_OPTIONS}
        value={String(value.minPlayers)}
        onChange={(v) => onChange({ ...value, minPlayers: Number(v) })}
      />
      {isFiltering(value) && (
        <Button variant="ghost" size="md" icon={<RotateCcw size={15} strokeWidth={1.75} />} onClick={() => onChange(NO_FILTERS)}>
          Reset
        </Button>
      )}
    </div>
  );
}
