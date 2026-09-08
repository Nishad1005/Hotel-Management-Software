import {
  MAX_PHOTO_BYTES,
  MAX_PHOTO_EDGE,
  PhotoUnsupportedError,
  type PreparedPhoto,
} from "./photo";

/**
 * The web half — canvas to compress, `crypto.subtle` to address (ADR 0014).
 *
 * No dependency, deliberately. Both halves of the job are already in the browser, and a
 * package that did the same thing would add bundle weight to the one platform that
 * currently ships.
 *
 * ## Compressing to a ceiling, not to a quality
 *
 * PRD section 13 gives a size, not a quality setting, and the two are only loosely
 * related: a photograph of a printed challan compresses to a fraction of what a dim
 * photograph of a cold room does at the same JPEG quality. So this measures and retries
 * rather than picking 0.8 and hoping — first dropping quality, then the longest edge,
 * because a smaller legible image beats a larger smeared one when the job is reading a
 * batch number off a sack.
 *
 * ## Why the hash is of the final bytes
 *
 * The address has to be of what is actually stored. Hashing the original would make two
 * different compressions of one photograph share an address, and the vault's claim —
 * that an address identifies the bytes an inspector is shown — would quietly stop being
 * true.
 */

/** Quality ladder, tried in order. Below the last step text starts to break up. */
const QUALITY_STEPS = [0.82, 0.7, 0.6, 0.5, 0.42];

/** Edge ladder, tried once the quality ladder is exhausted. */
const EDGE_STEPS = [MAX_PHOTO_EDGE, 1200, 1024, 800];

export function photoCaptureAvailable(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof createImageBitmap === "function" &&
    typeof crypto !== "undefined" &&
    typeof crypto.subtle?.digest === "function"
  );
}

export async function preparePhoto(source: Blob): Promise<PreparedPhoto> {
  if (!photoCaptureAvailable()) throw new PhotoUnsupportedError();

  const bitmap = await createImageBitmap(source);
  try {
    for (const edge of EDGE_STEPS) {
      const { canvas, width, height } = draw(bitmap, edge);
      for (const quality of QUALITY_STEPS) {
        const blob = await encode(canvas, quality);
        if (blob.size <= MAX_PHOTO_BYTES) {
          return {
            blob,
            sha256: await sha256Hex(blob),
            byteSize: blob.size,
            mimeType: "image/jpeg",
            width,
            height,
          };
        }
      }
    }
  } finally {
    bitmap.close();
  }

  /*
    Every rung tried and still too large.

    Refused rather than uploaded, because the server's own 400 KB constraint would reject
    it a moment later and the storekeeper would be told at the end of the sequence instead
    of the start. In practice this needs a photograph that is almost entirely noise; the
    message says what to do about it rather than restating the number.
  */
  throw new Error(
    "That photograph will not compress small enough to send. Take it again with less in frame, or in better light.",
  );
}

/** Scales onto a canvas, longest edge capped, aspect kept. */
function draw(bitmap: ImageBitmap, maxEdge: number) {
  const longest = Math.max(bitmap.width, bitmap.height);
  // Never scales UP. Enlarging a small photograph adds bytes and no detail.
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new PhotoUnsupportedError();
  // White underneath: a transparent source encoded to JPEG goes black otherwise, which
  // on a photographed document means an unreadable one.
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);

  return { canvas, width, height };
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("The photograph could not be encoded."))),
      "image/jpeg",
      quality,
    );
  });
}

async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
