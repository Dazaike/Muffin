import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { SmartImage } from "@/components/ui/SmartImage";

/** Horizontal strip of screenshots; click opens a lightbox with ←/→ navigation. */
export function Screenshots({ urls, name }: { urls: string[]; name: string }) {
  const [index, setIndex] = useState<number | null>(null);
  const open = index !== null;
  const count = urls.length;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowRight") setIndex((i) => (i === null ? i : (i + 1) % count));
      else if (e.key === "ArrowLeft") setIndex((i) => (i === null ? i : (i - 1 + count) % count));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, count]);

  if (count === 0) return null;

  // Keep the last shown image while the modal's exit animation plays.
  const current = urls[index ?? 0];

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Screenshots</h2>
      <div className="no-scrollbar -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1">
        {urls.map((u, i) => (
          <button
            key={u}
            type="button"
            aria-label={`Open screenshot ${i + 1} of ${count}`}
            onClick={() => setIndex(i)}
            className="focus-ring shrink-0 cursor-zoom-in snap-start rounded-card"
          >
            <SmartImage fade={false} src={u} name={name} className="aspect-video w-72 rounded-card" />
          </button>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => setIndex(null)}
        widthClass="max-w-5xl"
        panelClassName="p-2"
        title={<span className="sr-only">{`${name} screenshot`}</span>}
      >
        <div className="relative">
          <SmartImage fade={false} src={current} name={name} fit="contain" className="aspect-video w-full rounded-[14px] bg-black" />
          {count > 1 && (
            <>
              <button
                type="button"
                aria-label="Previous screenshot"
                onClick={() => setIndex((i) => (i === null ? i : (i - 1 + count) % count))}
                className="focus-ring absolute top-1/2 left-3 flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/55 hover:bg-black/75"
              >
                <ChevronLeft size={22} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                aria-label="Next screenshot"
                onClick={() => setIndex((i) => (i === null ? i : (i + 1) % count))}
                className="focus-ring absolute top-1/2 right-3 flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-black/55 hover:bg-black/75"
              >
                <ChevronRight size={22} strokeWidth={1.75} />
              </button>
              <div className="absolute right-3 bottom-3 rounded-full bg-black/60 px-2.5 py-0.5 text-xs tabular-nums">
                {(index ?? 0) + 1} / {count}
              </div>
            </>
          )}
        </div>
      </Modal>
    </section>
  );
}
