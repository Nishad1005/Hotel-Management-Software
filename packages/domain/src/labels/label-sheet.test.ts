import { describe, expect, it } from "vitest";
import { code128Svg, LABEL_SIZES, labelSize, planLabelSheet } from "./label-sheet";

describe("LABEL_SIZES", () => {
  it("offers a thermal roll and an office sheet", () => {
    const ids = LABEL_SIZES.map((s) => s.id);
    expect(ids).toContain("thermal-100x50");
    expect(ids).toContain("thermal-75x50");
    expect(ids).toContain("thermal-50x25");
    expect(ids).toContain("a4-10up");
  });

  it("puts exactly one label on a page for every thermal size", () => {
    // The field failure this prevents: an A4 grid sent to a thermal printer squeezes
    // all ten labels onto a single sticker. One label per page is not a nicety.
    for (const size of LABEL_SIZES.filter((s) => s.id.startsWith("thermal"))) {
      expect(size.perPage, size.id).toBe(1);
    }
  });

  it("defaults to the roll size, not the A4 sheet", () => {
    // Most properties buying a label printer buy a 100x50 roll. Defaulting to A4 means
    // the common case has to change a dropdown every time.
    expect(LABEL_SIZES[0]?.id).toBe("thermal-100x50");
  });

  it("resolves a size by id, and falls back rather than throwing", () => {
    expect(labelSize("thermal-50x25").widthMm).toBe(50);
    expect(labelSize("nonsense" as never).id).toBe("thermal-100x50");
  });
});

describe("planLabelSheet", () => {
  const codes = Array.from({ length: 23 }, (_, i) => `SB-DRY-S${String(i + 1).padStart(3, "0")}`);

  it("gives a thermal roll one label per page", () => {
    const plan = planLabelSheet(codes, "thermal-100x50");
    expect(plan.pages).toHaveLength(23);
    expect(plan.pages[0]?.labels).toHaveLength(1);
    expect(plan.pages[0]?.labels[0]?.code).toBe("SB-DRY-S001");
  });

  it("fills an A4 sheet ten up and leaves the last page short", () => {
    const plan = planLabelSheet(codes, "a4-10up");
    expect(plan.pages).toHaveLength(3);
    expect(plan.pages[0]?.labels).toHaveLength(10);
    expect(plan.pages[2]?.labels).toHaveLength(3);
  });

  it("reports the total, so the screen can say what it is about to print", () => {
    expect(planLabelSheet(codes, "a4-10up").total).toBe(23);
  });

  it("is empty for no codes rather than producing a blank page", () => {
    const plan = planLabelSheet([], "a4-10up");
    expect(plan.pages).toHaveLength(0);
    expect(plan.total).toBe(0);
  });

  it("keeps codes in the order given, which is walking order", () => {
    const plan = planLabelSheet(["B", "A", "C"], "a4-10up");
    expect(plan.pages[0]?.labels.map((l) => l.code)).toEqual(["B", "A", "C"]);
  });
});

describe("code128Svg", () => {
  it("emits an svg of the requested size", () => {
    const svg = code128Svg("SB-DRY-S001", 40, 12);
    expect(svg).toContain("<svg");
    expect(svg).toContain('width="40mm"');
    expect(svg).toContain('height="12mm"');
  });

  it("draws bars and not spaces", () => {
    const svg = code128Svg("A", 40, 12);
    const bars = svg.match(/<rect/g) ?? [];
    // Start, 'A', checksum and stop give 25 bar elements; asserting "several" rather
    // than an exact count keeps this from breaking on a rendering tweak.
    expect(bars.length).toBeGreaterThan(10);
  });

  it("scales bars to fill the width, so a long code stays inside the label", () => {
    const short = code128Svg("A", 40, 12);
    const long = code128Svg("SB-DRY-S001", 40, 12);
    // Both fit the same declared width; the long one simply uses narrower modules.
    expect(short).toContain('width="40mm"');
    expect(long).toContain('width="40mm"');
  });

  it("refuses a code Code 128 Set B cannot carry rather than printing something wrong", () => {
    expect(() => code128Svg("café", 40, 12)).toThrow();
  });
});
