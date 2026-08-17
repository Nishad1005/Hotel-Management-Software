/**
 * Reading the spreadsheet a property actually sends.
 *
 * Onboarding is ours to do: the zone master and the item list arrive as whatever the
 * property already keeps, and every minute spent reformatting a file by hand is a
 * minute the implementer is not doing the part only they can do. So the importer bends
 * to the file rather than the other way round.
 *
 * Ported from golaiv1, where it was proven against real client files — including one
 * with 3,328 items and a column headed "Definition" that meant "type". The header
 * matching below is the part that earns its keep; the parser is just careful.
 */

/**
 * Splits CSV text into rows of cells.
 *
 * Handles quoted fields, doubled quotes, commas and newlines inside quotes, CRLF, and
 * the byte order mark Excel writes. Rows that are entirely blank are dropped, because
 * every spreadsheet has trailing empty rows and nobody thinks to delete them.
 *
 * Deliberately hand-rolled rather than a dependency. It is forty lines, it has tests,
 * and it runs in the domain package where a parser with a DOM dependency could not.
 */
export function parseCsv(text: string): string[][] {
  // Excel prefixes a BOM. Left in place it becomes part of the first header, which then
  // matches nothing — and presents as "no Zone No. column" on a file that plainly has
  // one.
  const input = text.replace(/^﻿/, "");

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let cellWasQuoted = false;

  const endCell = () => {
    // Whitespace around an unquoted value is accidental; inside quotes it was meant.
    row.push(cellWasQuoted ? cell : cell.trim());
    cell = "";
    cellWasQuoted = false;
  };

  const endRow = () => {
    endCell();
    if (row.some((value) => value.length > 0)) rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i += 1) {
    const character = input[i];

    if (quoted) {
      if (character === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
      cellWasQuoted = true;
      continue;
    }

    if (character === ",") {
      endCell();
      continue;
    }

    if (character === "\n") {
      endRow();
      continue;
    }

    // Part of a CRLF pair; the \n that follows ends the row.
    if (character === "\r") continue;

    cell += character;
  }

  // Whatever is left when the text runs out, if it is not just a trailing newline.
  if (cell.length > 0 || row.length > 0) endRow();

  return rows;
}

/**
 * Reduces a header to something comparable.
 *
 * Lower case, parenthetical qualifiers removed, and every separator stripped — so
 * "Sub-Category (clean)", `sub_category` and "SubCategory" all become `subcategory`.
 * The parenthetical rule matters more than it looks: real files arrive with headings
 * like "Sub-Category (clean)" after somebody has tidied a column, and the qualifier
 * would otherwise stop it matching anything.
 */
export function normaliseHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[\s_/\-.]/g, "")
    .trim();
}

/**
 * The index of the first header matching any alias, or null.
 *
 * Aliases are tried in order, so the most specific goes first — one client's type
 * column is headed "Definition", and that has to win over a generic "type" when a file
 * happens to contain both.
 *
 * Null rather than a guess. Guessing imports the wrong column into the wrong field and
 * nobody notices until the data is wrong in a way that looks like the property's own
 * fault; telling somebody their file is missing a column is recoverable in seconds.
 */
export function findColumn(headers: readonly string[], aliases: readonly string[]): number | null {
  const normalised = headers.map(normaliseHeader);

  for (const alias of aliases) {
    const wanted = normaliseHeader(alias);
    const index = normalised.indexOf(wanted);
    if (index !== -1) return index;
  }

  return null;
}
