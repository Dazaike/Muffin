import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Award, BadgeCheck } from "lucide-react";
import { EmptyState, StateSwitch } from "@/components/ui/StateSwitch";
import { SmartImage } from "@/components/ui/SmartImage";
import { SortSelect } from "@/components/lists/SortSelect";
import { ViewToggle, type ViewMode } from "@/components/lists/ViewToggle";
import { formatCompact, formatDate } from "@/lib/format";
import type { Badge } from "@/lib/gameExtras";
import { ipc } from "@/lib/ipc";
import { useUniverseBadges } from "@/lib/roblox";
import type { AppError } from "@/lib/types";
import { flatItems, ListSkeleton, LoadMore, SignInNote } from "./QueryParts";
import { useWebSessionUserId } from "./session";
import { useSettings } from "@/store/settings";

type BadgeSort = "default" | "rarest" | "awarded";

const SORTS = [
  { value: "default" as const, label: "Roblox order" },
  { value: "rarest" as const, label: "Rarest first" },
  { value: "awarded" as const, label: "Most awarded" },
];

const CHUNK = 100;

function sortBadges(list: Badge[], sort: BadgeSort): Badge[] {
  if (sort === "rarest") return [...list].sort((a, b) => a.winRate - b.winRate);
  if (sort === "awarded") return [...list].sort((a, b) => b.awardedCount - a.awardedCount);
  return list;
}

/** "0.3%" style rarity: more precision for very rare badges. */
function rate(winRate: number): string {
  if (winRate <= 0) return "<0.01%";
  return `${winRate < 1 ? winRate.toFixed(2) : winRate.toFixed(1)}%`;
}

function BadgeRow({
  badge,
  earned,
  earnedDate,
  view,
}: {
  badge: Badge;
  earned: boolean | null;
  earnedDate: string | null;
  view: ViewMode;
}) {
  const date = formatDate(earnedDate);
  const earnedChip = earned && (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
      <BadgeCheck size={12} strokeWidth={2} />
      {date ? `Earned ${date}` : "Earned"}
    </span>
  );
  const stats = (
    <>
      <div>
        <dt className="text-muted">Rarity</dt>
        <dd className="font-medium">{rate(badge.winRate)}</dd>
      </div>
      <div>
        <dt className="text-muted">Won yesterday</dt>
        <dd className="font-medium">{formatCompact(badge.pastDayAwarded)}</dd>
      </div>
      <div>
        <dt className="text-muted">Won ever</dt>
        <dd className="font-medium">{formatCompact(badge.awardedCount)}</dd>
      </div>
    </>
  );

  if (view === "grid") {
    return (
      <li className="flex flex-col gap-3 rounded-[12px] bg-white/4 p-3">
        <div className="flex items-start justify-between gap-2">
          <SmartImage fade={false} src={badge.iconUrl} name={badge.name} className="size-16 shrink-0 rounded-[12px]" />
          {earnedChip}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold" title={badge.name}>
            {badge.name}
          </div>
          {badge.description && <p className="text-xs text-muted">{badge.description}</p>}
        </div>
        <dl className="mt-auto grid grid-cols-3 gap-x-4 text-xs tabular-nums">{stats}</dl>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 rounded-[12px] bg-white/4 p-3">
      <SmartImage fade={false} src={badge.iconUrl} name={badge.name} className="size-14 shrink-0 rounded-[12px]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{badge.name}</span>
          {earnedChip}
        </div>
        {badge.description && <p className="text-xs text-muted">{badge.description}</p>}
      </div>
      <dl className="grid shrink-0 grid-cols-3 gap-x-5 text-right text-xs tabular-nums">{stats}</dl>
    </li>
  );
}

/** Badges of the universe; when signed in, marks the ones the user has earned. */
export function BadgesTab({ universeId }: { universeId: number }) {
  const query = useUniverseBadges(universeId, true);
  const userId = useWebSessionUserId();
  const [sort, setSort] = useState<BadgeSort>("default");
  const view = useSettings((s) => s.values.badgesView);
  const setSetting = useSettings((s) => s.set);

  const badges = flatItems(query.data);
  const ids = useMemo(() => badges.map((b) => b.id), [badges]);

  // badgeId → ISO award date (null when Roblox sent none) for the badges the signed-in user earned.
  const awarded = useQuery<Map<number, string | null>, AppError>({
    queryKey: ["badgesAwarded", userId, ids.join(",")],
    enabled: userId !== null && ids.length > 0,
    staleTime: 60_000,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const out = new Map<number, string | null>();
      for (let i = 0; i < ids.length; i += CHUNK) {
        for (const a of await ipc.badgesAwarded(ids.slice(i, i + CHUNK))) out.set(a.badgeId, a.awardedDate);
      }
      return out;
    },
  });

  const shown = useMemo(() => sortBadges(badges, sort), [badges, sort]);
  const earnedMap = userId !== null ? awarded.data : undefined;
  const earnedCount = earnedMap ? badges.filter((b) => earnedMap.has(b.id)).length : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <SortSelect options={SORTS} value={sort} onChange={setSort} />
        {earnedCount !== null && (
          <span className="text-sm text-muted tabular-nums">
            You've earned {earnedCount} of {badges.length}
            {query.hasNextPage ? "+" : ""} loaded
          </span>
        )}
        <div className="ml-auto">
          <ViewToggle animated={false} value={view} onChange={(v) => void setSetting("badgesView", v)} />
        </div>
      </div>

      {userId === null && badges.length > 0 && <SignInNote>Sign in to see which badges you've earned.</SignInNote>}
      {awarded.isError && (
        <p className="text-sm text-muted">Couldn't check your earned badges: {awarded.error.message}</p>
      )}

      <StateSwitch
        animated={false}
        loading={query.isPending}
        error={query.isError && !query.data ? query.error : null}
        onRetry={() => void query.refetch()}
        isEmpty={badges.length === 0}
        skeleton={<ListSkeleton rows={5} height="h-[86px]" />}
        empty={
          <EmptyState
            icon={<Award size={22} strokeWidth={1.75} />}
            title="No badges"
            hint="This experience doesn't offer any badges."
          />
        }
      >
        <ul className={view === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-2" : "flex flex-col gap-2"}>
          {shown.map((b) => (
            <BadgeRow
              key={b.id}
              badge={b}
              earned={earnedMap ? earnedMap.has(b.id) : null}
              earnedDate={earnedMap?.get(b.id) ?? null}
              view={view}
            />
          ))}
        </ul>
        <LoadMore query={query} />
      </StateSwitch>
    </div>
  );
}
