import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Coins, Lock, RefreshCw, Wallet as WalletIcon } from "lucide-react";
import { ViewToggle } from "@/components/lists/ViewToggle";
import { TransactionRow } from "@/components/wallet/TransactionRow";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { Button } from "@/components/ui/Button";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, StateSwitch } from "@/components/ui/StateSwitch";
import { Tabs } from "@/components/ui/Tabs";
import { useResetOnAccountChange } from "@/hooks/useResetOnAccountChange";
import { useRobuxBalance } from "@/hooks/useRobuxBalance";
import { cn } from "@/lib/cn";
import { formatRobux, signedRobux, TX_TABS, type PageTotals, type TransactionPage, type TxKind } from "@/lib/economy";
import { ipc } from "@/lib/ipc";
import { useMotionPrefs } from "@/lib/motion";
import { credentialStore } from "@/lib/platform";
import type { AppError } from "@/lib/types";
import { useAccount } from "@/store/account";
import { useSettings } from "@/store/settings";

function BalanceCard({ signedIn, name }: { signedIn: boolean; name?: string }) {
  const m = useMotionPrefs();
  const balance = useRobuxBalance(signedIn);
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={m.fast}
      className="surface flex flex-wrap items-center gap-4 rounded-panel p-5"
    >
      <div className="accent-gradient flex size-12 shrink-0 items-center justify-center rounded-full text-white">
        <Coins size={22} strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium tracking-wide text-muted uppercase">
          Robux balance{name ? ` · ${name}` : ""}
        </div>
        <div className="mt-0.5 text-3xl font-semibold">
          {balance.data !== undefined ? (
            <AnimatedNumber value={balance.data} format={formatRobux} />
          ) : balance.isError ? (
            <span className="text-base font-normal text-muted">Balance unavailable: {balance.error.message}</span>
          ) : (
            <span className="skeleton inline-block h-8 w-28 rounded-md align-middle" aria-hidden />
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 rounded-full bg-white/6 px-3 py-1 text-xs text-muted">
        <Lock size={12} strokeWidth={1.75} />
        Read-only — nothing here spends Robux
      </div>
    </motion.section>
  );
}

function TotalCell({ label, value, tone }: { label: string; value: string; tone?: "in" | "out" }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-muted">{label}</span>
      <span className={cn("font-semibold tabular-nums", tone === "in" && "text-success", tone === "out" && "text-danger")}>{value}</span>
    </span>
  );
}

function PageFooter({ number, totals }: { number: number; totals: PageTotals }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-[10px] bg-white/3 px-3 py-2 text-xs">
      <span className="font-medium text-muted">
        Page {number} · {totals.count} {totals.count === 1 ? "transaction" : "transactions"}
      </span>
      {totals.income > 0 && <TotalCell label="Received" value={`+${formatRobux(totals.income)}`} tone="in" />}
      {totals.spent > 0 && <TotalCell label="Spent" value={`−${formatRobux(totals.spent)}`} tone="out" />}
      <TotalCell label="Net" value={signedRobux(totals.net)} tone={totals.net > 0 ? "in" : totals.net < 0 ? "out" : undefined} />
      {totals.pendingCount > 0 && <TotalCell label={`Pending (${totals.pendingCount})`} value={signedRobux(totals.pending)} />}
    </div>
  );
}

const SKELETON = (
  <div className="flex flex-col gap-2" aria-hidden>
    {Array.from({ length: 6 }, (_, i) => (
      <div key={i} className="skeleton h-14 rounded-[12px]" />
    ))}
  </div>
);

function History({ kind }: { kind: TxKind }) {
  const tab = TX_TABS.find((t) => t.id === kind) ?? TX_TABS[0]!;
  const view = useSettings((s) => s.values.walletView);
  const setSetting = useSettings((s) => s.set);
  const q = useInfiniteQuery<TransactionPage, AppError>({
    queryKey: ["economy", "tx", kind],
    queryFn: ({ pageParam }) => ipc.economyTransactions(kind, pageParam as string | null),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 60_000,
    // Roblox rate-limits this endpoint hard; retrying immediately only makes it worse.
    retry: false,
  });
  const pages = q.data?.pages ?? [];
  let rowIndex = 0;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-muted">{tab.hint}</p>
        <ViewToggle value={view} onChange={(v) => void setSetting("walletView", v)} />
      </div>
      <StateSwitch
        loading={q.isPending}
        error={q.isError && pages.length === 0 ? q.error : null}
        onRetry={() => void q.refetch()}
        isEmpty={pages.every((p) => p.items.length === 0)}
        skeleton={SKELETON}
        empty={<EmptyState title={`No ${tab.label.toLowerCase()} yet`} hint="Roblox returned no transactions of this type." />}
      >
        <div className="flex flex-col gap-4">
          {pages.map((page, i) => (
            <section key={`page-${i}`} aria-label={`Page ${i + 1}`}>
              <ul className={view === "grid" ? "grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2" : "flex flex-col gap-1.5"}>
                {page.items.map((tx, j) => (
                  <TransactionRow key={`${tx.id}-${j}`} tx={tx} fallbackTitle={tab.label} index={rowIndex++} view={view} />
                ))}
              </ul>
              <PageFooter number={i + 1} totals={page.totals} />
            </section>
          ))}
          {q.isError && !q.isFetchingNextPage && pages.length > 0 && (
            <p role="alert" className="text-sm text-danger">
              Couldn't load more: {q.error.message}
            </p>
          )}
          {q.hasNextPage && (
            <div className="flex justify-center">
              <Button variant="glass" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                {q.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </div>
      </StateSwitch>
    </div>
  );
}

export default function Wallet() {
  const status = useAccount((s) => s.status);
  const statusError = useAccount((s) => s.statusError);
  const reload = useAccount((s) => s.reload);
  const signingIn = useAccount((s) => s.signingIn);
  const signIn = useAccount((s) => s.signIn);
  const qc = useQueryClient();
  const [kind, setKind] = useState<TxKind>("Purchase");
  const [refreshing, setRefreshing] = useState(false);
  useResetOnAccountChange("economy");

  useEffect(() => {
    if (!status) void reload();
  }, [status, reload]);

  const signedIn = status?.signedIn === true;

  const refresh = async () => {
    setRefreshing(true);
    try {
      await qc.invalidateQueries({ queryKey: ["economy"] });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Page>
      <PageHeader
        title="Wallet"
        subtitle="Your Robux balance and transaction history. Read-only: Muffin doesn't buy marketplace items."
        actions={
          signedIn ? (
            <Button
              variant="glass"
              size="sm"
              disabled={refreshing}
              icon={<RefreshCw size={15} strokeWidth={1.75} className={refreshing ? "animate-spin" : undefined} />}
              onClick={() => void refresh()}
            >
              Refresh
            </Button>
          ) : undefined
        }
      />

      {!status ? (
        <div className="surface rounded-panel p-5 text-sm text-muted">
          {statusError ? (
            <>
              <p className="text-danger">Couldn't check your Roblox session: {statusError}</p>
              <div className="mt-3">
                <Button size="sm" variant="glass" onClick={() => void reload()}>
                  Retry
                </Button>
              </div>
            </>
          ) : (
            "Checking your Roblox session…"
          )}
        </div>
      ) : !signedIn ? (
        <div className="surface rounded-panel">
          <EmptyState
            icon={<WalletIcon size={22} strokeWidth={1.75} />}
            title="Sign in to see your Wallet"
            hint={`Robux balance and history need your Roblox session. Sign in inside Muffin; the session stays in ${credentialStore}.`}
            action={
              <Button variant="primary" disabled={signingIn} onClick={() => void signIn()}>
                {signingIn ? "Roblox sign-in open…" : "Sign in with Roblox"}
              </Button>
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <BalanceCard signedIn name={status.user?.displayName} />
          <Tabs tabs={TX_TABS.map(({ id, label }) => ({ id, label }))} value={kind} onChange={setKind} className="flex-wrap" />
          <History key={kind} kind={kind} />
        </div>
      )}
    </Page>
  );
}
