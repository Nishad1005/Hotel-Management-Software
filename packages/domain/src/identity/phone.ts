/**
 * Phone numbers as a login identifier.
 *
 * A storekeeper in Tinsukia, a security guard on an agency contract and a commis in
 * the kitchen mostly do not have an email address. Requiring one means inventing them,
 * and an invented address becomes a shared login within a fortnight — at which point
 * `captured_by` stops identifying anybody and the reconciliation control that Security
 * and the storekeeper are different people quietly stops existing.
 *
 * So the number is the identifier. Supabase stores phones in E.164 (+919829012345),
 * and every form of the number a person might type has to arrive there or the login
 * silently does not match.
 *
 * This lives in the domain package because the same normalisation has to run in the
 * app, in the admin screen that creates the login, and in the edge function that calls
 * `auth.admin.createUser`. Two implementations would differ on exactly one input and
 * that input would belong to a real person who then cannot sign in.
 */

const DEFAULT_COUNTRY = "+91";

/** E.164 permits at most fifteen digits, and nothing real is shorter than eight. */
const E164_MIN_DIGITS = 8;
const E164_MAX_DIGITS = 15;

/**
 * Whether the input is a phone number rather than an email or a username.
 *
 * Sign-in accepts either, and has to decide which field to hand Supabase before it can
 * ask. Getting it wrong produces "invalid login credentials" for a correct number,
 * which is indistinguishable from a wrong password to the person standing there.
 */
export function looksLikePhone(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;

  const shapedLikeANumber = /^\+?[\d\s\-().]+$/.test(trimmed);
  const hasEnoughDigits = trimmed.replace(/\D/g, "").length >= 6;

  return shapedLikeANumber && hasEnoughDigits;
}

/**
 * Normalises a typed number to E.164, or returns null when it cannot be one.
 *
 * Null rather than a best guess, deliberately. A guess creates a login that nobody can
 * sign in to, and the administrator reads the number back off the screen believing it
 * is right — the failure surfaces days later, to someone who cannot diagnose it. A
 * refusal surfaces immediately, to the person who can retype it.
 */
export function normalisePhone(input: string, defaultCountry = DEFAULT_COUNTRY): string | null {
  const trimmed = input.trim();

  // A letter anywhere means this was never a phone number — most often an email typed
  // into the wrong field, and a capital O for a zero the rest of the time.
  if (!trimmed || /[a-zA-Z@]/.test(trimmed)) return null;

  const explicitlyInternational = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (explicitlyInternational) {
    const plausible = digits.length >= E164_MIN_DIGITS && digits.length <= E164_MAX_DIGITS;
    return plausible ? `+${digits}` : null;
  }

  // 098290-12345 is how it gets written on a card at least as often as not.
  if (digits.startsWith("0")) digits = digits.slice(1);

  const countryCode = defaultCountry.slice(1);

  if (digits.length === 10) return defaultCountry + digits;

  // The country code typed without its plus: 919829012345.
  if (digits.length === 10 + countryCode.length && digits.startsWith(countryCode)) {
    return `+${digits}`;
  }

  return null;
}
