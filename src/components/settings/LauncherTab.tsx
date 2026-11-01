import { useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Segmented, Switch } from "@/components/ui/Controls";
import { useSettings } from "@/store/settings";
import { NotificationsTab } from "./NotificationsTab";
import { SettingRow, SettingsSection } from "./SettingRow";

export function LauncherTab() {
  const v = useSettings((s) => s.values);
  const set = useSettings((s) => s.set);
  const syncAutostart = useSettings((s) => s.syncAutostart);

  // The OS (not our DB) is the source of truth for whether Muffin starts with Windows.
  useEffect(() => {
    void syncAutostart();
  }, [syncAutostart]);

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="Startup">
        <SettingRow title="Start with Windows" description="Launch Muffin when you sign in to Windows.">
          <Switch label="Start with Windows" checked={v.autoStart} onChange={(x) => void set("autoStart", x)} />
        </SettingRow>
        <SettingRow
          title="Start minimized"
          description="When Muffin starts with Windows, stay hidden in the system tray instead of opening a window."
        >
          <Switch label="Start minimized" checked={v.startMinimized} onChange={(x) => void set("startMinimized", x)} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Window">
        <SettingRow title="When closing the window" description="Tray keeps Muffin running so the global shortcut and tray icon stay available.">
          <Segmented
            value={v.closeBehavior}
            onChange={(x) => void set("closeBehavior", x)}
            options={[
              { value: "quit", label: "Quit" },
              { value: "tray", label: "Minimize to tray" },
            ]}
          />
        </SettingRow>
        <SettingRow
          title="After launching a game"
          description="Applies once Roblox is detected running after a launch from Muffin. Playtime tracking stops when Muffin closes."
        >
          <Segmented
            value={v.afterLaunch}
            onChange={(x) => void set("afterLaunch", x)}
            options={[
              { value: "nothing", label: "Keep open" },
              { value: "tray", label: "Minimize to tray" },
              { value: "quit", label: "Close Muffin" },
            ]}
          />
        </SettingRow>
        <SettingRow title="Global shortcut" description="Ctrl + Alt + M shows or hides Muffin from anywhere.">
          <Switch label="Global shortcut" checked={v.globalShortcut} onChange={(x) => void set("globalShortcut", x)} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Home">
        <SettingRow
          title="Show my Roblox Continue row"
          description="Adds games from your Roblox Continue / recently played list to Continue Playing, after your Muffin launches. Needs a signed-in Roblox account. Muffin launches are recorded by Roblox itself when the game starts; Muffin cannot write to your Roblox history."
        >
          <Switch label="Show my Roblox Continue row" checked={v.continueFromRoblox} onChange={(x) => void set("continueFromRoblox", x)} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Notifications">
        <SettingRow
          title="Launch notifications"
          description="Show a system notification when a launch is handed off or fails while Muffin isn't focused."
        >
          <Switch label="Launch notifications" checked={v.notifications} onChange={(x) => void set("notifications", x)} />
        </SettingRow>
      </SettingsSection>

      <NotificationsTab />

      <SettingsSection title="Welcome">
        <SettingRow title="Welcome tour" description="Show the first-run setup dialog again.">
          <Button variant="glass" size="sm" onClick={() => void set("onboarded", false)}>
            Show again
          </Button>
        </SettingRow>
      </SettingsSection>
    </div>
  );
}
