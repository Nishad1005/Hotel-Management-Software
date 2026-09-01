/**
 * Error tracking — native half of the seam, which is to say: not yet.
 *
 * The real implementation is `telemetry.web.ts`, resolved by Metro on the platform this
 * app actually ships to (web-first, ADR 0014). It uses `@sentry/browser`, which cannot
 * run on a device — so this stub keeps native builds compiling without dragging a DOM
 * SDK into them.
 *
 * When Phase 9 brings native builds, `@sentry/react-native` lands here with the same
 * exported surface, exactly as the camera and printing already split across this seam.
 * Until then a native build reports nothing, which is honest: it also ships nothing.
 */

export const telemetryEnabled = false;

export function initTelemetry(): void {
  // Nothing to initialise on native yet.
}

export function setTelemetryTags(_tags: {
  orgId: string | null;
  propertyId: string | null;
  propertyCode: string | null;
}): void {
  // No sink for tags on native yet.
}

export function captureError(_error: unknown, _context?: Record<string, string | number>): void {
  // Errors on native surface nowhere until Phase 9 wires the react-native SDK.
}
