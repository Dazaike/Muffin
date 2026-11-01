import { Map as MapIcon } from "lucide-react";
import { PlayButton } from "@/components/game/PlayButton";
import { ViewToggle, type ViewMode } from "@/components/lists/ViewToggle";
import { EmptyState, StateSwitch } from "@/components/ui/StateSwitch";
import { SmartImage } from "@/components/ui/SmartImage";
import type { SubPlace } from "@/lib/gameExtras";
import { useUniversePlaces } from "@/lib/roblox";
import type { GameRef } from "@/lib/types";
import { useSettings } from "@/store/settings";
import { flatItems, ListSkeleton, LoadMore } from "./QueryParts";

function PlaceRow({ place, parent, view }: { place: SubPlace; parent: GameRef; view: ViewMode }) {
  const ref: GameRef = {
    placeId: place.placeId,
    universeId: parent.universeId,
    name: place.isRoot ? parent.name : `${parent.name} — ${place.name}`,
    iconUrl: place.iconUrl ?? (place.isRoot ? parent.iconUrl : null),
    genre: parent.genre,
    creator: parent.creator,
  };
  const mainChip = place.isRoot && (
    <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium">Main place</span>
  );
  if (view === "grid") {
    return (
      <li className="flex flex-col gap-3 rounded-[12px] bg-white/4 p-3">
        <div className="flex items-start justify-between gap-2">
          <SmartImage fade={false} src={place.iconUrl} name={place.name} className="size-20 shrink-0 rounded-[12px]" />
          {mainChip}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold" title={place.name}>
            {place.name}
          </div>
          {place.description && <p className="line-clamp-2 text-xs text-muted">{place.description}</p>}
        </div>
        <div className="mt-auto">
          <PlayButton game={ref} size="sm" />
        </div>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-3 rounded-[12px] bg-white/4 p-3">
      <SmartImage fade={false} src={place.iconUrl} name={place.name} className="size-14 shrink-0 rounded-[12px]" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{place.name}</span>
          {mainChip}
        </div>
        {place.description && <p className="line-clamp-2 text-xs text-muted">{place.description}</p>}
      </div>
      <PlayButton game={ref} size="sm" />
    </li>
  );
}

/** Every place of a multi-place universe, each launchable on its own. */
export function PlacesTab({ game }: { game: GameRef }) {
  const query = useUniversePlaces(game.universeId ?? null, game.placeId, true);
  const view = useSettings((s) => s.values.placesView);
  const setSetting = useSettings((s) => s.set);
  const places = flatItems(query.data);
  return (
    <StateSwitch
      animated={false}
      loading={query.isPending}
      error={query.isError && !query.data ? query.error : null}
      onRetry={() => void query.refetch()}
      isEmpty={places.length === 0}
      skeleton={<ListSkeleton rows={3} height="h-[84px]" />}
      empty={
        <EmptyState
          icon={<MapIcon size={22} strokeWidth={1.75} />}
          title="No places listed"
          hint="Roblox didn't list any places for this experience."
        />
      }
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">{places.length === 1 ? "This experience has a single place." : ""}</p>
        <ViewToggle animated={false} value={view} onChange={(v) => void setSetting("placesView", v)} />
      </div>
      <ul className={view === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2" : "flex flex-col gap-2"}>
        {places.map((p) => (
          <PlaceRow key={p.placeId} place={p} parent={game} view={view} />
        ))}
      </ul>
      <LoadMore query={query} />
    </StateSwitch>
  );
}
