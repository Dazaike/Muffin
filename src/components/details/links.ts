import { ipc, toAppError } from "@/lib/ipc";
import { toast } from "@/store/ui";

/** The experience's page on roblox.com (also what "Copy link" copies). */
export const gamePageUrl = (placeId: number) => `https://www.roblox.com/games/${placeId}`;

/** Opens an allowlisted https link in the default browser; failures surface as a toast. */
export function openLink(url: string): void {
  void ipc.openExternal(url).catch((e) => toast.error(toAppError(e).message));
}

/** Copies text through the webview clipboard, with a toast either way. */
export async function copyText(text: string, doneMessage: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(doneMessage);
  } catch {
    toast.error("Couldn't copy to the clipboard");
  }
}
