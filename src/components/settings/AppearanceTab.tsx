import { useRef, useState } from "react";
import { ColorPicker, type ColorSwatch } from "@/components/ui/color-picker/ColorPicker";
import { Segmented } from "@/components/ui/Controls";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { accentHex, hueOf, stripAlpha } from "@/lib/colour";
import { DEFAULT_SETTINGS, useSettings } from "@/store/settings";
import { SettingRow, SettingsSection } from "./SettingRow";
import { BackgroundSection } from "./BackgroundSection";

/** How long picking has to pause before the colour is written to the database. */
const SAVE_AFTER_MS = 500;

/** Bumped by a reset so a colour still waiting to be saved isn't written over the defaults. */
let resetEpoch = 0;
const RESET_KEYS = ["accentHue", "backgroundColor", "backgroundDim", "backgroundBlur"] as const;

/**
 * Dragging previews live without touching the database; the value is saved once picking pauses. The
 * pre-drag value is restored just before saving so a failed save rolls back to what was stored.
 */
function useLivePick<T>(read: () => T, apply: (v: T) => void, save: (v: T) => void) {
  const before = useRef<T | null>(null);
  const timer = useRef<number | undefined>(undefined);
  return (next: T) => {
    before.current ??= read();
    apply(next);
    window.clearTimeout(timer.current);
    const epoch = resetEpoch;
    timer.current = window.setTimeout(() => {
      const from = before.current;
      before.current = null;
      if (epoch !== resetEpoch) return;
      if (from !== null) apply(from);
      save(next);
    }, SAVE_AFTER_MS);
  };
}

/** The accent is a hue: whatever colour is picked, its hue is kept and the shade stays the app's. */
function AccentPicker() {
  const hue = useSettings((s) => s.values.accentHue);
  const bg = useSettings((s) => s.values.backgroundColor);
  const set = useSettings((s) => s.set);
  const [picked, setPicked] = useState(() => accentHex(hue));
  const pick = useLivePick<number>(
    () => useSettings.getState().values.accentHue,
    (h) => useSettings.setState((s) => ({ values: { ...s.values, accentHue: h } })),
    (h) => void set("accentHue", h),
  );
  return (
    <ColorPicker
      label="Accent"
      align="end"
      value={picked}
      background={bg}
      onValueChange={(hex) => {
        setPicked(hex);
        const h = hueOf(stripAlpha(hex));
        if (h !== null) pick(h);
      }}
    />
  );
}

const BG_PRESETS: ColorSwatch[] = ["#07070b", "#000000", "#0b1220", "#0f0a1a", "#0a1410", "#160b0b", "#1a1a1f"].map((color) => ({ id: color, color }));

function BackgroundColourPicker() {
  const colour = useSettings((s) => s.values.backgroundColor);
  const set = useSettings((s) => s.set);
  const [picked, setPicked] = useState(colour);
  const pick = useLivePick<string>(
    () => useSettings.getState().values.backgroundColor,
    (c) => useSettings.setState((s) => ({ values: { ...s.values, backgroundColor: c } })),
    (c) => void set("backgroundColor", c),
  );
  return (
    <ColorPicker
      label="Background"
      align="end"
      value={picked}
      background="#ececf4"
      defaultSwatches={BG_PRESETS}
      onValueChange={(hex) => {
        setPicked(hex);
        pick(stripAlpha(hex));
      }}
    />
  );
}

export function AppearanceTab() {
  const v = useSettings((s) => s.values);
  const set = useSettings((s) => s.set);
  // Remounts the colour pickers so they drop their own picked-colour state.
  const [pickerKey, setPickerKey] = useState(0);
  const isDefault =
    v.accentHue === DEFAULT_SETTINGS.accentHue &&
    v.backgroundColor.toLowerCase() === DEFAULT_SETTINGS.backgroundColor &&
    v.backgroundDim === DEFAULT_SETTINGS.backgroundDim &&
    v.backgroundBlur === DEFAULT_SETTINGS.backgroundBlur;
  const resetTheme = () => {
    resetEpoch++;
    setPickerKey((k) => k + 1);
    for (const key of RESET_KEYS) void set(key, DEFAULT_SETTINGS[key]);
  };
  return (
    <div className="flex flex-col gap-6">
      <SettingsSection>
        <SettingRow title="Accent colour" description="Tints buttons and highlights.">
          <AccentPicker key={`a${pickerKey}`} />
        </SettingRow>
        <SettingRow title="Background colour" description="The colour behind the whole app. Cards and panels are shaded from it. Separate from the accent.">
          <BackgroundColourPicker key={`b${pickerKey}`} />
        </SettingRow>
        <SettingRow title="Reset colours" description="Puts the accent, background colour and background dim and blur back to Muffin's defaults. A custom background image is kept.">
          <Button variant="glass" size="sm" icon={<RotateCcw size={14} strokeWidth={1.75} />} disabled={isDefault} onClick={resetTheme}>
            Reset
          </Button>
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
