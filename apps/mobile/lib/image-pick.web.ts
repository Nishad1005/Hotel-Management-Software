import type { ImagePicker } from "./image-pick";

/**
 * The web driver: a detached `<input type="file" accept="image/*">`.
 *
 * No dependency, and on a phone browser `capture` opens the camera directly rather than
 * the gallery — which is the difference between a storekeeper photographing the probe
 * reading in front of them and hunting for it afterwards among their own photos.
 *
 * `capture` is a hint the browser is free to ignore, and desktop browsers do: they show a
 * file dialog, which is correct there. So it is set for the camera case and omitted for
 * the gallery case, and neither path assumes it got what it asked for.
 */
export const imagePicker: ImagePicker = {
  available: () => typeof document !== "undefined",

  pick: (preferCamera) =>
    new Promise<Blob | null>((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      if (preferCamera) input.setAttribute("capture", "environment");
      input.style.display = "none";

      // Same shape as the text picker: `cancel` is recent and unevenly supported, so a
      // dismissal the browser does not report simply never settles. To the storekeeper
      // that is indistinguishable from having chosen nothing, which is what happened.
      const cleanup = () => input.remove();

      input.addEventListener("cancel", () => {
        cleanup();
        resolve(null);
      });

      input.addEventListener("change", () => {
        const file = input.files?.[0];
        cleanup();
        if (!file) {
          resolve(null);
          return;
        }
        // Handed back as bytes. Compression and the content address happen in `photo`,
        // so the two jobs stay separable and the compressor is testable without a dialog.
        resolve(file);
      });

      input.addEventListener("error", () => {
        cleanup();
        reject(new Error("The camera could not be opened."));
      });

      document.body.appendChild(input);
      input.click();
    }),
};
