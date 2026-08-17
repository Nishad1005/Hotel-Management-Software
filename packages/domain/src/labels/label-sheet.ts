import { encodeCode128B, QUIET_ZONE_MODULES } from "./code128";

/**
 * Laying out a sheet of location labels.
 *
 * Pure geometry and pure strings: no PDF library, no DOM, no printer. The renderer
 * turns this into a document; everything decided here can be unit tested, which matters
 * because the failure mode is a stack of wasted sticker stock rather than an exception.
 */

export type LabelSizeId = "thermal-100x50" | "thermal-75x50" | "thermal-50x25" | "a4-10up";

export interface LabelSize {
  id: LabelSizeId;
  label: string;
  /** Page dimensions, which for a thermal roll are the label's own dimensions. */
  widthMm: number;
  heightMm: number;
  perPage: number;
  columns: number;
  /** Inset from the page edge. Zero on a roll — the label IS the page. */
  marginMm: number;
}

/**
 * The sizes on offer.
 *
 * Thermal first and thermal by default, because a property that has bought a label
 * printer has almost certainly bought a 100×50 roll, and defaulting to A4 makes the
 * common case change a dropdown every time.
 *
 * **Every thermal size is one label per page, and that is not a detail.** Sending an A4
 * grid to a thermal printer squeezes all ten labels onto a single sticker — golaiv1's
 * one genuine field failure here, discovered with a printer and a wasted roll.
 */
export const LABEL_SIZES: readonly LabelSize[] = [
  {
    id: "thermal-100x50",
    label: "Thermal roll — 100 × 50 mm",
    widthMm: 100,
    heightMm: 50,
    perPage: 1,
    columns: 1,
    marginMm: 0,
  },
  {
    id: "thermal-75x50",
    label: "Thermal roll — 75 × 50 mm",
    widthMm: 75,
    heightMm: 50,
    perPage: 1,
    columns: 1,
    marginMm: 0,
  },
  {
    id: "thermal-50x25",
    label: "Thermal roll — 50 × 25 mm",
    widthMm: 50,
    heightMm: 25,
    perPage: 1,
    columns: 1,
    marginMm: 0,
  },
  {
    id: "a4-10up",
    label: "A4 sheet — 10 per page, office printer",
    widthMm: 210,
    heightMm: 297,
    perPage: 10,
    columns: 2,
    marginMm: 10,
  },
];

export function labelSize(id: LabelSizeId): LabelSize {
  return LABEL_SIZES.find((s) => s.id === id) ?? LABEL_SIZES[0]!;
}

export interface PlannedLabel {
  code: string;
  /** Human-readable name of the place, in the property's own words. */
  name?: string;
  /** The zone it belongs to, so a sticker cannot be stuck in the wrong room. */
  zone?: string;
}

export interface LabelPage {
  labels: PlannedLabel[];
}

export interface LabelSheetPlan {
  size: LabelSize;
  pages: LabelPage[];
  total: number;
}

/**
 * Splits labels across pages.
 *
 * Order is preserved, because the codes arrive in walking order and a label sheet that
 * comes off the printer in a different order to the shelves is a sheet somebody has to
 * sort by hand.
 */
export function planLabelSheet(
  labels: readonly (string | PlannedLabel)[],
  sizeId: LabelSizeId,
): LabelSheetPlan {
  const size = labelSize(sizeId);
  const normalised: PlannedLabel[] = labels.map((l) => (typeof l === "string" ? { code: l } : l));

  const pages: LabelPage[] = [];
  for (let i = 0; i < normalised.length; i += size.perPage) {
    pages.push({ labels: normalised.slice(i, i + size.perPage) });
  }

  return { size, pages, total: normalised.length };
}

/**
 * A Code 128 barcode as an SVG string.
 *
 * Bars are scaled to fill the given width, so a longer code narrows its modules rather
 * than overflowing the label. The quiet zone is included in the scaling — a barcode
 * printed hard against the edge of a sticker will not read, and that is a failure you
 * only discover with a scanner in your hand.
 */
export function code128Svg(text: string, widthMm: number, heightMm: number): string {
  const encoded = encodeCode128B(text);
  const totalModules = encoded.modules + QUIET_ZONE_MODULES * 2;
  const moduleWidth = widthMm / totalModules;

  let x = QUIET_ZONE_MODULES * moduleWidth;
  const rects: string[] = [];

  for (const element of encoded.bars) {
    const w = element.width * moduleWidth;
    if (element.bar) {
      // Rounded to three decimals: more precision than a printer can hold, and it keeps
      // the document small on a run of two hundred labels.
      rects.push(
        `<rect x="${x.toFixed(3)}" y="0" width="${w.toFixed(3)}" height="${heightMm}" fill="#000"/>`,
      );
    }
    x += w;
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm"`,
    ` viewBox="0 0 ${widthMm} ${heightMm}" preserveAspectRatio="none" shape-rendering="crispEdges">`,
    rects.join(""),
    "</svg>",
  ].join("");
}
