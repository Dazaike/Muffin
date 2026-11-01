import { useLayoutEffect } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { MotionConfig } from "motion/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Shell } from "@/components/shell/Shell";
import { queryClient } from "@/lib/queryClient";
import { applySettingsToDom, useSettings } from "@/store/settings";
import Discover from "@/pages/Discover";
import Favorites from "@/pages/Favorites";
import Friends from "@/pages/Friends";
import GameDetails from "@/pages/GameDetails";
import Home from "@/pages/Home";
import Library from "@/pages/Library";
import Profile from "@/pages/Profile";
import Recent from "@/pages/Recent";
import Search from "@/pages/Search";
import Settings from "@/pages/Settings";
import Wallet from "@/pages/Wallet";

/** Applies appearance/performance settings to <html> whenever they change. */
function useSettingsEffect() {
  const values = useSettings((s) => s.values);
  useLayoutEffect(() => applySettingsToDom(values), [values]);
}

function AppInner() {
  useSettingsEffect();
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
          <Route path="discover" element={<Discover />} />
          <Route path="search" element={<Search />} />
          <Route path="library" element={<Library />} />
          <Route path="favorites" element={<Favorites />} />
          <Route path="recent" element={<Recent />} />
          <Route path="friends" element={<Friends />} />
          <Route path="wallet" element={<Wallet />} />
          <Route path="profile" element={<Profile />} />
          <Route path="settings" element={<Settings />} />
          <Route path="game/:placeId" element={<GameDetails />} />
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
