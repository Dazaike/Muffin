import { BadgeCheck, ExternalLink, Ticket } from "lucide-react";
import { ViewToggle } from "@/components/lists/ViewToggle";
import { Button } from "@/components/ui/Button";
import { EmptyState, StateSwitch } from "@/components/ui/StateSwitch";
import { SmartImage } from "@/components/ui/SmartImage";
import type { GamePass } from "@/lib/gameExtras";
import { useGamePasses } from "@/lib/roblox";
import { useSettings } from "@/store/settings";
import { openLink } from "./links";
import { flatItems, ListSkeleton, LoadMore } from "./QueryParts";

function priceLabel(p: GamePass): string {
  if (!p.forSale) return "Off sale";
  if (p.price === null) return "No price";
  return p.price === 0 ? "Free" : `${p.price.toLocaleString()} Robux`;
}

function PassCard({ pass }: { pass: GamePass }) {
  return (
    <li className="flex gap-3 rounded-card bg-white/4 p-3">
      <SmartImage fade={false} src={pass.iconUrl} name={pass.name} className="size-16 shrink-0 rounded-[12px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{pass.name}</span>
          {pass.owned && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
              <BadgeCheck size={12} strokeWidth={2} />
              Owned
            </span>
          )}
        </div>
        {pass.description && <p className="line-clamp-2 text-xs text-muted">{pass.description}</p>}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <span className={pass.forSale || pass.owned ? "text-sm font-semibold tabular-nums" : "text-sm text-muted"}>
            {pass.owned && !pass.forSale ? "Owned" : priceLabel(pass)}
          </span>
          <Button
            size="sm"
            variant="ghost"
            icon={<ExternalLink size={14} strokeWidth={1.75} />}
            onClick={() => openLink(`https://www.roblox.com/game-pass/${pass.id}`)}
            aria-label={`View ${pass.name} on Roblox`}
          >
            View on Roblox
          </Button>
        </div>
      </div>
    </li>
  );
}

/** Game passes of the universe — view only. Purchasing happens on roblox.com, never in Muffin. */
export function PassesTab({ universeId }: { universeId: number }) {
  const query = useGamePasses(universeId, true);
  const view = useSettings((s) => s.values.passesView);
  const setSetting = useSettings((s) => s.set);
  const passes = flatItems(query.data);
  return (
    <StateSwitch
      animated={false}
      loading={query.isPending}
      error={query.isError && !query.data ? query.error : null}
      onRetry={() => void query.refetch()}
      isEmpty={passes.length === 0}
      skeleton={<ListSkeleton rows={4} height="h-[96px]" />}
      empty={
        <EmptyState
          icon={<Ticket size={22} strokeWidth={1.75} />}
          title="No game passes"
          hint="This experience doesn't sell any game passes."
        />
      }
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">View only — passes are bought on roblox.com.</p>
        <ViewToggle animated={false} value={view} onChange={(v) => void setSetting("passesView", v)} />
      </div>
      <ul className={view === "grid" ? "grid gap-2 md:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]" : "flex flex-col gap-2"}>
        {passes.map((p) => (
          <PassCard key={p.id} pass={p} />
        ))}
      </ul>
      <LoadMore query={query} />
    </StateSwitch>
  );
}
