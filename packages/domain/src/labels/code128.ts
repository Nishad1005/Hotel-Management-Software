/**
 * Code 128 encoding, as arithmetic.
 *
 * Every barcode library assumes a `<canvas>`. There is no DOM in React Native, and the
 * label renderer has to work there and in a browser from one source — so the encoding
 * lives here as pure maths and the renderer only draws rectangles.
 *
 * ## Code Set B only, deliberately
 *
 * Set B covers upper and lower case, digits and punctuation: everything our codes use.
 * Set C would halve the width of long digit runs by packing pairs, and adds a switching
 * decision to every encode.
 *
 * The trade is asymmetric. A barcode that is too wide fails visibly — it does not fit
 * the label, and somebody sees that before anything is stuck to a shelf. A switching
 * bug produces a barcode that scans perfectly as the wrong text, and nobody sees that
 * until stock is put away in the wrong bin. `modules` is reported so the renderer can
 * pick a label size or refuse; if a real label ever proves too narrow, Set C is the
 * escape hatch and it can be added with these tests already in place.
 */

/**
 * Bar and space widths for values 0–106, as digit strings.
 *
 * Six elements each — bar, space, bar, space, bar, space — totalling 11 modules, except
 * the stop symbol which has seven and totals 13. Transcribed from the specification,
 * and checked mechanically by the tests rather than by re-reading it: one wrong digit
 * yields a barcode that scans as a different character.
 */
export const CODE128_PATTERNS: readonly string[] = [
  "212222",
  "222122",
  "222221",
  "121223",
  "121322",
  "131222",
  "122213",
  "122312",
  "132212",
  "221213",
  "221312",
  "231212",
  "112232",
  "122132",
  "122231",
  "113222",
  "123122",
  "123221",
  "223211",
  "221132",
  "221231",
  "213212",
  "223112",
  "312131",
  "311222",
  "321122",
  "321221",
  "312212",
  "322112",
  "322211",
  "212123",
  "212321",
  "232121",
  "111323",
  "131123",
  "131321",
  "112313",
  "132113",
  "132311",
  "211313",
  "231113",
  "231311",
  "112133",
  "112331",
  "132131",
  "113123",
  "113321",
  "133121",
  "313121",
  "211331",
  "231131",
  "213113",
  "213311",
  "213131",
  "311123",
  "311321",
  "331121",
  "312113",
  "312311",
  "332111",
  "314111",
  "221411",
  "431111",
  "111224",
  "111422",
  "121124",
  "121421",
  "141122",
  "141221",
  "112214",
  "112412",
  "122114",
  "122411",
  "142112",
  "142211",
  "241211",
  "221114",
  "413111",
  "241112",
  "134111",
  "111242",
  "121142",
  "121241",
  "114212",
  "124112",
  "124211",
  "411212",
  "421112",
  "421211",
  "212141",
  "214121",
  "412121",
  "111143",
  "111341",
  "131141",
  "114113",
  "114311",
  "411113",
  "411311",
  "113141",
  "114131",
  "311141",
  "411131",
  "211412",
  "211214",
  "211232",
  "2331112",
];

export const START_A = 103;
export const START_B = 104;
export const START_C = 105;
export const STOP = 106;

/** Ten modules of clear space either side, or a scanner cannot find the edges. */
export const QUIET_ZONE_MODULES = 10;

const LOWEST = 32; // space
const HIGHEST = 126; // tilde

export interface Code128Element {
  /** True for a bar, false for a space. They always alternate, starting with a bar. */
  bar: boolean;
  /** One to four modules. A module is the narrowest element the printer can hold. */
  width: number;
}

export interface Code128Encoding {
  text: string;
  /** Start, data, checksum, stop — the values actually encoded. */
  symbols: number[];
  bars: Code128Element[];
  /** Total width excluding the quiet zone, in modules. */
  modules: number;
  quietZoneModules: number;
}

/** Whether Code Set B can carry every character, so a caller can check before printing. */
export function isEncodableCode128B(text: string): boolean {
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    if (point < LOWEST || point > HIGHEST) return false;
  }
  return true;
}

/** Character values in Code Set B: the code point less the space. */
export function code128Values(text: string): number[] {
  const values: number[] = [];
  for (const character of text) {
    const point = character.codePointAt(0) ?? 0;
    if (point < LOWEST || point > HIGHEST) {
      throw new RangeError(
        `Code 128 Set B cannot encode ${JSON.stringify(character)}. Codes may use letters, digits and punctuation only.`,
      );
    }
    values.push(point - LOWEST);
  }
  return values;
}

/**
 * The modulo-103 check symbol.
 *
 * The start value, plus each data value weighted by its one-based position. This is
 * what makes a misread fail rather than return the wrong code, so it is exposed and
 * tested on its own — the arithmetic can be checked by hand, unlike the pattern table.
 */
export function code128Checksum(values: readonly number[]): number {
  let sum = START_B;
  values.forEach((value, index) => {
    sum += value * (index + 1);
  });
  return sum % 103;
}

/** Expands symbol values into alternating bar and space widths. */
export function code128Bars(symbols: readonly number[]): Code128Element[] {
  const elements: Code128Element[] = [];
  for (const symbol of symbols) {
    const pattern = CODE128_PATTERNS[symbol];
    if (!pattern) throw new RangeError(`No Code 128 pattern for symbol ${symbol}`);
    [...pattern].forEach((digit, index) => {
      elements.push({ bar: index % 2 === 0, width: Number(digit) });
    });
  }
  return elements;
}

export function encodeCode128B(text: string): Code128Encoding {
  const values = code128Values(text);
  const symbols = [START_B, ...values, code128Checksum(values), STOP];
  const bars = code128Bars(symbols);

  return {
    text,
    symbols,
    bars,
    modules: bars.reduce((total, element) => total + element.width, 0),
    quietZoneModules: QUIET_ZONE_MODULES,
  };
}
