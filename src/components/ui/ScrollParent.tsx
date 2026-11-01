import { createContext, useContext } from "react";

/** The Shell's scrolling <main>. VirtualGrid virtualizes against it; null outside the shell. */
export const ScrollParentContext = createContext<HTMLElement | null>(null);

export function useScrollParent(): HTMLElement | null {
  return useContext(ScrollParentContext);
}
