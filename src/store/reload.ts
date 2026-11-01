import { ipc } from "@/lib/ipc";
import { useLibrary } from "./library";
import { useSettings } from "./settings";

/** Re-reads library, history and searches from SQLite into the store (after import / bulk sync). */
export async function reloadLibraryData(): Promise<void> {
  const [library, history, searches] = await Promise.all([ipc.libraryList(), ipc.historyList(), ipc.searchesList()]);
  useLibrary.getState().hydrate({ library, history, searches });
}

/** Re-reads persisted settings (after an import that may have changed them). */
export async function reloadSettings(): Promise<void> {
  useSettings.getState().hydrate(await ipc.settingsGetAll());
  await useSettings.getState().syncAutostart();
}
