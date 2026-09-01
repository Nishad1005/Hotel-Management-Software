import {
  addRange,
  needsRefill,
  refillCount,
  remainingNumbers,
  spendNumber,
  type NumberLeaseState,
} from "@golai/domain";
import { getDeviceId } from "./device";
import { createSessionStorage } from "./session-storage";
import { requireSupabase } from "./supabase";

/**
 * The device's pool of gate entry numbers. ADR 0005's client half, wired.
 *
 * The rules live in `@golai/domain` (pure, tested); this module is only the I/O around
 * them: persist the pool on the storage seam, refill it from the server while there is
 * a connection, and hand the capture screen a number instantly — which is the whole
 * point, because the number is written onto the vendor's paper challan the moment the
 * guard sees it and cannot wait for a round trip.
 *
 * Every operation runs through one queue per module. Two rapid captures must not read
 * the same pool state and spend the same number; serialising here costs microseconds
 * and removes the race outright. (Two browser TABS remain a documented pilot risk —
 * localStorage has no cross-tab lock — with a stated operational rule: one tab on the
 * dock device. The named unique constraint turns even that into a swallowed retry
 * rather than a lost arrival.)
 *
 * A corrupt or lost pool is deliberately survivable: unspent numbers that vanish become
 * a gap in the series, and gaps are legal — retained leases make every one explainable
 * (ADR 0005). What is NOT survivable is inventing a number outside a lease, so nothing
 * here ever falls back to minting: an empty pool with no server is an error the guard
 * sees, not a guess the auditor finds.
 */

const DOC_TYPE = "GATE_ENTRY";
const PREFIX = "GE";

const storage = createSessionStorage();

const key = (propertyId: string) => `golai.number-lease.${DOC_TYPE}.${propertyId}`;

/** All pool operations, one at a time, in arrival order. */
let queue: Promise<unknown> = Promise.resolve();

function serialise<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  // The queue itself must never reject, or one failure would poison every later take.
  queue = next.catch(() => undefined);
  return next;
}

async function loadState(propertyId: string): Promise<NumberLeaseState | null> {
  const raw = await storage.getItem(key(propertyId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as NumberLeaseState;
    if (!Array.isArray(parsed.ranges) || typeof parsed.propertyCode !== "string") return null;
    return parsed;
  } catch {
    // Unreadable state is treated as no state: the numbers it held become a gap, which
    // the retained lease rows can explain. A guess about its contents could not be.
    return null;
  }
}

async function saveState(propertyId: string, state: NumberLeaseState): Promise<void> {
  await storage.setItem(key(propertyId), JSON.stringify(state));
}

async function refill(
  propertyId: string,
  state: NumberLeaseState | null,
): Promise<NumberLeaseState> {
  const client = requireSupabase();
  const { data, error } = await client.rpc("lease_document_numbers", {
    p_property_id: propertyId,
    p_doc_type: DOC_TYPE,
    p_device_id: await getDeviceId(),
    p_count: refillCount(state),
  });

  if (error) throw new Error(error.message);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("The server returned no number block.");

  const next = addRange(
    state,
    { start: Number(row.range_start), end: Number(row.range_end) },
    { propertyCode: row.property_code, prefix: PREFIX },
  );
  await saveState(propertyId, next);
  return next;
}

/**
 * Tops the pool up if it is running low. Called when the capture screen opens, so the
 * refill happens while the guard is still walking to the vehicle — not while it waits.
 *
 * Failure is silent by design: if the pool still holds numbers the screen works
 * offline exactly as intended, and if it is empty the take below will say so loudly.
 */
export async function primeGateEntryNumbers(propertyId: string): Promise<void> {
  return serialise(async () => {
    const state = await loadState(propertyId);
    if (!needsRefill(state)) return;
    try {
      await refill(propertyId, state);
    } catch {
      // The pending take is the honest failure point, not the pre-warm.
    }
  });
}

/**
 * Spends one number, formatted exactly as the series prints it.
 *
 * Throws when the pool is empty and the server unreachable — the capture screen shows
 * that as its own error, because ADR 0005 is explicit: never generate a document number
 * outside a lease. With a 200-deep pool refilled in the background, reaching that state
 * at an online dock means something is genuinely wrong and should look wrong.
 */
export async function takeGateEntryNumber(propertyId: string): Promise<string> {
  return serialise(async () => {
    let state = await loadState(propertyId);

    if (remainingNumbers(state) === 0) {
      state = await refill(propertyId, state);
    }

    const { formatted, state: after } = spendNumber(state as NumberLeaseState);
    await saveState(propertyId, after);

    if (needsRefill(after)) {
      // Top up for the next capture, inside the queue so it cannot race a take.
      // Failure stays silent here for the same reason as in the pre-warm.
      queue = queue.then(async () => {
        const current = await loadState(propertyId);
        if (needsRefill(current)) await refill(propertyId, current).catch(() => undefined);
      });
    }

    return formatted;
  });
}
