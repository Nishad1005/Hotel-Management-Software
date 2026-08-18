import type { ChosenFile, FileTextPicker } from "./file-text";

/**
 * The web driver: a detached `<input type="file">`.
 *
 * No dependency and no rendered element. react-native-web has no file input, and a
 * library that adds one would ship a component we would then have to style to match
 * everything else — for a control that is only ever a button opening the operating
 * system's own dialog.
 */
export const fileTextPicker: FileTextPicker = {
  available: () => typeof document !== "undefined",

  pick: (accept) =>
    new Promise<ChosenFile | null>((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = accept;
      input.style.display = "none";

      // There is no reliable "cancelled" event across browsers — `cancel` is recent and
      // unevenly supported — so the element is removed on either outcome and the promise
      // simply never settles on a dismissal the browser does not report. The screen
      // treats that as "nothing was chosen", which is what it looks like to the user.
      const cleanup = () => input.remove();

      input.addEventListener("cancel", () => {
        cleanup();
        resolve(null);
      });

      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (!file) {
          cleanup();
          resolve(null);
          return;
        }
        file
          .text()
          .then((text) => {
            cleanup();
            resolve({ name: file.name, text });
          })
          .catch((e: unknown) => {
            cleanup();
            reject(e instanceof Error ? e : new Error(String(e)));
          });
      });

      document.body.appendChild(input);
      input.click();
    }),
};
