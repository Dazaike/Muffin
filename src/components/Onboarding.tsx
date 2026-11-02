import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CircleAlert, CircleCheck, RefreshCw } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useMotionPrefs } from "@/lib/motion";
import { robloxInstallHint } from "@/lib/platform";
import { useRobloxStatus } from "@/lib/roblox";
import { SignInButton } from "@/components/profile/SignInButton";
import { useSettings } from "@/store/settings";

const HANDLER_LABEL = {
  roblox: "Roblox Player",
  bloxstrap: "Bloxstrap",
  fishstrap: "Fishstrap",
  other: "a custom launcher",
  none: "nothing",
} as const;

/** First-run 3-step dialog: Welcome → Roblox check → optional sign-in. */
export function Onboarding() {
  const hydrated = useSettings((s) => s.hydrated);
  const onboarded = useSettings((s) => s.values.onboarded);
  const set = useSettings((s) => s.set);
  const m = useMotionPrefs();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const status = useRobloxStatus();

  const go = (n: number) => {
    setDir(n > step ? 1 : -1);
    setStep(n);
  };
  const finish = () => void set("onboarded", true);
  const s = status.data;
  const installed = !!s?.registered && s.exeExists;

  const panels = [
    <div key="welcome" className="flex flex-col items-center gap-4 py-2 text-center">
      <Logo size={72} />
      <h3 className="text-2xl font-semibold">Welcome to Muffin</h3>
      <p className="max-w-sm text-sm text-muted">
        A fast launcher for Roblox: browse, search and save experiences, then jump straight into the game.
      </p>
      <Button variant="primary" size="lg" onClick={() => go(1)}>
        Get started
      </Button>
    </div>,

    <div key="check" className="flex flex-col gap-4">
      <h3 className="text-lg font-semibold">Checking Roblox</h3>
      <div className="flex items-start gap-3 rounded-[14px] bg-white/5 p-4 text-sm">
        {status.isFetching && !s ? (
          <span className="text-muted">Looking for Roblox…</span>
        ) : status.isError ? (
          <>
            <CircleAlert size={20} className="mt-0.5 shrink-0 text-danger" strokeWidth={1.75} />
            <span>Couldn't check: {status.error.message}</span>
          </>
        ) : installed ? (
          <>
            <CircleCheck size={20} className="mt-0.5 shrink-0 text-success" strokeWidth={1.75} />
            <span>
              Roblox launches through <b>{HANDLER_LABEL[s.handler]}</b>.
              {s.exePath && <span className="mt-1 block truncate text-xs text-muted">{s.exePath}</span>}
            </span>
          </>
        ) : (
          <>
            <CircleAlert size={20} className="mt-0.5 shrink-0 text-amber-300" strokeWidth={1.75} />
            <span>
              Roblox isn't installed or its launcher is missing. {robloxInstallHint} — you can keep exploring in the meantime.
            </span>
          </>
        )}
      </div>
      <div className="flex justify-between">
        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={() => void status.refetch()}>
          Re-check
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => go(0)}>
            Back
          </Button>
          <Button variant="primary" onClick={() => go(2)}>
            Continue
          </Button>
        </div>
      </div>
    </div>,

    <div key="account" className="flex flex-col gap-4">
      <h3 className="text-lg font-semibold">Your account</h3>
      <p className="text-sm text-muted">
        Sign in to Roblox inside Muffin to see your Robux, friends, and your created and saved games. It's optional.
        Games launch as whichever account Roblox Player is signed in to.
      </p>
      <div className="flex flex-col gap-2">
        <SignInButton onSignedIn={finish} />
        <Button variant="ghost" onClick={finish}>
          Continue as guest
        </Button>
      </div>
      <div className="flex justify-start">
        <Button variant="ghost" size="sm" onClick={() => go(1)}>
          Back
        </Button>
      </div>
    </div>,
  ];

  return (
    <Modal open={hydrated && !onboarded} onClose={() => {}} dismissable={false} hideClose widthClass="max-w-md">
      <div className="mb-4 flex justify-center gap-1.5" aria-hidden>
        {panels.map((_, i) => (
          <span key={i} className={`h-1 rounded-full transition-all ${i === step ? "accent-gradient w-6" : "w-1.5 bg-white/15"}`} />
        ))}
      </div>
      <AnimatePresence mode="wait" initial={false} custom={dir}>
        <motion.div
          key={step}
          custom={dir}
          initial={{ opacity: 0, x: 28 * dir }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -28 * dir }}
          transition={m.fast}
        >
          {panels[step]}
        </motion.div>
      </AnimatePresence>
    </Modal>
  );
}
