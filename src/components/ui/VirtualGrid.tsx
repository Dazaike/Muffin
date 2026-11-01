import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useScrollParent } from "./ScrollParent";

export interface VirtualGridProps<T> {
  items: T[];
  /** Minimum item width in px; column count = floor((width + gap) / (minItemWidth + gap)). */
  minItemWidth: number;
  /** Row height in px, or a function of the computed column width (e.g. for aspect-ratio cards). */
  rowHeight: number | ((columnWidth: number) => number);
  gap?: number;
  getKey: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number, columnWidth: number) => ReactNode;
  overscan?: number;
  className?: string;
}

/**
 * Row-virtualized responsive grid. Virtualizes against the shell's scrolling <main>; outside the shell it
 * renders its own scroll container. Only visible rows exist in the DOM.
 */
export function VirtualGrid<T>(props: VirtualGridProps<T>) {
  const parent = useScrollParent();
  const [own, setOwn] = useState<HTMLDivElement | null>(null);
  if (parent) return <GridInner {...props} scrollEl={parent} />;
  return (
    <div ref={setOwn} className="h-full overflow-y-auto">
      {own && <GridInner {...props} scrollEl={own} />}
    </div>
  );
}

function GridInner<T>({
  items,
  minItemWidth,
  rowHeight,
  gap = 16,
  getKey,
  renderItem,
  overscan = 3,
  className,
  scrollEl,
}: VirtualGridProps<T> & { scrollEl: HTMLElement }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [margin, setMargin] = useState(0);

  // Track container width and its offset inside the scroll element.
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => {
      setWidth(grid.clientWidth);
      setMargin(grid.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(grid);
    ro.observe(scrollEl);
    return () => ro.disconnect();
  }, [scrollEl]);

  const cols = Math.max(1, Math.floor((width + gap) / (minItemWidth + gap)));
  const colWidth = width > 0 ? (width - gap * (cols - 1)) / cols : minItemWidth;
  const rowH = typeof rowHeight === "function" ? rowHeight(colWidth) : rowHeight;
  const rowCount = Math.ceil(items.length / cols);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollEl,
    estimateSize: () => rowH + gap,
    overscan,
    scrollMargin: margin,
  });

  // estimateSize is cached per index; invalidate when geometry changes.
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [virtualizer, rowH, gap, cols]);

  const total = virtualizer.getTotalSize();

  return (
    <div ref={gridRef} className={className} style={{ position: "relative", height: Math.max(0, total - gap) }}>
      {width > 0 &&
        virtualizer.getVirtualItems().map((row) => {
          const start = row.index * cols;
          const slice = items.slice(start, start + cols);
          return (
            <div
              key={row.key}
              className="focus-within:z-20 hover:z-20"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: rowH,
                transform: `translateY(${row.start - margin}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${cols}, ${colWidth}px)`,
                gap,
              }}
            >
              {slice.map((item, i) => (
                <div key={getKey(item, start + i)} style={{ minWidth: 0, height: "100%" }}>
                  {renderItem(item, start + i, colWidth)}
                </div>
              ))}
            </div>
          );
        })}
    </div>
  );
}
