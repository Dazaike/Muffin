import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Compass } from "lucide-react";
import { EmptyState, StateSwitch } from "@/components/ui/StateSwitch";
import { GameGrid, GridSkeleton, RowsSkeleton } from "@/components/lists/GameGrid";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { ResultFilterBar } from "@/components/lists/ResultFilterBar";
import { ViewToggle } from "@/components/lists/ViewToggle";
import { applyResultFilters, isFiltering, NO_FILTERS, type ResultFilters } from "@/lib/gameFilters";
import { useSortGames, useSorts } from "@/lib/roblox";
import { useSettings } from "@/store/settings";

const ALL = "__all__";

export default function Discover() {
  const sorts = useSorts();
  // Home's "View All" links here with ?sort=<sort id>.
  const [params] = useSearchParams();
  const [sortId, setSortId] = useState<string | undefined>(params.get("sort") ?? undefined);
  const [genre, setGenre] = useState(ALL);
  const [filters, setFilters] = useState<ResultFilters>(NO_FILTERS);
  const view = useSettings((s) => s.values.discoverView);
  const cards = useSettings((s) => s.values.discoverCards);
  const setSetting = useSettings((s) => s.set);

  const activeSort = sorts.data?.find((s) => s.id === sortId)?.id ?? sorts.data?.[0]?.id;
  const games = useSortGames(activeSort);
  const all = games.data;

  // Genre pills are derived from the games actually loaded for this sort.
  const genres = useMemo<TabItem[]>(() => {
    const counts = new Map<string, number>();
    for (const g of all ?? []) if (g.genre) counts.set(g.genre, (counts.get(g.genre) ?? 0) + 1);
    const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return [{ id: ALL, label: "All", count: all?.length ?? 0 }, ...sorted.map(([name, count]) => ({ id: name, label: name, count }))];
  }, [all]);

  const activeGenre = genres.some((g) => g.id === genre) ? genre : ALL;
  const byGenre = useMemo(
    () => (activeGenre === ALL ? (all ?? []) : (all ?? []).filter((g) => g.genre === activeGenre)),
    [all, activeGenre],
  );
  const filtered = useMemo(() => applyResultFilters(byGenre, filters), [byGenre, filters]);

  const sortTabs = useMemo<TabItem[]>(() => (sorts.data ?? []).map((s) => ({ id: s.id, label: s.name })), [sorts.data]);

  const loading = sorts.isLoading || (!!activeSort && games.isLoading);
  const error = sorts.error ?? games.error;
  const retry = () => {
    if (sorts.error || !sorts.data) void sorts.refetch();
    if (activeSort) void games.refetch();
  };

  return (
    <Page>
      <PageHeader title="Discover" subtitle="Live from Roblox. Player counts refresh every minute." />

      {sortTabs.length > 0 && (
        <div className="flex flex-col gap-3 pb-5">
          <Tabs
            tabs={sortTabs}
            value={activeSort ?? ""}
            onChange={(id) => {
              setSortId(id);
              setGenre(ALL);
            }}
            className="flex-wrap"
          />
          {genres.length > 2 && <Tabs tabs={genres} value={activeGenre} onChange={setGenre} className="flex-wrap gap-y-1.5" />}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ResultFilterBar value={filters} onChange={setFilters} />
            <ViewToggle value={view} onChange={(v) => void setSetting("discoverView", v)} />
          </div>
        </div>
      )}

      <StateSwitch
        loading={loading}
        error={error}
        onRetry={retry}
        isEmpty={filtered.length === 0}
        skeleton={view === "list" ? <RowsSkeleton count={9} /> : <GridSkeleton count={cards === "horizontal" ? 12 : 18} cards={cards} />}
        empty={
          <EmptyState
            icon={<Compass size={22} strokeWidth={1.75} />}
            title="Nothing to show here"
            hint={
              isFiltering(filters) && byGenre.length > 0
                ? "Nothing in this list has that many players. Lower the player minimum or reset."
                : activeGenre === ALL
                  ? "Roblox returned no experiences for this list right now."
                  : `No ${activeGenre} experiences in this list.`
            }
          />
        }
      >
        <GameGrid items={filtered} alwaysVirtual view={view} cards={cards} />
      </StateSwitch>
    </Page>
  );
}
