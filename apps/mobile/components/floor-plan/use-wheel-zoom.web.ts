import { WHEEL_STEP } from "@golai/domain";
import { useEffect, useRef, type RefObject } from "react";
import type { View } from "react-native";
// Type-only, so it is erased before the bundler resolves `./use-wheel-zoom` back to this
// very file (CLAUDE.md: a web driver must not import runtime values from its own base).
import type { WheelHandler } from "./use-wheel-zoom";

/**
 * Mouse-wheel zoom, anchored at the cursor — the demo's `wheel` listener.
 *
 * A real DOM listener rather than React's `onWheel`, for one reason: React registers wheel
 * handlers as passive, and a passive handler cannot `preventDefault`. Without that the
 * page scrolls underneath the plan while it zooms, which reads as the map fighting the
 * user. The demo makes the same choice (`{ passive: false }`).
 *
 * The cost is the demo's too, and worth knowing: while the cursor is over the plan, the
 * wheel belongs to the plan and the page does not scroll.
 */
export function useWheelZoom(target: RefObject<View | null>, onWheel: WheelHandler): void {
  // Held in a ref so the listener is attached once, not re-attached on every render that
  // happens to produce a new callback identity.
  const handler = useRef(onWheel);
  handler.current = onWheel;

  useEffect(() => {
    // On react-native-web a View's ref IS the DOM element.
    const node = target.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== "function") return;

    const listener = (e: WheelEvent) => {
      e.preventDefault();
      const rect = node.getBoundingClientRect();
      handler.current(
        e.deltaY > 0 ? WHEEL_STEP : 1 / WHEEL_STEP,
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
    };

    node.addEventListener("wheel", listener, { passive: false });
    return () => node.removeEventListener("wheel", listener);
  }, [target]);
}
