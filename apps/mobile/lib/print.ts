/**
 * Printing an HTML document — the port, and the platform default.
 *
 * Metro resolves `./print` to `print.web.ts` when bundling for web. This file is what
 * TypeScript sees and the fallback for any platform without a driver, which today means
 * native.
 *
 * Native gets one in Phase 9, and `expo-print` is what it will use. Adding that
 * dependency now would buy nothing: the browser's own print pipeline already produces a
 * PDF through "Save as PDF" and drives a thermal printer directly, which is the whole
 * requirement, and an untested native integration is a liability at a store rather than a
 * feature.
 */

export interface Printer {
  available: () => boolean;
  /**
   * Opens the platform's print dialog for this document.
   *
   * Deliberately not `toPdf`. The person at a store either has a label printer, in which
   * case they want to print, or they want a file to send to a print shop — and the same
   * dialog does both, with "Save as PDF" being one of its destinations. A separate PDF
   * path would be a second thing to keep working for no gain.
   */
  print: (html: string, title: string) => Promise<void>;
}

export const printer: Printer = {
  available: () => false,
  print: async () => {
    throw new Error("Printing is not available on this device yet.");
  },
};
