/**
 * The values both photo drivers need, in a module that has no platform variants.
 *
 * ## Why this file exists at all
 *
 * `photo.web.ts` used to import these from `./photo`, which on web resolves to
 * `photo.web.ts` — itself. TypeScript never saw it, because tsc has no platform
 * extensions and resolves `./photo` to `photo.ts` where the values do exist. The bundler
 * does have them, so at runtime the import was circular and every constant was
 * `undefined`.
 *
 * What that looked like: `blob.size <= undefined` is false for every blob, so the
 * compression ladder appeared to fail at every rung and threw "that photograph will not
 * compress small enough to send" — on a 12-megapixel photograph that compresses to 35 KB
 * at the first attempt. A correct compressor, an honest error message, and a completely
 * false conclusion.
 *
 * The rule this file encodes: **a `.web.ts` or `.native.ts` driver must never import
 * runtime values from its own base module name.** A type-only import is fine — it is
 * erased before the bundler sees it, which is why `file-text.web.ts` does exactly that
 * and is correct. Anything with a runtime value goes here, where both drivers can reach
 * it without either one resolving to the other.
 */

/** PRD section 13. The server enforces the same number, so this is not the only guard. */
export const MAX_PHOTO_BYTES = 400 * 1024;

/**
 * The longest edge a stored photograph keeps.
 *
 * 1600 is enough to read a challan's handwriting and to recognise a face across a
 * counter, which are the two jobs. Beyond that the extra pixels cost sync time on the
 * weakest connection on the property and buy nothing anybody looks at.
 */
export const MAX_PHOTO_EDGE = 1600;

export interface PreparedPhoto {
  /** The compressed bytes, ready to upload. */
  blob: Blob;
  /** Lowercase hex SHA-256 of exactly those bytes — the vault's address for them. */
  sha256: string;
  byteSize: number;
  mimeType: "image/jpeg";
  width: number;
  height: number;
}

export class PhotoUnsupportedError extends Error {
  constructor() {
    super(
      "Photographs are not built for this platform yet. Capture on the web app, or record the line without one.",
    );
    this.name = "PhotoUnsupportedError";
  }
}
