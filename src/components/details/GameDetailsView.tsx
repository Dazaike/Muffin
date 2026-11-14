import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Award, ChevronDown, Gamepad2, Image as ImageIcon, Map as MapIcon, Server, Ticket, Users } from "lucide-react";
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
  const [section, setSection] = useState<SectionId>("play");
  // Sections slide in from the side the nav item is on.
  const dir = useRef(1);
  const select = (id: SectionId) => {
    dir.current = SECTIONS.findIndex((s) => s.id === id) > SECTIONS.findIndex((s) => s.id === section) ? 1 : -1;
    setSection(id);
  };
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [menuOpen]);
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

  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]!;

  return (
    <div className="flex flex-col gap-6">
      <div className="relative z-30 flex items-center gap-2" ref={menuRef}>
        <Button variant="glass" icon={<ArrowLeft size={16} strokeWidth={1.75} />} onClick={onBack} className="shrink-0">
          Back
        </Button>
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => setMenuOpen((o) => !o)}
          className="focus-ring glass flex h-10 cursor-pointer items-center gap-2.5 rounded-[12px] px-3.5 text-sm font-medium text-fg"
        >
          <span className="text-accent">{current.icon}</span>
          <span>{current.label}</span>
          <ChevronDown size={15} strokeWidth={1.75} className={cn("text-muted transition-transform duration-200", menuOpen && "rotate-180")} />
        </button>
        <AnimatePresence>
          {menuOpen && (
            <motion.nav
              aria-label="Game sections"
              role="menu"
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={m.fast}
              style={{ transformOrigin: "top left" }}
              className="absolute top-full left-0 mt-2 flex w-56 flex-col gap-1 rounded-[16px] bg-raised p-1.5 shadow-black/40 shadow-xl ring-1 ring-white/10"
            >
              {SECTIONS.map((s) => {
                const active = s.id === section;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="menuitem"
                    aria-current={active ? "page" : undefined}
                    onClick={() => {
                      select(s.id);
                      setMenuOpen(false);
                    }}
                    className={cn(
                      "focus-ring flex cursor-pointer items-center gap-3 rounded-[12px] px-3 py-2.5 text-left text-sm font-medium transition-colors",
                      active ? "bg-accent/20 text-fg ring-1 ring-accent/30" : "text-muted hover:bg-white/5 hover:text-fg",
                    )}
                  >
                    <span className={cn(active && "text-accent")}>{s.icon}</span>
                    {s.label}
                  </button>
                );
              })}
            </motion.nav>
          )}
        </AnimatePresence>
      </div>

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
