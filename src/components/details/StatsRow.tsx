import type { ReactNode } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { formatCompact, formatDate, percent, relativeTime } from "@/lib/format";
import { useMaturity } from "@/lib/roblox";
import type { GameDetails } from "@/lib/types";

function Stat({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="surface rounded-card px-4 py-3.5" title={title}>
      <div className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-1 text-xl font-semibold">{children}</div>
    </div>
  );
}

const Num = ({ value }: { value: string }) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>;
const Pending = () => <span aria-hidden className="skeleton block h-6 w-16 rounded-md" />;
const Dash = () => <span className="text-muted">—</span>;
const full = (n: number) => n.toLocaleString("en-US");

/** A count that exists on the real details only: skeleton while the seed is showing, hidden when Roblox sent none. */
function Count({ value, loading }: { value: number | undefined; loading: boolean }) {
  if (value !== undefined) return <Num value={formatCompact(value)} />;
  return loading ? <Pending /> : <Dash />;
}

function DateStat({ iso, loading, relative }: { iso: string | undefined; loading: boolean; relative?: boolean }) {
  const date = formatDate(iso);
  if (!date) return loading ? <Pending /> : <Dash />;
  return (
    <span className="block">
      <span className="block text-lg">{date}</span>
      {relative && <span className="block text-xs font-normal text-muted">{relativeTime(Date.parse(iso as string))}</span>}
    </span>
  );
}

/** Like / dislike bar with both counts and the approval percent; hidden when Roblox reports no votes. */
export function RatingBar({ up, down }: { up: number; down: number }) {
  const rating = percent(up, down);
  if (rating === null) return null;
  return (
    <div className="surface flex flex-col gap-2.5 rounded-card px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums" title={`${full(up)} likes`}>
          <ThumbsUp size={15} strokeWidth={1.75} className="text-success" />
          {formatCompact(up)}
        </span>
        <span className="text-xl font-semibold tabular-nums">{rating}% liked</span>
        <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums" title={`${full(down)} dislikes`}>
          {formatCompact(down)}
          <ThumbsDown size={15} strokeWidth={1.75} className="text-danger" />
        </span>
      </div>
      <div
        className="flex h-2 overflow-hidden rounded-full bg-danger/70"
        role="img"
        aria-label={`${rating}% liked: ${full(up)} likes, ${full(down)} dislikes`}
      >
        <div className="h-full bg-success" style={{ width: `${(up / (up + down)) * 100}%` }} />
      </div>
    </div>
  );
}

/**
 * The stat tiles of roblox.com's game page: Active, Favorites, Visits, Server size, Created, Updated, Genre and
 * Maturity, plus the like/dislike bar. `loading` is true while only the seed (placeholder) data is available:
 * fields the seed can't provide show a skeleton instead of a misleading 0.
 */
export function StatsRow({ game, loading }: { game: GameDetails; loading: boolean }) {
  const maturity = useMaturity(game, !loading);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Active" title={game.playerCount !== undefined ? `${full(game.playerCount)} playing now` : undefined}>
          {game.playerCount !== undefined ? <Num value={formatCompact(game.playerCount)} /> : loading ? <Pending /> : <Dash />}
        </Stat>
        <Stat label="Favorites" title={game.favorites !== undefined ? full(game.favorites) : undefined}>
          <Count value={game.favorites} loading={loading} />
        </Stat>
        <Stat label="Visits" title={loading ? undefined : full(game.visits)}>
          {loading ? <Pending /> : <Num value={formatCompact(game.visits)} />}
        </Stat>
        <Stat label="Server size">
          {loading ? <Pending /> : game.maxPlayers > 0 ? <Num value={`${game.maxPlayers} players`} /> : <Dash />}
        </Stat>
        <Stat label="Created">
          <DateStat iso={game.created} loading={loading} />
        </Stat>
        <Stat label="Updated" title={game.updated}>
          <DateStat iso={game.updated} loading={loading} relative />
        </Stat>
        <Stat label="Genre">
          {game.genre ? (
            <span className="block">
              <span className="block truncate text-lg">{game.genre}</span>
              {game.genreL2 && <span className="block truncate text-xs font-normal text-muted">{game.genreL2}</span>}
            </span>
          ) : loading ? (
            <Pending />
          ) : (
            <Dash />
          )}
        </Stat>
        {maturity && (
          <Stat label="Maturity">
            <span className="block truncate text-lg">{maturity.replace(/^Maturity:\s*/i, "")}</span>
          </Stat>
        )}
      </div>
    </div>
  );
}
