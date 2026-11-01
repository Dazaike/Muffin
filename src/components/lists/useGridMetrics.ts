import { useSettings } from "@/store/settings";

/**
 * Card min width and gap in px, matching the density CSS variables (`--card-min`, `--card-gap`).
 * `horizontal` (icon-left tiles) uses a wider minimum so a full-width grid lands on roughly 2–4 columns.
 */
export function useGridMetrics(layout: "vertical" | "horizontal" = "vertical"): { minWidth: number; gap: number } {
  const compact = useSettings((s) => s.values.density === "compact");
  if (layout === "horizontal") return compact ? { minWidth: 280, gap: 10 } : { minWidth: 320, gap: 16 };
  return compact ? { minWidth: 148, gap: 10 } : { minWidth: 176, gap: 16 };
}
