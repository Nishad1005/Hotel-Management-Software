import type { PlanDataBehavior } from "./registry";

/**
 * What a pin says — LFP-4.
 *
 * The figures arrive from one server read (`floor_plan_readings`); this module turns them
 * into the words on a pin and nothing else. It adds nothing up: every number here was
 * counted where the rows are, so a pin can never disagree with the screen it drills into
 * by having done its own arithmetic.
 *
 * The rules it enforces are the pin data contract's (LFP4_PIN_DATA_CONTRACT.md):
 *
 *   - real data or "No reading yet", never a placeholder;
 *   - a pin may fall back to its OWN stock count, never to another location's data;
 *   - a property-scoped figure says so;
 *   - colour encodes only a state provable from data. Two qualify: a temperature not read
 *     today, and a returnable past the date the property itself promised. Nothing here
 *     compares a value against a limit.
 */

/** One zone's figures, over its subtree. */
export interface ZoneReading {
  stockLines: number;
  latestTempC: number | null;
  /** ISO timestamp, server clock. */
  latestTempAt: string | null;
  /** In the property's own day; null when there has never been a reading. */
  tempReadToday: boolean | null;
  dwellMinutes: number | null;
}

/** The property's figures: Terminal 1, and the returnables register. */
export interface PropertyReading {
  receivingOpen: number;
  quarantineMaxHours: number | null;
  returnablesOutstanding: number;
  returnablesOverdue: number;
}

export type PinTone = "neutral" | "attention";

export interface PinText {
  value: string;
  tone: PinTone;
  /** Set when the figure is the property's, not the location's — the pin shows it. */
  caption?: "property-wide";
}

export const NO_READING = "No reading yet";

/** How a timestamp becomes "09:40". Supplied by the caller: locale and clock are I/O. */
export type TimeFormatter = (iso: string) => string;

const MINUS = "−";

export function formatTemperature(c: number): string {
  const abs = Math.abs(c).toFixed(1);
  return `${c < 0 ? MINUS : ""}${abs}°C`;
}

export function formatLines(n: number): string {
  return `${n} ${n === 1 ? "line" : "lines"}`;
}

/** Whole numbers as such, fractions to one place: 16, or 2.5. */
export function formatQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** "24 min", "3.5 h", "2.1 d" — the resolution a person reads a dwell at. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.max(0, Math.round(minutes))} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

/**
 * A zone's pin, for the source the property configured.
 *
 * `zone` is null when the readings have not arrived — the pin then says so rather than
 * showing a zero that would read as an empty store.
 */
export function zonePin(
  behavior: PlanDataBehavior,
  zone: ZoneReading | null,
  property: PropertyReading | null,
  time: TimeFormatter,
): PinText {
  if (!zone) return { value: NO_READING, tone: "neutral" };

  switch (behavior) {
    case "TEMPERATURE": {
      if (zone.latestTempC !== null && zone.latestTempAt !== null) {
        return {
          value: `${formatTemperature(zone.latestTempC)} · ${time(zone.latestTempAt)}`,
          // Not read today is a fact about a date. Whether the value is safe is a
          // threshold, and no threshold colours a pin.
          tone: zone.tempReadToday ? "neutral" : "attention",
        };
      }
      // Never read. Its own stock count is the one fallback allowed, and the pin still
      // says there is no reading, because that is the fact the round exists to change.
      if (zone.stockLines > 0) {
        return { value: `${formatLines(zone.stockLines)} · no reading`, tone: "attention" };
      }
      return { value: NO_READING, tone: "attention" };
    }

    case "COUNT":
      // 0 is a true reading — an empty store is not a missing round.
      return { value: formatLines(zone.stockLines), tone: "neutral" };

    case "DWELL": {
      if (zone.dwellMinutes !== null) {
        return { value: `${formatDuration(zone.dwellMinutes)} dwell`, tone: "neutral" };
      }
      // Stock with no arrival on record cannot happen through the ledger, but a figure
      // must still be an honest one: the count is.
      if (zone.stockLines > 0) return { value: formatLines(zone.stockLines), tone: "neutral" };
      return { value: "Empty", tone: "neutral" };
    }

    case "RETURNABLE": {
      if (!property) return { value: NO_READING, tone: "neutral" };
      // The register is property-wide (the contract's known limitation). When it is
      // empty and this store holds stock, the store's own count is the more useful
      // figure — and it is this location's, so it needs no label.
      if (property.returnablesOutstanding === 0 && zone.stockLines > 0) {
        return { value: formatLines(zone.stockLines), tone: "neutral" };
      }
      const overdue =
        property.returnablesOverdue > 0 ? ` · ${property.returnablesOverdue} overdue` : "";
      return {
        value: `${formatQty(property.returnablesOutstanding)} returnable${overdue}`,
        // Past a date the property itself promised: a fact about a promise, not a limit.
        tone: property.returnablesOverdue > 0 ? "attention" : "neutral",
        caption: "property-wide",
      };
    }
  }
}

/**
 * The gate's pin. "No reading yet", always, in this phase: an on-site count needs
 * `gate_entry.timestamp_out`, and nothing in the product writes it. A count that only
 * ever grows is worse than none.
 */
export function gatePin(): PinText {
  return { value: NO_READING, tone: "neutral" };
}

/** Terminal 1's pin: what is being received, and how long the oldest lot has waited. */
export function dockPin(property: PropertyReading | null): PinText {
  if (!property) return { value: NO_READING, tone: "neutral" };
  const parts: string[] = [];
  if (property.receivingOpen > 0) parts.push(`${property.receivingOpen} receiving`);
  if (property.quarantineMaxHours !== null && property.quarantineMaxHours > 0) {
    parts.push(`${formatDuration(property.quarantineMaxHours * 60)} in quarantine`);
  }
  // Nothing waiting is the good state, and it is a reading.
  return { value: parts.length > 0 ? parts.join(" · ") : "Clear", tone: "neutral" };
}

/**
 * Where a tap on a pin goes. Screens, not routes: the app owns its URLs, and this
 * says only which screen and what to hand it. Null means the pin is not tappable —
 * the gate, until a gate log exists to land on.
 */
export type DrillDown =
  | { screen: "registers"; tab: "STORAGE"; location: string }
  | { screen: "stock"; query: string }
  | { screen: "returnables" }
  | { screen: "receive" };

export function drillDownFor(behavior: PlanDataBehavior, locationCode: string): DrillDown {
  switch (behavior) {
    case "TEMPERATURE":
      return { screen: "registers", tab: "STORAGE", location: locationCode };
    case "COUNT":
    case "DWELL":
      return { screen: "stock", query: locationCode };
    case "RETURNABLE":
      return { screen: "returnables" };
  }
}

export const DOCK_DRILL_DOWN: DrillDown = { screen: "receive" };
export const GATE_DRILL_DOWN: DrillDown | null = null;
