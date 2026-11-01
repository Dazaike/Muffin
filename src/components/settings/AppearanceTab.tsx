import { useRef } from "react";
import { ColorWheel } from "@/components/ui/ColorWheel";
import { Segmented } from "@/components/ui/Controls";
import { DEFAULT_SETTINGS, useSettings } from "@/store/settings";
import { SettingRow, SettingsSection } from "./SettingRow";
import { BackgroundSection } from "./BackgroundSection";

/**
 * Dragging previews the hue live without touching the database; releasing persists it once. The
 * pre-drag value is restored just before saving so a failed save rolls back to what was stored.
 */
function AccentPicker() {
  const hue = useSettings((s) => s.values.accentHue);
  const set = useSettings((s) => s.set);
  const before = useRef<number | null>(null);
  return (
    <ColorWheel
      label="Accent colour hue"
      value={hue}
      defaultValue={DEFAULT_SETTINGS.accentHue}
      onChange={(h) => {
        before.current ??= useSettings.getState().values.accentHue;
        useSettings.setState((s) => ({ values: { ...s.values, accentHue: h } }));
      }}
      onCommit={(h) => {
        const from = before.current;
        before.current = null;
        if (from !== null) useSettings.setState((s) => ({ values: { ...s.values, accentHue: from } }));
        void set("accentHue", h);
      }}
    />
  );
}

export function AppearanceTab() {
  const v = useSettings((s) => s.values);
  const set = useSettings((s) => s.set);
  return (
    <div className="flex flex-col gap-6">
      <SettingsSection>
        <SettingRow title="Accent colour" description="Tints buttons and highlights.">
          <AccentPicker />
        </SettingRow>
        <SettingRow title="Density" description="Compact shrinks cards and spacing to fit more on screen.">
          <Segmented
            value={v.density}
            onChange={(x) => void set("density", x)}
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" },
            ]}
          />
        </SettingRow>
      </SettingsSection>

      <BackgroundSection />

      <SettingsSection title="Layout">
        <SettingRow title="Game card shape" description="Square matches Roblox's own game thumbnails. Portrait is the taller poster style.">
          <Segmented
            value={v.cardShape}
            onChange={(x) => void set("cardShape", x)}
            options={[
              { value: "portrait", label: "Portrait" },
              { value: "square", label: "Square" },
            ]}
          />
        </SettingRow>
        <SettingRow
          title="Discover card layout"
          description="Horizontal shows icon-left tiles, 2–4 per row, in the Discover grid. The list view is unchanged."
        >
          <Segmented
            value={v.discoverCards}
            onChange={(x) => void set("discoverCards", x)}
            options={[
              { value: "vertical", label: "Vertical cards" },
              { value: "horizontal", label: "Horizontal cards" },
            ]}
          />
        </SettingRow>
        <SettingRow title="Library view">
          <Segmented
            value={v.libraryView}
            onChange={(x) => void set("libraryView", x)}
            options={[
              { value: "grid", label: "Grid" },
              { value: "list", label: "List" },
            ]}
          />
        </SettingRow>
        <SettingRow title="Library sort">
          <Segmented
            className="flex-wrap"
            value={v.librarySort}
            onChange={(x) => void set("librarySort", x)}
            options={[
              { value: "name", label: "Name" },
              { value: "lastPlayed", label: "Last played" },
              { value: "added", label: "Date added" },
              { value: "custom", label: "Custom" },
            ]}
          />
        </SettingRow>
      </SettingsSection>
    </div>
  );
}
