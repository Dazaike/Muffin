import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { modKeyLabel } from "@/lib/platform";
import { useUi } from "@/store/ui";
import { AccountMenu } from "./AccountMenu";
import { PrimaryNav } from "./PrimaryNav";
import { RobuxBadge } from "./RobuxBadge";

/** Top navigation tabs + global search (`/` focuses it, Enter runs a search) + Robux badge + account menu. */
export function TopBar() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const tick = useUi((s) => s.searchFocusTick);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);

  useEffect(() => {
    if (tick > 0) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [tick]);

  return (
    <div className="page-pad relative z-20 flex h-14 shrink-0 items-center gap-3">
      <PrimaryNav />
      <form
        className="relative w-[clamp(120px,14vw,224px)] shrink-0"
        onSubmit={(e) => {
          e.preventDefault();
          const query = q.trim();
          if (!query) return;
          navigate(`/search?q=${encodeURIComponent(query)}`);
          inputRef.current?.blur();
        }}
      >
        <Search size={17} strokeWidth={1.75} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") inputRef.current?.blur();
          }}
          placeholder="Search experiences"
          aria-label="Search experiences"
          className="focus-ring h-10 w-full rounded-full border border-white/8 bg-white/5 pr-3 pl-10 text-sm transition-colors outline-none placeholder:text-muted focus:border-accent/60 focus:bg-white/8 min-[1000px]:pr-16"
        />
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          title="Command palette"
          className="absolute top-1/2 right-2 hidden -translate-y-1/2 cursor-pointer rounded-md bg-white/8 px-1.5 py-0.5 text-[11px] text-muted hover:text-fg min-[1000px]:block"
        >
          {modKeyLabel} K
        </button>
      </form>
      <RobuxBadge />
      <AccountMenu />
    </div>
  );
}
