import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useOutlet } from "react-router-dom";
import { CommandPalette } from "@/components/CommandPalette";
import { Onboarding } from "@/components/Onboarding";
import { ScrollParentContext } from "@/components/ui/ScrollParent";
import { Toasts } from "@/components/ui/Toasts";
import { isTypingTarget, useGoBack } from "@/hooks/useGoBack";
import { useUi } from "@/store/ui";
import { AmbientBackground } from "./AmbientBackground";
import { OfflineBanner } from "./OfflineBanner";
import { TitleBar } from "./TitleBar";
import { TopBar } from "./TopBar";

/** `/`, Ctrl+K, Alt+Left, Backspace. */
function useKeyboardShortcuts() {
  const goBack = useGoBack();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ui.setPaletteOpen(!ui.paletteOpen);
        return;
      }
      if (ui.paletteOpen || isTypingTarget(e.target)) return;
      if (e.key === "/" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        ui.focusSearch();
      } else if ((e.key === "ArrowLeft" && e.altKey) || (e.key === "Backspace" && !e.ctrlKey && !e.altKey && !e.metaKey)) {
        e.preventDefault();
        goBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goBack]);
}

/** Each routed page scrolls in its own container (not a shared <main>), so a page never inherits another's scroll offset. */
function PageScroller({ children }: { children: ReactNode }) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  return (
    <div ref={setEl} className="h-full overflow-x-hidden overflow-y-auto">
      <ScrollParentContext.Provider value={el}>{children}</ScrollParentContext.Provider>
    </div>
  );
}

/** Window chrome: title bar, top navigation bar, routed content (switched instantly), and global overlays. */
export function Shell() {
  const location = useLocation();
  const outlet = useOutlet();
  const segment = location.pathname.split("/")[1] ?? "";
  useKeyboardShortcuts();

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-bg">
      <AmbientBackground />
      <TitleBar />
      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar />
        <OfflineBanner />
        <main className="relative min-h-0 flex-1 overflow-hidden">
          <div key={segment} className="h-full">
            <PageScroller>{outlet}</PageScroller>
          </div>
        </main>
      </div>
      <CommandPalette />
      <Onboarding />
      <Toasts />
    </div>
  );
}
