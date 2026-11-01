import { useRef } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Slider } from "@/components/ui/Controls";
import { useBackground } from "@/store/background";
import { BACKGROUND_BLUR_RANGE, BACKGROUND_DIM_RANGE, useSettings } from "@/store/settings";
import { SettingRow, SettingsSection } from "./SettingRow";

type SliderKey = "backgroundDim" | "backgroundBlur";

/**
 * Drag previews the value live without touching the database; releasing persists it once. The
 * pre-drag value is restored just before saving so a failed save rolls back to what was stored.
 */
function useCommittedSlider(key: SliderKey) {
  const value = useSettings((s) => s.values[key]);
  const set = useSettings((s) => s.set);
  const before = useRef<number | null>(null);
  return {
    value,
    onChange: (v: number) => {
      before.current ??= useSettings.getState().values[key];
      useSettings.setState((s) => ({ values: { ...s.values, [key]: v } }));
    },
    onCommit: (v: number) => {
      const from = before.current;
      before.current = null;
      if (from !== null) useSettings.setState((s) => ({ values: { ...s.values, [key]: from } }));
      void set(key, v);
    },
  };
}

export function BackgroundSection() {
  const active = useSettings((s) => s.values.backgroundImage);
  const url = useBackground((s) => s.url);
  const busy = useBackground((s) => s.busy);
  const pick = useBackground((s) => s.pick);
  const remove = useBackground((s) => s.remove);
  const dim = useCommittedSlider("backgroundDim");
  const blur = useCommittedSlider("backgroundBlur");

  return (
    <SettingsSection title="Background">
      <SettingRow
        title="Custom image"
        description="PNG, JPG, WebP or GIF. Stored only on this device (max 12 MB)."
      >
        <div className="flex items-center gap-3">
          <div className="h-12 w-20 shrink-0 overflow-hidden rounded-[10px] bg-white/6" aria-hidden>
            {active && url && <img src={url} alt="" draggable={false} className="size-full object-cover" />}
          </div>
          <Button variant="glass" size="sm" icon={<ImagePlus size={15} />} disabled={busy} onClick={() => void pick()}>
            Choose image…
          </Button>
          {active && (
            <Button variant="ghost" size="sm" icon={<Trash2 size={15} />} disabled={busy} onClick={() => void remove()}>
              Remove
            </Button>
          )}
        </div>
      </SettingRow>
      {active && (
        <>
          <SettingRow title="Dim" description="Darkens the image so text stays readable.">
            <Slider
              label="Background dim"
              min={BACKGROUND_DIM_RANGE.min}
              max={BACKGROUND_DIM_RANGE.max}
              value={dim.value}
              onChange={dim.onChange}
              onCommit={dim.onCommit}
              format={(v) => `${v}%`}
            />
          </SettingRow>
          <SettingRow title="Blur" description="Softens the image only, not the app. Skipped in lightweight mode.">
            <Slider
              label="Background blur"
              min={BACKGROUND_BLUR_RANGE.min}
              max={BACKGROUND_BLUR_RANGE.max}
              value={blur.value}
              onChange={blur.onChange}
              onCommit={blur.onCommit}
              format={(v) => `${v}px`}
            />
          </SettingRow>
        </>
      )}
    </SettingsSection>
  );
}
