import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Library as LibraryIcon, SearchX } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { GameGrid, GridSkeleton } from "@/components/lists/GameGrid";
import { GameRowContent, ROW_CLASS } from "@/components/lists/GameRow";
import { ReorderList } from "@/components/lists/ReorderList";
import { SearchField } from "@/components/lists/SearchField";
import { SortSelect, type SortOption } from "@/components/lists/SortSelect";
import { ViewToggle } from "@/components/lists/ViewToggle";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { Button } from "@/components/ui/Button";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, StateSwitch } from "@/components/ui/StateSwitch";
import { relativeTime } from "@/lib/format";
import { useMotionPrefs } from "@/lib/motion";
import type { LibraryEntry, Settings } from "@/lib/types";
import { useLibrary } from "@/store/library";
import { useSettings } from "@/store/settings";

const SORTS: SortOption<Settings["librarySort"]>[] = [
  { value: "name", label: "Name" },
  { value: "lastPlayed", label: "Last played" },
  { value: "added", label: "Date added" },
  { value: "custom", label: "Custom order" },
];

export default function Library() {
  const m = useMotionPrefs();
  const navigate = useNavigate();
  const entries = useLibrary((s) => s.entries);
  const history = useLibrary((s) => s.history);
  const hydrated = useLibrary((s) => s.hydrated);
  const reorder = useLibrary((s) => s.reorder);
  const view = useSettings((s) => s.values.libraryView);
  const sort = useSettings((s) => s.values.librarySort);
  const setSetting = useSettings((s) => s.set);
  const [query, setQuery] = useState("");

  const lastPlayed = useMemo(() => new Map(history.map((h) => [h.placeId, h.lastLaunchedAt])), [history]);
  const filtering = query.trim().length > 0;

  const visible = useMemo<LibraryEntry[]>(() => {
    const q = query.trim().toLowerCase();
    const list = q ? entries.filter((e) => e.name.toLowerCase().includes(q)) : [...entries];
    switch (sort) {
      case "name":
        return list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
      case "lastPlayed":
        // Never-played games go last, newest-added first among them.
        return list.sort((a, b) => {
          const la = lastPlayed.get(a.placeId);
          const lb = lastPlayed.get(b.placeId);
          if (la !== undefined && lb !== undefined) return lb - la;
          if (la !== undefined) return -1;
          if (lb !== undefined) return 1;
          return b.addedAt - a.addedAt;
        });
      case "added":
        return list.sort((a, b) => b.addedAt - a.addedAt);
      case "custom":
        return list; // the store keeps entries ordered by position
    }
  }, [entries, query, sort, lastPlayed]);

  const subtitleFor = (e: LibraryEntry) => {
    const t = lastPlayed.get(e.placeId);
    return [e.genre, t !== undefined ? `played ${relativeTime(t)}` : null].filter(Boolean).join(" · ") || undefined;
  };

  return (
    <Page>
      <PageHeader
        title="My Library"
        subtitle={
          <>
            <AnimatedNumber value={entries.length} format={String} /> {entries.length === 1 ? "game" : "games"} saved on this device
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <SearchField value={query} onChange={setQuery} placeholder="Search your library" className="min-w-56 flex-1 sm:max-w-sm" />
        <div className="ml-auto flex items-center gap-2">
          <SortSelect options={SORTS} value={sort} onChange={(v) => void setSetting("librarySort", v)} />
          <ViewToggle value={view} onChange={(v) => void setSetting("libraryView", v)} />
        </div>
      </div>

      <StateSwitch
        loading={!hydrated}
        isEmpty={visible.length === 0}
        skeleton={<GridSkeleton count={10} />}
        empty={
          entries.length === 0 ? (
            <EmptyState
              icon={<LibraryIcon size={22} strokeWidth={1.75} />}
              title="Your library is empty"
              hint="Favorite a game, or choose “Add to Library” from its right-click menu, and it shows up here."
              action={
                <Button variant="primary" onClick={() => navigate("/discover")}>
                  Discover games
                </Button>
              }
            />
          ) : (
            <EmptyState icon={<SearchX size={22} strokeWidth={1.75} />} title={`No games match “${query.trim()}”`} />
          )
        }
      >
        {view === "grid" ? (
          <GameGrid items={visible} />
        ) : sort === "custom" && !filtering ? (
          <ReorderList entries={visible} subtitleFor={subtitleFor} onCommit={(ids) => void reorder(ids)} />
        ) : (
          <div className="relative flex flex-col gap-2">
            <AnimatePresence mode="popLayout">
              {visible.map((e, i) => (
                <motion.div key={e.placeId} layout transition={m.spring} exit={{ opacity: 0, scale: 0.96 }} className={ROW_CLASS}>
                  <GameRowContent game={e} index={i} subtitle={subtitleFor(e)} />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </StateSwitch>
    </Page>
  );
}
