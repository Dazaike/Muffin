import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { CornerDownLeft, Search } from "lucide-react";
import { NAV_PAGES } from "@/components/shell/PrimaryNav";
import { useOpenGame } from "@/components/game/useGameMenu";
import { Skeleton } from "@/components/ui/Skeleton";
import { SmartImage } from "@/components/ui/SmartImage";
import { cn } from "@/lib/cn";
import { useMotionPrefs } from "@/lib/motion";
import { useSearch } from "@/lib/roblox";
import type { CardGame } from "@/lib/types";
import { useOnline } from "@/lib/useOnline";
import { useLibrary } from "@/store/library";
import { useUi } from "@/store/ui";

type Item =
  | { key: string; section: string; kind: "page"; label: string; icon: ReactNode; to: string }
  | { key: string; section: string; kind: "game"; game: CardGame; hint?: string };

const matches = (name: string, q: string) => name.toLowerCase().includes(q);

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const setOpen = useUi((s) => s.setPaletteOpen);
  const m = useMotionPrefs();
  const navigate = useNavigate();
  const openGame = useOpenGame();
  const online = useOnline();
  const entries = useLibrary((s) => s.entries);
  const history = useLibrary((s) => s.history);

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setDebounced("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const q = query.trim().toLowerCase();
  const remote = useSearch(open ? debounced : "");

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    if (!q) {
      for (const p of NAV_PAGES) out.push({ key: `page:${p.to}`, section: "Pages", kind: "page", label: p.label, icon: p.icon, to: p.to });
      for (const e of entries.filter((x) => x.pinned)) out.push({ key: `pin:${e.placeId}`, section: "Pinned", kind: "game", game: e });
      for (const h of history.slice(0, 5)) out.push({ key: `recent:${h.placeId}`, section: "Recent", kind: "game", game: h });
      return out;
    }
    const seen = new Set<number>();
    for (const e of entries) {
      if (matches(e.name, q) && !seen.has(e.placeId)) {
        seen.add(e.placeId);
        out.push({ key: `lib:${e.placeId}`, section: "On this device", kind: "game", game: e, hint: e.favorite ? "Favorite" : "Library" });
      }
    }
    for (const h of history) {
      if (matches(h.name, q) && !seen.has(h.placeId)) {
        seen.add(h.placeId);
        out.push({ key: `hist:${h.placeId}`, section: "On this device", kind: "game", game: h, hint: "Played" });
      }
    }
    if (debounced.toLowerCase() === q) {
      for (const g of remote.data ?? []) {
        if (!seen.has(g.placeId)) {
          seen.add(g.placeId);
          out.push({ key: `rbx:${g.placeId}`, section: "Roblox", kind: "game", game: g });
        }
      }
    }
    return out;
  }, [q, debounced, entries, history, remote.data]);

  useEffect(() => setActive(0), [q]);
  const safeActive = Math.min(active, Math.max(0, items.length - 1));

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [safeActive, items]);

  const close = () => setOpen(false);

  const choose = (item: Item | undefined) => {
    if (!item) return;
    close();
    if (item.kind === "page") navigate(item.to);
    else openGame(item.game);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (items.length) setActive((safeActive + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (items.length) setActive((safeActive - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(items[safeActive]);
    }
  };

  const remoteLoading = q.length >= 2 && (debounced.toLowerCase() !== q || remote.isFetching) && !remote.data;
  const remoteMissing = q.length >= 2 && !remoteLoading && remote.isError && !remote.data;

  let lastSection = "";
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="palette"
          className="fixed inset-0 z-[85] flex items-start justify-center px-4 pt-[14vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={m.fast}
        >
          <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onMouseDown={close} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -4 }}
            transition={m.spring}
            className="glass relative w-full max-w-xl overflow-hidden rounded-[20px]"
          >
            <div className="flex items-center gap-3 border-b border-white/8 px-4">
              <Search size={18} strokeWidth={1.75} className="shrink-0 text-muted" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search games, jump to a page…"
                aria-label="Command palette search"
                className="h-14 w-full bg-transparent text-[15px] outline-none placeholder:text-muted"
              />
              <kbd className="shrink-0 rounded-md bg-white/8 px-1.5 py-0.5 text-[11px] text-muted">Esc</kbd>
            </div>
            <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
              {items.map((it, i) => {
                const header = it.section !== lastSection ? it.section : null;
                lastSection = it.section;
                const isActive = i === safeActive;
                return (
                  <div key={it.key}>
                    {header && <div className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">{header}</div>}
                    <motion.button
                      layout="position"
                      type="button"
                      data-active={isActive}
                      onMouseMove={() => i !== safeActive && setActive(i)}
                      onClick={() => choose(it)}
                      transition={m.fast}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-3 rounded-[12px] px-3 py-2 text-left text-sm transition-colors",
                        isActive ? "bg-white/10" : "hover:bg-white/5",
                      )}
                    >
                      {it.kind === "page" ? (
                        <>
                          <span className="flex size-8 items-center justify-center rounded-[9px] bg-white/6 text-muted">{it.icon}</span>
                          <span className="flex-1">{it.label}</span>
                        </>
                      ) : (
                        <>
                          <SmartImage src={it.game.iconUrl} name={it.game.name} className="size-8 shrink-0 rounded-[9px]" />
                          <span className="flex-1 truncate">{it.game.name}</span>
                          {it.hint && <span className="text-xs text-muted">{it.hint}</span>}
                        </>
                      )}
                      {isActive && (
                        <span className="flex items-center gap-1 text-[11px] text-muted">
                          <CornerDownLeft size={12} strokeWidth={1.75} />
                          {it.kind === "game" ? "Open" : "Go"}
                        </span>
                      )}
                    </motion.button>
                  </div>
                );
              })}
              {remoteLoading && (
                <div className="space-y-2 p-2">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-10 rounded-[12px]" />
                  ))}
                </div>
              )}
              {remoteMissing && (
                <div className="px-3 py-3 text-xs text-muted">
                  {online ? "Couldn't reach Roblox search." : "You're offline — showing saved games only."}
                </div>
              )}
              {!remoteLoading && !remoteMissing && q && items.length === 0 && (
                <div className="px-3 py-8 text-center text-sm text-muted">No games found for “{query.trim()}”</div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
