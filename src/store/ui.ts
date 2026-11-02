import { create } from "zustand";

export type ToastKind = "info" | "success" | "error";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
  /**
   * Undoable toast: reverses the action it reports. Rendered with a draining countdown and Ctrl/Cmd+Z;
   * the countdown (not a store timer) dismisses it so hovering can hold the clock.
   */
  undo?: { onUndo: () => void; duration: number };
}

interface UiState {
  toasts: Toast[];
  paletteOpen: boolean;
  /** Increments when something asks the top bar search input to take focus. */
  searchFocusTick: number;
  pushToast: (t: {
    kind?: ToastKind;
    message: string;
    action?: ToastAction;
    undo?: () => void;
    duration?: number;
  }) => number;
  dismissToast: (id: number) => void;
  setPaletteOpen: (open: boolean) => void;
  focusSearch: () => void;
}

let nextId = 1;
const UNDO_MS = 6000;

export const useUi = create<UiState>((set, get) => ({
  toasts: [],
  paletteOpen: false,
  searchFocusTick: 0,
  pushToast: ({ kind = "info", message, action, undo, duration }) => {
    const id = nextId++;
    if (undo) {
      const ms = duration ?? UNDO_MS;
      set((s) => ({ toasts: [...s.toasts, { id, kind, message, undo: { onUndo: undo, duration: ms } }] }));
      return id;
    }
    set((s) => ({ toasts: [...s.toasts, { id, kind, message, action }] }));
    const ms = duration ?? (action ? 5000 : kind === "error" ? 7000 : 4000);
    setTimeout(() => get().dismissToast(id), ms);
    return id;
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  focusSearch: () => set((s) => ({ searchFocusTick: s.searchFocusTick + 1 })),
}));

/** Imperative toast helpers usable from stores and event handlers. */
export const toast = {
  info: (message: string) => useUi.getState().pushToast({ kind: "info", message }),
  success: (message: string) => useUi.getState().pushToast({ kind: "success", message }),
  error: (message: string) => useUi.getState().pushToast({ kind: "error", message }),
  withAction: (message: string, action: ToastAction, duration = 5000) =>
    useUi.getState().pushToast({ kind: "info", message, action, duration }),
  /** Reports a completed action and offers to reverse it (countdown chip + Ctrl/Cmd+Z). */
  undoable: (message: string, onUndo: () => void, duration = UNDO_MS) =>
    useUi.getState().pushToast({ kind: "info", message, undo: onUndo, duration }),
};
