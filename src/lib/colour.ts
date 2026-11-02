/** The accent is `oklch(L C hue)`; keep these in step with `--accent` in styles/theme.css. */
const ACCENT_L = 0.66;
const ACCENT_C = 0.19;

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** `#rrggbb` (a trailing alpha pair is ignored) to 0..1 channels, or null. */
function rgbOf(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim());
  if (!m?.[1]) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** `#rrggbb` from the picker, which adds two alpha digits when not opaque. The app never uses alpha. */
export function stripAlpha(hex: string): string {
  return /^#[0-9a-f]{6}/i.test(hex) ? hex.slice(0, 7).toLowerCase() : hex;
}

/** OKLCH hue (0-359) of a colour, or `null` for greys, where hue means nothing. */
export function hueOf(hex: string): number | null {
  const rgb = rgbOf(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(lin) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  if (Math.hypot(a, bb) < 0.02) return null;
  const h = (Math.atan2(bb, a) * 180) / Math.PI;
  return Math.round((h + 360) % 360) % 360;
}

/** Linear sRGB of an OKLCH colour (unclamped). */
function oklchToLinear(l0: number, c: number, hue: number): [number, number, number] {
  const h = (hue * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l = (l0 + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (l0 - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (l0 - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** The accent colour for a hue as `#rrggbb`: chroma is reduced until it fits sRGB, so the hue holds. */
export function accentHex(hue: number): string {
  let c = ACCENT_C;
  let rgb = oklchToLinear(ACCENT_L, c, hue);
  while (c > 0 && rgb.some((v) => v < -0.0005 || v > 1.0005)) {
    c -= 0.005;
    rgb = oklchToLinear(ACCENT_L, Math.max(0, c), hue);
  }
  const bytes = rgb.map((v) => Math.round(clamp01(gam(clamp01(v))) * 255));
  return `#${bytes.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
