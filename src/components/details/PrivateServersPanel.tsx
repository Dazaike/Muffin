import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Lock, Pencil, Plus, Trash2, X } from "lucide-react";
import { PlayButton } from "@/components/game/PlayButton";
import { Button } from "@/components/ui/Button";
import { ConfirmModal, Modal } from "@/components/ui/Modal";
import { relativeTime } from "@/lib/format";
import { ipc, toAppError } from "@/lib/ipc";
import type { AppError, GameRef, PrivateServer } from "@/lib/types";
import { useResetOnAccountChange } from "@/hooks/useResetOnAccountChange";
import { useLaunch } from "@/store/launch";
import { toast } from "@/store/ui";
import { OwnedServersSection } from "./OwnedServersSection";
import { IconBtn, inputClass } from "./serverUi";

const MAX_LABEL = 40;

function AddServerForm({
  placeId,
  onAdded,
  onCancel,
}: {
  placeId: number;
  onAdded: (s: PrivateServer) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState("");
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onAdded(await ipc.addPrivateServer(placeId, label.trim() || undefined, link.trim()));
    } catch (err) {
      setError(toAppError(err).message);
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Label</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={MAX_LABEL}
          placeholder="Private Server"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Share link</span>
        <input
          data-autofocus
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            setError(null);
          }}
          placeholder="https://www.roblox.com/share?code=…&type=Server"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          className={inputClass}
        />
        <span className="text-xs text-muted">
          On roblox.com open the private server's page and copy its share link (roblox.com/share?code=…&amp;type=Server).
          Muffin only stores the link's code on this PC.
        </span>
      </label>
      {error && (
        <div role="alert" className="rounded-[12px] bg-danger/12 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={busy || link.trim().length === 0}>
          Add server
        </Button>
      </div>
    </form>
  );
}

function ServerRow({
  server,
  game,
  onRename,
  onRemove,
}: {
  server: PrivateServer;
  game: GameRef;
  onRename: (s: PrivateServer, label: string) => Promise<boolean>;
  onRemove: (s: PrivateServer) => void;
}) {
  const launchPrivate = useLaunch((s) => s.launchPrivate);
  const [draft, setDraft] = useState<string | null>(null);

  const save = async () => {
    if (draft === null) return;
    const next = draft.trim();
    if (next && next !== server.label) {
      if (!(await onRename(server, next))) return; // keep editing on failure
    }
    setDraft(null);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        `https://www.roblox.com/share?code=${encodeURIComponent(server.code)}&type=${encodeURIComponent(server.kind)}`,
      );
      toast.success("Share link copied");
    } catch {
      toast.error("Couldn't copy to the clipboard");
    }
  };

  return (
    <li className="flex items-center gap-2 rounded-[12px] bg-white/4 p-2 pl-3">
      <Lock size={15} strokeWidth={1.75} className="shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        {draft !== null ? (
          <input
            autoFocus
            value={draft}
            maxLength={MAX_LABEL}
            aria-label="Server label"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              else if (e.key === "Escape") {
                e.stopPropagation();
                setDraft(null);
              }
            }}
            className={`${inputClass} h-8`}
          />
        ) : (
          <>
            <div className="truncate text-sm font-medium">{server.label}</div>
            <div className="truncate text-xs text-muted">Saved {relativeTime(server.createdAt)}</div>
          </>
        )}
      </div>
      {draft !== null ? (
        <>
          <IconBtn label="Save name" onClick={() => void save()}>
            <Check size={16} strokeWidth={1.75} />
          </IconBtn>
          <IconBtn label="Cancel rename" onClick={() => setDraft(null)}>
            <X size={16} strokeWidth={1.75} />
          </IconBtn>
        </>
      ) : (
        <>
          <PlayButton game={game} size="sm" onPlay={() => void launchPrivate(server.id, game)} />
          <IconBtn label={`Copy share link for ${server.label}`} onClick={() => void copyLink()}>
            <Copy size={15} strokeWidth={1.75} />
          </IconBtn>
          <IconBtn label={`Rename ${server.label}`} onClick={() => setDraft(server.label)}>
            <Pencil size={15} strokeWidth={1.75} />
          </IconBtn>
          <IconBtn label={`Remove ${server.label}`} danger onClick={() => onRemove(server)}>
            <Trash2 size={15} strokeWidth={1.75} />
          </IconBtn>
        </>
      )}
    </li>
  );
}

/**
 * Private servers for one game.
 * 1. Saved in Muffin: bookmarked share links (play, rename, copy, remove, add by pasting).
 * 2. On your Roblox account: price, servers you own, buy (with confirmation) and manage.
 */
export function PrivateServersPanel({ placeId, game }: { placeId: number; game: GameRef }) {
  const qc = useQueryClient();
  const key = ["privateServers", placeId] as const;
  const list = useQuery<PrivateServer[], AppError>({ queryKey: key, queryFn: () => ipc.listPrivateServers(placeId) });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<PrivateServer | null>(null);
  useResetOnAccountChange("economy");

  const patch = (fn: (prev: PrivateServer[]) => PrivateServer[]) =>
    qc.setQueryData<PrivateServer[]>(key, (prev) => fn(prev ?? []));

  const rename = async (s: PrivateServer, label: string): Promise<boolean> => {
    try {
      const updated = await ipc.renamePrivateServer(s.id, label);
      patch((prev) => prev.map((x) => (x.id === s.id ? updated : x)));
      return true;
    } catch (e) {
      toast.error(toAppError(e).message);
      return false;
    }
  };

  const remove = async (s: PrivateServer) => {
    try {
      await ipc.removePrivateServer(s.id);
      patch((prev) => prev.filter((x) => x.id !== s.id));
      toast.success(`Removed ${s.label}`);
    } catch (e) {
      toast.error(toAppError(e).message);
    }
  };

  const servers = list.data ?? [];

  return (
    <section className="surface rounded-panel p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Private servers</h2>
          <p className="text-xs text-muted">Saved in Muffin — links stored on this PC</p>
        </div>
        <Button size="sm" variant="glass" icon={<Plus size={15} strokeWidth={1.75} />} onClick={() => setAdding(true)}>
          Add
        </Button>
      </div>

      {list.isPending ? (
        <div className="flex flex-col gap-2" aria-hidden>
          <div className="skeleton h-14 rounded-[12px]" />
          <div className="skeleton h-14 rounded-[12px]" />
        </div>
      ) : list.isError ? (
        <div className="flex flex-col items-start gap-2 text-sm text-muted">
          <span>Couldn't load saved servers: {list.error.message}</span>
          <Button size="sm" variant="glass" onClick={() => void list.refetch()}>
            Retry
          </Button>
        </div>
      ) : servers.length === 0 ? (
        <p className="py-2 text-sm text-muted">
          No private servers saved for this game. Add a share link to launch straight into your server.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {servers.map((s) => (
            <ServerRow key={s.id} server={s} game={game} onRename={rename} onRemove={setRemoving} />
          ))}
        </ul>
      )}

      <OwnedServersSection
        placeId={placeId}
        universeId={game.universeId}
        gameName={game.name}
        onBookmarked={(s) => patch((prev) => (prev.some((x) => x.id === s.id) ? prev : [...prev, s]))}
      />

      <Modal open={adding} onClose={() => setAdding(false)} title="Add private server">
        <AddServerForm
          placeId={placeId}
          onCancel={() => setAdding(false)}
          onAdded={(s) => {
            patch((prev) => [...prev, s]);
            setAdding(false);
            toast.success(`Saved ${s.label}`);
          }}
        />
      </Modal>

      <ConfirmModal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && void remove(removing)}
        title="Remove private server?"
        message={
          <>
            <b>{removing?.label}</b> will be removed from Muffin. You can add it again with its share link.
          </>
        }
        confirmLabel="Remove"
        danger
      />
    </section>
  );
}
