import { ipc, toAppError } from "./ipc";
import { useAccount } from "@/store/account";
import { useLibrary } from "@/store/library";
import { useSettings } from "@/store/settings";
import { toast } from "@/store/ui";

const BOOT_TIMEOUT_MS = 4000;

/**
 * Hydrates every store in parallel. Resolves when all are loaded or after 4 s with whatever arrived
 * (and an error toast). Never rejects.
 */
export async function boot(): Promise<void> {
  const settled = { settings: false, library: false };

  const loads = Promise.all([
    ipc.settingsGetAll().then((raw) => {
      useSettings.getState().hydrate(raw);
      settled.settings = true;
    }),
    Promise.all([ipc.libraryList(), ipc.historyList(200), ipc.searchesList()]).then(([library, history, searches]) => {
      useLibrary.getState().hydrate({ library, history, searches });
      settled.library = true;
    }),
  ]);
  void useAccount.getState().init();
  void useAccount.getState().reload();
  void ipc.onNotifierNotice((n) => toast.error(n.message)).catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((r) => {
    timer = setTimeout(() => r("timeout"), BOOT_TIMEOUT_MS);
  });

  try {
    const res = await Promise.race([loads, timeout]);
    if (res === "timeout") {
      if (!settled.settings) useSettings.getState().hydrate(null);
      toast.error("Startup is taking longer than expected — some data may be missing");
    }
  } catch (e) {
    if (!settled.settings) useSettings.getState().hydrate(null);
    toast.error(`Couldn't load saved data: ${toAppError(e).message}`);
  } finally {
    clearTimeout(timer);
  }
}
