import { describe, expect, it } from "vitest";
import {
  CODE128_PATTERNS,
  code128Bars,
  code128Checksum,
  code128Values,
  encodeCode128B,
  isEncodableCode128B,
  START_B,
  STOP,
} from "./code128";

describe("the pattern table", () => {
  // Transcribed data, so it is checked mechanically rather than by re-reading it. A
  // single wrong digit produces a barcode that scans as the wrong character, which is
  // exactly the failure nobody notices until a storekeeper puts stock on the wrong bin.
  it("has every value from 0 to 106", () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
  });

  it("gives every data symbol six elements totalling eleven modules", () => {
    CODE128_PATTERNS.slice(0, 106).forEach((pattern, value) => {
      const widths = [...pattern].map(Number);
      expect(widths, `value ${value} element count`).toHaveLength(6);
      expect(
        widths.reduce((a, b) => a + b, 0),
        `value ${value} module width`,
      ).toBe(11);
    });
  });

  it("gives the stop symbol seven elements totalling thirteen modules", () => {
    const pattern = CODE128_PATTERNS[STOP];
    expect(pattern).toBeDefined();
    const stop = [...(pattern ?? "")].map(Number);
    expect(stop).toHaveLength(7);
    expect(stop.reduce((a, b) => a + b, 0)).toBe(13);
  });

  it("uses only widths one to four", () => {
    for (const pattern of CODE128_PATTERNS) {
      for (const digit of pattern) {
        expect(Number(digit)).toBeGreaterThanOrEqual(1);
        expect(Number(digit)).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe("code128Values", () => {
  it("maps a character to its value by subtracting the space", () => {
    // Code Set B: value = codePoint - 32. 'A' is 65, so 33.
    expect(code128Values("A")).toEqual([33]);
    expect(code128Values(" ")).toEqual([0]);
    expect(code128Values("0")).toEqual([16]);
    expect(code128Values("-")).toEqual([13]);
  });

  it("encodes a location code", () => {
    // S=51, B=34, -=13, D=36, R=50, Y=57, 0=16, 1=17
    expect(code128Values("SB-DRY-S001")).toEqual([51, 34, 13, 36, 50, 57, 13, 51, 16, 16, 17]);
  });
});

describe("code128Checksum", () => {
  it("weights each value by its position, starting at one", () => {
    // Worked by hand: start 104, then 'A' at position 1.
    // (104 + 1 * 33) mod 103 = 137 mod 103 = 34
    expect(code128Checksum([33])).toBe(34);
  });

  it("weights a second character by two", () => {
    // 'A' = 33, 'B' = 34.  (104 + 1*33 + 2*34) mod 103 = 205 mod 103 = 102
    expect(code128Checksum([33, 34])).toBe(102);
  });

  it("stays inside the symbol range for a long code", () => {
    const sum = code128Checksum(code128Values("SB-DRY-S001"));
    expect(sum).toBeGreaterThanOrEqual(0);
    expect(sum).toBeLessThan(103);
  });

  it("is the start value alone for empty input", () => {
    expect(code128Checksum([])).toBe(START_B % 103);
  });
});

describe("encodeCode128B", () => {
  it("frames the data with a start symbol, a checksum and a stop", () => {
    const encoded = encodeCode128B("A");
    expect(encoded.symbols).toEqual([START_B, 33, 34, STOP]);
  });

  it("alternates bar and space, beginning with a bar", () => {
    const { bars } = encodeCode128B("SB-DRY-S001");
    expect(bars[0]?.bar).toBe(true);
    bars.forEach((element, i) => {
      expect(element.bar, `element ${i}`).toBe(i % 2 === 0);
    });
  });

  it("ends on a bar, so the stop pattern terminates the symbol", () => {
    const { bars } = encodeCode128B("SB-DRY-S001");
    expect(bars.at(-1)?.bar).toBe(true);
  });

  it("reports a module count matching the symbols it used", () => {
    const encoded = encodeCode128B("SB-DRY-S001");
    // 11 data + start + checksum = 13 symbols of 11 modules, plus a 13-module stop.
    expect(encoded.modules).toBe(13 * 11 + 13);
  });

  it("keeps the quiet zone out of the module count, and says so separately", () => {
    const encoded = encodeCode128B("A");
    expect(encoded.quietZoneModules).toBe(10);
  });

  it("refuses a character Code Set B cannot carry", () => {
    // Encoding it as something else would produce a barcode that scans cleanly as the
    // wrong text, which is worse than refusing to print.
    expect(() => encodeCode128B("SB DRY")).toThrow();
    expect(() => encodeCode128B("café")).toThrow();
  });

  it("accepts everything our codes actually use", () => {
    for (const code of ["SB-DRY-S001", "SB-VEN-0042", "SB-EMP-0117", "SB-T1-REJ"]) {
      expect(isEncodableCode128B(code)).toBe(true);
      expect(() => encodeCode128B(code)).not.toThrow();
    }
  });

  it("is deterministic", () => {
    expect(encodeCode128B("SB-DRY-S001")).toEqual(encodeCode128B("SB-DRY-S001"));
  });
});

describe("code128Bars", () => {
  it("turns symbols into widths in order", () => {
    const bars = code128Bars([START_B, STOP]);
    const widths = bars.map((b) => b.width).join("");
    expect(widths).toBe(`${CODE128_PATTERNS[START_B]}${CODE128_PATTERNS[STOP]}`);
  });
});
