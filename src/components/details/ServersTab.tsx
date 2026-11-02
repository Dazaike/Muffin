import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Gauge, LoaderCircle, LogIn, RefreshCw, Server, Wifi } from "lucide-react";
import { ActionSwap, type ActionSwapState } from "@/components/ui/ActionSwap";
import { Button } from "@/components/ui/Button";
import { EmptyState, StateSwitch } from "@/components/ui/StateSwitch";
import { SortSelect } from "@/components/lists/SortSelect";
import { ViewToggle, type ViewMode } from "@/components/lists/ViewToggle";
import { cn } from "@/lib/cn";
import { viewServers, type ServerSort } from "@/lib/gameFilters";
import type { PublicServer } from "@/lib/gameExtras";
import { usePublicServers } from "@/lib/roblox";
import type { GameRef } from "@/lib/types";
import { useLaunch } from "@/store/launch";
import { useSettings } from "@/store/settings";
import { flatItems, ListSkeleton, LoadMore } from "./QueryParts";

const SORTS = [
  { value: "default" as const, label: "Roblox order" },
  { value: "ping" as const, label: "Lowest ping" },
  { value: "players" as const, label: "Most players" },
];

// `pendingLabel` sits on the state the press moves into; `busy` (this server is the one launching) also selects "opening".
const JOIN_STATES: ActionSwapState[] = [
  { id: "join", label: "Join", icon: <LogIn size={16} strokeWidth={1.75} />, tone: "accent" },
  { id: "opening", label: "Opening", icon: <LoaderCircle size={16} strokeWidth={2} className="animate-spin" />, tone: "accent", pendingLabel: "Opening" },
];
const FULL_STATES: ActionSwapState[] = [{ id: "full", label: "Full", icon: <LogIn size={16} strokeWidth={1.75} />, tone: "quiet" }];

function FillBar({ playing, max }: { playing: number; max: number }) {
  const ratio = max > 0 ? Math.min(1, playing / max) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8" role="presentation">
      <div
        className={cn("h-full rounded-full", ratio >= 1 ? "bg-danger/80" : "accent-gradient")}
        style={{ width: `${Math.round(ratio * 100)}%` }}
      />
    </div>
  );
}

function ServerRow({
  server,
  busy,
  locked,
  onJoin,
  view,
}: {
  server: PublicServer;
  busy: boolean;
  locked: boolean;
  onJoin: () => PromiseLike<unknown>;
  view: ViewMode;
}) {
  const full = server.playing >= server.maxPlayers;
  const joinButton = (
    <ActionSwap
      size="sm"
      states={full ? FULL_STATES : JOIN_STATES}
      value={full ? "full" : busy ? "opening" : "join"}
      disabled={full || (locked && !busy)}
      title={full ? "Server is full" : "Join this server"}
      onAction={(next) => {
        if (locked || next.id !== "opening") return;
        return onJoin();
      }}
    />
  );
  const stats = (
    <>
      {server.ping !== undefined && (
        <span className="inline-flex items-center gap-1" title="Ping reported by the server list">
          <Wifi size={13} strokeWidth={1.75} />
          {Math.round(server.ping)} ms
        </span>
      )}
      {server.fps !== undefined && (
        <span className="inline-flex items-center gap-1" title="Server frame rate">
          <Gauge size={13} strokeWidth={1.75} />
          {Math.round(server.fps)} fps
        </span>
      )}
    </>
  );
  const players = (
    <span className="font-medium tabular-nums">
      {server.playing} <span className="text-muted">/ {server.maxPlayers} players</span>
    </span>
  );

  if (view === "grid") {
    return (
      <li className="flex flex-col gap-3 rounded-[12px] bg-white/4 p-3.5">
        <div className="text-sm">{players}</div>
        <FillBar playing={server.playing} max={server.maxPlayers} />
        <div className="flex min-h-5 items-center gap-3 text-xs text-muted tabular-nums">{stats}</div>
        <div className="mt-auto">{joinButton}</div>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-4 rounded-[12px] bg-white/4 p-3 pl-4">
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
          {players}
          <span className="flex items-center gap-3 text-xs text-muted tabular-nums">{stats}</span>
        </div>
        <FillBar playing={server.playing} max={server.maxPlayers} />
      </div>
      {joinButton}
    </li>
  );
}

/** Public server browser. Mounted lazily by the Servers tab; Roblox lists no region, so none is shown. */
export function ServersTab({ game }: { game: GameRef }) {
  const qc = useQueryClient();
  const query = usePublicServers(game.placeId, true);
  const phase = useLaunch((s) => s.state.phase);
  const launchInstance = useLaunch((s) => s.launchInstance);
  const [hideFull, setHideFull] = useState(false);
  const [sort, setSort] = useState<ServerSort>("default");
  const view = useSettings((s) => s.values.serversView);
  const setSetting = useSettings((s) => s.set);
  const [joining, setJoining] = useState<string | null>(null);

  useEffect(() => {
    if (phase === "idle") setJoining(null);
  }, [phase]);

  const all = flatItems(query.data);
  const servers = useMemo(() => viewServers(all, hideFull, sort), [all, hideFull, sort]);

  // Reset (not refetch) so a refresh re-requests only the first page, which Roblox rate-limits tightly.
  const refresh = () => void qc.resetQueries({ queryKey: ["servers", game.placeId] });
  const refreshing = query.isFetching && !query.isFetchingNextPage;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <SortSelect options={SORTS} value={sort} onChange={setSort} />
        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[12px] px-3 text-sm select-none hover:bg-white/6">
          <input
            type="checkbox"
            checked={hideFull}
            onChange={(e) => setHideFull(e.target.checked)}
            className="size-4 accent-[var(--accent)]"
          />
          Hide full servers
        </label>
        <div className="ml-auto flex items-center gap-2">
          <ViewToggle animated={false} value={view} onChange={(v) => void setSetting("serversView", v)} />
          <Button
            size="md"
            variant="glass"
            disabled={refreshing}
            onClick={refresh}
            icon={<RefreshCw size={15} strokeWidth={1.75} className={refreshing ? "spin" : undefined} />}
          >
            Refresh
          </Button>
        </div>
      </div>

      <StateSwitch
        animated={false}
        loading={query.isPending}
        error={query.isError && !query.data ? query.error : null}
        onRetry={refresh}
        isEmpty={servers.length === 0}
        skeleton={<ListSkeleton rows={5} height="h-[60px]" />}
        empty={
          <EmptyState
            icon={<Server size={22} strokeWidth={1.75} />}
            title={all.length === 0 ? "No public servers right now" : "No servers match"}
            hint={
              all.length === 0
                ? "This experience has no running public servers (or Roblox didn't list any)."
                : "Every loaded server is full. Turn off “Hide full servers” or load more."
            }
          />
        }
      >
        <ul className={view === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2" : "flex flex-col gap-2"}>
          {servers.map((s) => (
            <ServerRow
              key={s.id}
              server={s}
              view={view}
              busy={joining === s.id && phase !== "idle"}
              locked={phase !== "idle"}
              onJoin={() => {
                setJoining(s.id);
                return launchInstance(s.id, game);
              }}
            />
          ))}
        </ul>
        <LoadMore query={query} />
        <p className="mt-3 text-xs text-muted">
          Servers are listed by Roblox and change quickly; a server can fill up before Roblox opens. Joining hands off to
          Roblox — it doesn't mean you're connected.
        </p>
      </StateSwitch>
    </div>
  );
}
