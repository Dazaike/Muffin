import { ipc, toAppError } from "./ipc";
import { queryClient } from "./queryClient";
import { useFishstrapPrompt } from "@/store/fishstrapPrompt";
import { platform } from "@/lib/platform";
import { useSettings } from "@/store/settings";
import { toast } from "@/store/ui";

/** Downloads and silently installs Fishstrap, keeping the prompt's "installing" state up. Resolves whether it worked. */
export async function installFishstrap(): Promise<boolean> {
  const prompt = useFishstrapPrompt.getState();
  prompt.setPhase("installing");
  try {
    await ipc.fishstrapInstall();
    toast.success("Fishstrap installed");
    return true;
  } catch (e) {
    toast.error(toAppError(e).message);
    return false;
  } finally {
    prompt.setPhase("closed");
    void queryClient.invalidateQueries({ queryKey: ["fishstrapStatus"] });
    void queryClient.invalidateQueries({ queryKey: ["robloxStatus"] });
  }
}

/**
 * Before a launch: if Fishstrap isn't installed (and no other custom launcher is), offer to install
 * it. "Use Roblox's default" remembers the choice and launches normally. Resolves false when the
 * launch should not go ahead (prompt closed, or the install failed).
 */
export async function ensureLauncher(): Promise<boolean> {
  if (platform !== "windows") return true;
  const { values, set } = useSettings.getState();
  if (values.fishstrapPrompt === "declined") return true;
  let missing = false;
  try {
    const [fishstrap, roblox] = await Promise.all([ipc.fishstrapStatus(), ipc.robloxStatus()]);
    const customLauncher = roblox.registered && (roblox.handler === "bloxstrap" || roblox.handler === "other");
    missing = !fishstrap.installed && !customLauncher;
  } catch {
    return true; // can't tell: don't block the launch
  }
  if (!missing) return true;

  const choice = await useFishstrapPrompt.getState().ask();
  if (choice === "dismiss") return false;
  if (choice === "deny") {
    await set("fishstrapPrompt", "declined");
    return true;
  }
  return installFishstrap();
}
