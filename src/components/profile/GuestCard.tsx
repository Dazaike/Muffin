import { SignInButton } from "./SignInButton";

/** Guest state: explains what signing in does and offers the in-app Roblox sign-in. */
export function GuestCard() {
  return (
    <section className="glass rounded-hero p-6 md:p-8">
      <h2 className="text-2xl font-semibold tracking-tight">You're browsing as a guest</h2>
      <p className="mt-2 max-w-xl text-sm text-muted">
        Sign in to Roblox inside Muffin to see your Robux, friends, and your created and saved games. Browsing, searching,
        your launcher library and launching games work without an account.
      </p>
      <div className="mt-5">
        <SignInButton />
      </div>
    </section>
  );
}
