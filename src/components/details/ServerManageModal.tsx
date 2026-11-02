import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, Link2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { Switch } from "@/components/ui/Controls";
import { ConfirmModal, Modal } from "@/components/ui/Modal";
import {
  daysUntil,
  formatRobux,
  formatWhen,
  SERVER_NAME_MAX,
  type ServerDetail,
} from "@/lib/economy";
import { ipc, toAppError } from "@/lib/ipc";
import type { AppError, PrivateServer } from "@/lib/types";
import { toast } from "@/store/ui";
import { InlineError, inputClass, Note } from "./serverUi";

const section = "flex flex-col gap-2 rounded-[14px] bg-white/4 p-3";

function Heading({ children, hint }: { children: string; hint?: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{children}</h3>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function renewalText(d: ServerDetail): string {
  const sub = d.subscription;
  if (!sub) return "";
  const when = sub.expirationDate ? formatWhen(sub.expirationDate) : null;
  const days = daysUntil(sub.expirationDate);
  const rel = days === null ? "" : days > 0 ? ` (in ${days} ${days === 1 ? "day" : "days"})` : " (today or past)";
  if (sub.active) return when ? `Renews ${when}${rel}` : "Renews monthly";
  return when ? `${sub.expired ? "Expired" : "Ends"} ${when}${rel}` : sub.expired ? "Expired" : "Not renewing";
}

/**
 * Manage one private server you own on Roblox: rename, enable/disable joining, cancel the monthly
 * renewal, regenerate the invite link, and bookmark its share link into Muffin's local list.
 * Nothing here spends Robux.
 */
export function ServerManageModal({
  serverId,
  placeId,
  onClose,
  onBookmarked,
}: {
  serverId: number | null;
  placeId: number;
  onClose: () => void;
  onBookmarked: (s: PrivateServer) => void;
}) {
  const qc = useQueryClient();
  const open = serverId !== null;
  const key = ["economy", "server", serverId] as const;
  const query = useQuery<ServerDetail, AppError>({
    queryKey: key,
    queryFn: () => ipc.privateServerDetail(serverId as number),
    enabled: open,
    staleTime: 0,
    retry: false,
  });
  const detail = query.data;

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirm, setConfirm] = useState<"regenerate" | "cancel" | null>(null);

  useEffect(() => {
    if (detail) setDraft(detail.name);
  }, [detail?.id, detail?.name]);

  useEffect(() => {
    if (open) {
      setError(null);
      setBusy(null);
      setConfirm(null);
    }
  }, [serverId, open]);

  const run = async (label: string, action: () => Promise<ServerDetail>, done: string): Promise<void> => {
    if (busy) return;
    setBusy(label);
    setError(null);
    try {
      qc.setQueryData(key, await action());
      void qc.invalidateQueries({ queryKey: ["economy", "owned"] });
      toast.success(done);
    } catch (e) {
      setError(toAppError(e).message);
    } finally {
      setBusy(null);
    }
  };

  const trimmed = draft.trim();
  const renameOk = !!detail && trimmed.length >= 1 && trimmed.length <= SERVER_NAME_MAX && trimmed !== detail.name;

  const bookmark = async () => {
    if (!detail?.shareLink || busy) return;
    setBusy("bookmark");
    try {
      const saved = await ipc.addPrivateServer(placeId, detail.name, detail.shareLink);
      onBookmarked(saved);
      toast.success(`Saved ${saved.label} to Muffin`);
    } catch (e) {
      toast.error(toAppError(e).message);
    } finally {
      setBusy(null);
    }
  };

  const sub = detail?.subscription;

  return (
    <>
      <Modal open={open} onClose={onClose} title={detail ? `Manage ${detail.name}` : "Manage private server"} widthClass="max-w-lg">
        {query.isPending ? (
          <div className="flex flex-col gap-3" aria-hidden>
            <div className="skeleton h-16 rounded-[14px]" />
            <div className="skeleton h-24 rounded-[14px]" />
          </div>
        ) : query.isError ? (
          <div className="flex flex-col items-start gap-2">
            <InlineError>Couldn't load this server: {query.error.message}</InlineError>
            <Button size="sm" variant="glass" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        ) : detail ? (
          <div className="flex flex-col gap-3">
            <Note>These controls change the server on your Roblox account. Nothing here spends Robux.</Note>

            <div className={section}>
              <Heading>Name</Heading>
              <div className="flex gap-2">
                <input
                  value={draft}
                  maxLength={SERVER_NAME_MAX}
                  aria-label="Server name"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && renameOk) void run("rename", () => ipc.privateServerRename(detail.id, trimmed), "Server renamed");
                  }}
                  className={inputClass}
                />
                <Button
                  variant="glass"
                  disabled={!renameOk || busy !== null}
                  onClick={() => void run("rename", () => ipc.privateServerRename(detail.id, trimmed), "Server renamed")}
                >
                  Rename
                </Button>
              </div>
            </div>

            <div className={section}>
              <div className="flex items-center justify-between gap-3">
                <Heading hint={detail.active ? "Players with the link can join." : "Joining is turned off."}>
                  Joining enabled
                </Heading>
                <Switch
                  label="Joining enabled"
                  checked={detail.active}
                  disabled={busy !== null}
                  onChange={(v) =>
                    void run("active", () => ipc.privateServerSetActive(detail.id, v), v ? "Joining enabled" : "Joining disabled")
                  }
                />
              </div>
            </div>

            <div className={section}>
              <Heading>Subscription</Heading>
              {sub ? (
                <>
                  <div className="text-sm">
                    {sub.price != null && sub.price > 0 ? `${formatRobux(sub.price)} Robux / month · ` : ""}
                    {renewalText(detail)}
                  </div>
                  {sub.hasInsufficientFunds && sub.active && (
                    <div className="text-xs text-danger">Your balance doesn't cover the next renewal.</div>
                  )}
                  {sub.hasPriceChanged && (
                    <div className="text-xs text-muted">Roblox reports the price changed since you subscribed.</div>
                  )}
                  {sub.active ? (
                    <div>
                      <Button variant="glass" size="sm" disabled={busy !== null} onClick={() => setConfirm("cancel")}>
                        Cancel monthly renewal
                      </Button>
                    </div>
                  ) : (
                    <div className="text-xs text-muted">
                      Renewal is off. To resubscribe, use the server's page on roblox.com.
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-muted">No subscription information returned (free server).</div>
              )}
            </div>

            <div className={section}>
              <Heading hint="Share link used to join this server.">Invite link</Heading>
              {detail.shareLink ? (
                <>
                  <div className="flex gap-2">
                    <input readOnly value={detail.shareLink} aria-label="Share link" className={inputClass} onFocus={(e) => e.currentTarget.select()} />
                    <CopyButton value={detail.shareLink} label="Copy" />
                  </div>
                  <div>
                    <Button
                      variant="glass"
                      size="sm"
                      icon={<BookmarkPlus size={15} strokeWidth={1.75} />}
                      disabled={busy !== null}
                      onClick={() => void bookmark()}
                    >
                      Save to Muffin
                    </Button>
                  </div>
                </>
              ) : (
                <Note>
                  {detail.linkIsLegacy
                    ? "Roblox returned this server's link in an older format that Muffin can't launch. "
                    : "Roblox didn't return a link for this server. "}
                  Open the server's page on roblox.com, copy its share link (roblox.com/share?code=…&type=Server) and paste it with
                  “Add” on the game page.
                </Note>
              )}
              <div>
                <Button
                  variant="glass"
                  size="sm"
                  icon={<RefreshCw size={15} strokeWidth={1.75} className={busy === "regenerate" ? "animate-spin" : undefined} />}
                  disabled={busy !== null}
                  onClick={() => setConfirm("regenerate")}
                >
                  Generate new link
                </Button>
              </div>
            </div>

            {error && <InlineError>{error}</InlineError>}

            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-xs text-muted">
                <Link2 size={12} strokeWidth={1.75} />
                Server #{detail.id}
              </span>
              <Button variant="ghost" data-autofocus onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmModal
        open={confirm === "regenerate"}
        onClose={() => setConfirm(null)}
        onConfirm={() => detail && void run("regenerate", () => ipc.privateServerRegenerateLink(detail.id), "New link generated")}
        title="Generate a new link?"
        message="Anyone holding the old link will no longer be able to join. Links saved in Muffin for this server stop working until you replace them with the new one."
        confirmLabel="Generate new link"
        danger
      />
      <ConfirmModal
        open={confirm === "cancel"}
        onClose={() => setConfirm(null)}
        onConfirm={() => detail && void run("cancel", () => ipc.privateServerCancelSubscription(detail.id), "Renewal cancelled")}
        title="Cancel monthly renewal?"
        message="The server stops renewing. Roblox decides how long it stays usable after this; resubscribing is done on roblox.com."
        confirmLabel="Cancel renewal"
        danger
      />
    </>
  );
}
