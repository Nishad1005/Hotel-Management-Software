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
