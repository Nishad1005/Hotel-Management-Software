import type { Printer } from "./print";

/**
 * The web driver: a hidden iframe and the browser's own print dialog.
 *
 * An iframe rather than `window.open`. A popup is blocked by default on a click that has
 * been through an await, which is exactly the shape of "render two hundred labels then
 * print" — and a blocked popup fails silently, leaving somebody pressing a button that
 * does nothing.
 *
 * The dialog's own "Save as PDF" destination is what produces the file to send to a print
 * shop, so there is no separate PDF path to build or keep working.
 */

/**
 * How long the frame lives after the dialog is dismissed.
 *
 * Removing it immediately kills the print job in Safari and older Chrome, which read the
 * document while the dialog is open. Ten seconds is longer than any dialog takes to
 * hand off and short enough that a long session does not accumulate frames.
 */
const CLEANUP_DELAY_MS = 10_000;

export const printer: Printer = {
  available: () => typeof document !== "undefined" && typeof window !== "undefined",

  print: (html, title) =>
    new Promise<void>((resolve, reject) => {
      const frame = document.createElement("iframe");
      frame.setAttribute("aria-hidden", "true");
      frame.setAttribute("title", title);
      // Off-screen rather than display:none. A frame that is not laid out has no page
      // box, and Chrome prints a blank document from it.
      frame.style.position = "fixed";
      frame.style.right = "0";
      frame.style.bottom = "0";
      frame.style.width = "1px";
      frame.style.height = "1px";
      frame.style.border = "0";
      frame.style.opacity = "0";

      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        window.setTimeout(() => frame.remove(), CLEANUP_DELAY_MS);
        if (error) reject(error);
        else resolve();
      };

      frame.addEventListener("load", () => {
        try {
          const view = frame.contentWindow;
          if (!view) throw new Error("The print frame did not open.");
          view.focus();
          view.print();
          finish();
        } catch (e) {
          finish(e instanceof Error ? e : new Error(String(e)));
        }
      });

      document.body.appendChild(frame);

      // srcdoc rather than document.write: the frame stays same-origin, the load event
      // fires once the whole document including the inline SVG is parsed, and there is no
      // document.open/close dance that some browsers now warn about.
      frame.srcdoc = html;
    }),
};
