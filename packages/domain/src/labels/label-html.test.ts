import { describe, expect, it } from "vitest";
import { renderLabelSheetHtml } from "./label-html";
import { planLabelSheet } from "./label-sheet";

describe("rendering a label sheet", () => {
  it("sets the page size in millimetres to match the roll", () => {
    // Not cosmetic. A thermal printer given no page size fits the whole run onto one
    // sticker — golaiv1's single genuine field failure here, found with a wasted roll.
    const html = renderLabelSheetHtml(planLabelSheet(["SB-DRY-R1-B1"], "thermal-100x50"));
    expect(html).toContain("@page { size: 100mm 50mm; margin: 0mm; }");
  });

  it("uses A4 with a margin for the office-printer sheet", () => {
    const html = renderLabelSheetHtml(planLabelSheet(["A"], "a4-10up"));
    expect(html).toContain("@page { size: 210mm 297mm; margin: 10mm; }");
  });

  it("emits one page per label on a thermal roll", () => {
    const html = renderLabelSheetHtml(planLabelSheet(["A", "B", "C"], "thermal-100x50"));
    expect(html.match(/class="page"/g)).toHaveLength(3);
  });

  it("fits ten to a page on A4", () => {
    const codes = Array.from({ length: 12 }, (_, i) => `SB-DRY-R1-B${i + 1}`);
    const html = renderLabelSheetHtml(planLabelSheet(codes, "a4-10up"));
    expect(html.match(/class="page"/g)).toHaveLength(2);
    expect(html.match(/class="label"/g)).toHaveLength(12);
  });

  it("stops the last page emitting a trailing blank one", () => {
    // On a thermal roll a trailing blank page is a wasted sticker on every print.
    const html = renderLabelSheetHtml(planLabelSheet(["A"], "thermal-100x50"));
    expect(html).toContain(".page:last-child { page-break-after: auto");
  });

  it("prints the code as text as well as bars", () => {
    // A scanner that will not read a scuffed label still leaves somebody with a bin they
    // can identify.
    const html = renderLabelSheetHtml(planLabelSheet(["SB-DRY-R1-B1"], "thermal-100x50"));
    expect(html).toContain(">SB-DRY-R1-B1<");
    expect(html).toContain("<svg");
  });

  it("carries the zone and the name where they are given", () => {
    const html = renderLabelSheetHtml(
      planLabelSheet(
        [{ code: "SB-DRY-R1-B1", name: "Ghoda 1, top shelf", zone: "Dry store" }],
        "thermal-100x50",
      ),
    );
    expect(html).toContain("Dry store");
    expect(html).toContain("Ghoda 1, top shelf");
  });

  it("escapes text that would otherwise break the markup", () => {
    const html = renderLabelSheetHtml(
      planLabelSheet([{ code: "A", name: '<script>alert("x")</script>' }], "thermal-100x50"),
      { footer: "Voyage & Solitaire" },
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Voyage &amp; Solitaire");
  });

  it("keeps the barcode off the edge of the sticker", () => {
    // A barcode printed hard against the edge will not read, and that is a failure only
    // found with a scanner in hand.
    const html = renderLabelSheetHtml(planLabelSheet(["ABC"], "thermal-100x50"));
    const width = /<svg[^>]*width="([\d.]+)mm"/.exec(html)?.[1];
    expect(Number(width)).toBeLessThan(100);
    expect(Number(width)).toBeGreaterThan(80);
  });

  it("renders an empty run without producing a page", () => {
    const html = renderLabelSheetHtml(planLabelSheet([], "thermal-100x50"));
    expect(html).not.toContain('class="page"');
    expect(html).toContain("<body></body>");
  });
});
