import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { GameCard } from "@/components/game/GameCard";
import { Skeleton } from "@/components/ui/Skeleton";
import { SmartImage } from "@/components/ui/SmartImage";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { ipc, toAppError } from "@/lib/ipc";
import { useFilledIcons } from "@/lib/roblox";
import type { CardGame } from "@/lib/types";
import { useUserSection, type ProfileItem, type ProfileSection } from "@/lib/userProfile";
import { toast } from "@/store/ui";

type TabId = "experiences" | ProfileSection;

const TABS: TabItem<TabId>[] = [
  { id: "experiences", label: "Experiences" },
  { id: "favorites", label: "Favorites" },
  { id: "friends", label: "Friends" },
  { id: "badges", label: "Badges" },
  { id: "groups", label: "Groups" },
  { id: "collectibles", label: "Collectibles" },
  { id: "wearing", label: "Wearing" },
];

const EMPTY: Record<TabId, string> = {
  experiences: "No public experiences.",
  favorites: "No favorite experiences.",
  friends: "No friends to show.",
  badges: "No badges yet.",
  groups: "Not in any groups.",
  collectibles: "No collectibles.",
  wearing: "Nothing to show.",
};

const PRIVATE: Partial<Record<TabId, string>> = {
  favorites: "They keep their favorites private.",
  friends: "They keep their friends list private.",
  collectibles: "Their inventory is private.",
  badges: "Their badges are hidden.",
  groups: "Their groups are hidden.",
  wearing: "Roblox won't show what they're wearing.",
};

const GRID = { gridTemplateColumns: "repeat(auto-fill, minmax(var(--poster-min), 1fr))" } as const;

function openOnRoblox(path: string) {
  void ipc.openExternal(`https://www.roblox.com${path}`).catch((e) => toast.error(toAppError(e).message));
}

function GameGrid({ games }: { games: CardGame[] }) {
  const filled = useFilledIcons(games);
  return (
    <div className="grid gap-[var(--card-gap)]" style={GRID}>
      {filled.map((g, i) => (
        <GameCard key={g.placeId} game={g} variant="poster" index={i} />
      ))}
    </div>
  );
}

function Tile({ item, onOpen, round }: { item: ProfileItem; onOpen?: () => void; round?: boolean }) {
  const body = (
    <>
      <SmartImage src={item.imageUrl} name={item.name} className={round ? "aspect-square w-full rounded-full" : "aspect-square w-full rounded-[12px]"} />
      <div className="mt-2 w-full min-w-0 text-center">
        <div className="truncate text-sm font-medium">{item.name}</div>
        {item.subtitle && <div className="truncate text-xs text-muted">{item.subtitle}</div>}
      </div>
    </>
  );
  const cls = "flex min-w-0 flex-col items-center rounded-card bg-white/4 p-3";
  return onOpen ? (
    <button type="button" onClick={onOpen} className={`${cls} focus-ring cursor-pointer transition-colors hover:bg-white/8`} title={item.name}>
      {body}
    </button>
  ) : (
    <div className={cls} title={item.subtitle ? `${item.name}: ${item.subtitle}` : item.name}>
      {body}
    </div>
  );
}

function SectionBody({ userId, section }: { userId: number; section: ProfileSection }) {
  const navigate = useNavigate();
  const q = useUserSection(userId, section, true);
  const games: CardGame[] = useMemo(
    () => (section === "favorites" ? (q.data?.items ?? []) : []).flatMap((i) => (i.placeId ? [{ placeId: i.placeId, universeId: i.universeId, name: i.name }] : [])),
    [q.data, section],
  );

  if (q.isPending) {
    return (
      <div className="grid gap-[var(--card-gap)]" style={GRID}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    );
  }
  if (q.isError) return <div className="text-sm text-danger">Couldn't load this: {q.error.message}</div>;
  if (q.data.private) return <div className="text-sm text-muted">{PRIVATE[section]}</div>;
  if (q.data.items.length === 0) return <div className="text-sm text-muted">{EMPTY[section]}</div>;
  if (section === "favorites") return <GameGrid games={games} />;

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
      {q.data.items.map((item) => (
        <Tile
          key={item.id}
          item={item}
          round={section === "friends" || section === "groups"}
          onOpen={
            section === "friends"
              ? () => navigate(`/user/${item.id}`)
              : section === "groups"
                ? () => openOnRoblox(`/communities/${item.id}`)
                : section === "badges"
                  ? () => openOnRoblox(`/badges/${item.id}`)
                  : () => openOnRoblox(`/catalog/${item.id}`)
          }
        />
      ))}
    </div>
  );
}

/** Everything else about a user, one tab at a time (each tab loads when first opened). */
export function ProfileTabs({ userId, games }: { userId: number; games: CardGame[] }) {
  const [tab, setTab] = useState<TabId>("experiences");
  return (
    <section className="mt-8">
      <Tabs tabs={TABS} value={tab} onChange={setTab} variant="underline" className="mb-4 overflow-x-auto" />
      {tab === "experiences" ? (
        games.length > 0 ? <GameGrid games={games} /> : <div className="text-sm text-muted">{EMPTY.experiences}</div>
      ) : (
        <SectionBody key={`${userId}:${tab}`} userId={userId} section={tab} />
      )}
    </section>
  );
}
