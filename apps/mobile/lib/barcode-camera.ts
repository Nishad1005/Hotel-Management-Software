/**
 * Reading a label with the device camera — the port, and the platform default.
 *
 * Metro resolves `./barcode-camera` to `barcode-camera.web.ts` when bundling for web.
 * This file is what TypeScript sees, and it is the genuine fallback for any platform
 * without a driver of its own — which today means native.
 *
 * ## Why native has no driver yet
 *
 * Web is the delivery target (ADR 0014) and native builds move to Phase 9. The camera
 * path on native wants `expo-camera`, which is a dependency worth adding when there is a
 * native build to test it in and not before — an untested camera integration is a
 * liability at a dock, not a feature.
 *
 * The seam is the point. Put-away already records HOW a code was established, so the day
 * the native driver lands, the only thing that changes is which file answers `available`.
 * Nothing above this line moves.
 */

export interface BarcodeSession {
  /** Stops the camera and releases the device. Safe to call more than once. */
  stop: () => void;
}

export interface CameraScanner {
  /** Whether this platform can read a label at all. */
  available: () => Promise<boolean>;
  /**
   * Starts the camera and calls `onCode` with the first label it reads.
   *
   * `mount` is a platform view handle — an HTMLElement on web. Typed as unknown here
   * because the port must not name a DOM type in a bundle that also builds for native.
   */
  start: (mount: unknown, onCode: (code: string) => void) => Promise<BarcodeSession>;
}

export const cameraScanner: CameraScanner = {
  available: async () => false,
  start: async () => {
    throw new Error("Reading a label with the camera is not available on this device yet.");
  },
};
