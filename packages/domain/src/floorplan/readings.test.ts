import { describe, expect, it } from "vitest";

import {
  NO_READING,
  dockPin,
  drillDownFor,
  formatDuration,
  formatTemperature,
  gatePin,
  zonePin,
  type PropertyReading,
  type ZoneReading,
} from "./readings";

const time = (iso: string) => `T(${iso})`;

const empty: ZoneReading = {
  stockLines: 0,
  latestTempC: null,
  latestTempAt: null,
  tempReadToday: null,
  dwellMinutes: null,
};

const quiet: PropertyReading = {
  receivingOpen: 0,
  quarantineMaxHours: null,
  returnablesOutstanding: 0,
  returnablesOverdue: 0,
};

describe("temperature pins", () => {
  it("show the reading and when it was taken, neutral when read today", () => {
    const pin = zonePin(
      "TEMPERATURE",
      { ...empty, latestTempC: 3.8, latestTempAt: "2026-09-24T04:10:00Z", tempReadToday: true },
      quiet,
      time,
    );
    expect(pin).toEqual({ value: "3.8°C · T(2026-09-24T04:10:00Z)", tone: "neutral" });
  });

  it("keep the last reading but draw attention when it was not today", () => {
    const pin = zonePin(
      "TEMPERATURE",
      { ...empty, latestTempC: -18, latestTempAt: "2026-09-22T04:10:00Z", tempReadToday: false },
      quiet,
      time,
    );
    expect(pin.value).toBe("−18.0°C · T(2026-09-22T04:10:00Z)");
    expect(pin.tone).toBe("attention");
  });

  it("never invent a reading: an unread zone with stock shows its own count and says so", () => {
    expect(zonePin("TEMPERATURE", { ...empty, stockLines: 12 }, quiet, time)).toEqual({
      value: "12 lines · no reading",
      tone: "attention",
    });
  });

  it("and an unread, empty zone says No reading yet", () => {
    expect(zonePin("TEMPERATURE", empty, quiet, time)).toEqual({
      value: NO_READING,
      tone: "attention",
    });
  });

  it("say nothing at all before the readings have arrived", () => {
    expect(zonePin("TEMPERATURE", null, null, time)).toEqual({
      value: NO_READING,
      tone: "neutral",
    });
  });
});

describe("count pins", () => {
  it("treat zero as a reading, not as missing", () => {
    expect(zonePin("COUNT", empty, quiet, time)).toEqual({ value: "0 lines", tone: "neutral" });
  });

  it("pluralise", () => {
    expect(zonePin("COUNT", { ...empty, stockLines: 1 }, quiet, time).value).toBe("1 line");
    expect(zonePin("COUNT", { ...empty, stockLines: 142 }, quiet, time).value).toBe("142 lines");
  });
});

describe("dwell pins", () => {
  it("show the longest dwell at a readable resolution", () => {
    expect(zonePin("DWELL", { ...empty, stockLines: 2, dwellMinutes: 24 }, quiet, time).value).toBe(
      "24 min dwell",
    );
    expect(
      zonePin("DWELL", { ...empty, stockLines: 2, dwellMinutes: 210 }, quiet, time).value,
    ).toBe("3.5 h dwell");
    expect(
      zonePin("DWELL", { ...empty, stockLines: 2, dwellMinutes: 60 * 24 * 3 }, quiet, time).value,
    ).toBe("3.0 d dwell");
  });

  it("call an empty staging area Empty — nothing waiting is the good state", () => {
    expect(zonePin("DWELL", empty, quiet, time)).toEqual({ value: "Empty", tone: "neutral" });
  });

  it("are never coloured: how long is too long is a threshold", () => {
    expect(
      zonePin("DWELL", { ...empty, stockLines: 1, dwellMinutes: 60 * 24 * 30 }, quiet, time).tone,
    ).toBe("neutral");
  });
});

describe("returnable pins", () => {
  it("show the property's register and say it is property-wide", () => {
    expect(zonePin("RETURNABLE", empty, { ...quiet, returnablesOutstanding: 16 }, time)).toEqual({
      value: "16 returnable",
      tone: "neutral",
      caption: "property-wide",
    });
  });

  it("draw attention to promises that are overdue, and say how many", () => {
    const pin = zonePin(
      "RETURNABLE",
      empty,
      { ...quiet, returnablesOutstanding: 16, returnablesOverdue: 3 },
      time,
    );
    expect(pin).toEqual({
      value: "16 returnable · 3 overdue",
      tone: "attention",
      caption: "property-wide",
    });
  });

  it("fall back to the store's own count when the register is empty — and only then", () => {
    expect(zonePin("RETURNABLE", { ...empty, stockLines: 7 }, quiet, time)).toEqual({
      value: "7 lines",
      tone: "neutral",
    });
    // With anything on the register, the register wins and the fallback is not offered.
    expect(
      zonePin(
        "RETURNABLE",
        { ...empty, stockLines: 7 },
        { ...quiet, returnablesOutstanding: 1 },
        time,
      ).caption,
    ).toBe("property-wide");
  });

  it("show an empty register as zero, still labelled", () => {
    expect(zonePin("RETURNABLE", empty, quiet, time)).toEqual({
      value: "0 returnable",
      tone: "neutral",
      caption: "property-wide",
    });
  });

  it("write fractional quantities to one place", () => {
    expect(
      zonePin("RETURNABLE", empty, { ...quiet, returnablesOutstanding: 2.5 }, time).value,
    ).toBe("2.5 returnable");
  });
});

describe("the scenery pins", () => {
  it("the gate has no reading in this phase, and is neutral about it", () => {
    expect(gatePin()).toEqual({ value: NO_READING, tone: "neutral" });
  });

  it("the dock shows both halves, either half, or Clear", () => {
    expect(dockPin({ ...quiet, receivingOpen: 2, quarantineMaxHours: 3.5 }).value).toBe(
      "2 receiving · 3.5 h in quarantine",
    );
    expect(dockPin({ ...quiet, receivingOpen: 2 }).value).toBe("2 receiving");
    expect(dockPin({ ...quiet, quarantineMaxHours: 0.4 }).value).toBe("24 min in quarantine");
    expect(dockPin(quiet)).toEqual({ value: "Clear", tone: "neutral" });
    expect(dockPin(null).value).toBe(NO_READING);
  });

  it("the dock is never coloured, however long the quarantine", () => {
    expect(dockPin({ ...quiet, quarantineMaxHours: 90 }).tone).toBe("neutral");
  });
});

describe("formatting", () => {
  it("uses a real minus sign and one decimal for temperatures", () => {
    expect(formatTemperature(4)).toBe("4.0°C");
    expect(formatTemperature(-0.5)).toBe("−0.5°C");
  });

  it("steps duration from minutes to hours to days", () => {
    expect(formatDuration(0)).toBe("0 min");
    expect(formatDuration(59.6)).toBe("60 min");
    expect(formatDuration(60)).toBe("1.0 h");
    expect(formatDuration(60 * 47.9)).toBe("47.9 h");
    expect(formatDuration(60 * 48)).toBe("2.0 d");
  });
});

describe("drill-down", () => {
  it("sends temperature to the storage register, filtered to the location", () => {
    expect(drillDownFor("TEMPERATURE", "TW-CHILL")).toEqual({
      screen: "registers",
      tab: "STORAGE",
      location: "TW-CHILL",
    });
  });

  it("sends counts and dwell to the stock screen, searched by the location's code", () => {
    expect(drillDownFor("COUNT", "TW-DRY")).toEqual({ screen: "stock", query: "TW-DRY" });
    expect(drillDownFor("DWELL", "TW-STAGING")).toEqual({ screen: "stock", query: "TW-STAGING" });
  });

  it("sends returnables to the register, unscoped, because the register is", () => {
    expect(drillDownFor("RETURNABLE", "TW-KEGS")).toEqual({ screen: "returnables" });
  });
});
