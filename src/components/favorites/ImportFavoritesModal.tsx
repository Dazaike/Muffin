import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Controls";
import { Modal } from "@/components/ui/Modal";
import { SmartImage } from "@/components/ui/SmartImage";
import type { FavoritesDiff } from "@/lib/dataTypes";
import { ipc, toAppError } from "@/lib/ipc";
import type { AppError } from "@/lib/types";
import { reloadLibraryData } from "@/store/reload";
import { toast } from "@/store/ui";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Option({ title, hint, checked, onChange }: { title: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <div className="text-[13px] text-muted">{hint}</div>
      </div>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

/**
 * One-way import of the signed-in Roblox account's favorite games into the library. Fetches and previews first;
 * nothing is written to Muffin until the user confirms, and nothing is ever written to Roblox.
 */
export function ImportFavoritesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  // The key changes on every close/retry, so each opening fetches the account's current favorites.
  const [runId, setRunId] = useState(1);
  const [addToLibrary, setAddToLibrary] = useState(true);
  const [markFavorite, setMarkFavorite] = useState(true);
  const [applying, setApplying] = useState(false);

  const query = useQuery<FavoritesDiff, AppError>({
    queryKey: ["robloxFavorites", runId],
    queryFn: () => ipc.syncRobloxFavorites(),
    enabled: open,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });

  const close = () => {
    if (applying) return;
    setRunId((n) => n + 1);
    onClose();
  };

  const diff = query.data;
  const effectiveAdd = addToLibrary || markFavorite;
  const canApply = !!diff && diff.newCount > 0 && effectiveAdd && !applying;
  const fresh = diff?.items.filter((g) => !g.inLibrary) ?? [];

  const apply = async () => {
    setApplying(true);
    try {
      const r = await ipc.applyRobloxFavorites(addToLibrary, markFavorite);
      await reloadLibraryData();
      toast.success(
        r.added > 0
          ? `Added ${plural(r.added, "game", "games")}${markFavorite ? " to your favorites" : " to your library"}`
          : "Nothing new to add",
      );
      setApplying(false);
      close();
    } catch (e) {
      setApplying(false);
      toast.error(`Couldn't import favorites: ${toAppError(e).message}`);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Import favorites from Roblox" widthClass="max-w-lg">
      {query.isPending || query.isFetching ? (
        <div className="flex flex-col gap-3 py-2" aria-busy>
          <div className="text-sm text-muted">Reading your Roblox favorites…</div>
          <div className="skeleton h-12 rounded-card" />
          <div className="skeleton h-12 rounded-card" />
        </div>
      ) : query.isError ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">{query.error.message}</p>
          <div className="flex justify-end gap-2">
            {query.error.code === "auth_expired" ? (
              <Button
                variant="primary"
                onClick={() => {
                  close();
                  navigate("/profile");
                }}
              >
                Go to Profile
              </Button>
            ) : (
              <Button variant="glass" onClick={() => setRunId((n) => n + 1)}>
                Retry
              </Button>
            )}
          </div>
        </div>
      ) : diff ? (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-muted">
            <span className="font-medium text-fg">{plural(diff.newCount, "new game", "new games")}</span> ·{" "}
            {diff.existingCount} already in your library
            {diff.truncated && <> · showing the first {diff.total} of your favorites</>}
            {diff.skipped > 0 && <> · {plural(diff.skipped, "game", "games")} skipped (no playable place)</>}
          </p>

          {fresh.length > 0 && (
            <ul className="surface max-h-56 divide-y divide-white/6 overflow-y-auto rounded-card">
              {fresh.map((g) => (
                <li key={g.placeId} className="flex items-center gap-3 px-3 py-2">
                  <SmartImage src={g.iconUrl} name={g.name} className="size-9 shrink-0 rounded-[10px]" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{g.name}</div>
                    {g.creator && <div className="truncate text-xs text-muted">by {g.creator}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {diff.newCount > 0 ? (
            <div className="flex flex-col gap-4">
              <Option
                title="Add to library"
                hint="Keep these games in My Library."
                checked={effectiveAdd}
                onChange={(v) => {
                  setAddToLibrary(v);
                  if (!v) setMarkFavorite(false);
                }}
              />
              <Option
                title="Mark as favorite"
                hint="Also shows them under Favorites (adds them to the library too)."
                checked={markFavorite}
                onChange={(v) => {
                  setMarkFavorite(v);
                  if (v) setAddToLibrary(true);
                }}
              />
              <p className="text-xs text-muted">
                One-way: games already in your library keep their flags and order, and Roblox is never changed.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted">Everything from your Roblox favorites is already in Muffin.</p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={close} disabled={applying}>
              {diff.newCount > 0 ? "Cancel" : "Close"}
            </Button>
            {diff.newCount > 0 && (
              <Button variant="primary" disabled={!canApply} onClick={() => void apply()}>
                {applying ? "Importing…" : `Import ${plural(diff.newCount, "game", "games")}`}
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
