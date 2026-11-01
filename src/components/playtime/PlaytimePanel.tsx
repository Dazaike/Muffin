import { useState } from "react";
import { motion } from "motion/react";
import { Clock3 } from "lucide-react";
import { RowsSkeleton } from "@/components/lists/GameGrid";
import { ViewToggle } from "@/components/lists/ViewToggle";
import { Segmented } from "@/components/ui/Controls";
import { SmartImage } from "@/components/ui/SmartImage";
import { EmptyState, StateSwitch } from "@/components/ui/StateSwitch";
import type { PlaytimeRange } from "@/lib/dataTypes";
import { formatDuration, relativeTime } from "@/lib/format";
import { useMotionPrefs } from "@/lib/motion";
import { usePlayerState, usePlaytimeSessions, usePlaytimeSummary } from "@/lib/playtime";
import { useSettings } from "@/store/settings";

const RANGES = [
  { value: "today", label: "Today" },
  { value: "week", label: "7 days" },
  { value: "all", label: "All time" },
] as const;

const EMPTY_HINT: Record<PlaytimeRange, string> = {
  today: "Nothing tracked today.",
  week: "Nothing tracked in the last 7 days.",
  all: "Launch a game from Muffin and keep Muffin running while you play.",
};

export function PlaytimePanel() {
  const [range, setRange] = useState<PlaytimeRange>("week");
  const m = useMotionPrefs();
  const player = usePlayerState();
  const view = useSettings((s) => s.values.playtimeView);
  const setSetting = useSettings((s) => s.set);
  const summary = usePlaytimeSummary(range);
  const sessions = usePlaytimeSessions(50);
  const data = summary.data;
  const max = data?.games.reduce((n, g) => Math.max(n, g.totalMs), 0) ?? 0;
  const nowPlaying = player.running ? data?.games.find((g) => g.placeId === player.placeId) ?? sessions.data?.find((s) => s.endedAt === null) : undefined;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented options={[...RANGES]} value={range} onChange={setRange} />
        <div className="flex flex-wrap items-center gap-3">
          {player.running && (
            <span className="inline-flex items-center gap-2 rounded-full bg-white/6 px-3 py-1.5 text-[13px]">
              <span aria-hidden className="size-2 rounded-full bg-emerald-400" />
              Roblox is running{nowPlaying ? ` · ${nowPlaying.name}` : ""}
            </span>
          )}
          <ViewToggle value={view} onChange={(v) => void setSetting("playtimeView", v)} />
        </div>
      </div>

      <StateSwitch
        loading={summary.isPending}
        error={summary.error}
        onRetry={() => void summary.refetch()}
        isEmpty={!data || data.games.length === 0}
        skeleton={<RowsSkeleton count={4} />}
        empty={<EmptyState icon={<Clock3 size={22} strokeWidth={1.75} />} title="No playtime yet" hint={EMPTY_HINT[range]} />}
      >
        {data && (
          <div className="flex flex-col gap-8">
            <div className="grid grid-cols-2 gap-3">
              <div className="surface rounded-card px-4 py-3.5">
                <div className="text-[11px] font-medium tracking-wide text-muted uppercase">Time played</div>
                <div className="mt-1 text-2xl font-semibold">{formatDuration(data.totalMs)}</div>
              </div>
              <div className="surface rounded-card px-4 py-3.5">
                <div className="text-[11px] font-medium tracking-wide text-muted uppercase">Sessions</div>
                <div className="mt-1 text-2xl font-semibold">{data.sessionCount.toLocaleString()}</div>
              </div>
            </div>

            <section aria-label="Time per game">
              <h2 className="mb-3 text-sm font-medium text-muted">By game</h2>
              <ul className={view === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3" : "flex flex-col gap-2"}>
                {data.games.map((g, i) => {
                  const bar = (
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                      <motion.div
                        className="accent-gradient h-full origin-left rounded-full"
                        style={{ width: `${max > 0 ? Math.max(2, (g.totalMs / max) * 100) : 0}%` }}
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: 1 }}
                        transition={{ ...m.spring, ...m.stagger(i) }}
                      />
                    </div>
                  );
                  const meta = (
                    <div className="text-xs text-muted">
                      {g.sessions} {g.sessions === 1 ? "session" : "sessions"} · last {relativeTime(g.lastPlayedAt)}
                    </div>
                  );
                  return view === "grid" ? (
                    <li key={g.placeId} className="surface flex flex-col gap-3 rounded-card p-3">
                      <div className="flex items-center gap-3">
                        <SmartImage src={g.iconUrl} name={g.name} className="size-14 shrink-0 rounded-[12px]" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{g.name}</div>
                          <div className="text-lg font-semibold tabular-nums">{formatDuration(g.totalMs)}</div>
                        </div>
                      </div>
                      {bar}
                      {meta}
                    </li>
                  ) : (
                    <li key={g.placeId} className="surface flex items-center gap-4 rounded-card p-3">
                      <SmartImage src={g.iconUrl} name={g.name} className="size-12 shrink-0 rounded-[12px]" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="truncate text-sm font-medium">{g.name}</span>
                          <span className="shrink-0 text-sm tabular-nums">{formatDuration(g.totalMs)}</span>
                        </div>
                        <div className="mt-2">{bar}</div>
                        <div className="mt-1.5">{meta}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        )}
      </StateSwitch>

      {sessions.data && sessions.data.length > 0 && (
        <section aria-label="Recent sessions">
          <h2 className="mb-3 text-sm font-medium text-muted">Recent sessions</h2>
          <ul
            className={
              view === "grid"
                ? "grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-3"
                : "surface divide-y divide-white/6 rounded-panel"
            }
          >
            {sessions.data.map((s) => {
              const when = new Date(s.startedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
              const dur =
                s.endedAt === null ? <span className="text-emerald-400">Playing now · {formatDuration(s.durationMs)}</span> : formatDuration(s.durationMs);
              return view === "grid" ? (
                <li key={s.id} className="surface flex flex-col gap-1 rounded-card px-4 py-3 text-sm">
                  <div className="truncate font-medium">{s.name}</div>
                  <div className="text-xs text-muted">{when}</div>
                  <div className="mt-1 tabular-nums">{dur}</div>
                </li>
              ) : (
                <li key={s.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{s.name}</div>
                    <div className="text-xs text-muted">{when}</div>
                  </div>
                  <span className="shrink-0 tabular-nums">{dur}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <p className="text-xs text-muted">
        Playtime is estimated: when Muffin sees the Roblox player start shortly after you launch a game from Muffin, that
        session is credited to that game. It only counts while Muffin is running, and games started outside Muffin aren&apos;t
        tracked.
      </p>
    </div>
  );
}
