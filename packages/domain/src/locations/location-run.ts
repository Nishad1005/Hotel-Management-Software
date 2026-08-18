/**
 * Generating a run of bin codes.
 *
 * Nobody creates a hundred and twenty bins one at a time, so the implementer names the
 * fixture, gives a range, and the codes are derived. This is the rule behind the live
 * preview on that screen — the codes are shown before anything is written, because the
 * alternative is discovering the naming was wrong after the labels are printed and
 * stuck.
 *
 * The property's own word for the fixture is what appears: "Ghoda", not "Trestle". A
 * ghoda is what sacks and sheet material lean on, and a system that renames it teaches
 * everybody to translate.
 */

/**
 * The most locations one run may create.
 *
 * golaiv1 shipped this uncapped and had to add multi-select bulk delete afterwards,
 * because generators over-produce and somebody always types 1 to 2000. Refusing up
 * front is cheaper than a screen for undoing it, and a genuine store with more than
 * five hundred bins in one zone wants two runs and a think.
 */
export const MAX_RUN = 500;

/** Zero-padded to this width, and widened rather than wrapped beyond it. */
const SEQUENCE_WIDTH = 3;

export type LocationRunError =
  | "PARENT_REQUIRED"
  | "RANGE_BELOW_ONE"
  | "RANGE_NOT_WHOLE"
  | "RANGE_REVERSED"
  | "RANGE_TOO_LARGE";

export interface LocationRunPlan {
  ok: boolean;
  errors: LocationRunError[];
  prefix: string;
  codes: string[];
  count: number;
  /** For the preview line: `→ codes SB-DRY-S001 … SB-DRY-S020`. */
  first: string | null;
  last: string | null;
}

/**
 * The code prefix implied by what the property calls this fixture.
 *
 * The first letter of the first word that has one — so "1st Floor Bin" gives F rather
 * than falling through to the default S, which would collide with every Shelf in the
 * same zone. Where there is no letter at all, S: a shelf is the thing most stores have
 * most of.
 */
export function fixturePrefix(fixtureName: string): string {
  // The first letter that BEGINS a word, not the first letter anywhere: "1st Floor
  // Bin" must give F. Taking any letter finds the "s" in "1st" and yields S, which
  // then collides with every Shelf in the same zone — and the collision only shows up
  // once both runs exist.
  const wordStart = /(?:^|[^A-Za-z0-9])([A-Za-z])/.exec(fixtureName ?? "");
  return wordStart?.[1]?.toUpperCase() ?? "S";
}

/** Letters only, upper case, trimmed to something that reads on a label. */
function normalisePrefix(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 3);
}

/**
 * A new storage zone.
 *
 * Provisioning seeds seven — security, the two terminals, dispatch, dry, chilled, frozen
 * — and that is a starting set rather than a complete one. A resort has a pool bar store,
 * a spa store and a banquet store; a city hotel has none of them. Without this the seven
 * were all a property could ever have, and its own layout had nowhere to go.
 *
 * The code is derived rather than typed whole, so every zone at a property shares its
 * prefix and a sticker read at three in the morning says which hotel it belongs to. The
 * suffix is the property's to choose because the word is theirs.
 */
export const ZONE_SUFFIX_MAX = 12;

export type ZoneError =
  | "PROPERTY_REQUIRED"
  | "NAME_REQUIRED"
  | "SUFFIX_REQUIRED"
  | "SUFFIX_TOO_LONG";

export interface ZonePlan {
  ok: boolean;
  errors: ZoneError[];
  /** What the code will be. Shown before anything is written. */
  code: string;
  suffix: string;
}

export function planZone(input: {
  propertyCode: string;
  /** The property's own word — "Pool bar store", "Ghoda shed". */
  name: string;
  /** Derived from the name when left blank, because most of the time it should be. */
  suffix?: string;
}): ZonePlan {
  const errors: ZoneError[] = [];

  const property = (input.propertyCode ?? "").trim().toUpperCase();
  if (property.length === 0) errors.push("PROPERTY_REQUIRED");

  const name = (input.name ?? "").trim();
  if (name.length === 0) errors.push("NAME_REQUIRED");

  const typed = input.suffix !== undefined && input.suffix.trim().length > 0;
  const source = typed ? input.suffix! : name;
  const suffix = zoneSuffix(source);

  if (suffix.length === 0) errors.push("SUFFIX_REQUIRED");

  // Only what somebody typed. Silently shortening a code they chose is how a label comes
  // back saying something they did not; silently shortening one DERIVED from a long name
  // is the whole job — "Housekeeping chemicals and consumables" was never a code.
  if (typed && rawZoneSuffix(source).length > ZONE_SUFFIX_MAX) errors.push("SUFFIX_TOO_LONG");

  return {
    ok: errors.length === 0,
    errors,
    code: errors.length === 0 ? `${property}-${suffix}` : "",
    suffix,
  };
}

/**
 * Letters and digits, upper case, words joined rather than run together.
 *
 * "Pool bar store" becomes POOLBAR rather than POOL-BAR-STORE: the code is read off a
 * sticker and typed into a search box, and every hyphen is a chance to type it wrong.
 * "Store" is dropped because every zone is one.
 */
function rawZoneSuffix(raw: string): string {
  return (raw ?? "")
    .toUpperCase()
    .replace(/\b(STORE|STORES|ROOM|AREA)\b/g, " ")
    .replace(/[^A-Z0-9]/g, "");
}

function zoneSuffix(raw: string): string {
  return rawZoneSuffix(raw).slice(0, ZONE_SUFFIX_MAX);
}

export function planLocationRun(input: {
  /** The zone or rack these hang under, e.g. `SB-DRY`. */
  parentCode: string;
  fixtureName: string;
  /** Overrides the derived prefix — two fixtures can share a first letter. */
  prefix?: string;
  from: number;
  to: number;
}): LocationRunPlan {
  const errors: LocationRunError[] = [];

  const parent = (input.parentCode ?? "").trim().toUpperCase();
  if (parent.length === 0) errors.push("PARENT_REQUIRED");

  const explicit = input.prefix ? normalisePrefix(input.prefix) : "";
  const prefix = explicit.length > 0 ? explicit : fixturePrefix(input.fixtureName ?? "");

  const { from, to } = input;

  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    errors.push("RANGE_NOT_WHOLE");
  } else {
    // Only meaningful once the numbers are whole; reporting "starts below one" for 1.5
    // sends somebody looking at the wrong field.
    if (from < 1 || to < 1) errors.push("RANGE_BELOW_ONE");
    if (to < from) errors.push("RANGE_REVERSED");
    if (from >= 1 && to >= from && to - from + 1 > MAX_RUN) errors.push("RANGE_TOO_LARGE");
  }

  if (errors.length > 0) {
    return { ok: false, errors, prefix, codes: [], count: 0, first: null, last: null };
  }

  const codes: string[] = [];
  for (let n = from; n <= to; n += 1) {
    codes.push(`${parent}-${prefix}${String(n).padStart(SEQUENCE_WIDTH, "0")}`);
  }

  return {
    ok: true,
    errors: [],
    prefix,
    codes,
    count: codes.length,
    first: codes[0] ?? null,
    last: codes[codes.length - 1] ?? null,
  };
}
