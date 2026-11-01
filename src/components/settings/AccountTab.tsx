import { useState } from "react";
import { LogIn, LogOut, UserPlus } from "lucide-react";
import { toAvatarUser, UserAvatar } from "@/components/shell/AccountMenu";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Controls";
import { ConfirmModal } from "@/components/ui/Modal";
import type { AccountSummary } from "@/lib/types";
import { useAccount } from "@/store/account";
import { useSettings } from "@/store/settings";
import { SettingRow, SettingsSection } from "./SettingRow";

function AccountRow({ account, active, busy, onRemove }: { account: AccountSummary; active: boolean; busy: boolean; onRemove: () => void }) {
  const signingIn = useAccount((s) => s.signingIn);
  const signIn = useAccount((s) => s.signIn);
  const switchTo = useAccount((s) => s.switchTo);
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="flex min-w-0 items-center gap-3">
        <UserAvatar user={toAvatarUser(account)} size={40} />
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="truncate">{account.displayName}</span>
            {active && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium">Active</span>}
            {account.expired && <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[11px] font-medium text-danger">Expired</span>}
          </div>
          <div className="truncate text-[13px] text-muted">@{account.username} · ID {account.userId}</div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {account.expired ? (
          <Button variant="primary" size="sm" icon={<LogIn size={14} strokeWidth={1.75} />} disabled={signingIn || busy} onClick={() => void signIn()}>
            {signingIn ? "Roblox sign-in open…" : "Sign in again"}
          </Button>
        ) : !active ? (
          <Button variant="glass" size="sm" disabled={busy} onClick={() => void switchTo(account.userId)}>
            {busy ? "Switching…" : "Switch"}
          </Button>
        ) : null}
        <Button variant="glass" size="sm" icon={<LogOut size={14} strokeWidth={1.75} />} disabled={busy} onClick={onRemove}>
          Remove
        </Button>
      </div>
    </div>
  );
}

export function AccountTab() {
  const accounts = useAccount((s) => s.accounts);
  const activeUserId = useAccount((s) => s.activeUserId);
  const busyUserId = useAccount((s) => s.busyUserId);
  const accountSigningIn = useAccount((s) => s.signingIn);
  const accountSignIn = useAccount((s) => s.signIn);
  const removeAccount = useAccount((s) => s.remove);
  const [removing, setRemoving] = useState<AccountSummary | null>(null);
  const showRobux = useSettings((s) => s.values.showRobux);
  const setSetting = useSettings((s) => s.set);

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="Roblox accounts">
        {accounts.length === 0 && (
          <SettingRow title="No account signed in" description="Sign in separately to see Robux, friends, and your created and saved games. You can add more than one account and switch between them.">
            <Button variant="glass" size="sm" icon={<UserPlus size={14} strokeWidth={1.75} />} disabled={accountSigningIn} onClick={() => void accountSignIn()}>
              {accountSigningIn ? "Roblox sign-in open…" : "Add account"}
            </Button>
          </SettingRow>
        )}
        {accounts.map((a) => (
          <AccountRow key={a.userId} account={a} active={a.userId === activeUserId} busy={busyUserId === a.userId} onRemove={() => setRemoving(a)} />
        ))}
        {accounts.length > 0 && (
          <SettingRow title="Add another account" description="Opens a private Roblox login window; your current accounts stay signed in.">
            <Button variant="glass" size="sm" icon={<UserPlus size={14} strokeWidth={1.75} />} disabled={accountSigningIn} onClick={() => void accountSignIn()}>
              {accountSigningIn ? "Roblox sign-in open…" : "Add account"}
            </Button>
          </SettingRow>
        )}
      </SettingsSection>
      <SettingsSection title="Top bar">
        <SettingRow title="Show Robux balance" description="Show your Robux balance next to your avatar while signed in. Click it to open the Wallet.">
          <Switch label="Show Robux balance" checked={showRobux} onChange={(x) => void setSetting("showRobux", x)} />
        </SettingRow>
      </SettingsSection>
      <p className="px-1 text-[13px] text-muted">
        Roblox sessions are stored in Windows Credential Manager and are never written to Muffin's database.
      </p>
      <ConfirmModal
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && void removeAccount(removing.userId)}
        title="Remove account?"
        message={`${removing?.displayName ?? "This account"} will be signed out of Muffin and its saved session deleted from Windows Credential Manager. You can add it again later.`}
        confirmLabel="Remove"
        danger
      />
    </div>
  );
}
