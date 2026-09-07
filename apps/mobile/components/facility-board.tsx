import { Image, StyleSheet, View } from "react-native";
import { FACILITY_ASPECT, FACILITY_PINS } from "../lib/facility";
import type { PropertyOverview } from "../lib/overview";
import type { StorageReading } from "../lib/temperature";
import { radius, space, usePalette } from "../theme";
import { Text } from "./ui";

const SCHEMATIC = require("../assets/illustrations/facility-schematic.png");

/**
 * When a reading was taken, said unambiguously.
 *
 * A bare "07:57" is fine for this morning and a lie by omission for the morning before
 * last — and the whole point of a cold-chain pin is that the reader can tell the
 * difference between a room that was checked at breakfast and one that has not been
 * checked since Tuesday. So the date appears the moment it is not today's.
 */
function when(iso: string): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const today = new Date();
  const sameDay =
    at.getDate() === today.getDate() &&
    at.getMonth() === today.getMonth() &&
    at.getFullYear() === today.getFullYear();
  if (sameDay) return time;
  return `${at.toLocaleDateString([], { day: "numeric", month: "short" })} · ${time}`;
}

/**
 * The property, drawn, with what is actually happening on it.
 *
 * ## Every number here is real or absent
 *
 * This is the one rule the block is built around (brief §6, and decision 4 in §2): the
 * pins are fed by the queries the dashboard already makes and by the temperature
 * register, and where a source has nothing to say the pin says so. There is no
 * simulated telemetry, no "live" anything, and no placeholder figure that a manager
 * could mistake for a reading — a schematic that invents a cold-room temperature is
 * worse than no schematic, because it is the one number somebody might act on.
 *
 * ## Why an image with overlays rather than a drawing in code
 *
 * The drawing is a placeholder for a property-accurate one. Keeping it as a single
 * asset means that replacement is a new file plus the anchors in `lib/facility.ts`;
 * expressing it as components would make it a rewrite. The pins are real Views on top
 * precisely so they survive that swap.
 */
export function FacilityBoard({
  overview,
  readings,
  propertyCode,
}: {
  overview: PropertyOverview | null;
  /** Latest storage readings, newest first. Empty is a legitimate state, not a failure. */
  readings: StorageReading[];
  propertyCode: string;
}) {
  const p = usePalette();

  function latestFor(suffix: string): StorageReading | undefined {
    return readings.find((r) => r.locationCode === `${propertyCode}-${suffix}`);
  }

  function readingFor(pin: (typeof FACILITY_PINS)[number]): {
    value: string;
    note: string;
    tone: "known" | "unknown";
  } {
    if (pin.locationSuffix) {
      const latest = latestFor(pin.locationSuffix);
      if (!latest) return { value: "—", note: "No reading yet", tone: "unknown" };
      return { value: `${latest.temperatureC}°`, note: when(latest.recordedAt), tone: "known" };
    }

    if (!overview) return { value: "—", note: "Not loaded", tone: "unknown" };

    if (pin.key === "SEC") {
      return {
        value: String(overview.arrivalsWaiting),
        note: overview.arrivalsWaiting === 1 ? "arrival waiting" : "arrivals waiting",
        tone: "known",
      };
    }
    if (pin.key === "T1_RCV") {
      return {
        value: String(overview.quarantineLines),
        note:
          overview.quarantineOldestHours === null
            ? "at Terminal 1"
            : `oldest ${overview.quarantineOldestHours.toFixed(1)} h`,
        tone: "known",
      };
    }
    return {
      value: String(overview.awaitingGatePass),
      note: "awaiting a pass",
      tone: "known",
    };
  }

  return (
    <View
      style={{
        borderRadius: radius.lg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: p.border,
        backgroundColor: p.surface,
        overflow: "hidden",
      }}
    >
      {/*
        `aspectRatio` reserves the height before the image decodes, so the cards below do
        not jump down the page when it arrives.
      */}
      <View style={{ width: "100%", aspectRatio: FACILITY_ASPECT }}>
        {/*
          Explicitly sized, and `contain` rather than `cover`, for two separate reasons.

          `StyleSheet.absoluteFill` alone left the <img> at its natural 1800px on web —
          it kept its intrinsic width, overflowed the card, and the card's `overflow:
          hidden` cropped the dry store and dispatch off the right-hand edge.

          `contain` because the pins are positioned as percentages of THIS container, so
          the artwork has to occupy exactly the container box or every pin drifts off the
          zone it names. With the container's aspect tied to the asset (FACILITY_ASPECT)
          contain fits precisely; if a swapped-in drawing has a different aspect it
          letterboxes, which is visible and fixable, where cover would silently crop
          zones out from under their own pins.
        */}
        <Image
          source={SCHEMATIC}
          resizeMode="contain"
          style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
          accessibilityLabel="Plan of the property: security gate, receiving bay, cold room, freezer, dry store and dispatch"
        />

        {FACILITY_PINS.map((pin) => {
          const r = readingFor(pin);
          return (
            <View
              key={pin.key}
              style={{
                position: "absolute",
                left: `${pin.x}%`,
                top: `${pin.y}%`,
                // Pulls the pin's own centre onto the anchor rather than its top-left,
                // so a re-drawn schematic's anchors mean the middle of a zone.
                transform: [{ translateX: -54 }, { translateY: -22 }],
                width: 108,
                alignItems: "center",
              }}
            >
              <View
                style={{
                  backgroundColor: p.surface,
                  borderRadius: radius.md,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: r.tone === "known" ? p.brassLine : p.border,
                  paddingHorizontal: space.sm,
                  paddingVertical: space.xs,
                  alignItems: "center",
                  minWidth: 88,
                }}
              >
                <Text role="overline" style={{ color: p.brass }} lines={1}>
                  {pin.label}
                </Text>
                <Text
                  role="heading"
                  numeric
                  tone={r.tone === "known" ? "default" : "muted"}
                  style={{ marginTop: 1 }}
                >
                  {r.value}
                </Text>
                <Text role="caption" tone="muted" lines={1}>
                  {r.note}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
