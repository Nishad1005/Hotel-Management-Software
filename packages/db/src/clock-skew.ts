/**
 * Surviving a JWT that is a second ahead of the server.
 *
 * ## What goes wrong
 *
 * Supabase Auth stamps `iat` on the access token from its own clock. PostgREST then
 * validates that token against a different machine's clock. When Auth is even slightly
 * ahead, `iat` is briefly in the future and PostgREST refuses the request outright:
 *
 *     401 {"code":"PGRST303","message":"JWT issued at future"}
 *
 * Nothing is wrong with the token, the user, or the request. It becomes valid on its
 * own a moment later, and the identical request then succeeds.
 *
 * ## Why it needs handling rather than logging
 *
 * It was found in testing, three times in about a dozen sign-ins, and once it landed on
 * the query that loads a user's properties. That call is the session bootstrap: it
 * failed, the app had no property, and it rendered nothing at all. Signed in, blank
 * screen, no error — at a gate at six in the morning, with no way to know that
 * reloading would fix it. A random blank app is not something to leave to chance
 * because the failure is transient.
 *
 * ## Why replaying is safe, including for writes
 *
 * This is the part that decides whether the retry is allowed to be unconditional. A
 * `PGRST303` is a refusal at the door: PostgREST rejects the token before it opens a
 * transaction, so the statement never reached the database. There is no partial write
 * to duplicate, which is what would otherwise make retrying a POST reckless. The retry
 * is therefore keyed to that one code and no other — a 401 from bad credentials, or any
 * other PostgREST error, is passed straight through untouched.
 *
 * The delays are deliberately longer than the skew ever observed. Nothing is retried
 * more than twice, so a genuine outage surfaces as an error rather than hanging.
 */

/** PostgREST's code for "this token's `iat` is ahead of my clock". */
export const JWT_AHEAD_CODE = "PGRST303";

/** Waits between attempts. Two retries, then the caller sees the refusal. */
export const SKEW_RETRY_DELAYS_MS = [1200, 2500] as const;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A request can only be replayed if its body can be sent twice.
 *
 * Strings and empty bodies can. A stream cannot — it is consumed by the first attempt,
 * and re-sending it would produce an empty request that looks like a different bug
 * entirely. supabase-js sends JSON strings, so this is a guard rather than a limit.
 */
function isReplayable(init?: RequestInit): boolean {
  const body = init?.body;
  return body === undefined || body === null || typeof body === "string";
}

/**
 * True when this response is the clock-skew refusal and nothing else.
 *
 * Reads a clone so the caller still gets an untouched body when we decide to pass the
 * response through.
 */
async function isClockSkewRefusal(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  try {
    const text = await res.clone().text();
    return text.includes(JWT_AHEAD_CODE);
  } catch {
    // An unreadable body is not evidence of skew; let the caller see the original.
    return false;
  }
}

/**
 * Wraps a fetch so the clock-skew refusal is retried instead of surfacing.
 *
 * `sleep` is injectable so the tests do not spend four seconds proving it waits.
 */
export function withClockSkewRetry(
  baseFetch: typeof fetch,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let res = await baseFetch(input, init);
    if (!isReplayable(init)) return res;

    for (const delay of SKEW_RETRY_DELAYS_MS) {
      if (!(await isClockSkewRefusal(res))) return res;
      await sleep(delay);
      res = await baseFetch(input, init);
    }
    return res;
  };
}
