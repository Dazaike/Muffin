import { useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Award, Gamepad2, Image as ImageIcon, Map as MapIcon, Server, Ticket, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { useMotionPrefs } from "@/lib/motion";
import type { GameDetails, GameRef } from "@/lib/types";
import { BadgesTab } from "./BadgesTab";
import { CreatorSection } from "./CreatorSection";
import { PassesTab } from "./PassesTab";
import { PlacesTab } from "./PlacesTab";
import { PlaySection } from "./PlaySection";
import { PrivateServersPanel } from "./PrivateServersPanel";
import { Screenshots } from "./Screenshots";
import { ServersTab } from "./ServersTab";

type SectionId = "play" | "servers" | "badges" | "passes" | "places" | "community" | "media";

const ICON = { size: 17, strokeWidth: 1.75 } as const;

const SECTIONS: { id: SectionId; label: string; icon: ReactNode }[] = [
  { id: "play", label: "Play", icon: <Gamepad2 {...ICON} /> },
  { id: "servers", label: "Servers", icon: <Server {...ICON} /> },
  { id: "badges", label: "Badges", icon: <Award {...ICON} /> },
  { id: "passes", label: "Passes", icon: <Ticket {...ICON} /> },
  { id: "places", label: "Places", icon: <MapIcon {...ICON} /> },
  { id: "community", label: "Community", icon: <Users {...ICON} /> },
  { id: "media", label: "Media", icon: <ImageIcon {...ICON} /> },
];

const SLIDE_PX = 18;

function Pending() {
  return <div className="skeleton h-40 rounded-card" aria-hidden />;
}

interface Props {
  game: GameDetails;
  gameRef: GameRef;
  loading: boolean;
  onBack: () => void;
}

/** The details page body: a section list on the left (Play, Details, Servers, …) and the open section on the right. */
export function GameDetailsView({ game, gameRef, loading, onBack }: Props) {
  const m = useMotionPrefs();
  const group = useId();
  const [section, setSection] = useState<SectionId>("play");
  // Sections slide in from the side the nav item is on.
  const dir = useRef(1);
  const select = (id: SectionId) => {
    dir.current = SECTIONS.findIndex((s) => s.id === id) > SECTIONS.findIndex((s) => s.id === section) ? 1 : -1;
    setSection(id);
  };

  // The seed (clicked card) has no universe id until the real details arrive.
  const universeId = game.universeId > 0 ? game.universeId : null;
  const pictures = [...new Set([game.heroUrl ?? game.iconUrl, ...game.screenshots].filter((u): u is string => !!u))];

  const panels: Record<SectionId, ReactNode> = {
    play: <PlaySection game={game} gameRef={gameRef} loading={loading} go={select} />,
    servers: (
      <div className="grid items-start gap-8 lg:grid-cols-2">
        <ServersTab game={gameRef} />
        <PrivateServersPanel placeId={game.placeId} game={gameRef} />
      </div>
    ),
    badges: universeId ? <BadgesTab universeId={universeId} /> : <Pending />,
    passes: universeId ? <PassesTab universeId={universeId} /> : <Pending />,
    places: universeId ? <PlacesTab game={gameRef} /> : <Pending />,
    community: (
      <div className="max-w-2xl">
        <CreatorSection game={game} />
        {!game.creator && <p className="text-sm text-muted">{loading ? "Loading…" : "No creator information."}</p>}
      </div>
    ),
    media: pictures.length > 0 ? <Screenshots urls={pictures} name={game.name} /> : <p className="text-sm text-muted">No pictures for this experience.</p>,
  };

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[190px_minmax(0,1fr)]">
      <nav
        aria-label="Game sections"
        className="no-scrollbar flex gap-1 overflow-x-auto lg:sticky lg:top-4 lg:flex-col lg:overflow-visible"
      >
        <Button
          variant="glass"
          icon={<ArrowLeft size={16} strokeWidth={1.75} />}
          onClick={onBack}
          className="mb-1 shrink-0 max-lg:mr-1 lg:mb-3"
        >
          Back
        </Button>
        {SECTIONS.map((s) => {
          const active = s.id === section;
          return (
            <button
              key={s.id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => select(s.id)}
              className={cn(
                "focus-ring relative flex shrink-0 cursor-pointer items-center gap-3 rounded-[12px] px-3.5 py-2.5 text-left text-sm font-medium transition-colors",
                active ? "text-fg" : "text-muted hover:bg-white/5 hover:text-fg",
              )}
            >
              {active && (
                <motion.span layoutId={`details-nav-${group}`} transition={m.spring} className="absolute inset-0 rounded-[12px] bg-accent/20 ring-1 ring-accent/30" />
              )}
              <span className={cn("relative", active && "text-accent")}>{s.icon}</span>
              <span className="relative">{s.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="relative min-w-0">
        {/* popLayout takes the leaving panel out of flow, so the page height doesn't collapse mid-switch. */}
        <AnimatePresence mode="popLayout" initial={false} custom={dir.current}>
          <motion.div
            key={section}
            custom={dir.current}
            variants={{
              enter: (d: number) => ({ opacity: 0, x: m.full ? SLIDE_PX * d : 0 }),
              center: { opacity: 1, x: 0 },
              exit: (d: number) => ({ opacity: 0, x: m.full ? -SLIDE_PX * d : 0 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={m.fast}
          >
            {panels[section]}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
