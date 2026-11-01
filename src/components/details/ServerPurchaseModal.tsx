import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Coins, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { formatRobux, SERVER_NAME_MAX, type PurchaseResult, type ServerSettings } from "@/lib/economy";
import { ipc, toAppError } from "@/lib/ipc";
import type { AppError } from "@/lib/types";
import { InlineError, inputClass, Note } from "./serverUi";

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-muted">{label}</span>
      <span className={strong ? "text-base font-semibold tabular-nums" : "font-medium tabular-nums"}>{value}</span>
    </div>
  );
}

/**
 * The ONLY place in the UI that spends Robux. Shows the live price and balance, requires an
 * explicit click on the buy button (no form submit / Enter shortcut), sends the price the user saw
 * (`expectedPrice`; Rust refuses if it changed) and never retries.
 */
export function ServerPurchaseModal({
  open,
  onClose,
  universeId,
  gameName,
  onPurchased,
}: {
  open: boolean;
  onClose: () => void;
  universeId: number;
  gameName: string;
  onPurchased: (r: PurchaseResult) => void;
}) {
  const [name, setName] = useState("My private server");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setBusy(false);
      setError(null);
    }
  }, [open]);

  // Always read the price fresh when the dialog opens: it is what we ask Roblox to charge.
  const settings = useQuery<ServerSettings, AppError>({
    queryKey: ["economy", "serverSettings", universeId],
    queryFn: () => ipc.privateServerSettings(universeId),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const balance = useQuery<number, AppError>({
    queryKey: ["economy", "balance"],
    queryFn: ipc.economyBalance,
    enabled: open,
    staleTime: 0,
    retry: false,
  });

  const s = settings.data;
  const price = s?.price ?? 0;
  const have = balance.data;
  const trimmed = name.trim();
  const nameValid = trimmed.length >= 1 && trimmed.length <= SERVER_NAME_MAX;
  const insufficient = price > 0 && have !== undefined && have < price;
  const blockReason = !s
    ? null
    : !s.available
      ? "Private servers aren't available for this game."
      : s.hasDiscounts
        ? "Roblox applies a discount to this server, so Muffin can't confirm the final price. Purchase it on roblox.com instead."
        : insufficient
          ? `Not enough Robux: you have ${formatRobux(have ?? 0)} and this costs ${formatRobux(price)}.`
          : null;
  const canBuy = !!s && !blockReason && nameValid && !busy && (price === 0 || have !== undefined);

  const buy = async () => {
    if (!s || !canBuy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await ipc.privateServerPurchase(universeId, trimmed, s.price);
      onPurchased(result);
    } catch (e) {
      setError(toAppError(e).message);
      // The price or balance may have changed: show current numbers; the user must click again.
      void settings.refetch();
      void balance.refetch();
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create private server" dismissable={!busy}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          for <b className="text-fg">{gameName}</b> · This is a real Roblox purchase made with your Robux.
        </p>

        {settings.isPending ? (
          <div className="skeleton h-28 rounded-[12px]" aria-hidden />
        ) : settings.isError ? (
          <div className="flex flex-col items-start gap-2">
            <InlineError>Couldn't load the price: {settings.error.message}</InlineError>
            <Button size="sm" variant="glass" onClick={() => void settings.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <div className="rounded-[12px] bg-white/5 px-3 py-2 text-sm">
            <Row label="Price" value={price > 0 ? `${formatRobux(price)} Robux / month` : "Free"} strong />
            <Row
              label="Your balance"
              value={have !== undefined ? `${formatRobux(have)} Robux` : balance.isError ? "unavailable" : "loading…"}
            />
            {price > 0 && have !== undefined && !insufficient && (
              <Row label="Balance after first charge" value={`${formatRobux(have - price)} Robux`} />
            )}
          </div>
        )}

        {s && s.price > 0 && !blockReason && (
          <Note>
            Private servers are a monthly subscription: Roblox renews it every month for the price above until you
            cancel it from the server's Manage dialog or on roblox.com.
          </Note>
        )}

        {blockReason && (
          <div role="alert" className="flex items-start gap-2 rounded-[12px] bg-danger/12 px-3 py-2 text-sm text-danger">
            <TriangleAlert size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            {blockReason}
          </div>
        )}
        {balance.isError && price > 0 && <InlineError>Couldn't read your balance: {balance.error.message}</InlineError>}

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Server name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={SERVER_NAME_MAX}
            spellCheck={false}
            className={inputClass}
          />
        </label>

        {error && <InlineError>{error}</InlineError>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" data-autofocus disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={<Coins size={16} strokeWidth={1.75} />} disabled={!canBuy} onClick={() => void buy()}>
            {busy ? "Purchasing…" : price > 0 ? `Buy for ${formatRobux(price)} Robux` : "Create free server"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
