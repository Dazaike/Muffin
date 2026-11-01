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
}

interface UiState {
  toasts: Toast[];
  paletteOpen: boolean;
  /** Increments when something asks the top bar search input to take focus. */
  searchFocusTick: number;
  pushToast: (t: { kind?: ToastKind; message: string; action?: ToastAction; duration?: number }) => number;
  dismissToast: (id: number) => void;
  setPaletteOpen: (open: boolean) => void;
  focusSearch: () => void;
}

let nextId = 1;

export const useUi = create<UiState>((set, get) => ({
  toasts: [],
  paletteOpen: false,
  searchFocusTick: 0,
  pushToast: ({ kind = "info", message, action, duration }) => {
    const id = nextId++;
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
};
