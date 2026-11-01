import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAccount } from "@/store/account";

/** Guest state: explains what signing in does and offers the in-app Roblox sign-in. */
export function GuestCard() {
  const signingIn = useAccount((s) => s.signingIn);
  const signIn = useAccount((s) => s.signIn);

  return (
    <section className="glass rounded-hero p-6 md:p-8">
      <h2 className="text-2xl font-semibold tracking-tight">You're browsing as a guest</h2>
      <p className="mt-2 max-w-xl text-sm text-muted">
        Sign in to Roblox inside Muffin to see your Robux, friends, and your created and saved games. Browsing, searching,
        your launcher library and launching games work without an account.
      </p>
      <div className="mt-5">
        <Button variant="primary" icon={<LogIn size={16} strokeWidth={1.75} />} disabled={signingIn} onClick={() => void signIn()}>
          {signingIn ? "Roblox sign-in open…" : "Sign in to Roblox"}
        </Button>
      </div>
    </section>
  );
}
