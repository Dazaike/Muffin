import { Gamepad2 } from "lucide-react";
import { HANDLER_LABEL } from "@/components/settings/handler";
import { useRobloxStatus } from "@/lib/roblox";

/** Explains that the Roblox Player uses its own login, and shows which program handles `roblox://`. */
export function PlayerCallout() {
  const status = useRobloxStatus();
  const s = status.data;

  let detected: string;
  if (status.isError) detected = `Couldn't detect the launcher: ${status.error.message}`;
  else if (!s) detected = "Detecting launcher…";
  else if (!s.registered) detected = "Detected launcher: none — Roblox isn't registered on this PC.";
  else if (!s.exeExists) detected = `Detected launcher: ${HANDLER_LABEL[s.handler]} (its file is missing).`;
  else detected = `Detected launcher: ${HANDLER_LABEL[s.handler]}.`;

  return (
    <section className="surface flex gap-4 rounded-panel p-5">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Gamepad2 size={20} strokeWidth={1.75} />
      </div>
      <div className="min-w-0">
        <h3 className="font-semibold">Roblox Player account</h3>
        <p className="mt-1 text-sm text-muted">
          Roblox Player uses its own login; games launch as whichever account the Player or bootstrapper is signed
          into, which may differ from your account in Muffin.
        </p>
        <p className="mt-2 truncate text-sm">{detected}</p>
      </div>
    </section>
  );
}
