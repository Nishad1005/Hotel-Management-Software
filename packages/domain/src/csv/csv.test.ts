import { describe, expect, it } from "vitest";
import { findColumn, normaliseHeader, parseCsv } from "./csv";

describe("parseCsv", () => {
  it("reads the ordinary case", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("keeps commas inside quotes", () => {
    // "Main Store (Hardware), Level 2" is one zone name, not two columns.
    expect(parseCsv('name,note\n"Main Store, Level 2",fine')).toEqual([
      ["name", "note"],
      ["Main Store, Level 2", "fine"],
    ]);
  });

  it("unescapes a doubled quote", () => {
    expect(parseCsv('a\n"She said ""hello"""')).toEqual([["a"], ['She said "hello"']]);
  });

  it("keeps newlines inside quotes", () => {
    expect(parseCsv('a,b\n"line one\nline two",x')).toEqual([
      ["a", "b"],
      ["line one\nline two", "x"],
    ]);
  });

  it("reads files saved on Windows", () => {
    // Every spreadsheet a property sends will have CRLF endings.
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips the byte order mark Excel writes", () => {
    // Without this the first header becomes "﻿Zone No." and matches nothing, which
    // presents as "we could not find a Zone No. column" on a file that plainly has one.
    expect(parseCsv("﻿a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("drops rows that are entirely blank", () => {
    // Spreadsheets are full of trailing empty rows and nobody thinks to delete them.
    expect(parseCsv("a,b\n1,2\n\n,,\n3,4\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("keeps a row where only some cells are blank", () => {
    expect(parseCsv("a,b,c\n1,,3")).toEqual([
      ["a", "b", "c"],
      ["1", "", "3"],
    ]);
  });

  it("trims surrounding whitespace but not inside quotes", () => {
    expect(parseCsv('a,b\n  1  ,"  2  "')).toEqual([
      ["a", "b"],
      ["1", "  2  "],
    ]);
  });

  it("is empty for empty input", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("   \n  \n")).toEqual([]);
  });
});

describe("normaliseHeader", () => {
  it("ignores case, spacing and separators", () => {
    for (const header of ["Sub Category", "sub_category", "SUB-CATEGORY", "sub.category"]) {
      expect(normaliseHeader(header)).toBe("subcategory");
    }
  });

  it("drops a parenthetical qualifier", () => {
    // Real files arrive with headings like "Sub-Category (clean)" after somebody has
    // tidied a column, and the qualifier should not stop it matching.
    expect(normaliseHeader("Sub-Category (clean)")).toBe("subcategory");
    expect(normaliseHeader("Zone No. (from master sheet)")).toBe("zoneno");
  });
});

describe("findColumn", () => {
  const headers = ["Zone No.", "Zone Name", "Category Type", "Notes"];

  it("finds a column by any of its aliases", () => {
    expect(findColumn(headers, ["zoneno", "zone", "no", "number"])).toBe(0);
    expect(findColumn(headers, ["zonename", "name"])).toBe(1);
    expect(findColumn(headers, ["categorytype", "category", "type"])).toBe(2);
  });

  it("prefers the earlier alias when several match", () => {
    // "Definition" is what one client calls the type column, so it is listed first and
    // has to win over the generic "type" even when both are present.
    expect(findColumn(["Type", "Definition"], ["definition", "type"])).toBe(1);
  });

  it("returns null when nothing matches, rather than guessing a column", () => {
    // Guessing here silently imports the wrong data into the wrong field, which is far
    // worse than telling somebody their file is missing a column.
    expect(findColumn(headers, ["barcode", "ean"])).toBeNull();
  });

  it("matches a header the property wrote carelessly", () => {
    expect(findColumn(["  zone_no  ", "ZONE NAME"], ["zoneno"])).toBe(0);
  });
});
