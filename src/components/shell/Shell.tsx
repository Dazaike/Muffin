import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useOutlet } from "react-router-dom";
import { NAV_PAGES } from "./PrimaryNav";
import { CommandPalette } from "@/components/CommandPalette";
import { Onboarding } from "@/components/Onboarding";
import { ScrollParentContext } from "@/components/ui/ScrollParent";
import { Toasts } from "@/components/ui/Toasts";
import { isTypingTarget, useGoBack } from "@/hooks/useGoBack";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { morphNavCount } from "@/lib/gameTransition";
import { useUi } from "@/store/ui";
import { useMotionPrefs } from "@/lib/motion";
import { startFishstrapLaunchSync } from "@/store/fishstrapLaunch";
import { LaunchCard } from "@/components/fishstrap/LaunchCard";
import { FishstrapPrompt } from "@/components/fishstrap/FishstrapPrompt";
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

/** Nav order by first path segment (`""` is Home). */
const NAV_ORDER = NAV_PAGES.map((p) => (p.to === "/" ? "" : p.to.slice(1)));
const SLIDE = 48;

/** `custom` is the direction: 1 enters from the left and leaves to the right, -1 the reverse, 0 only fades. */
function pageSlide(slides: boolean, instant: boolean): Variants {
  const shift = (d: number, sign: number) => (slides ? d * SLIDE * sign : 0);
  const t = { duration: instant ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] };
  return {
    enter: (d: number) => ({ opacity: 0, x: shift(d, -1) }),
    center: { opacity: 1, x: 0, transition: t },
    exit: (d: number) => ({ opacity: 0, x: shift(d, 1), transition: { ...t, duration: instant ? 0 : 0.2 } }),
  };
}

/** Window chrome: title bar, top navigation bar, routed content (slides between nav pages), and global overlays. */
export function Shell() {
  const location = useLocation();
  const outlet = useOutlet();
  const segment = location.pathname.split("/")[1] ?? "";
  const m = useMotionPrefs();
  // Moving to a tab further along the nav slides the page in left to right; moving back, right to left.
  const prev = useRef(segment);
  const dir = useRef(0);
  if (prev.current !== segment) {
    const from = NAV_ORDER.indexOf(prev.current);
    const to = NAV_ORDER.indexOf(segment);
    dir.current = from < 0 || to < 0 ? 0 : to > from ? 1 : -1;
    prev.current = segment;
  }
  useKeyboardShortcuts();
  useEffect(() => {
    let off: (() => void) | undefined;
    let cancelled = false;
    void startFishstrapLaunchSync()
      .then((u) => (cancelled ? u() : (off = u)))
      .catch(() => {
        /* events unavailable: the Fishstrap page still shows the last snapshot on demand */
      });
    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-bg">
      <AmbientBackground />
      <TitleBar />
      <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar />
        <OfflineBanner />
        <main className="relative min-h-0 flex-1 overflow-hidden">
          {/* A morph navigation (card -> details, avatar -> profile, and back) bumps the key, which swaps the pages in one commit so the morph sees one page at a time. Every other change slides or fades. */}
          <AnimatePresence key={morphNavCount()} mode="popLayout" initial={false} custom={dir.current}>
            <motion.div
              key={segment}
              custom={dir.current}
              variants={pageSlide(m.full, m.off)}
              initial="enter"
              animate="center"
              exit="exit"
              className="h-full"
            >
              <PageScroller>{outlet}</PageScroller>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <CommandPalette />
      <Onboarding />
      <Toasts />
      <LaunchCard />
      <FishstrapPrompt />
    </div>
  );
}
