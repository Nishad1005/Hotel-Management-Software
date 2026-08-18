/**
 * Reading a text file the user chose — the port, and the platform default.
 *
 * Metro resolves `./file-text` to `file-text.web.ts` when bundling for web. This file is
 * what TypeScript sees and the fallback for any platform without a driver, which today
 * means native.
 *
 * Native gets one when native builds land in Phase 9; it wants `expo-document-picker`,
 * and that is a dependency worth adding when there is a build to test it in.
 *
 * The paste box above this is not a fallback for the missing driver — it is the primary
 * path on every platform. Somebody importing an item list already has the spreadsheet
 * open, and select-all-copy is fewer steps than a file dialog on any device.
 */

export interface ChosenFile {
  name: string;
  text: string;
}

export interface FileTextPicker {
  available: () => boolean;
  /** Resolves null when the user dismisses the dialog. */
  pick: (accept: string) => Promise<ChosenFile | null>;
}

export const fileTextPicker: FileTextPicker = {
  available: () => false,
  pick: async () => {
    throw new Error("Choosing a file is not available on this device yet. Paste the rows instead.");
  },
};
