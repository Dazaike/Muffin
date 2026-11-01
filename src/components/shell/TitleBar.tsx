import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { Logo } from "@/components/Logo";
import { windowControls } from "@/lib/ipc";
import { cn } from "@/lib/cn";

function WinButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // Keep the drag region from swallowing the press.
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={onClick}
      className={cn(
        "flex h-full w-12 cursor-pointer items-center justify-center text-muted transition-colors",
        danger ? "hover:bg-[#e81123] hover:text-white" : "hover:bg-white/8 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

/** Custom frameless title bar (40 px). The empty area is the drag region. */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let off: (() => void) | undefined;
    let dead = false;
    const sync = () => void windowControls.isMaximized().then((v) => !dead && setMaximized(v)).catch(() => {});
    sync();
    windowControls.onResized(sync).then((u) => (dead ? u() : (off = u))).catch(() => {});
    return () => {
      dead = true;
      off?.();
    };
  }, []);

  return (
    <header data-tauri-drag-region className="relative z-40 flex h-10 shrink-0 items-center justify-between select-none">
      <div data-tauri-drag-region className="flex items-center gap-2.5 pl-3.5">
        <Logo size={20} className="pointer-events-none" />
        <span data-tauri-drag-region className="text-[13px] font-semibold tracking-wide">
          Muffin
        </span>
      </div>
      <div className="flex h-full">
        <WinButton label="Minimize" onClick={() => void windowControls.minimize()}>
          <Minus size={16} strokeWidth={1.75} />
        </WinButton>
        <WinButton label={maximized ? "Restore" : "Maximize"} onClick={() => void windowControls.toggleMaximize()}>
          {maximized ? <Copy size={13} strokeWidth={1.75} /> : <Square size={13} strokeWidth={1.75} />}
        </WinButton>
        <WinButton label="Close" danger onClick={() => void windowControls.close()}>
          <X size={17} strokeWidth={1.75} />
        </WinButton>
      </div>
    </header>
  );
}
