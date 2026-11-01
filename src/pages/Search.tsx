import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Clock, SearchX, Telescope, WifiOff, X } from "lucide-react";
import { cardRowHeight, GameCard } from "@/components/game/GameCard";
import { useOpenGame } from "@/components/game/useGameMenu";
import { RowsSkeleton } from "@/components/lists/GameGrid";
import { PeopleResults } from "@/components/lists/PeopleResults";
import { ResultFilterBar } from "@/components/lists/ResultFilterBar";
import { SearchField } from "@/components/lists/SearchField";
import { SuggestionList } from "@/components/lists/SuggestionList";
import { ViewToggle } from "@/components/lists/ViewToggle";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { useScrollParent } from "@/components/ui/ScrollParent";
import { EmptyState, StateSwitch } from "@/components/ui/StateSwitch";
import { VirtualGrid } from "@/components/ui/VirtualGrid";
import { useDebounced } from "@/hooks/useDebounced";
import { applyResultFilters, isFiltering, NO_FILTERS, type ResultFilters } from "@/lib/gameFilters";
import { useMotionPrefs } from "@/lib/motion";
import { useAutocomplete, useSearch } from "@/lib/roblox";
import type { AppError, GameSummary } from "@/lib/types";
import { useOnline } from "@/lib/useOnline";
import { useLibrary } from "@/store/library";

import { useSettings } from "@/store/settings";
const DEBOUNCE_MS = 250;
const SAVE_MS = 600;
const ROW_H = 84;
const ROW_GAP = 8;
const GRID_MIN_W = 170;
const GRID_GAP = 16;
/** Result lists up to this size are plain animated lists; longer ones are row-virtualized. */
const VIRTUALIZE_AT = 30;
/** Larger than any viewport so VirtualGrid always lays results out in a single column. */
const SINGLE_COLUMN = 10_000;

export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [input, setInput] = useState(q);
  const [highlight, setHighlight] = useState(0);
  const [focused, setFocused] = useState(false);
  const [filters, setFilters] = useState<ResultFilters>(NO_FILTERS);
  /** True while the user is typing and hasn't yet picked a suggestion / run the search. */
  const [suggOpen, setSuggOpen] = useState(false);
  const [suggIdx, setSuggIdx] = useState(-1);

  const m = useMotionPrefs();
  const online = useOnline();
  const openGame = useOpenGame();
  const view = useSettings((s) => s.values.searchView);
  const setSetting = useSettings((s) => s.set);
  useSettings((s) => s.values.cardShape); // re-render so grid row heights follow the card shape
  const scrollEl = useScrollParent();
  const searches = useLibrary((s) => s.searches);
  const recordSearch = useLibrary((s) => s.recordSearch);
  const removeSearch = useLibrary((s) => s.removeSearch);
  const clearSearches = useLibrary((s) => s.clearSearches);

  const search = useSearch(q);
  const results = search.data;
  const list = useMemo(() => applyResultFilters(results ?? [], filters), [results, filters]);
  const filtering = isFiltering(filters);
  const trimmedQ = q.trim();
  const active = trimmedQ.length >= 2;

  const listRef = useRef<HTMLDivElement>(null);
  /** The last `q` this page wrote itself, to tell its own URL updates from external navigation. */
  const written = useRef(q);
  const latest = useRef({ q, setParams });
  latest.current = { q, setParams };

  const commit = useCallback((value: string) => {
    const next = value.trim();
    written.current = next;
    latest.current.setParams(next ? { q: next } : {}, { replace: true });
  }, []);

  // External navigation to /search?q=… (top bar, command palette) → mirror into the input.
  useEffect(() => {
    if (q !== written.current) {
      written.current = q;
      setInput(q);
    }
  }, [q]);

  // Debounce input → `q` param.
  useEffect(() => {
    const t = setTimeout(() => {
      if (input.trim() !== latest.current.q.trim()) commit(input);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [input, commit]);

  // Save a search once typing has stopped for 600 ms.
  useEffect(() => {
    const v = input.trim();
    if (v.length < 2) return;
    const t = setTimeout(() => void recordSearch(v), SAVE_MS);
    return () => clearTimeout(t);
  }, [input, recordSearch]);

  // New result set → highlight the first row.
  useEffect(() => setHighlight(0), [results, filters]);

  const debouncedInput = useDebounced(input, 150);
  const auto = useAutocomplete(debouncedInput, focused && suggOpen);
  const suggestions = useMemo(() => {
    const typed = input.trim().toLowerCase();
    return (auto.data ?? []).filter((s) => s.toLowerCase() !== typed);
  }, [auto.data, input]);
  const showSuggestions = focused && suggOpen && suggestions.length > 0;

  // Keep the highlighted row visible (rows may be virtualized away, so this is computed, not DOM-based).
  useEffect(() => {
    const host = listRef.current;
    if (!scrollEl || !host || list.length === 0) return;
    const grid = view === "grid";
    const cols = grid ? Math.max(1, Math.floor((host.clientWidth + GRID_GAP) / (GRID_MIN_W + GRID_GAP))) : 1;
    const colW = (host.clientWidth - GRID_GAP * (cols - 1)) / cols;
    const h = grid ? cardRowHeight("poster", colW) : ROW_H;
    const gap = grid ? GRID_GAP : ROW_GAP;
    const top =
      host.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop + Math.floor(highlight / cols) * (h + gap);
    const bottom = top + h;
    const viewH = scrollEl.clientHeight;
    if (top < scrollEl.scrollTop + 8) scrollEl.scrollTo({ top: Math.max(0, top - 8) });
    else if (bottom > scrollEl.scrollTop + viewH - 8) scrollEl.scrollTo({ top: bottom - viewH + 8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to highlight moves, not list identity
  }, [highlight]);

  const runSearch = (value: string) => {
    setSuggOpen(false);
    setSuggIdx(-1);
    setInput(value);
    commit(value);
  };

  const onInput = (value: string) => {
    setInput(value);
    setSuggOpen(value.trim().length >= 2);
    setSuggIdx(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (showSuggestions && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const n = suggestions.length;
      const next = suggIdx + (e.key === "ArrowDown" ? 1 : -1);
      if (next >= n) {
        // Past the last suggestion: close the list so the arrows drive the results again.
        setSuggOpen(false);
        setSuggIdx(-1);
      } else setSuggIdx(next < -1 ? n - 1 : next);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (list.length === 0) return;
      setHighlight((h) => Math.max(0, Math.min(list.length - 1, h + (e.key === "ArrowDown" ? 1 : -1))));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = showSuggestions ? suggestions[suggIdx] : undefined;
      if (picked) {
        runSearch(picked);
        return;
      }
      setSuggOpen(false);
      // Results are still for the previous text: run the search now instead of opening a stale row.
      if (input.trim() !== trimmedQ) {
        commit(input);
        return;
      }
      const game = list[highlight];
      if (game) openGame(game);
    } else if (e.key === "Escape" && showSuggestions) {
      e.stopPropagation();
      setSuggOpen(false);
    } else if (e.key === "Escape" && input) {
      e.stopPropagation();
      runSearch("");
    }
  };

  const renderRow = (g: GameSummary, i: number) => (
    <GameCard game={g} variant="row" index={i} highlighted={focused && i === highlight} className="h-full" />
  );
  const renderCard = (g: GameSummary, i: number) => (
    <GameCard game={g} variant="poster" index={i} highlighted={focused && i === highlight} className="h-full" />
  );

  const error: AppError | null =
    search.error && !online ? { code: "network", message: "You're offline and this search isn't cached yet." } : search.error;

  return (
    <Page>
      <PageHeader title="Search" subtitle="Results come straight from Roblox, in Roblox's order." />

      <div className="relative mb-4 max-w-2xl">
        <SearchField
          value={input}
          onChange={onInput}
          placeholder="Search experiences"
          autoFocus={!q}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {showSuggestions && <SuggestionList suggestions={suggestions} active={suggIdx} onPick={runSearch} />}
      </div>

      {active && (
        <div className="mb-5">
          <ResultFilterBar value={filters} onChange={setFilters} />
        </div>
      )}

      {!online && (
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/6 px-3.5 py-1.5 text-sm text-muted">
          <WifiOff size={15} strokeWidth={1.75} />
          You're offline. Showing cached results where available.
        </div>
      )}

      {active ? (
        <StateSwitch
          loading={search.isLoading}
          error={error}
          onRetry={() => void search.refetch()}
          isEmpty={list.length === 0}
          skeleton={<RowsSkeleton count={7} />}
          empty={
            filtering && (results?.length ?? 0) > 0 ? (
              <EmptyState
                icon={<SearchX size={22} strokeWidth={1.75} />}
                title="No games match these filters"
                hint={`${results?.length ?? 0} found, none with enough players. Lower the player minimum or reset.`}
              />
            ) : (
              <EmptyState
                icon={<SearchX size={22} strokeWidth={1.75} />}
                title={`No games found for “${trimmedQ}”`}
                hint="Check the spelling or try a shorter search."
              />
            )
          }
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm text-muted" aria-live="polite">
              {filtering ? `${list.length} of ${results?.length ?? 0}` : list.length}{" "}
              {list.length === 1 && !filtering ? "experience" : "experiences"}
              <span className="hidden sm:inline"> · ↑↓ to move, Enter for details</span>
            </div>
            <ViewToggle value={view} onChange={(v) => void setSetting("searchView", v)} />
          </div>
          <div ref={listRef}>
            {view === "grid" ? (
              <VirtualGrid
                items={list}
                minItemWidth={GRID_MIN_W}
                rowHeight={(w) => cardRowHeight("poster", w)}
                gap={GRID_GAP}
                getKey={(g) => g.placeId}
                renderItem={(g, i) => renderCard(g, i)}
              />
            ) : list.length > VIRTUALIZE_AT ? (
              <VirtualGrid
                items={list}
                minItemWidth={SINGLE_COLUMN}
                rowHeight={ROW_H}
                gap={ROW_GAP}
                getKey={(g) => g.placeId}
                renderItem={(g, i) => renderRow(g, i % 8)}
              />
            ) : (
              <div className="relative flex flex-col" style={{ gap: ROW_GAP }}>
                <AnimatePresence mode="popLayout">
                  {list.map((g, i) => (
                    <motion.div
                      key={g.placeId}
                      layout
                      transition={m.spring}
                      exit={{ opacity: 0 }}
                      style={{ height: ROW_H }}
                    >
                      {renderRow(g, i)}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </StateSwitch>
      ) : (
        <Idle
          single={trimmedQ.length === 1}
          searches={searches}
          onPick={runSearch}
          onRemove={(s) => void removeSearch(s)}
          onClear={() => void clearSearches()}
        />
      )}

      {active && trimmedQ.length >= 3 && online && <PeopleResults query={trimmedQ} />}
    </Page>
  );
}

function Idle({
  single,
  searches,
  onPick,
  onRemove,
  onClear,
}: {
  single: boolean;
  searches: string[];
  onPick: (q: string) => void;
  onRemove: (q: string) => void;
  onClear: () => void;
}) {
  const m = useMotionPrefs();
  if (searches.length === 0) {
    return (
      <EmptyState
        icon={<Telescope size={22} strokeWidth={1.75} />}
        title={single ? "Keep typing" : "Search Roblox experiences"}
        hint={single ? "Type at least 2 characters." : "Find games by name."}
      />
    );
  }
  return (
    <section aria-label="Recent searches">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted">{single ? "Type at least 2 characters — or pick a recent search" : "Recent searches"}</h2>
        <button
          type="button"
          onClick={onClear}
          className="focus-ring cursor-pointer rounded-md px-2 py-1 text-[13px] text-muted transition-colors hover:text-fg"
        >
          Clear
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <AnimatePresence mode="popLayout">
          {searches.map((s) => (
            <motion.div
              key={s}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={m.spring}
              className="glass inline-flex h-9 items-center rounded-full pr-1 pl-3.5 text-sm"
            >
              <button
                type="button"
                onClick={() => onPick(s)}
                className="focus-ring inline-flex cursor-pointer items-center gap-2 rounded-full pr-1"
              >
                <Clock size={14} strokeWidth={1.75} className="text-muted" />
                <span className="max-w-56 truncate">{s}</span>
              </button>
              <button
                type="button"
                aria-label={`Remove ${s} from recent searches`}
                onClick={() => onRemove(s)}
                className="focus-ring ml-1 flex size-6 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-white/10 hover:text-fg"
              >
                <X size={13} strokeWidth={1.75} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}
