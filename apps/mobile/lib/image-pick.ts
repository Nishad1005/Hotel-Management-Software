/**
 * Getting a photograph off the device — the port, and the native fallback.
 *
 * Separate from `file-text` because the two want different things from the same dialog:
 * that one reads a spreadsheet into a string, this one hands back bytes for compression.
 * Sharing a module would mean one of them decoding a JPEG as UTF-8.
 *
 * Native gets a driver when native builds land in Phase 9, where it wants
 * `expo-image-picker`. Until then this refuses in words a storekeeper can act on rather
 * than presenting a button that does nothing.
 */

export interface ImagePicker {
  available: () => boolean;
  /**
   * Opens the camera where the device has one, the gallery otherwise.
   *
   * Resolves null when nothing was chosen. `preferCamera` is a request rather than a
   * guarantee: a laptop has no rear camera and will show a file dialog, which is the
   * right thing there.
   */
  pick: (preferCamera: boolean) => Promise<Blob | null>;
}

export const imagePicker: ImagePicker = {
  available: () => false,
  pick: async () => {
    throw new Error(
      "Taking a photograph is not available on this device yet. Record the line without one.",
    );
  },
};
