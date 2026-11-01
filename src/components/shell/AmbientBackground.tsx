import { useSettings } from "@/store/settings";
import { useBackgroundLoader } from "@/store/background";

/**
 * Fixed full-window image behind the app. Dim and blur apply to the image layer only; blur is
 * skipped in lightweight mode. The wrapper is oversized by twice the blur radius so blurred edges
 * never fade into the page background.
 */
function BackgroundImageLayer({ url }: { url: string }) {
  const dim = useSettings((s) => s.values.backgroundDim);
  const blur = useSettings((s) => (s.values.lightweightMode ? 0 : s.values.backgroundBlur));
  const bleed = blur * 2;
  return (
    <div className="app-bg" aria-hidden>
      <div className="absolute" style={{ inset: -bleed }}>
        <img
          src={url}
          alt=""
          draggable={false}
          className="size-full object-cover select-none"
          style={blur > 0 ? { filter: `blur(${blur}px)` } : undefined}
        />
      </div>
      <div className="absolute inset-0 bg-bg" style={{ opacity: dim / 100 }} />
    </div>
  );
}

/** App backdrop: the user's custom image when one is active; otherwise the plain solid app background. */
export function AmbientBackground() {
  const { active, url } = useBackgroundLoader();
  if (active && url) return <BackgroundImageLayer url={url} />;
  return null;
}
