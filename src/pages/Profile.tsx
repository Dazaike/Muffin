import { useMemo } from "react";
import { motion } from "motion/react";
import { GuestCard } from "@/components/profile/GuestCard";
import { PlayerCallout } from "@/components/profile/PlayerCallout";
import { RobloxAccount } from "@/components/profile/RobloxAccount";
import { Button } from "@/components/ui/Button";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { Page, PageHeader } from "@/components/ui/PageHeader";
import { formatDuration } from "@/lib/format";
import { useMotionPrefs } from "@/lib/motion";
import { usePlaytimeSummary } from "@/lib/playtime";
import { useAccount } from "@/store/account";
import { useLibrary } from "@/store/library";

function StatTile({ label, value, text, index }: { label: string; value?: number; text?: string; index: number }) {
  const m = useMotionPrefs();
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...m.fast, ...m.stagger(index) }}
      className="surface rounded-card px-4 py-3.5"
    >
      <div className="text-[11px] font-medium tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-1 text-2xl font-semibold">
        {text !== undefined ? text : <AnimatedNumber value={value ?? 0} format={(n) => n.toLocaleString()} />}
      </div>
    </motion.div>
  );
}

export default function Profile() {
  const account = useAccount((s) => s.status);
  const accountError = useAccount((s) => s.statusError);
  const reloadAccount = useAccount((s) => s.reload);
  const accountSigningIn = useAccount((s) => s.signingIn);
  const accountSignIn = useAccount((s) => s.signIn);
  const entries = useLibrary((s) => s.entries);
  const history = useLibrary((s) => s.history);

  const stats = useMemo(
    () => ({
      library: entries.length,
      favorites: entries.filter((e) => e.favorite).length,
      launches: history.reduce((sum, h) => sum + h.launchCount, 0),
    }),
    [entries, history],
  );

  const playtime = usePlaytimeSummary("all");
  const activeAccount = useAccount((s) => s.accounts.find((a) => a.userId === s.activeUserId));

  return (
    <Page>
      <PageHeader title="Profile" subtitle={account?.signedIn ? "Signed in inside Muffin" : account?.expired ? "Session expired" : "Guest"} />
      <div className="flex max-w-4xl flex-col gap-5">
        {!account && <section className="surface rounded-panel p-5 text-sm text-muted">
          {accountError ? <><p className="text-danger">Couldn't check the in-app Roblox session: {accountError}</p><div className="mt-3"><Button size="sm" variant="glass" onClick={() => void reloadAccount()}>Retry</Button></div></> : "Checking in-app Roblox session…"}
        </section>}
        {account?.signedIn && account.user && <RobloxAccount key={account.user.id} user={account.user} />}
        {account?.expired && (
          <section className="surface rounded-panel p-5">
            <h3 className="font-semibold">Roblox session expired</h3>
            <p className="mt-1 text-sm text-muted">{activeAccount?.displayName ?? "This account"} was signed out by Roblox. Sign in again to restore its account data; your other accounts are unaffected.</p>
            <div className="mt-3"><Button variant="primary" disabled={accountSigningIn} onClick={() => void accountSignIn()}>{accountSigningIn ? "Roblox sign-in open…" : "Sign in again"}</Button></div>
          </section>
        )}
        {!account?.signedIn && !account?.expired && <GuestCard />}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Library" value={stats.library} index={0} />
          <StatTile label="Favorites" value={stats.favorites} index={1} />
          <StatTile label="Total launches" value={stats.launches} index={2} />
          <StatTile label="Time played" text={playtime.data ? formatDuration(playtime.data.totalMs) : "—"} index={3} />
        </div>

        <PlayerCallout />

      </div>
    </Page>
  );
}
