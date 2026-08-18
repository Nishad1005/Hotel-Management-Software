import type { BarcodeSession, CameraScanner } from "./barcode-camera";

/**
 * The web camera driver, built on the browser's own BarcodeDetector.
 *
 * No dependency. `BarcodeDetector` is a platform API in Chrome, Edge and Android
 * WebView — which is what a dock tablet actually runs — and a library wrapping it would
 * ship a decoder we do not need alongside a fallback we could not test today.
 *
 * Safari and Firefox do not implement it. That is why `available()` exists and why the
 * scan field keeps the wedge and typed paths visible rather than treating the camera as
 * the way in: on a device with no detector the camera button is simply not offered, and
 * nothing else about the screen changes.
 *
 * ## Reading is a poll, not a stream
 *
 * `detect()` takes a frame and returns what it found. Driven from
 * `requestAnimationFrame` so it stops when the tab is hidden — a camera left running
 * behind a locked screen is both a battery problem and a thing a storekeeper is right to
 * object to.
 */

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

/**
 * The formats a Golai label can carry.
 *
 * Code 128 because that is what `packages/domain/src/labels` encodes; QR because a
 * property that already has its own labelling usually has QR, and refusing to read one
 * would be a choice with nothing behind it.
 */
const FORMATS = ["code_128", "qr_code", "code_39", "ean_13"];

function detectorConstructor(): BarcodeDetectorConstructor | null {
  const g = globalThis as unknown as { BarcodeDetector?: BarcodeDetectorConstructor };
  return typeof g.BarcodeDetector === "function" ? g.BarcodeDetector : null;
}

export const cameraScanner: CameraScanner = {
  available: async () => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return false;
    const Ctor = detectorConstructor();
    if (!Ctor) return false;

    // Present but supporting nothing we print is the same as absent, and finding that
    // out at the dock rather than here is the version that wastes somebody's morning.
    try {
      const supported = (await Ctor.getSupportedFormats?.()) ?? FORMATS;
      return FORMATS.some((f) => supported.includes(f));
    } catch {
      return false;
    }
  },

  start: async (mount, onCode) => {
    const Ctor = detectorConstructor();
    if (!Ctor) throw new Error("This browser cannot read a label with the camera.");
    if (!(mount instanceof HTMLElement)) throw new Error("The camera has nowhere to render.");

    let stream: MediaStream;
    try {
      // The rear camera where there is one. `ideal` rather than `exact` so a laptop with
      // only a front camera still works instead of throwing.
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
    } catch {
      throw new Error(
        "The camera could not be opened. Allow camera access for this site, or type the code.",
      );
    }

    const video = document.createElement("video");
    video.setAttribute("playsinline", "true");
    video.muted = true;
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.objectFit = "cover";
    video.srcObject = stream;
    mount.appendChild(video);
    await video.play();

    const detector = new Ctor({ formats: FORMATS });

    let stopped = false;
    let frame = 0;
    // Reads overlap otherwise: detect() is slower than a frame, and queueing them behind
    // each other turns a busy camera into an unresponsive one.
    let reading = false;

    const stop: BarcodeSession["stop"] = () => {
      if (stopped) return;
      stopped = true;
      if (frame) cancelAnimationFrame(frame);
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
      video.remove();
    };

    const tick = () => {
      if (stopped) return;
      frame = requestAnimationFrame(tick);
      if (reading || video.readyState < 2) return;

      reading = true;
      void detector
        .detect(video)
        .then((found) => {
          const code = found[0]?.rawValue?.trim();
          // The camera stops itself on a hit. A scanner that keeps reading while the
          // screen has moved on fires the next gate's scan into the last one's field.
          if (code) {
            stop();
            onCode(code);
          }
        })
        .catch(() => {
          // A frame that will not decode is the ordinary case, not an error.
        })
        .finally(() => {
          reading = false;
        });
    };

    frame = requestAnimationFrame(tick);
    return { stop };
  },
};
