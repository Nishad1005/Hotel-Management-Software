import { describe, expect, it } from "vitest";
import { ITEM_COLUMN_ALIASES, readItemSheet, suggestItemCode } from "./item-import";

const HEADER = "Item Code,Item Name,Category,UOM";

describe("readItemSheet", () => {
  it("reads the ordinary file", () => {
    const sheet = readItemSheet(`${HEADER}\nMILK-1L,Toned Milk 1 L,Dairy,L`);
    expect(sheet.ok).toBe(true);
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0]).toMatchObject({
      code: "MILK-1L",
      name: "Toned Milk 1 L",
      category: "Dairy",
      uom: "L",
      line: 2,
    });
  });

  it("finds columns whatever the property called them", () => {
    // Real files: one client's type column is headed "Definition", another writes
    // "Sub-Category (clean)" after tidying it.
    const sheet = readItemSheet("Product Code,Particulars,Group,Units\nRICE,Basmati rice,Dry,KG");
    expect(sheet.rows[0]).toMatchObject({ code: "RICE", name: "Basmati rice", uom: "KG" });
  });

  it("needs a name column and says which headers it saw", () => {
    const sheet = readItemSheet("Code,Qty\nX,1");
    expect(sheet.ok).toBe(false);
    expect(sheet.problem).toContain("Item Name");
    // Naming what it found is the difference between a fixable error and a shrug.
    expect(sheet.problem).toContain("Code");
  });

  it("refuses a file with only a header", () => {
    expect(readItemSheet(HEADER).ok).toBe(false);
  });

  it("refuses an empty file", () => {
    expect(readItemSheet("").ok).toBe(false);
  });

  it("skips rows with no name rather than importing a blank item", () => {
    const sheet = readItemSheet(`${HEADER}\nA,,Dairy,L\nB,Butter,Dairy,KG`);
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0]?.name).toBe("Butter");
    expect(sheet.skipped).toBe(1);
  });

  it("keeps a client's own code exactly as written", () => {
    // Never renamed, never renumbered, never case-folded. golaiv1's hardest-won rule:
    // a client's code is the one they use on paper, and changing it silently breaks
    // every cross-reference they have outside this system.
    const sheet = readItemSheet(`${HEADER}\n au162590 ,Cupcake fabric,Dry,PC`);
    expect(sheet.rows[0]?.code).toBe("au162590");
  });

  it("marks rows with no code, because those are the ones we allocate for", () => {
    const sheet = readItemSheet(`${HEADER}\n,Rohu,Fish,KG\nMILK-1L,Milk,Dairy,L`);
    expect(sheet.rows[0]?.code).toBeNull();
    expect(sheet.rows[1]?.code).toBe("MILK-1L");
    expect(sheet.needingCode).toBe(1);
    expect(sheet.withCode).toBe(1);
  });

  it("reports a duplicate code within the file rather than letting one win silently", () => {
    // Two rows claiming one code means one of them is wrong, and importing either is a
    // guess. The upsert would quietly keep the first and drop the second.
    const sheet = readItemSheet(`${HEADER}\nMILK,Milk A,Dairy,L\nMILK,Milk B,Dairy,L`);
    expect(sheet.duplicates).toEqual(["MILK"]);
  });

  it("treats duplicate codes case-sensitively, because the codes are kept verbatim", () => {
    const sheet = readItemSheet(`${HEADER}\nMilk,A,Dairy,L\nMILK,B,Dairy,L`);
    expect(sheet.duplicates).toEqual([]);
  });

  it("carries the line number, so an error points at a row in their spreadsheet", () => {
    const sheet = readItemSheet(`${HEADER}\nA,First,Dairy,L\nB,Second,Dairy,L`);
    expect(sheet.rows.map((r) => r.line)).toEqual([2, 3]);
  });

  it("tolerates a file missing the optional columns", () => {
    const sheet = readItemSheet("Item Name\nRohu");
    expect(sheet.ok).toBe(true);
    expect(sheet.rows[0]).toMatchObject({ name: "Rohu", code: null, category: null, uom: null });
  });
});

describe("ITEM_COLUMN_ALIASES", () => {
  it("puts the client-specific heading before the generic one", () => {
    // "Definition" is what one client calls the type column. It has to beat a generic
    // "type" in a file that happens to contain both.
    expect(ITEM_COLUMN_ALIASES.type.indexOf("definition")).toBeLessThan(
      ITEM_COLUMN_ALIASES.type.indexOf("type"),
    );
  });
});

describe("shelf life", () => {
  const withShelf = "Item Code,Item Name,Category,UOM,Shelf Life (days)";

  it("reads whole days, which is what makes an imported item perishable at all", () => {
    const sheet = readItemSheet(`${withShelf}\nMILK,Toned Milk,Dairy,L,10`);
    expect(sheet.rows[0]?.shelfLifeDays).toBe(10);
  });

  it("is null when the column is absent", () => {
    const sheet = readItemSheet("Item Name\nRohu");
    expect(sheet.rows[0]?.shelfLifeDays).toBeNull();
  });

  it("refuses to guess at anything that is not a plain number", () => {
    // A wrong shelf life produces a wrong expiry date on every batch of that item, and a
    // watchlist that quietly lies is worse than one with gaps in it.
    const sheet = readItemSheet(
      `${withShelf}\nA,One,Dairy,L,7 days\nB,Two,Dairy,L,approx 30\nC,Three,Dairy,L,n/a\nD,Four,Dairy,L,1.5\nE,Five,Dairy,L,-3\nF,Six,Dairy,L,0`,
    );
    expect(sheet.rows.map((r) => r.shelfLifeDays)).toEqual([null, null, null, null, null, null]);
  });
});

describe("suggesting a code for a line that has none", () => {
  it("derives it from the name, so a printed label can be read", () => {
    expect(suggestItemCode("Toned Milk 1L", new Set())).toBe("TONED-MILK-1L");
  });

  it("collapses punctuation and spacing to one separator", () => {
    expect(suggestItemCode("Milk  1L  (Toned)", new Set())).toBe("MILK-1L-TONED");
    expect(suggestItemCode("Milk-1L-Toned", new Set())).toBe("MILK-1L-TONED");
  });

  it("never ends on a separator", () => {
    expect(suggestItemCode("Rohu — ", new Set())).toBe("ROHU");
    // Truncation is where this goes wrong: the cut can land on a hyphen.
    expect(suggestItemCode("Fresh Atlantic Salmon Fillet Skin On", new Set())).not.toMatch(/-$/);
  });

  it("falls back rather than returning an empty code", () => {
    expect(suggestItemCode("!!!", new Set())).toBe("ITEM");
  });

  it("suffixes around a code that is already spoken for", () => {
    const taken = new Set(["TONED-MILK", "TONED-MILK-2"]);
    expect(suggestItemCode("Toned Milk", taken)).toBe("TONED-MILK-3");
  });

  it("checks against the item master, not only against this file", () => {
    // The collision that matters is the unique constraint, which does not care which
    // spreadsheet a code came from.
    expect(suggestItemCode("Rohu", new Set(["ROHU"]))).toBe("ROHU-2");
  });
});
