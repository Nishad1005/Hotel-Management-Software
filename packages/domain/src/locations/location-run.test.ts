import { describe, expect, it } from "vitest";
import { fixturePrefix, MAX_RUN, planLocationRun } from "./location-run";

describe("fixturePrefix", () => {
  it("takes the first letter of what the property calls it", () => {
    expect(fixturePrefix("Shelf")).toBe("S");
    expect(fixturePrefix("Rack")).toBe("R");
    expect(fixturePrefix("Bin")).toBe("B");
  });

  it("handles the words a store in Assam actually uses", () => {
    // A ghoda is a trestle that sacks and sheet material lean on. Nobody on that floor
    // calls it anything else, and the app should not make them.
    expect(fixturePrefix("Ghoda")).toBe("G");
    expect(fixturePrefix("Peti stack")).toBe("P");
  });

  it("skips leading digits and punctuation to find a real letter", () => {
    // "1st Floor Bin" must not become "S" by falling through to the default — F is
    // right, and picking S would collide with every Shelf in the same zone.
    expect(fixturePrefix("1st Floor Bin")).toBe("F");
    expect(fixturePrefix("  -- Cold room shelf")).toBe("C");
  });

  it("falls back to S when there is no letter at all", () => {
    expect(fixturePrefix("")).toBe("S");
    expect(fixturePrefix("   ")).toBe("S");
    expect(fixturePrefix("123")).toBe("S");
  });
});

describe("planLocationRun", () => {
  const base = { parentCode: "SB-DRY", fixtureName: "Shelf", from: 1, to: 6 };

  it("produces the codes the preview shows before anything is written", () => {
    const run = planLocationRun(base);
    expect(run.ok).toBe(true);
    expect(run.prefix).toBe("S");
    expect(run.codes).toEqual([
      "SB-DRY-S001",
      "SB-DRY-S002",
      "SB-DRY-S003",
      "SB-DRY-S004",
      "SB-DRY-S005",
      "SB-DRY-S006",
    ]);
  });

  it("uses the property's own word for the fixture", () => {
    const run = planLocationRun({ ...base, fixtureName: "Ghoda", from: 1, to: 2 });
    expect(run.codes).toEqual(["SB-DRY-G001", "SB-DRY-G002"]);
  });

  it("lets the prefix be overridden, because two fixtures can start with the same letter", () => {
    // Shelf and Stack both give S. The implementer types SK for one of them.
    const run = planLocationRun({ ...base, fixtureName: "Stack", prefix: "SK", from: 1, to: 2 });
    expect(run.prefix).toBe("SK");
    expect(run.codes).toEqual(["SB-DRY-SK001", "SB-DRY-SK002"]);
  });

  it("normalises a sloppy prefix rather than rejecting it", () => {
    const run = planLocationRun({ ...base, prefix: " g2! ", from: 1, to: 1 });
    expect(run.prefix).toBe("G");
  });

  it("pads to three digits so codes sort in walking order", () => {
    // "SB-DRY-S10" sorts before "SB-DRY-S9" lexically, which is wrong on a picking
    // walk and wrong on a printed label sheet.
    const run = planLocationRun({ ...base, from: 9, to: 11 });
    expect(run.codes).toEqual(["SB-DRY-S009", "SB-DRY-S010", "SB-DRY-S011"]);
  });

  it("widens past three digits rather than wrapping", () => {
    const run = planLocationRun({ ...base, from: 999, to: 1000 });
    expect(run.codes).toEqual(["SB-DRY-S999", "SB-DRY-S1000"]);
  });

  it("makes a single location when from equals to", () => {
    const run = planLocationRun({ ...base, from: 4, to: 4 });
    expect(run.codes).toEqual(["SB-DRY-S004"]);
  });

  describe("refusing a run", () => {
    it("will not count backwards", () => {
      const run = planLocationRun({ ...base, from: 10, to: 3 });
      expect(run.ok).toBe(false);
      expect(run.errors).toContain("RANGE_REVERSED");
      expect(run.codes).toEqual([]);
    });

    it("will not start below one", () => {
      expect(planLocationRun({ ...base, from: 0, to: 5 }).errors).toContain("RANGE_BELOW_ONE");
    });

    it("will not take fractions", () => {
      expect(planLocationRun({ ...base, from: 1.5, to: 5 }).errors).toContain("RANGE_NOT_WHOLE");
    });

    it("caps the run, because a generator that over-produces is the usual mistake", () => {
      // golaiv1 shipped an uncapped generator and had to add bulk delete to clean up
      // after it. Refusing up front is cheaper than a screen for undoing it.
      const run = planLocationRun({ ...base, from: 1, to: MAX_RUN + 1 });
      expect(run.ok).toBe(false);
      expect(run.errors).toContain("RANGE_TOO_LARGE");
    });

    it("allows exactly the cap", () => {
      expect(planLocationRun({ ...base, from: 1, to: MAX_RUN }).ok).toBe(true);
    });

    it("needs somewhere to put them", () => {
      const run = planLocationRun({ ...base, parentCode: "  " });
      expect(run.ok).toBe(false);
      expect(run.errors).toContain("PARENT_REQUIRED");
    });

    it("reports every problem at once", () => {
      const run = planLocationRun({ ...base, parentCode: "", from: 0, to: -5 });
      expect(run.errors).toEqual(
        expect.arrayContaining(["PARENT_REQUIRED", "RANGE_BELOW_ONE", "RANGE_REVERSED"]),
      );
    });
  });

  it("summarises itself for the preview line", () => {
    const run = planLocationRun({ ...base, from: 1, to: 20 });
    expect(run.count).toBe(20);
    expect(run.first).toBe("SB-DRY-S001");
    expect(run.last).toBe("SB-DRY-S020");
  });

  it("has no first or last when it refused", () => {
    const run = planLocationRun({ ...base, from: 10, to: 3 });
    expect(run.first).toBeNull();
    expect(run.last).toBeNull();
    expect(run.count).toBe(0);
  });
});
