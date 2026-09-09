import { PhotoUnsupportedError, type PreparedPhoto } from "./photo-limits";

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

export {
  MAX_PHOTO_BYTES,
  MAX_PHOTO_EDGE,
  PhotoUnsupportedError,
  type PreparedPhoto,
} from "./photo-limits";

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
