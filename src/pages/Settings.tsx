import { useCallback, useId, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Database, Fish, Gamepad2, Palette, Rocket, UserRound, Zap } from "lucide-react";
import { AccountTab } from "@/components/settings/AccountTab";
import { AppearanceTab } from "@/components/settings/AppearanceTab";
import { FishstrapTab } from "@/components/settings/FishstrapTab";
import { LauncherTab } from "@/components/settings/LauncherTab";
import { PerformanceTab } from "@/components/settings/PerformanceTab";
import { PrivacyTab } from "@/components/settings/PrivacyTab";
import { RobloxTab } from "@/components/settings/RobloxTab";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/lib/cn";
import { useMotionPrefs } from "@/lib/motion";
import { platform } from "@/lib/platform";

const ALL_TABS = [
  { id: "appearance", label: "Appearance", icon: <Palette size={16} strokeWidth={1.75} />, content: <AppearanceTab /> },
  { id: "performance", label: "Performance", icon: <Zap size={16} strokeWidth={1.75} />, content: <PerformanceTab /> },
  { id: "launcher", label: "Launcher", icon: <Rocket size={16} strokeWidth={1.75} />, content: <LauncherTab /> },
  { id: "roblox", label: "Roblox", icon: <Gamepad2 size={16} strokeWidth={1.75} />, content: <RobloxTab /> },
  { id: "fishstrap", label: "Fishstrap", icon: <Fish size={16} strokeWidth={1.75} />, content: <FishstrapTab /> },
  { id: "account", label: "Account", icon: <UserRound size={16} strokeWidth={1.75} />, content: <AccountTab /> },
  { id: "privacy", label: "Privacy & Data", icon: <Database size={16} strokeWidth={1.75} />, content: <PrivacyTab /> },
] as const satisfies readonly { id: string; label: string; icon: ReactNode; content: ReactNode }[];

const TABS = ALL_TABS.filter((t) => t.id !== "fishstrap" || platform === "windows");

type TabId = (typeof TABS)[number]["id"];

const isTabId = (v: string | null): v is TabId => TABS.some((t) => t.id === v);

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const active: TabId = isTabId(raw) ? raw : "appearance";
  const group = useId();
  const m = useMotionPrefs();

  const select = useCallback(
    (id: TabId) => setParams({ tab: id }, { replace: true }),
    [setParams],
  );

  const current = TABS.find((t) => t.id === active) ?? ALL_TABS[0];

  return (
    <Page>
      <PageHeader title="Settings" />
      <div className="grid gap-6 md:grid-cols-[210px_minmax(0,1fr)]">
        <div
          role="tablist"
          aria-orientation="vertical"
          className="no-scrollbar flex gap-1 overflow-x-auto md:sticky md:top-4 md:flex-col md:self-start md:overflow-visible"
        >
          {TABS.map((t) => {
            const isActive = t.id === active;
            return (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={isActive}
                onClick={() => select(t.id)}
                className={cn(
                  "focus-ring relative flex shrink-0 cursor-pointer items-center gap-2.5 rounded-[12px] px-3.5 py-2.5 text-left text-sm font-medium transition-colors",
                  isActive ? "text-fg" : "text-muted hover:bg-white/5 hover:text-fg",
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId={`settings-tab-${group}`}
                    transition={m.spring}
                    className="absolute inset-0 rounded-[12px] bg-white/8"
                  >
                    <span className="accent-gradient absolute top-2.5 bottom-2.5 left-0 w-[3px] rounded-full max-md:hidden" />
                  </motion.span>
                )}
                <span className="relative flex items-center gap-2.5">
                  {t.icon}
                  {t.label}
                </span>
              </button>
            );
          })}
        </div>

        <div role="tabpanel" className="min-w-0 max-w-3xl">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={current.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={m.fast}
            >
              {current.content}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </Page>
  );
}
