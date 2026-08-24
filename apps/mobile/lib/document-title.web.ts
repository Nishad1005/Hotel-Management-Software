import { useEffect } from "react";

const APP_NAME = "PARGOLAI";

/**
 * Names the browser tab after the page you are on.
 *
 * No route set a title, so every tab in the product read the same word — and with the
 * office running the app on a laptop, "which of these four tabs is the receiving screen"
 * was answerable only by clicking each one. `expo-router/head` would do this too but needs
 * `expo-head`, which is not installed; a seam costs one file and no dependency.
 *
 * Page first, product second: a tab strip truncates from the right, so "Receive goods · P…"
 * is useful where "PARGOLAI · Rec…" is not.
 */
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
  }, [title]);
}
