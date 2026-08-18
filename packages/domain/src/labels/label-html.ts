import { code128Svg, type LabelSheetPlan, type PlannedLabel } from "./label-sheet";

/**
 * A printable document for a label sheet.
 *
 * Pure strings, no DOM (ADR 0009). The renderer on each platform hands this to something
 * that can print — a browser's own print pipeline on web, expo-print on native later —
 * and neither of them needs to know anything about label geometry.
 *
 * ## Why the CSS matters more than it looks
 *
 * `@page size` is what makes a thermal printer produce ONE label per page rather than
 * shrinking the whole run onto one sticker. That was golaiv1's single genuine field
 * failure here, found with a printer and a wasted roll — which is why every thermal size
 * is one-per-page in `LABEL_SIZES` and why the page size is emitted in millimetres to
 * match.
 */

/** Enough of an escape to make arbitrary text safe inside markup and attributes. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface LabelHtmlOptions {
  /** Shown small on each label. The property's name, usually. */
  footer?: string;
}

/**
 * How much of the label the barcode gets.
 *
 * Two thirds, with the code printed underneath. The printed code is not decoration: a
 * scanner that will not read a scuffed label leaves somebody with a bin they can still
 * identify, and hard rule 13 is about how the destination was ESTABLISHED rather than
 * about a person never seeing the code.
 */
const BARCODE_HEIGHT_FRACTION = 0.42;

function labelMarkup(label: PlannedLabel, widthMm: number, heightMm: number, footer?: string) {
  // The barcode is inset from both edges. A barcode printed hard against the edge of a
  // sticker will not read, and that is a failure only discovered with a scanner in hand.
  const padMm = Math.max(1.5, widthMm * 0.04);
  const barWidth = widthMm - padMm * 2;
  const barHeight = Math.max(6, heightMm * BARCODE_HEIGHT_FRACTION);

  const zone = label.zone ? `<div class="zone">${escapeHtml(label.zone)}</div>` : "";
  const name = label.name ? `<div class="name">${escapeHtml(label.name)}</div>` : "";
  const foot = footer ? `<div class="foot">${escapeHtml(footer)}</div>` : "";

  return [
    '<div class="label">',
    zone,
    `<div class="bars">${code128Svg(label.code, barWidth, barHeight)}</div>`,
    `<div class="code">${escapeHtml(label.code)}</div>`,
    name,
    foot,
    "</div>",
  ].join("");
}

export function renderLabelSheetHtml(plan: LabelSheetPlan, options: LabelHtmlOptions = {}): string {
  const { size } = plan;
  const cellWidth = 100 / size.columns;

  const pages = plan.pages
    .map(
      (page) =>
        `<section class="page">${page.labels
          .map((l) =>
            labelMarkup(
              l,
              size.perPage === 1 ? size.widthMm : (size.widthMm - size.marginMm * 2) / size.columns,
              size.perPage === 1
                ? size.heightMm
                : (size.heightMm - size.marginMm * 2) / (size.perPage / size.columns),
              options.footer,
            ),
          )
          .join("")}</section>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Labels</title>
<style>
  /* Millimetres, to match the roll. A thermal printer given no page size fits the whole
     run onto one sticker. */
  @page { size: ${size.widthMm}mm ${size.heightMm}mm; margin: ${size.marginMm}mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    /* Barcodes must print black even where a browser is trying to save toner. */
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .page {
    width: ${size.widthMm - size.marginMm * 2}mm;
    height: ${size.heightMm - size.marginMm * 2}mm;
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    page-break-after: always;
    break-after: page;
  }
  /* Otherwise the last page emits a trailing blank one, which on a thermal roll is a
     wasted sticker every time. */
  .page:last-child { page-break-after: auto; break-after: auto; }
  .label {
    width: ${cellWidth}%;
    height: ${size.perPage === 1 ? "100%" : `${100 / (size.perPage / size.columns)}%`};
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    overflow: hidden;
    padding: 1mm;
  }
  .zone {
    font-size: 2.4mm;
    letter-spacing: 0.35mm;
    text-transform: uppercase;
    color: #444;
  }
  .bars { line-height: 0; }
  .bars svg { display: block; }
  .code {
    /* Tabular so a column of codes reads straight, and monospace so 0 and O differ. */
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-weight: 700;
    font-size: 3.6mm;
    letter-spacing: 0.3mm;
    margin-top: 1mm;
  }
  .name { font-size: 2.8mm; color: #222; margin-top: 0.5mm; }
  .foot { font-size: 2.2mm; color: #777; margin-top: 0.5mm; }
</style>
</head>
<body>${pages}</body>
</html>`;
}
