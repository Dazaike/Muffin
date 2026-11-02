import { lazy, Suspense, useEffect, useLayoutEffect, type ComponentType, type LazyExoticComponent } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { MotionConfig } from "motion/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Shell } from "@/components/shell/Shell";
import { queryClient } from "@/lib/queryClient";
import { applySettingsToDom, useSettings } from "@/store/settings";
import GameDetails from "@/pages/GameDetails";
import Home from "@/pages/Home";
import UserProfile from "@/pages/UserProfile";

// Home and the two morph targets (game details, profiles) stay in the main bundle so opening them never waits on a chunk.
// Everything else loads on demand, and is fetched in the background once the app is idle so navigation is still instant.
const Discover = lazy(() => import("@/pages/Discover"));
const Favorites = lazy(() => import("@/pages/Favorites"));
const Friends = lazy(() => import("@/pages/Friends"));
const Library = lazy(() => import("@/pages/Library"));
const Profile = lazy(() => import("@/pages/Profile"));
const Recent = lazy(() => import("@/pages/Recent"));
const Search = lazy(() => import("@/pages/Search"));
const Settings = lazy(() => import("@/pages/Settings"));
const Wallet = lazy(() => import("@/pages/Wallet"));

function Page({ page: Component }: { page: LazyExoticComponent<ComponentType> }) {
  return (
    <Suspense fallback={null}>
      <Component />
    </Suspense>
  );
}

function usePreloadPages() {
  useEffect(() => {
    const load = () => {
      void Promise.all([
        import("@/pages/Discover"),
        import("@/pages/Favorites"),
        import("@/pages/Friends"),
        import("@/pages/Library"),
        import("@/pages/Profile"),
        import("@/pages/Recent"),
        import("@/pages/Search"),
        import("@/pages/Settings"),
        import("@/pages/Wallet"),
      ]);
    };
    const id = window.setTimeout(load, 1500);
    return () => window.clearTimeout(id);
  }, []);
}

/** Applies appearance/performance settings to <html> whenever they change. */
function useSettingsEffect() {
  const values = useSettings((s) => s.values);
  useLayoutEffect(() => applySettingsToDom(values), [values]);
}

function AppInner() {
  useSettingsEffect();
  usePreloadPages();
  const intensity = useSettings((s) => s.values.animationIntensity);
  const reduceMotion = useSettings((s) => s.values.reduceMotion);
  const always = reduceMotion || intensity !== "full";

  return (
    <MotionConfig
      reducedMotion={always ? "always" : "user"}
      transition={intensity === "off" ? { duration: 0 } : undefined}
    >
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="discover" element={<Page page={Discover} />} />
          <Route path="search" element={<Page page={Search} />} />
          <Route path="library" element={<Page page={Library} />} />
          <Route path="favorites" element={<Page page={Favorites} />} />
          <Route path="recent" element={<Page page={Recent} />} />
          <Route path="friends" element={<Page page={Friends} />} />
          <Route path="wallet" element={<Page page={Wallet} />} />
          <Route path="profile" element={<Page page={Profile} />} />
          <Route path="settings" element={<Page page={Settings} />} />
          <Route path="game/:placeId" element={<GameDetails />} />
          <Route path="user/:userId" element={<UserProfile />} />
          <Route path="*" element={<Home />} />
        </Route>
      </Routes>
    </MotionConfig>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <AppInner />
      </HashRouter>
    </QueryClientProvider>
  );
}
