import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { useMotionPrefs } from "@/lib/motion";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** Tailwind max-width class for the panel (default max-w-md). */
  widthClass?: string;
  /** Hide the × button (e.g. onboarding). */
  hideClose?: boolean;
  /** When false, Esc / backdrop click do nothing. */
  dismissable?: boolean;
  panelClassName?: string;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Dialog with backdrop fade, spring panel, Esc/backdrop close, focus trap and focus restore. */
export function Modal({
  open,
  onClose,
  title,
  children,
  widthClass = "max-w-md",
  hideClose,
  dismissable = true,
  panelClassName,
}: ModalProps) {
  const m = useMotionPrefs();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>("[data-autofocus]") ?? panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissable) {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0]!;
      const lastEl = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      } else if (!panel.contains(document.activeElement)) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, [open, dismissable]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="modal"
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={m.fast}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onMouseDown={dismissable ? onClose : undefined} />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.94, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 4 }}
            transition={m.spring}
            className={cn("glass relative w-full rounded-[20px] p-6 outline-none", widthClass, panelClassName)}
          >
            {(title || !hideClose) && (
              <div className="mb-4 flex items-start justify-between gap-4">
                <h2 id={titleId} className="text-lg font-semibold">
                  {title}
                </h2>
                {!hideClose && (
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={onClose}
                    className="focus-ring -mt-1 -mr-1 cursor-pointer rounded-lg p-1.5 text-muted hover:bg-white/8 hover:text-fg"
                  >
                    <X size={18} strokeWidth={1.75} />
                  </button>
                )}
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Confirm dialog built on Modal. */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  danger,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="text-sm text-muted">{message}</div>
      <div className="mt-6 flex justify-end gap-2">
        <ModalButton onClick={onClose}>Cancel</ModalButton>
        <ModalButton
          primary
          danger={danger}
          autoFocus
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </ModalButton>
      </div>
    </Modal>
  );
}

export function ModalButton({
  children,
  onClick,
  primary,
  danger,
  autoFocus,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  danger?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <Button
      data-autofocus={autoFocus ? "" : undefined}
      onClick={onClick}
      variant={primary ? (danger ? "danger" : "primary") : "glass"}
    >
      {children}
    </Button>
  );
}
