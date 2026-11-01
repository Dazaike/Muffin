import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, Server, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatRobux, type OwnedServer, type PurchaseResult, type ServerSettings } from "@/lib/economy";
import { ipc } from "@/lib/ipc";
import type { AppError, PrivateServer } from "@/lib/types";
import { useAccount } from "@/store/account";
import { toast } from "@/store/ui";
import { ServerManageModal } from "./ServerManageModal";
import { ServerPurchaseModal } from "./ServerPurchaseModal";
import { Note } from "./serverUi";

/**
 * "On Roblox" half of the private-servers panel: price/availability (public), the servers the
 * signed-in account owns for this game, buying a new one and managing existing ones.
 */
export function OwnedServersSection({
  placeId,
  universeId,
  gameName,
  onBookmarked,
}: {
  placeId: number;
  universeId?: number | null;
  gameName: string;
  onBookmarked: (s: PrivateServer) => void;
}) {
  const qc = useQueryClient();
  const status = useAccount((s) => s.status);
  const reload = useAccount((s) => s.reload);
  const signingIn = useAccount((s) => s.signingIn);
  const signIn = useAccount((s) => s.signIn);
  const [buying, setBuying] = useState(false);
  const [managing, setManaging] = useState<number | null>(null);

  useEffect(() => {
    if (!status) void reload();
  }, [status, reload]);
  const signedIn = status?.signedIn === true;
  const uid = universeId ?? 0;

  const settings = useQuery<ServerSettings, AppError>({
    queryKey: ["economy", "serverSettings", uid],
    queryFn: () => ipc.privateServerSettings(uid),
    enabled: uid > 0,
    staleTime: 60_000,
    retry: false,
  });
  const owned = useQuery<OwnedServer[], AppError>({
    queryKey: ["economy", "owned", uid],
    queryFn: () => ipc.privateServersOwned(uid),
    enabled: uid > 0 && signedIn,
    staleTime: 30_000,
    retry: false,
  });

  const purchased = (r: PurchaseResult) => {
    setBuying(false);
    toast.success(r.price > 0 ? `Bought ${r.name} for ${formatRobux(r.price)} Robux` : `Created ${r.name}`);
    void qc.invalidateQueries({ queryKey: ["economy", "owned"] });
    void qc.invalidateQueries({ queryKey: ["economy", "balance"] });
    void qc.invalidateQueries({ queryKey: ["economy", "tx"] });
    setManaging(r.serverId);
  };

  const s = settings.data;

  return (
    <div className="mt-5 border-t border-white/8 pt-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">On your Roblox account</h3>
          <p className="text-xs text-muted">Buy, manage and share private servers for this game.</p>
        </div>
        {signedIn && s?.available && uid > 0 && (
          <Button
            size="sm"
            variant="glass"
            icon={<Coins size={15} strokeWidth={1.75} />}
            onClick={() => setBuying(true)}
          >
            Create
          </Button>
        )}
      </div>

      {uid === 0 ? (
        <p className="text-sm text-muted">Loading game info…</p>
      ) : settings.isPending ? (
        <div className="skeleton h-9 rounded-[12px]" aria-hidden />
      ) : settings.isError ? (
        <div className="flex flex-col items-start gap-2 text-sm text-muted">
          <span>Couldn't load private server pricing: {settings.error.message}</span>
          <Button size="sm" variant="glass" onClick={() => void settings.refetch()}>
            Retry
          </Button>
        </div>
      ) : !s?.available ? (
        <p className="text-sm text-muted">The developer hasn't enabled private servers for this game.</p>
      ) : (
        <p className="text-sm">
          {s.price > 0 ? (
            <>
              <b>{formatRobux(s.price)} Robux</b> per month, renews until cancelled.
            </>
          ) : (
            <b>Free</b>
          )}
          {s.hasDiscounts && <span className="text-muted"> · A discount applies (buy on roblox.com).</span>}
        </p>
      )}

      {uid > 0 && s?.available && !signedIn && (
        <div className="mt-3 flex flex-col items-start gap-2">
          <Note>Sign in to buy a private server or manage the ones you own.</Note>
          <Button size="sm" variant="glass" disabled={signingIn || !status} onClick={() => void signIn()}>
            {signingIn ? "Roblox sign-in open…" : "Sign in with Roblox"}
          </Button>
        </div>
      )}

      {signedIn && uid > 0 && (
        <div className="mt-3">
          {owned.isPending ? (
            <div className="skeleton h-14 rounded-[12px]" aria-hidden />
          ) : owned.isError ? (
            <div className="flex flex-col items-start gap-2 text-sm text-muted">
              <span>Couldn't load your private servers: {owned.error.message}</span>
              <Button size="sm" variant="glass" onClick={() => void owned.refetch()}>
                Retry
              </Button>
            </div>
          ) : owned.data.length === 0 ? (
            <p className="text-sm text-muted">You don't own a private server for this game.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {owned.data.map((o, i) => (
                <li key={o.id ?? `row-${i}`} className="flex items-center gap-2 rounded-[12px] bg-white/4 p-2 pl-3">
                  <Server size={15} strokeWidth={1.75} className="shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{o.name}</div>
                    <div className="text-xs text-muted">{o.active ? "Joining enabled" : "Joining disabled"}</div>
                  </div>
                  <Button
                    size="sm"
                    variant="glass"
                    icon={<SlidersHorizontal size={14} strokeWidth={1.75} />}
                    disabled={o.id == null}
                    title={o.id == null ? "Roblox didn't return an id for this server, so it can't be managed here" : undefined}
                    onClick={() => o.id != null && setManaging(o.id)}
                  >
                    Manage
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {uid > 0 && (
        <ServerPurchaseModal
          open={buying}
          onClose={() => setBuying(false)}
          universeId={uid}
          gameName={gameName}
          onPurchased={purchased}
        />
      )}
      <ServerManageModal
        serverId={managing}
        placeId={placeId}
        onClose={() => setManaging(null)}
        onBookmarked={onBookmarked}
      />
    </div>
  );
}
