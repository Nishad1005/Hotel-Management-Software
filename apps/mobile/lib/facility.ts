/**
 * Where the status pins sit on the facility schematic.
 *
 * ## The swappability contract
 *
 * Brief §6: the schematic is ONE file, replaced later by a property-accurate drawing
 * with zero code changes. Anchors are percentages of the image rather than pixels, and
 * they live here — in one exported constant — so a redrawn schematic is a new PNG plus
 * an edit to this table, and nothing else in the app moves.
 *
 * The generator prints these on every run (`python scripts/make-facility-schematic.py`)
 * for checking against what is written below. They are duplicated by necessity: the
 * drawing knows where its zones are and the app cannot ask it.
 *
 * ## Five pins, not six
 *
 * The dry store is drawn and deliberately unpinned. §6 allows a pin to show a neutral
 * "no reading yet" state where a source is empty, but that is for a source that exists
 * and happens to be empty — not for a figure the app cannot honestly attribute. The
 * only stock number to hand is `stockLines`, which counts every zone; hanging it on the
 * dry store would be an invented value wearing a real one's clothes.
 */

export interface FacilityPin {
  key: string;
  /** What the zone is called, in the words the property uses. */
  label: string;
  /** Percentage of the image's width, from the left. */
  x: number;
  /** Percentage of the image's height, from the top. */
  y: number;
  /**
   * The suffix of the seeded location code this pin reports on, where it reports a
   * per-location reading. `SB-CHILL` and `TW-CHILL` differ only by property prefix.
   */
  locationSuffix?: string;
}

export const FACILITY_PINS: FacilityPin[] = [
  { key: "SEC", label: "Security gate", x: 26.6, y: 32.0 },
  { key: "T1_RCV", label: "Receiving bay", x: 43.3, y: 41.3 },
  { key: "CHILL", label: "Cold room", x: 62.1, y: 48.7, locationSuffix: "CHILL" },
  { key: "FREEZE", label: "Freezer", x: 51.4, y: 58.3, locationSuffix: "FREEZE" },
  { key: "T2_DSP", label: "Dispatch", x: 63.6, y: 71.0 },
];

/**
 * The drawing's aspect. **Must match the asset**, and is not merely cosmetic: the board
 * sizes its container by this and the pins are placed as percentages of that container,
 * so an aspect that disagrees with the image puts every pin beside the zone it names.
 * Swapping the schematic means updating this line as well as the anchors above.
 *
 * Wide and shallow on purpose: at 16:9 the block stood 840px tall on a laptop and
 * pushed every metric tile below the fold, which inverted the page — the schematic
 * says *where*, the tiles say *what needs doing*, and the second is the reason somebody
 * opened the app.
 */
export const FACILITY_ASPECT = 1800 / 720;
