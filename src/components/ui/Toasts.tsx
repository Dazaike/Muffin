import { useState, type Ref } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useMotionPrefs } from "@/lib/motion";
import { useUi, type Toast, type ToastKind } from "@/store/ui";
import { cn } from "@/lib/cn";
import { UndoCountdown } from "./UndoButton";

const ICON: Record<ToastKind, typeof Info> = { info: Info, success: CircleCheck, error: CircleAlert };
const TONE: Record<ToastKind, string> = { info: "text-accent", success: "text-success", error: "text-danger" };

// AnimatePresence popLayout measures its direct child through a ref, so ToastItem hands `ref` to the motion element.
function ToastItem({
  toast: t,
  shortcut,
  dismiss,
  ref,
}: {
  toast: Toast;
  shortcut: boolean;
  dismiss: (id: number) => void;
  ref?: Ref<HTMLDivElement>;
}) {
  const m = useMotionPrefs();
  const [hovered, setHovered] = useState(false);
  const Icon = ICON[t.kind];
  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, x: 40, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.96 }}
      transition={m.spring}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className="glass pointer-events-auto flex w-full items-start gap-3 rounded-[14px] px-4 py-3 text-sm"
    >
      <Icon size={18} strokeWidth={1.75} className={cn("mt-0.5 shrink-0", TONE[t.kind])} />
      <div className="min-w-0 flex-1 break-words">{t.message}</div>
      {t.action && (
        <button
          type="button"
          onClick={() => {
            t.action?.onClick();
            dismiss(t.id);
          }}
          className="focus-ring shrink-0 cursor-pointer rounded-md px-2 py-0.5 text-[13px] font-semibold text-accent hover:bg-white/8"
        >
          {t.action.label}
        </button>
      )}
      {t.undo && (
        <UndoCountdown
          duration={t.undo.duration}
          paused={hovered}
          shortcut={shortcut}
          onUndo={() => {
            dismiss(t.id);
            t.undo?.onUndo();
          }}
          onExpire={() => dismiss(t.id)}
        />
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismiss(t.id)}
        className="focus-ring shrink-0 cursor-pointer rounded-md p-0.5 text-muted hover:text-fg"
      >
        <X size={16} strokeWidth={1.75} />
      </button>
    </motion.div>
  );
}

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  // Ctrl/Cmd+Z undoes only the newest undoable toast, not every one on screen.
  const shortcutId = toasts.filter((t) => t.undo).at(-1)?.id;
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[80] flex w-[min(380px,calc(100vw-2rem))] flex-col items-end gap-2" role="status" aria-live="polite">
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} shortcut={t.id === shortcutId} dismiss={dismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}
