import { Segmented, Switch } from "@/components/ui/Controls";
import { useSettings } from "@/store/settings";
import { SettingRow, SettingsSection } from "./SettingRow";

export function PerformanceTab() {
  const v = useSettings((s) => s.values);
  const set = useSettings((s) => s.set);
  return (
    <SettingsSection>
      <SettingRow
        title="Animation intensity"
        description="Full: springs and staggered entrances. Reduced: quick fades only. Off: no animation."
      >
        <Segmented
          value={v.animationIntensity}
          onChange={(x) => void set("animationIntensity", x)}
          options={[
            { value: "full", label: "Full" },
            { value: "reduced", label: "Reduced" },
            { value: "off", label: "Off" },
          ]}
        />
      </SettingRow>
      <SettingRow
        title="Reduce motion"
        description="Forces reduced motion regardless of intensity. Your system's reduce-motion preference is always respected as well."
      >
        <Switch label="Reduce motion" checked={v.reduceMotion} onChange={(x) => void set("reduceMotion", x)} />
      </SettingRow>
      <SettingRow
        title="Lightweight rendering"
        description="Turns off blur and uses solid surfaces. Best for older GPUs."
      >
        <Switch label="Lightweight rendering" checked={v.lightweightMode} onChange={(x) => void set("lightweightMode", x)} />
      </SettingRow>
    </SettingsSection>
  );
}
