import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion, useSpring } from "motion/react";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { cn } from "@/lib/cn";
import { useMotionPrefs } from "@/lib/motion";

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** Match the route exactly (Home). */
  end?: boolean;
}

const PILL_SPRING = { stiffness: 420, damping: 38 } as const;
const DRAG_THRESHOLD = 4;

/** Index of the tab that owns `pathname`, or -1 for routes without a tab (game details, unknown paths). */
function ownerIndex(items: NavItem[], pathname: string): number {
  return items.findIndex((it) => (it.end ? pathname === it.to : pathname === it.to || pathname.startsWith(`${it.to}/`)));
}

/** Overshoot past a track end is damped so the pill resists but never leaves the track. */
const rubber = (over: number) => 26 * (1 - Math.exp(-over / 60));

interface DragState {
  id: number;
  startX: number;
  moved: boolean;
}

/**
 * Inset navigation track with one shared accent pill. The pill follows the route, slides between tabs on a spring,
 * can be dragged across the track (rubber-banded, snaps to the nearest tab on release), and the labels collapse to
 * icons when the full-width track would not fit in its container.
 */
export function NavTabs({ items, badges, label = "Primary" }: { items: NavItem[]; badges?: Record<string, number | undefined>; label?: string }) {
  const m = useMotionPrefs();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const x = useSpring(0, PILL_SPRING);
  const w = useSpring(0, PILL_SPRING);

  const activeIdx = ownerIndex(items, pathname);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [rover, setRover] = useState<number | null>(null);
  const [labels, setLabels] = useState(true);
  const labelsRef = useRef(labels);
  labelsRef.current = labels;
  const fullWidth = useRef(0);
  const wasHidden = useRef(true);
  const activeRef = useRef(activeIdx);
  activeRef.current = activeIdx;

  const shownIdx = dragIdx ?? activeIdx;
  const tabbable = rover ?? (activeIdx >= 0 ? activeIdx : 0);
  const badgeKey = items.map((it) => badges?.[it.to] ?? 0).join(",");

  useEffect(() => setRover(null), [pathname]);

  const place = useCallback(
    (i: number, instant: boolean) => {
      const el = tabRefs.current[i];
      if (!el) return;
      if (instant || !m.full) {
        x.jump(el.offsetLeft);
        w.jump(el.offsetWidth);
      } else {
        x.set(el.offsetLeft);
        w.set(el.offsetWidth);
      }
    },
    [m.full, x, w],
  );

  // Follow the route. Appearing from a tab-less route teleports instead of sliding in from a stale position.
  useLayoutEffect(() => {
    if (activeIdx < 0) {
      wasHidden.current = true;
      return;
    }
    place(activeIdx, wasHidden.current);
    wasHidden.current = false;
  }, [activeIdx, labels, place]);

  // Label collapse: compare the container with the last measured width of the labelled track.
  const fit = useCallback(() => {
    const wrap = wrapRef.current;
    const track = trackRef.current;
    if (!wrap || !track) return;
    if (labelsRef.current) fullWidth.current = track.offsetWidth;
    const next = wrap.clientWidth >= fullWidth.current;
    if (next !== labelsRef.current) setLabels(next);
  }, []);

  useLayoutEffect(fit, [fit, labels, badgeKey]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const track = trackRef.current;
    if (!wrap || !track) return;
    const ro = new ResizeObserver((entries) => {
      if (entries.some((e) => e.target === wrap)) fit();
      // Tab sizes changed (labels, badges, fonts): re-measure the pill without animating.
      if (!drag.current?.moved && activeRef.current >= 0) place(activeRef.current, true);
    });
    ro.observe(wrap);
    ro.observe(track);
    return () => ro.disconnect();
  }, [fit, place]);

  /** Tab whose centre is nearest to `local` (track padding-box coordinates). */
  const nearest = (local: number): number => {
    let best = 0;
    let bestD = Infinity;
    tabRefs.current.forEach((el, i) => {
      if (!el) return;
      const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - local);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };

  const localX = (clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    return clientX - track.getBoundingClientRect().left - track.clientLeft;
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    suppressClick.current = false;
    if (e.button !== 0) return;
    drag.current = { id: e.pointerId, startX: e.clientX, moved: false };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD) return;
      d.moved = true;
      suppressClick.current = true;
      trackRef.current?.setPointerCapture(e.pointerId);
    }
    const first = tabRefs.current[0];
    const last = tabRefs.current[items.length - 1];
    if (!first || !last) return;
    const lo = first.offsetLeft + first.offsetWidth / 2;
    const hi = last.offsetLeft + last.offsetWidth / 2;
    const pointer = localX(e.clientX);
    const idx = nearest(pointer);
    const el = tabRefs.current[idx];
    if (!el) return;
    const center = pointer < lo ? lo - rubber(lo - pointer) : pointer > hi ? hi + rubber(pointer - hi) : pointer;
    const left = center - el.offsetWidth / 2;
    if (m.full) {
      x.set(left);
      w.set(el.offsetWidth);
    } else {
      x.jump(left);
      w.jump(el.offsetWidth);
    }
    setDragIdx(idx);
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>, commit: boolean) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) return;
    if (trackRef.current?.hasPointerCapture(e.pointerId)) trackRef.current.releasePointerCapture(e.pointerId);
    const target = commit ? nearest(localX(e.clientX)) : activeRef.current;
    setDragIdx(null);
    if (target >= 0 && target !== activeRef.current) {
      place(target, false);
      const item = items[target];
      if (item) navigate(item.to);
    } else if (activeRef.current >= 0) {
      place(activeRef.current, false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const raw = (e.target as HTMLElement).closest<HTMLElement>("[data-nav-idx]")?.dataset.navIdx;
    if (raw === undefined) return;
    const idx = Number(raw);
    const n = items.length;
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % n;
    else if (e.key === "ArrowLeft") next = (idx - 1 + n) % n;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === " ") {
      e.preventDefault();
      const item = items[idx];
      if (item) navigate(item.to);
      return;
    }
    if (next < 0) return;
    e.preventDefault();
    tabRefs.current[next]?.focus();
  };

  const pillVisible = activeIdx >= 0 || dragIdx !== null;

  return (
    <div ref={wrapRef} className="min-w-0 flex-1">
      <nav aria-label={label}>
        <div
          ref={trackRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => endDrag(e, true)}
          onPointerCancel={(e) => endDrag(e, false)}
          onClickCapture={(e) => {
            if (!suppressClick.current) return;
            suppressClick.current = false;
            e.preventDefault();
            e.stopPropagation();
          }}
          onKeyDown={onKeyDown}
          className="relative inline-flex w-max touch-none items-center gap-0.5 rounded-[14px] border border-white/6 bg-black/40 p-1 shadow-[inset_0_2px_8px_rgba(0,0,0,0.65)] select-none"
        >
          <motion.div
            aria-hidden
            style={{ x, width: w }}
            initial={false}
            animate={{ opacity: pillVisible ? 1 : 0 }}
            transition={m.fast}
            className="pointer-events-none absolute top-1 bottom-1 left-0 rounded-[10px] bg-accent"
          />
          {items.map((it, i) => {
            const on = i === shownIdx;
            const count = badges?.[it.to];
            const showBadge = count !== undefined && count > 0;
            return (
              <Link
                key={it.to}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                to={it.to}
                data-nav-idx={i}
                draggable={false}
                aria-current={i === activeIdx ? "page" : undefined}
                aria-label={labels ? undefined : it.label}
                title={labels ? undefined : it.label}
                tabIndex={i === tabbable ? 0 : -1}
                onFocus={() => setRover(i)}
                className={cn(
                  "focus-ring relative z-10 flex h-9 items-center gap-2 rounded-[10px] text-sm font-medium whitespace-nowrap transition-colors",
                  labels ? "px-3" : "px-2.5",
                  on ? "text-white" : "text-muted hover:text-fg",
                )}
              >
                <span className="relative flex size-[18px] shrink-0 items-center justify-center">
                  {it.icon}
                  {!labels && showBadge && (
                    <span className="absolute -top-2 -right-2.5 min-w-4 rounded-full bg-raised px-1 text-center text-[10px] leading-4 text-fg ring-1 ring-white/15">
                      <AnimatedNumber value={count} format={(n) => String(n)} />
                    </span>
                  )}
                </span>
                {labels && <span>{it.label}</span>}
                {labels && showBadge && (
                  <span className={cn("rounded-full px-1.5 text-[11px] transition-colors", on ? "bg-white/25" : "bg-white/10")}>
                    <AnimatedNumber value={count} format={(n) => String(n)} />
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
