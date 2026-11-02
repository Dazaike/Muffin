import { useMemo, type ReactNode } from "react";
import { Loader2, LogIn } from "lucide-react";
import { ActionSwap, type ActionSwapState } from "@/components/ui/ActionSwap";
import { useAccount } from "@/store/account";

export interface SignInButtonProps {
  /** Idle label, e.g. "Sign in to Roblox" or "Sign in again". */
  label?: string;
  icon?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** `accent` is the primary look; `quiet` the glass one. */
  tone?: "accent" | "quiet";
  className?: string;
  /** Extra guard on top of the sign-in already being open (e.g. another account action in flight). */
  disabled?: boolean;
  /** Called after a sign-in that actually added an account (not after cancelling the login window). */
  onSignedIn?: () => void;
}

/**
 * Opens the in-app Roblox login. The pill follows the account store's `signingIn` flag, so every sign-in
 * button on screen shows the same state no matter which one (or which toast action) started it.
 */
export function SignInButton({ label = "Sign in to Roblox", icon, size = "md", tone = "accent", className, disabled, onSignedIn }: SignInButtonProps) {
  const signingIn = useAccount((s) => s.signingIn);
  const signIn = useAccount((s) => s.signIn);
  const states = useMemo<ActionSwapState[]>(
    () => [
      { id: "idle", label, icon: icon ?? <LogIn size={16} strokeWidth={1.75} />, tone },
      { id: "signing-in", label: "Signing in", icon: <Loader2 size={16} strokeWidth={1.75} className="animate-spin" />, tone, pendingLabel: "Signing in" },
    ],
    [label, icon, tone],
  );

  return (
    <ActionSwap
      size={size}
      states={states}
      value={signingIn ? "signing-in" : "idle"}
      disabled={disabled}
      className={className}
      title={signingIn ? "Finish signing in in the Roblox window" : undefined}
      onAction={(next) => {
        if (signingIn || next.id !== "signing-in") return;
        return signIn().then((ok) => {
          if (ok) onSignedIn?.();
        });
      }}
    />
  );
}
