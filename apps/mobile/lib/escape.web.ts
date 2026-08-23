import { useEffect } from "react";

/**
 * Escape closes the thing on top.
 *
 * Every modal in this app is a full-screen slide-up with no Escape and no click-outside,
 * which on a keyboard-driven desktop means the only way out of "choose a reject reason"
 * is to find and hit a small × with the mouse. `keydown` on `window` in the capture phase
 * would be wrong — a text field should get its own Escape first — so this listens in the
 * bubble phase and only acts while `active`.
 *
 * `onEscape` is depended on rather than held in a ref: callers pass a `useCallback`'d
 * setter, and a stale closure that closes the wrong overlay is worse than a re-subscribe.
 */
export function useEscape(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onEscape();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, onEscape]);
}
