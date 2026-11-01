import { useNavigate } from "react-router-dom";
import { LogIn, LogOut, Settings as SettingsIcon, User, UserPlus, UserRound, Users } from "lucide-react";
import { Menu, type MenuEntry } from "@/components/ui/Menu";
import { SmartImage } from "@/components/ui/SmartImage";
import { useHeadshot } from "@/lib/roblox";
import type { AccountSummary } from "@/lib/types";
import { useAccount } from "@/store/account";

const ICON = { size: 16, strokeWidth: 1.75 } as const;

export interface AvatarUser {
  id: string;
  displayName: string;
  username: string;
  avatarUrl?: string | null;
}

/** Account row → the shape `UserAvatar` takes (the row's cached headshot URL is used directly). */
export function toAvatarUser(a: AccountSummary): AvatarUser {
  return { id: String(a.userId), displayName: a.displayName, username: a.username, avatarUrl: a.avatarUrl ?? null };
}

/** Round avatar: the cached headshot URL first, else a fresh Roblox headshot, else an initial. */
export function UserAvatar({ user, size = 32 }: { user: AvatarUser; size?: number }) {
  const headshot = useHeadshot(user.avatarUrl ? null : user.id);
  return (
    <SmartImage
      src={user.avatarUrl ?? headshot.data}
      name={user.displayName}
      className="shrink-0 rounded-full"
      style={{ width: size, height: size }}
    />
  );
}

/** Top-right account dropdown: signed-in identity or guest sign-in options. */
export function AccountMenu() {
  const navigate = useNavigate();
  const accounts = useAccount((s) => s.accounts);
  const activeUserId = useAccount((s) => s.activeUserId);
  const accountSigningIn = useAccount((s) => s.signingIn);
  const accountSignIn = useAccount((s) => s.signIn);
  const accountSignOut = useAccount((s) => s.signOut);
  const switchTo = useAccount((s) => s.switchTo);
  const active = accounts.find((a) => a.userId === activeUserId) ?? null;
  const user = active ? toAvatarUser(active) : null;

  const entries = (): MenuEntry[] => {
    if (user) {
      const others = accounts.filter((a) => a.userId !== activeUserId);
      return [
        {
          type: "header",
          content: (
            <div className="flex items-center gap-3 px-2.5 py-2">
              <UserAvatar user={user} size={40} />
              <div className="min-w-0">
                <div className="truncate font-medium">{user.displayName}</div>
                <div className="truncate text-xs text-muted">@{user.username}</div>
                {active?.expired ? (
                  <div className="truncate text-xs text-danger">Session expired</div>
                ) : (
                  <div className="truncate text-xs text-muted">ID {user.id}</div>
                )}
              </div>
            </div>
          ),
        },
        { type: "separator" },
        { label: "Profile", icon: <User {...ICON} />, onSelect: () => navigate("/profile") },
        { label: "Friends", icon: <Users {...ICON} />, onSelect: () => navigate("/friends") },
        { label: "Settings", icon: <SettingsIcon {...ICON} />, onSelect: () => navigate("/settings") },
        { type: "separator" },
        ...others.map((a): MenuEntry => ({
          label: a.expired ? `${a.displayName} · sign in again` : a.displayName,
          icon: <UserAvatar user={toAvatarUser(a)} size={20} />,
          title: `@${a.username}`,
          onSelect: () => void (a.expired ? accountSignIn() : switchTo(a.userId)),
        })),
        {
          label: accountSigningIn ? "Roblox sign-in open…" : "Add account",
          icon: <UserPlus {...ICON} />,
          disabled: accountSigningIn,
          onSelect: () => void accountSignIn(),
        },
        { type: "separator" },
        ...(active ? [
          ...(active.expired ? [{ label: "Sign in again", icon: <LogIn {...ICON} />, disabled: accountSigningIn, onSelect: () => void accountSignIn() }] : []),
          { label: `Remove ${active.displayName}`, icon: <LogOut {...ICON} />, danger: true, onSelect: () => void accountSignOut() },
        ] : []),
      ];
    }
    return [
      {
        label: accountSigningIn ? "Roblox sign-in open…" : "Sign in to Roblox",
        icon: <LogIn {...ICON} />,
        disabled: accountSigningIn,
        onSelect: () => void accountSignIn(),
      },
      { label: "Continue as guest", icon: <UserRound {...ICON} />, onSelect: () => {} },
    ];
  };

  return (
    <Menu
      entries={entries}
      trigger={(props, open) => (
        <button
          type="button"
          {...props}
          aria-label="Account"
          className="focus-ring flex size-9 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-white/6 transition-colors hover:bg-white/12"
          data-open={open}
        >
          {user ? <UserAvatar user={user} size={36} /> : <UserRound size={18} strokeWidth={1.75} className="text-muted" />}
        </button>
      )}
    />
  );
}
