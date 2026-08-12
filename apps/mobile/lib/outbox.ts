import { MemoryOutboxStore, Outbox, type OutboxStore } from "@golai/outbox";
import { createOutboxStore } from "./outbox-store";

/**
 * The app's single outbox.
 *
 * Screens enqueue captures and never learn whether they landed in SQLite or
 * IndexedDB — the driver is chosen by Metro at bundle time via platform extensions on
 * ./outbox-store. That is what makes ADR 0014's "web now, native later" cheap instead
 * of a rewrite.
 */
function storeOrMemory(): OutboxStore {
  try {
    return createOutboxStore();
  } catch {
    // A device that cannot open its store must still let the guard capture.
    return new MemoryOutboxStore();
  }
}

export const outbox = new Outbox({
  store: storeOrMemory(),
  now: () => Date.now(),
});

/**
 * The queue changed — something was captured, sent, or parked.
 *
 * The counts are read straight from the store rather than mirrored into React state,
 * so screens need a nudge to re-read. Without one, a "3 waiting to sync" banner sits
 * there unchanged while the records are draining behind it, and the guard cannot tell
 * a working queue from a stuck one. That distinction is the entire point of showing
 * the number.
 */
const listeners = new Set<() => void>();

export function onOutboxChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyOutboxChanged(): void {
  for (const listener of listeners) listener();
}
