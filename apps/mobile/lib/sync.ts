import { createSender, type SyncTarget } from "@golai/db";
import type { OutboxRecord } from "@golai/outbox";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { notifyOutboxChanged, outbox } from "./outbox";
import { requireSupabase } from "./supabase";

/**
 * The other half of the offline queue.
 *
 * `Outbox.enqueue` and `Outbox.drain` were both written and tested, and nothing called
 * drain — so every capture went into IndexedDB or SQLite and stayed there. The home
 * screen's "N waiting to sync" was permanently accurate and permanently unresolvable.
 * This module is what closes the loop.
 */

const DRAIN_INTERVAL_MS = 60_000;

/**
 * Maps a queued capture onto the row to insert.
 *
 * Deliberately thin, and deliberately optimistic. A payload missing a required field
 * produces a not-null violation, which `createSender` already classifies as permanent,
 * so the record is parked with the database's own account of what was wrong. Validating
 * here instead would replace an accurate reason with a guess, and every rule would then
 * exist in two places — which is the divergence CLAUDE.md rule 16 is about.
 *
 * Returning null is reserved for a capture type this build has never heard of, which is
 * a genuinely different situation: a newer app version queued it, and discarding it
 * would lose a real arrival.
 */
export function routeCapture(record: OutboxRecord): SyncTarget | null {
  if (record.type !== "GATE_ENTRY") return null;

  const p = record.payload as GateEntryPayload;
  const vendor = p.vendor;
  const bill = p.bill;

  return {
    table: "gate_entry",
    // No `idempotentOn`, deliberately. A gate entry's only unique constraint is on the
    // NUMBER, and until leasing lands that number is minted from the device clock — so
    // two guards capturing in the same second produce the same one. A unique violation
    // here is therefore ambiguous: it might be this device retrying after a lost
    // acknowledgement, or it might be a different vehicle entirely.
    //
    // Unable to tell, we park rather than guess. A parked record needs somebody to look
    // at it; a record deleted on a guess has lost an arrival, and nothing anywhere
    // would say so.
    //
    // Once numbers are leased the number becomes genuinely unique per property, and
    // `gate_entry_no_unique_per_property` can be named here.
    row: {
      property_id: p.propertyId,
      gate_entry_no: p.gateEntryNumber,
      party_id: vendor?.kind === "REGISTERED" ? vendor.partyId : null,
      unregistered_vendor_name: vendor?.kind === "UNREGISTERED" ? vendor.name : null,
      arrival_type: p.arrivalType,
      bill: bill?.kind,
      bill_photo_ref: bill?.kind === "PHOTOGRAPHED" ? bill.photoRef : null,
      package_count: p.packageCount,
      vehicle_mode: p.vehicleMode ?? null,
      vehicle_number: p.vehicleNumber ?? null,
      captured_by: p.capturedBy ?? null,
      // timestamp_in is left to the server's own clock (CLAUDE.md 19). This is the
      // device's claim, kept beside it so an entry captured at 08:00 and synced at
      // 14:00 can still be aged from when the material actually arrived.
      captured_at_device: p.capturedAt ? new Date(p.capturedAt).toISOString() : null,
    },
  };
}

interface GateEntryPayload {
  propertyId?: string;
  gateEntryNumber?: string;
  arrivalType?: string;
  packageCount?: number;
  vehicleMode?: string;
  vehicleNumber?: string;
  capturedBy?: string;
  capturedAt?: number;
  vendor?: { kind: "REGISTERED"; partyId: string } | { kind: "UNREGISTERED"; name: string };
  bill?: { kind: "PHOTOGRAPHED"; photoRef: string } | { kind: "UNANSWERED" | "NONE" };
}

/**
 * Drains the queue, once, and never twice at the same time.
 *
 * The overlap guard is not defensive tidiness. `Outbox.drain` reads the list, then
 * sends and removes record by record; two drains racing would both read the same
 * pending record and both send it. The idempotency key means the server survives that,
 * but the second send would be a wasted round trip on a gate device holding a bad
 * connection, which is where the round trips are most expensive.
 */
let inFlight: Promise<void> | null = null;

export async function drainOnce(): Promise<void> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const client = requireSupabase();
      await outbox.drain(createSender({ client, route: routeCapture }));
    } catch {
      // Supabase not configured, or the store could not be opened. Both are conditions
      // a later attempt may resolve, and neither is worth surfacing over the capture
      // screen — the pending count is already the honest signal.
    } finally {
      inFlight = null;
      notifyOutboxChanged();
    }
  })();

  return inFlight;
}

/**
 * Runs the drain for as long as someone is signed in.
 *
 * Not scoped to the active property, deliberately. A capture carries the property it
 * was made at, so an entry recorded at one property must still reach the server after
 * the user switches to another — a group storekeeper covering two hotels would
 * otherwise strand a shift's work by changing screens.
 *
 * It is scoped to having a session, because without a JWT every insert returns 401,
 * which is unrecognised and therefore treated as retryable — so a signed-out app would
 * quietly burn through the backoff schedule and leave a real capture waiting half an
 * hour after sign-in.
 */
export function useSyncEngine(signedIn: boolean): void {
  const signedInRef = useRef(signedIn);
  signedInRef.current = signedIn;

  useEffect(() => {
    if (!signedIn) return;

    const run = () => {
      if (signedInRef.current) void drainOnce();
    };

    run();

    const timer = setInterval(run, DRAIN_INTERVAL_MS);

    // A gate device spends most of its life with the screen off. Coming back to the
    // foreground is the strongest signal that the network may have returned.
    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active") run();
    });

    // Web only, and the most direct signal there is. Guarded rather than branched on
    // Platform, so the same file serves both runtimes.
    const online = typeof window !== "undefined" && typeof window.addEventListener === "function";
    if (online) window.addEventListener("online", run);

    return () => {
      clearInterval(timer);
      appState.remove();
      if (online) window.removeEventListener("online", run);
    };
  }, [signedIn]);
}
