import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";
import { useMotionPrefs } from "@/lib/motion";

export type MenuEntry =
  | {
      type?: "item";
      label: string;
      icon?: ReactNode;
      onSelect: () => void;
      danger?: boolean;
      disabled?: boolean;
      /** Native tooltip, e.g. to explain why an item is disabled. */
      title?: string;
    }
  | { type: "separator" }
  | { type: "header"; content: ReactNode };

interface MenuListProps {
  entries: MenuEntry[];
  onClose: () => void;
  className?: string;
}

function MenuList({ entries, onClose, className }: MenuListProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div ref={ref} role="menu" onKeyDown={onKeyDown} className={cn("glass min-w-[200px] rounded-[14px] p-1.5 text-sm", className)}>
      {entries.map((e, i) => {
        if (e.type === "separator") return <div key={i} className="my-1 h-px bg-white/8" />;
        if (e.type === "header") return <div key={i}>{e.content}</div>;
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={e.disabled}
            title={e.title}
            onClick={() => {
              onClose();
              e.onSelect();
            }}
            className={cn(
              "focus-ring flex w-full cursor-pointer items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left transition-colors hover:bg-white/8 focus-visible:bg-white/8 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent",
              e.danger && "text-danger",
            )}
          >
            {e.icon && <span className="flex size-4 shrink-0 items-center justify-center">{e.icon}</span>}
            <span className="flex-1 truncate">{e.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export interface MenuProps {
  /** Renders the trigger; spread `props` on the button. */
  trigger: (props: { onClick: () => void; "aria-haspopup": "menu"; "aria-expanded": boolean }, open: boolean) => ReactNode;
  entries: MenuEntry[] | (() => MenuEntry[]);
  align?: "start" | "end";
  className?: string;
  menuClassName?: string;
}

/** Dropdown menu anchored below its trigger. Closes on outside click / Esc. */
export function Menu({ trigger, entries, align = "end", className, menuClassName }: MenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const m = useMotionPrefs();
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, close]);

  const list = typeof entries === "function" ? entries() : entries;
  const origin = align === "end" ? "top right" : "top left";

  return (
    <div ref={wrapRef} className={cn("relative inline-block", className)}>
      {trigger({ onClick: () => setOpen((o) => !o), "aria-haspopup": "menu", "aria-expanded": open }, open)}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={m.fast}
            style={{ transformOrigin: origin }}
            className={cn("absolute top-full z-50 mt-2", align === "end" ? "right-0" : "left-0")}
          >
            <MenuList entries={list} onClose={close} className={menuClassName} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export interface ContextMenuProps {
  entries: MenuEntry[] | (() => MenuEntry[]);
  children: ReactNode;
}

/** Right-click menu for its children. Wrapper uses `display: contents` so layouts are unaffected. */
export function ContextMenu({ entries, children }: ContextMenuProps) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [placed, setPlaced] = useState<{ x: number; y: number; ox: string; oy: string } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const m = useMotionPrefs();
  const close = useCallback(() => setPos(null), []);

  // Clamp into the viewport once the menu has been measured.
  useLayoutEffect(() => {
    if (!pos) {
      setPlaced(null);
      return;
    }
    const r = boxRef.current?.getBoundingClientRect();
    const w = r?.width ?? 220;
    const h = r?.height ?? 240;
    const flipX = pos.x + w > window.innerWidth - 8;
    const flipY = pos.y + h > window.innerHeight - 8;
    setPlaced({
      x: flipX ? Math.max(8, pos.x - w) : pos.x,
      y: flipY ? Math.max(8, pos.y - h) : pos.y,
      ox: flipX ? "right" : "left",
      oy: flipY ? "bottom" : "top",
    });
  }, [pos]);

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [pos, close]);

  const list = pos ? (typeof entries === "function" ? entries() : entries) : [];

  return (
    <div
      style={{ display: "contents" }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setPos({ x: e.clientX, y: e.clientY });
      }}
    >
      {children}
      {createPortal(
        <AnimatePresence>
          {pos && (
            <motion.div
              ref={boxRef}
              key="ctx"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: placed ? 1 : 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={m.fast}
              style={{
                position: "fixed",
                left: placed?.x ?? pos.x,
                top: placed?.y ?? pos.y,
                transformOrigin: placed ? `${placed.oy} ${placed.ox}` : "top left",
                zIndex: 90,
              }}
            >
              <MenuList entries={list} onClose={close} />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
