import { create } from "zustand";

export type PromptChoice = "install" | "deny" | "dismiss";

interface PromptState {
  /** `ask`: waiting for the user's answer. `installing`: Fishstrap is being downloaded and installed. */
  phase: "closed" | "ask" | "installing";
  ask: () => Promise<PromptChoice>;
  answer: (choice: PromptChoice) => void;
  setPhase: (phase: PromptState["phase"]) => void;
}

let resolver: ((c: PromptChoice) => void) | null = null;

export const useFishstrapPrompt = create<PromptState>((set) => ({
  phase: "closed",
  ask: () =>
    new Promise<PromptChoice>((resolve) => {
      resolver = resolve;
      set({ phase: "ask" });
    }),
  answer: (choice) => {
    const r = resolver;
    resolver = null;
    set({ phase: choice === "install" ? "installing" : "closed" });
    r?.(choice);
  },
  setPhase: (phase) => set({ phase }),
}));
