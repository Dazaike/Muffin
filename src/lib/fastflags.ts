import type { FastFlag } from "./types";

export type ParseResult = { flags: FastFlag[] } | { error: string };

/** Parses a FastFlag JSON object; booleans use Fishstrap's "True"/"False" capitalization. */
export function parseFlagJson(text: string): ParseResult {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { error: "That isn't valid JSON." };
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    return { error: "Expected a JSON object like { \"FFlagName\": true }." };
  }
  const flags: FastFlag[] = [];
  for (const [name, v] of Object.entries(doc)) {
    if (typeof v === "boolean") flags.push({ name, value: v ? "True" : "False" });
    else if (typeof v === "number") flags.push({ name, value: String(v) });
    else if (typeof v === "string") flags.push({ name, value: v });
    else return { error: `${name}: values must be a string, number or boolean.` };
  }
  return { flags };
}

/** Incoming flags override same-named current ones; result is sorted by name. */
export function mergeFlags(current: FastFlag[], incoming: FastFlag[]): FastFlag[] {
  const map = new Map<string, string>();
  for (const f of current) map.set(f.name, f.value);
  for (const f of incoming) map.set(f.name, f.value);
  return [...map].map(([name, value]) => ({ name, value })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
