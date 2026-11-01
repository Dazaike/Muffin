import { useMemo, useState } from "react";
import { Download, Heart } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ImportFavoritesModal } from "@/components/favorites/ImportFavoritesModal";
import { GameGrid, GridSkeleton, RowsSkeleton } from "@/components/lists/GameGrid";
import { ViewToggle } from "@/components/lists/ViewToggle";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { Button } from "@/components/ui/Button";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, StateSwitch } from "@/components/ui/StateSwitch";
import { useLibrary } from "@/store/library";
import { useSettings } from "@/store/settings";

export default function Favorites() {
  const navigate = useNavigate();
  const entries = useLibrary((s) => s.entries);
  const hydrated = useLibrary((s) => s.hydrated);
  const favorites = useMemo(() => entries.filter((e) => e.favorite), [entries]);
  const [importing, setImporting] = useState(false);
  const view = useSettings((s) => s.values.favoritesView);
  const setSetting = useSettings((s) => s.set);

  return (
    <Page>
      <PageHeader
        title="Favorites"
        subtitle={
          <>
            <AnimatedNumber value={favorites.length} format={String} /> {favorites.length === 1 ? "game" : "games"}
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <ViewToggle value={view} onChange={(v) => void setSetting("favoritesView", v)} />
            <Button variant="glass" icon={<Download size={16} strokeWidth={1.75} />} onClick={() => setImporting(true)}>
              Import from Roblox
            </Button>
          </div>
        }
      />
      <StateSwitch
        loading={!hydrated}
        isEmpty={favorites.length === 0}
        skeleton={view === "list" ? <RowsSkeleton count={6} /> : <GridSkeleton count={8} />}
        empty={
          <EmptyState
            icon={<Heart size={22} strokeWidth={1.75} />}
            title="No favorites yet"
            hint="Tap the heart on any game to keep it here, or import the games you've favorited on Roblox."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" onClick={() => navigate("/discover")}>
                  Discover games
                </Button>
                <Button variant="glass" icon={<Download size={16} strokeWidth={1.75} />} onClick={() => setImporting(true)}>
                  Import from Roblox
                </Button>
              </div>
            }
          />
        }
      >
        <GameGrid items={favorites} view={view} />
      </StateSwitch>
      <ImportFavoritesModal open={importing} onClose={() => setImporting(false)} />
    </Page>
  );
}
