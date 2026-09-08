/**
 * The staff card number — PRD §4 Gate 8, "Staff identity".
 *
 * `TW-EMP-04270`: the property's own code, the person series, a sequence, and a check
 * digit. The same scheme as the vendor ID at Gate 0b, deliberately, because Security
 * scanning a vendor card and a storekeeper scanning a staff card should not be two
 * systems that merely look alike.
 *
 * ## Why a check digit at all, when typing is not permitted
 *
 * The PRD forbids typing a staff code — a forgotten card is a supervisor override, not a
 * keyboard. The check digit is not there for typists. It is there because a QR read off a
 * scratched laminated card in a dark corridor can come back one character wrong, and the
 * difference between "this scan failed" and "this scan identified somebody else" is the
 * whole accountability claim. A wrong-but-plausible code is the failure worth engineering
 * against; an unreadable one is merely inconvenient.
 *
 * ## Damm rather than Luhn
 *
 * Luhn is the familiar choice and it misses the transposition 09 -> 90, which is exactly
 * the class of error a human reading a code aloud to another human produces. Damm catches
 * every single-digit substitution AND every adjacent transposition, needs no position
 * weighting, and is the same amount of code. The tests below assert both properties
 * exhaustively over the range rather than trusting the table.
 */

/**
 * The Damm operation table — a weakly totally anti-symmetric quasigroup of order 10.
 *
 * Copied from the published table rather than generated, and verified by the exhaustive
 * tests: a transcription slip here would silently weaken the check rather than break it,
 * which is the kind of bug that survives review.
 */
const DAMM: readonly (readonly number[])[] = [
  [0, 3, 1, 7, 5, 9, 8, 6, 4, 2],
  [7, 0, 9, 2, 1, 5, 4, 8, 6, 3],
  [4, 2, 0, 6, 8, 7, 1, 3, 5, 9],
  [1, 7, 5, 0, 9, 8, 3, 4, 2, 6],
  [6, 1, 2, 3, 0, 4, 5, 9, 7, 8],
  [3, 6, 7, 4, 2, 0, 9, 5, 8, 1],
  [5, 8, 6, 9, 7, 2, 0, 1, 3, 4],
  [8, 9, 4, 5, 3, 6, 2, 0, 1, 7],
  [9, 4, 3, 8, 6, 1, 7, 2, 0, 5],
  [2, 5, 8, 1, 4, 3, 6, 7, 9, 0],
];

/** How many digits the sequence occupies before the check digit is appended. */
export const PERSON_SEQUENCE_DIGITS = 4;

/** The series marker, between the property code and the number. */
export const PERSON_SERIES = "EMP";

/**
 * The Damm check digit for a run of digits.
 *
 * Returns the digit that, appended, makes the whole string validate to zero.
 */
export function dammCheckDigit(digits: string): number {
  let interim = 0;
  for (const ch of digits) {
    const d = ch.charCodeAt(0) - 48;
    if (d < 0 || d > 9) throw new Error(`Not a digit: ${ch}`);
    interim = DAMM[interim]![d]!;
  }
  return interim;
}

/** True when a run of digits already carries a correct trailing check digit. */
export function dammIsValid(digitsWithCheck: string): boolean {
  if (digitsWithCheck.length === 0) return false;
  try {
    return dammCheckDigit(digitsWithCheck) === 0;
  } catch {
    return false;
  }
}

/**
 * Builds the card number for the nth person at a property.
 *
 * The sequence is zero-padded to four digits and the check digit appended, so the
 * printed number is a fixed width and a missing character is visible rather than merely
 * wrong. Four digits is a deliberate departure from the PRD's three-digit illustration:
 * contract, agency and daily-wage turnover is exactly the population this register is
 * for, and a hotel that reissues numbers because it ran out at 999 has lost the one
 * property the code needs — that a number identifies one person, once, for ever.
 */
export function personCode(propertyCode: string, sequence: number): string {
  const code = propertyCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,8}$/.test(code)) throw new Error(`Not a property code: ${propertyCode}`);
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`A person sequence starts at 1: ${sequence}`);
  }

  const padded = String(sequence).padStart(PERSON_SEQUENCE_DIGITS, "0");
  if (padded.length > PERSON_SEQUENCE_DIGITS) {
    // Not clamped, and not silently widened. A property that reaches this needs a
    // decision about the series, not a card that no longer matches the printed stock.
    throw new Error(
      `Person sequence beyond the ${PERSON_SEQUENCE_DIGITS}-digit series: ${sequence}`,
    );
  }

  return `${code}-${PERSON_SERIES}-${padded}${dammCheckDigit(padded)}`;
}

export interface ParsedPersonCode {
  propertyCode: string;
  sequence: number;
}

/**
 * Reads a card number back, returning null when it is not one.
 *
 * Null covers every kind of wrong — bad shape, unknown series, failed check digit —
 * because the caller's response is the same in each case and must be: refuse the scan.
 * Distinguishing "malformed" from "mistyped" would invite a screen that offers to
 * proceed anyway, which is the exception path the PRD closes.
 */
export function parsePersonCode(raw: string): ParsedPersonCode | null {
  const value = raw.trim().toUpperCase();
  const m = /^([A-Z0-9]{1,8})-([A-Z]{3})-(\d+)$/.exec(value);
  if (!m) return null;

  const [, propertyCode, series, digits] = m as unknown as [string, string, string, string];
  if (series !== PERSON_SERIES) return null;
  if (digits.length !== PERSON_SEQUENCE_DIGITS + 1) return null;
  if (!dammIsValid(digits)) return null;

  const sequence = Number(digits.slice(0, PERSON_SEQUENCE_DIGITS));
  if (sequence < 1) return null;

  return { propertyCode, sequence };
}

/** Convenience for the scan path, where only "is this a card" matters. */
export function isPersonCode(raw: string): boolean {
  return parsePersonCode(raw) !== null;
}
