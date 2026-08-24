/**
 * Escape closes the thing on top. Native has no Escape key, so this is the no-op half.
 *
 * A platform seam rather than a `Platform.OS` branch, matching how the camera, printing
 * and file-picking are already split — the web half imports `window`, which does not
 * exist on a device, and a runtime branch would still bundle it.
 */
export function useEscape(_active: boolean, _onEscape: () => void): void {
  // Android's hardware back is handled by the navigator; iOS has no equivalent.
}
