/** 999 → "999", 1000 → "1K", 1234 → "1.2K", 3_400_000 → "3.4M", 1.1e9 → "1.1B". */
export function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  const units: [number, string][] = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      // Truncate (not round) to one decimal so 999_999 never shows as "1000K".
      const v = Math.floor((abs * 10) / size) / 10;
      const s = Number.isInteger(v) ? String(v) : v.toFixed(1);
      return `${n < 0 ? "-" : ""}${s}${suffix}`;
    }
  }
  return String(Math.trunc(n));
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 d ago", "2 mo ago", "1 y ago". */
export function relativeTime(ms: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${Math.max(1, min)} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 30) return `${day} d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} mo ago`;
  return `${Math.floor(day / 365) || 1} y ago`;
}

/** Approval percent 0–100, or null when there are no votes. */
export function percent(up: number, down: number): number | null {
  const total = up + down;
  if (total <= 0) return null;
  return Math.round((up / total) * 100);
}

/** ISO timestamp → "Jul 14, 2017" (UTC calendar day, so it never shifts with the viewer's zone); null if unparseable. */
export function formatDate(iso: string | undefined | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export type DayBucket = "Today" | "Yesterday" | "Earlier";

/** Groups a timestamp relative to local midnight: "Today" | "Yesterday" | "Earlier". */
export function dayBucket(ms: number, now: number = Date.now()): DayBucket {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const startToday = d.getTime();
  if (ms >= startToday) return "Today";
  if (ms >= startToday - 86_400_000) return "Yesterday";
  return "Earlier";
}

/** "<1 min", "42 min", "3h 20m", "3h", "120h". Whole minutes, never rounded up. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0 min";
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return "<1 min";
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 || h >= 100 ? `${h}h` : `${h}h ${m}m`;
}
