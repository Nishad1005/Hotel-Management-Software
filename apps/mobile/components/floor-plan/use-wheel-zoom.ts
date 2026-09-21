import type { RefObject } from "react";
import type { View } from "react-native";

/**
 * Mouse-wheel zoom — the native half, which is nothing.
 *
 * A phone has no wheel; pinch does this job there. The web half
 * (`use-wheel-zoom.web.ts`) attaches a DOM listener, which is why this is a platform
 * pair rather than a `Platform.OS` branch: the brief forbids DOM APIs in code that ships
 * to native, and a file the native bundler never opens cannot break that rule.
 */

/** `factor` < 1 zooms in. `x`/`y` are the cursor in pixels, relative to the plan's frame. */
export type WheelHandler = (factor: number, x: number, y: number) => void;

export function useWheelZoom(_target: RefObject<View | null>, _onWheel: WheelHandler): void {
  // Deliberately empty.
}
