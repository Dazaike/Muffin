import type { HandlerKind } from "@/lib/types";

/** Human name for the program that owns the `roblox://` protocol. */
export const HANDLER_LABEL: Record<HandlerKind, string> = {
  roblox: "Roblox Player",
  bloxstrap: "Bloxstrap",
  fishstrap: "Fishstrap",
  other: "Custom launcher",
  none: "None",
};
