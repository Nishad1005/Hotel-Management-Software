import { describe, expect, it } from "vitest";
import { can, capabilitiesFor, CAPABILITIES, type Capability } from "./capabilities";

/** Everything that changes stock, a master, or a person's access. */
const WRITES: Capability[] = CAPABILITIES.filter((c) => c !== "stock.view" && c !== "reports.view");

describe("Security", () => {
  it("is limited to Gate 0 and Gate 10, and nothing else", () => {
    // PRD section 4 Gate 0a, verbatim: "Security is a named app user with a role
    // limited to Gate 0 and Gate 10". Security staff are frequently outsourced with
    // high churn; the narrow surface is the point.
    const caps = capabilitiesFor(["SECURITY"]);
    expect([...caps].sort()).toEqual(["gate.capture", "gate.pass"]);
  });

  it("cannot reach the item master or the stock report", () => {
    expect(can(["SECURITY"], "masters.edit")).toBe(false);
    expect(can(["SECURITY"], "stock.view")).toBe(false);
    expect(can(["SECURITY"], "receiving")).toBe(false);
    expect(can(["SECURITY"], "issue")).toBe(false);
  });
});

describe("Storekeeper", () => {
  it("runs the flow inside the property, gates 1 to 9 and 11", () => {
    const caps = capabilitiesFor(["STOREKEEPER"]);
    expect(caps.has("receiving")).toBe(true);
    expect(caps.has("putaway")).toBe(true);
    expect(caps.has("transfer")).toBe(true);
    expect(caps.has("issue")).toBe(true);
    expect(caps.has("dispatch")).toBe(true);
    expect(caps.has("terminal.clear")).toBe(true);
    expect(caps.has("stock.view")).toBe(true);
  });

  it("does not capture at the gate", () => {
    // If the storekeeper creates the gate entry as well as the GRN, the two records
    // agree by construction and the reconciliation control (PRD section 1) is gone.
    expect(can(["STOREKEEPER"], "gate.capture")).toBe(false);
  });

  it("cannot create users or change enforcement", () => {
    expect(can(["STOREKEEPER"], "users.manage")).toBe(false);
    expect(can(["STOREKEEPER"], "enforcement.configure")).toBe(false);
    expect(can(["STOREKEEPER"], "overrides")).toBe(false);
  });

  it("records stock without authority over the master it is recorded against", () => {
    expect(can(["STOREKEEPER"], "masters.edit")).toBe(false);
  });
});

describe("the specialist roles", () => {
  it("lets the Food Safety Officer block a batch", () => {
    expect(can(["FSO"], "quality.hold")).toBe(true);
    expect(can(["FSO"], "quality.signoff")).toBe(true);
  });

  it("gives nobody else the power to block a batch", () => {
    for (const role of ["STOREKEEPER", "CHEF", "PURCHASE", "BANQUET", "SECURITY"] as const) {
      expect(can([role], "quality.hold")).toBe(false);
    }
  });

  it("puts variance approval with Purchase, not with the person who counted", () => {
    expect(can(["PURCHASE"], "variance.approve")).toBe(true);
    expect(can(["STOREKEEPER"], "variance.approve")).toBe(false);
  });

  it("gives Purchase the vendor master, since they own the relationship", () => {
    expect(can(["PURCHASE"], "parties.edit")).toBe(true);
  });

  it("puts the temperature round with the people who walk it", () => {
    // The storekeeper as part of the day's work, the FSO because temperature is theirs
    // to escalate. Mirrors the insert policy on temperature_reading — a role granted
    // here but refused there would be offered a screen that refuses them at the end.
    expect(can(["STOREKEEPER"], "temperature.record")).toBe(true);
    expect(can(["FSO"], "temperature.record")).toBe(true);
    for (const role of ["SECURITY", "CHEF", "BANQUET", "PURCHASE", "GM", "AUDITOR"] as const) {
      expect(can([role], "temperature.record")).toBe(false);
    }
  });

  it("lets a chef sign off perishable quality without operating the store", () => {
    expect(can(["CHEF"], "quality.signoff")).toBe(true);
    expect(can(["CHEF"], "receiving")).toBe(false);
    // The receiver presents a card and the storekeeper scans it; the chef's
    // representative never operates the app (PRD section 5).
    expect(can(["CHEF"], "issue")).toBe(false);
  });
});

describe("GM and Auditor", () => {
  it("gives the GM overrides and enforcement, not the day-to-day flow", () => {
    expect(can(["GM"], "overrides")).toBe(true);
    expect(can(["GM"], "enforcement.configure")).toBe(true);
    expect(can(["GM"], "receiving")).toBe(false);
    expect(can(["GM"], "putaway")).toBe(false);
  });

  it("makes the Auditor read-only, with no exception", () => {
    expect(can(["AUDITOR"], "stock.view")).toBe(true);
    expect(can(["AUDITOR"], "reports.view")).toBe(true);
    for (const write of WRITES) {
      expect(can(["AUDITOR"], write)).toBe(false);
    }
  });
});

describe("Owner and Admin", () => {
  it("hold every capability", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      for (const capability of CAPABILITIES) {
        expect(can([role], capability)).toBe(true);
      }
    }
  });
});

describe("combining roles", () => {
  it("takes the union, because a small property doubles people up", () => {
    const caps = capabilitiesFor(["SECURITY", "STOREKEEPER"]);
    expect(caps.has("gate.capture")).toBe(true);
    expect(caps.has("receiving")).toBe(true);
  });

  it("grants nothing for no roles", () => {
    expect(capabilitiesFor([]).size).toBe(0);
  });

  it("ignores a role it does not recognise rather than failing open", () => {
    // A newer server can hold a role this build predates. Ignoring it grants nothing,
    // which is the safe direction; throwing would lock the user out of the app
    // entirely over a role they may not even rely on.
    const caps = capabilitiesFor(["STOREKEEPER", "SOMETHING_NEW" as never]);
    expect(caps.has("receiving")).toBe(true);
    expect(caps.size).toBe(capabilitiesFor(["STOREKEEPER"]).size);
  });

  it("hands back a copy, so one caller cannot widen the table for every other", () => {
    const caps = capabilitiesFor(["SECURITY"]) as Set<Capability>;
    caps.add("users.manage");
    expect(capabilitiesFor(["SECURITY"]).has("users.manage")).toBe(false);
  });
});
