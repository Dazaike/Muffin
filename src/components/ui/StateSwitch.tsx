import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { TriangleAlert, Inbox } from "lucide-react";
import { useMotionPrefs } from "@/lib/motion";
import type { AppError } from "@/lib/types";
import { Button } from "./Button";

export function EmptyState({ title, hint, icon, action }: { title: string; hint?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-white/5 text-muted">
        {icon ?? <Inbox size={22} strokeWidth={1.75} />}
      </div>
      <div className="text-base font-medium">{title}</div>
      {hint && <div className="max-w-md text-sm text-muted">{hint}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-danger/15 text-danger">
        <TriangleAlert size={22} strokeWidth={1.75} />
      </div>
      <div className="text-base font-medium">Something went wrong</div>
      <div className="max-w-md text-sm text-muted">{message}</div>
      {onRetry && (
        <Button variant="glass" size="sm" onClick={onRetry} className="mt-2">
          Retry
        </Button>
      )}
    </div>
  );
}

export interface StateSwitchProps {
  loading: boolean;
  error?: AppError | null | false;
  onRetry?: () => void;
  isEmpty?: boolean;
  skeleton: ReactNode;
  /** Shown when `isEmpty`. Use <EmptyState/>. */
  empty?: ReactNode;
  children: ReactNode;
  /** Cross-fade between states (default true). */
  animated?: boolean;
}

type Phase = "loading" | "error" | "empty" | "content";

/** Cross-fades between skeleton / error (with Retry) / empty / content; `animated={false}` switches instantly. */
export function StateSwitch({ loading, error, onRetry, isEmpty, skeleton, empty, children, animated = true }: StateSwitchProps) {
  const m = useMotionPrefs();
  const phase: Phase = loading ? "loading" : error ? "error" : isEmpty ? "empty" : "content";
  const body = (
    <>
      {phase === "loading" && skeleton}
      {phase === "error" && <ErrorState message={error ? error.message : "Unknown error"} onRetry={onRetry} />}
      {phase === "empty" && (empty ?? <EmptyState title="Nothing here yet" />)}
      {phase === "content" && children}
    </>
  );
  if (!animated) return body;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={phase}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={m.fast}
      >
        {body}
      </motion.div>
    </AnimatePresence>
  );
}
