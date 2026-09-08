/**
 * Preparing a photograph for the evidence vault — the port, and the native fallback.
 *
 * Metro resolves `./photo` to `photo.web.ts` on web and to this file everywhere else,
 * the same split the outbox storage uses. TypeScript resolves this one, so the signature
 * here is what proves the contract for the driver it never sees.
 *
 * ## Why the web driver needs no dependency
 *
 * Compression and hashing are both in the browser already: a canvas resizes and
 * re-encodes, and `crypto.subtle` digests. Web is the first delivery target (ADR 0014),
 * so the platform that ships now costs nothing in bundle size or native build
 * configuration.
 *
 * Native will need `expo-image-manipulator` and a file digest, which is a dependency
 * decision worth making when native builds actually land in Phase 9 rather than carrying
 * an unused package until then. Until it does, this file refuses clearly instead of
 * silently uploading a four-megabyte original — which would sail past the client rule and
 * be rejected by the server's own 400 KB ceiling anyway, just later and less
 * comprehensibly.
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

/**
 * Compresses to under the ceiling and returns the bytes with their content address.
 *
 * Refuses rather than approximates on a platform with no driver. A photograph the
 * storekeeper believes was taken, that never reached the vault, is worse than being told
 * plainly that this device cannot take one.
 */
export async function preparePhoto(_source: Blob): Promise<PreparedPhoto> {
  throw new PhotoUnsupportedError();
}

/** Whether this build can take a photograph at all, so a screen can say so up front. */
export function photoCaptureAvailable(): boolean {
  return false;
}
