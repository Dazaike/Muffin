import { Switch } from "@/components/ui/Controls";
import { SettingRow, SettingsSection } from "@/components/settings/SettingRow";
import { useRobloxStatus } from "@/lib/roblox";
import { useFishstrapLaunch } from "@/store/fishstrapLaunch";
import { useSettings } from "@/store/settings";
import { LaunchSteps } from "./LaunchSteps";

/** "Hide Fishstrap": launch without Fishstrap's window and show its progress in Muffin instead. */
export function HidePage() {
  const hide = useSettings((s) => s.values.hideFishstrap);
  const set = useSettings((s) => s.set);
  const progress = useFishstrapLaunch((s) => s.progress);
  const handler = useRobloxStatus().data?.handler;
  const notFishstrap = handler !== undefined && handler !== "fishstrap";

  return (
    <>
      <SettingsSection title="Launch">
        <SettingRow
          title="Hide Fishstrap"
          description="Muffin starts Fishstrap without its window and shows what it's doing (connecting, downloading Roblox, applying mods, starting) inside Muffin instead."
        >
          <Switch label="Hide Fishstrap" checked={hide} onChange={(x) => void set("hideFishstrap", x)} />
        </SettingRow>
        {notFishstrap && (
          <div className="px-5 py-3 text-[13px] text-muted">
            Fishstrap isn't the program registered for roblox:// links on this PC, so launches don't go through it and
            this has no effect.
          </div>
        )}
        <div className="px-5 py-3 text-[13px] text-muted">
          Applies to launches started from Muffin. Fishstrap's own error dialogs are suppressed while hidden; Muffin
          shows the reason here instead.
        </div>
      </SettingsSection>

      <SettingsSection title="Launch status">
        <div className="px-5 py-4">
          {progress ? (
            <LaunchSteps progress={progress} />
          ) : (
            <div className="text-sm text-muted">No launch yet. Start an experience and its progress shows here.</div>
          )}
        </div>
      </SettingsSection>
    </>
  );
}
