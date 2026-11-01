import { useState, type ReactNode } from "react";
import { Award, Info, Map as MapIcon, Server, Ticket } from "lucide-react";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import type { GameDetails, GameRef } from "@/lib/types";
import { BadgesTab } from "./BadgesTab";
import { Description } from "./Description";
import { PassesTab } from "./PassesTab";
import { PlacesTab } from "./PlacesTab";
import { ServersTab } from "./ServersTab";
import { PrivateServersPanel } from "./PrivateServersPanel";
import { SocialLinks } from "./SocialLinks";

type TabId = "about" | "servers" | "badges" | "passes" | "places";

const ICON = { size: 15, strokeWidth: 1.75 } as const;

const TABS: TabItem<TabId>[] = [
  { id: "about", label: "About", icon: <Info {...ICON} /> },
  { id: "servers", label: "Servers", icon: <Server {...ICON} /> },
  { id: "badges", label: "Badges", icon: <Award {...ICON} /> },
  { id: "passes", label: "Passes", icon: <Ticket {...ICON} /> },
  { id: "places", label: "Places", icon: <MapIcon {...ICON} /> },
];

function Pending() {
  return <div className="skeleton h-40 rounded-card" aria-hidden />;
}

/** About / Servers / Badges / Passes / Places. Only the open panel is mounted; data is cached by react-query, so returning to a tab is instant. */
export function DetailsTabs({ game, gameRef, loading }: { game: GameDetails; gameRef: GameRef; loading: boolean }) {
  const [tab, setTab] = useState<TabId>("about");

  // The seed (clicked card) has no universe id until the real details arrive.
  const universeId = game.universeId > 0 ? game.universeId : null;

  const panels: Record<TabId, ReactNode> = {
    about: (
      <div className="flex flex-col gap-8">
        <Description text={game.description} loading={loading} />
        {universeId && <SocialLinks universeId={universeId} />}
      </div>
    ),
    servers: (
      <div className="grid items-start gap-8 lg:grid-cols-2">
        <ServersTab game={gameRef} />
        <PrivateServersPanel placeId={game.placeId} game={gameRef} />
      </div>
    ),
    badges: universeId ? <BadgesTab universeId={universeId} /> : <Pending />,
    passes: universeId ? <PassesTab universeId={universeId} /> : <Pending />,
    places: universeId ? <PlacesTab game={gameRef} /> : <Pending />,
  };

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Tabs tabs={TABS} value={tab} onChange={setTab} variant="underline" animated={false} className="no-scrollbar overflow-x-auto" />
      <div role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
        {panels[tab]}
      </div>
    </div>
  );
}
