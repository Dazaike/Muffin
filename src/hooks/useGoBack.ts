import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

/** Navigates back, falling back to Home when there is no history to return to. */
export function useGoBack(): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    if (window.history.length <= 1) navigate("/");
    else navigate(-1);
  }, [navigate]);
}

/** True when the keyboard event originates from an editable element. */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}
