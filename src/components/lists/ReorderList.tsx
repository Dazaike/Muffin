import { useCallback, useEffect, useRef, useState } from "react";
import { Reorder, useDragControls } from "motion/react";
import { GripVertical } from "lucide-react";
import { GameRowContent, ROW_CLASS } from "@/components/lists/GameRow";
import type { LibraryEntry } from "@/lib/types";

function ReorderRow({
  entry,
  index,
  subtitle,
  onDragEnd,
}: {
  entry: LibraryEntry;
  index: number;
  subtitle?: string;
  onDragEnd: () => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      as="div"
      value={entry}
      dragListener={false}
      dragControls={controls}
      onDragEnd={() => onDragEnd()}
      whileDrag={{ scale: 1.01, zIndex: 30 }}
      className={ROW_CLASS}
    >
      <GameRowContent
        game={entry}
        index={index}
        subtitle={subtitle}
        leading={
          <div
            title="Drag to reorder"
            aria-hidden
            onPointerDown={(e) => {
              e.preventDefault();
              controls.start(e);
            }}
            className="flex h-9 w-6 shrink-0 cursor-grab touch-none items-center justify-center text-muted hover:text-fg active:cursor-grabbing"
          >
            <GripVertical size={18} strokeWidth={1.75} />
          </div>
        }
      />
    </Reorder.Item>
  );
}

/**
 * Drag-to-reorder list for the library's custom order. Calls `onCommit(placeIds)` with the full new order
 * when a drag ends and the order actually changed.
 */
export function ReorderList({
  entries,
  subtitleFor,
  onCommit,
}: {
  entries: LibraryEntry[];
  subtitleFor: (entry: LibraryEntry) => string | undefined;
  onCommit: (placeIds: number[]) => void;
}) {
  const [order, setOrder] = useState(entries);
  const orderRef = useRef(order);
  orderRef.current = order;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  // Follow the store whenever it changes (after a commit, an undo, a favorite toggle…).
  useEffect(() => setOrder(entries), [entries]);

  const commit = useCallback(() => {
    const ids = orderRef.current.map((e) => e.placeId);
    const prev = entriesRef.current;
    if (ids.length === prev.length && ids.every((id, i) => id === prev[i]?.placeId)) return;
    onCommit(ids);
  }, [onCommit]);

  return (
    <Reorder.Group as="div" axis="y" values={order} onReorder={setOrder} className="flex flex-col gap-2">
      {order.map((e, i) => (
        <ReorderRow key={e.placeId} entry={e} index={i} subtitle={subtitleFor(e)} onDragEnd={commit} />
      ))}
    </Reorder.Group>
  );
}
