import { useMemo, useState } from "react";
import { History, Trash2 } from "lucide-react";
import { GameCard } from "@/components/game/GameCard";
import { GridSkeleton, RowsSkeleton } from "@/components/lists/GameGrid";
import { GameRowContent, ROW_CLASS } from "@/components/lists/GameRow";
import { useGridMetrics } from "@/components/lists/useGridMetrics";
import { ViewToggle } from "@/components/lists/ViewToggle";
import { PlaytimePanel } from "@/components/playtime/PlaytimePanel";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/Modal";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, StateSwitch } from "@/components/ui/StateSwitch";
import { Tabs } from "@/components/ui/Tabs";
import { dayBucket, relativeTime, type DayBucket } from "@/lib/format";
import type { HistoryEntry } from "@/lib/types";
import { useLibrary } from "@/store/library";
import { useSettings } from "@/store/settings";

const BUCKETS: DayBucket[] = ["Today", "Yesterday", "Earlier"];

type RecentTab = "history" | "playtime";

const TABS: { id: RecentTab; label: string }[] = [
  { id: "history", label: "History" },
  { id: "playtime", label: "Playtime" },
];

export default function Recent() {
  const history = useLibrary((s) => s.history);
  const hydrated = useLibrary((s) => s.hydrated);
  const clearHistory = useLibrary((s) => s.clearHistory);
  const [confirming, setConfirming] = useState(false);
  const [tab, setTab] = useState<RecentTab>("history");
  const view = useSettings((s) => s.values.recentView);
  const setSetting = useSettings((s) => s.set);
  const { minWidth, gap } = useGridMetrics();

  const totalLaunches = useMemo(() => history.reduce((n, h) => n + h.launchCount, 0), [history]);

  const groups = useMemo(() => {
    const now = Date.now();
    const out: Record<DayBucket, HistoryEntry[]> = { Today: [], Yesterday: [], Earlier: [] };
    for (const h of [...history].sort((a, b) => b.lastLaunchedAt - a.lastLaunchedAt)) out[dayBucket(h.lastLaunchedAt, now)].push(h);
    return BUCKETS.map((label) => ({ label, items: out[label] })).filter((g) => g.items.length > 0);
  }, [history]);

  const now = Date.now();
  let index = 0;

  return (
    <Page>
      <PageHeader
        title="Recently Played"
        subtitle={
          <>
            <AnimatedNumber value={history.length} format={String} /> {history.length === 1 ? "game" : "games"} ·{" "}
            <AnimatedNumber value={totalLaunches} format={String} /> {totalLaunches === 1 ? "launch" : "launches"} handed off to Roblox
          </>
        }
        actions={
          tab === "history" ? (
            <div className="flex items-center gap-2">
              <ViewToggle value={view} onChange={(v) => void setSetting("recentView", v)} />
              <Button
                variant="glass"
                icon={<Trash2 size={16} strokeWidth={1.75} />}
                disabled={history.length === 0}
                onClick={() => setConfirming(true)}
              >
                Clear history
              </Button>
            </div>
          ) : undefined
        }
      />

      <Tabs tabs={TABS} value={tab} onChange={setTab} className="mb-6" />

      {tab === "playtime" ? (
        <PlaytimePanel />
      ) : (
        <StateSwitch
          loading={!hydrated}
          isEmpty={groups.length === 0}
          skeleton={view === "grid" ? <GridSkeleton count={8} /> : <RowsSkeleton count={6} />}
          empty={
            <EmptyState
              icon={<History size={22} strokeWidth={1.75} />}
              title="Nothing played yet"
              hint="Games you launch from Muffin appear here."
            />
          }
        >
          <div className="flex flex-col gap-8">
            {groups.map((g) => (
              <section key={g.label} aria-label={g.label}>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted">
                  {g.label}
                  <span className="rounded-full bg-white/8 px-1.5 text-[11px] tabular-nums">{g.items.length}</span>
                </h2>
                {view === "grid" ? (
                  <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`, gap }}>
                    {g.items.map((h) => (
                      <GameCard
                        key={h.placeId}
                        game={h}
                        variant="poster"
                        index={index++}
                        subtitle={`${relativeTime(h.lastLaunchedAt, now)} · ${h.launchCount} ${h.launchCount === 1 ? "launch" : "launches"}`}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {g.items.map((h) => (
                      <div key={h.placeId} className={ROW_CLASS}>
                        <GameRowContent
                          game={h}
                          index={index++}
                          subtitle={`Launched ${relativeTime(h.lastLaunchedAt, now)} · ${h.launchCount} ${h.launchCount === 1 ? "launch" : "launches"}`}
                          trailing={h.genre ? <span className="max-w-32 truncate">{h.genre}</span> : undefined}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </StateSwitch>
      )}

      <ConfirmModal
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void clearHistory()}
        title="Clear play history?"
        message="This removes every entry from Recently Played, including launch counts. Your library, favorites and playtime aren't touched."
        confirmLabel="Clear history"
        danger
      />
    </Page>
  );
}
