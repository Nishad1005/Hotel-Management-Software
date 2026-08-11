import { beforeEach, describe, expect, test } from "vitest";
import { MemoryOutboxStore } from "./memory-store";
import { Outbox } from "./outbox";

/**
 * A controllable clock. Time is injected everywhere, never read — the same rule the
 * domain package follows, and here it is also what makes backoff testable without
 * waiting for it.
 */
function clockFrom(startMs: number) {
  let now = startMs;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const T0 = Date.UTC(2026, 7, 10, 6, 0, 0);

function makeOutbox(startMs = T0) {
  const clock = clockFrom(startMs);
  const store = new MemoryOutboxStore();
  const outbox = new Outbox({ store, now: clock.now });
  return { outbox, store, clock };
}

describe("enqueue", () => {
  test("accepts a capture and returns a record with a stable id", async () => {
    const { outbox } = makeOutbox();
    const record = await outbox.enqueue({
      type: "GATE_ENTRY",
      idempotencyKey: "ge-1",
      payload: { packageCount: 3 },
    });

    expect(record.id).toBeTruthy();
    expect(record.status).toBe("PENDING");
    expect(record.attempts).toBe(0);
    expect(record.createdAt).toBe(T0);
  });

  test("enqueuing the same idempotency key twice does not duplicate", async () => {
    // The drain worker retries, and a device may re-submit after a crash. A gate
    // entry recorded twice is a phantom arrival that nobody can reconcile.
    const { outbox } = makeOutbox();
    const first = await outbox.enqueue({
      type: "GATE_ENTRY",
      idempotencyKey: "ge-1",
      payload: { packageCount: 3 },
    });
    const second = await outbox.enqueue({
      type: "GATE_ENTRY",
      idempotencyKey: "ge-1",
      payload: { packageCount: 99 },
    });

    expect(second.id).toBe(first.id);
    expect(await outbox.pendingCount()).toBe(1);
    // The original payload wins. A repeat is a duplicate, not an edit.
    expect(second.payload).toEqual({ packageCount: 3 });
  });
});

describe("drain order", () => {
  test("sends in the order captured", async () => {
    // Gate entries carry leased sequential numbers. Sending them out of order would
    // make the server's arrival log disagree with the numbers written on challans.
    const { outbox } = makeOutbox();
    await outbox.enqueue({ type: "GATE_ENTRY", idempotencyKey: "a", payload: {} });
    await outbox.enqueue({ type: "GATE_ENTRY", idempotencyKey: "b", payload: {} });
    await outbox.enqueue({ type: "GATE_ENTRY", idempotencyKey: "c", payload: {} });

    const sent: string[] = [];
    await outbox.drain(async (record) => {
      sent.push(record.idempotencyKey);
      return { ok: true };
    });

    expect(sent).toEqual(["a", "b", "c"]);
  });
});

describe("a successful send", () => {
  test("removes the record from the queue", async () => {
    const { outbox } = makeOutbox();
    await outbox.enqueue({ type: "GATE_ENTRY", idempotencyKey: "a", payload: {} });

    await outbox.drain(async () => ({ ok: true }));

    expect(await outbox.pendingCount()).toBe(0);
  });
});

describe("a failed send", () => {
  test("keeps the record and counts the attempt", async () => {
    const { outbox } = makeOutbox();
    await outbox.enqueue({ type: "GATE_ENTRY", idempotencyKey: "a", payload: {} });

    await outbox.drain(async () => ({ ok: false, retryable: true }));

    expect(await outbox.pendingCount()).toBe(1);
    const [record] = await outbox.all();
    expect(record?.attempts).toBe(1);
  });

  test("backs off before retrying, and does not send early", async () => {
    const { outbox, clock } = makeOutbox();
    await outbox.enqueue({ type: "GATE_ENTRY", idempotencyKey: "a", payload: {} });
    await outbox.drain(async () => ({ ok: false, retryable: true }));

    let attempted = 0;
    await outbox.drain(async () => {
      attempted += 1;
      return { ok: true };
    });
    expect(attempted).toBe(0);

    clock.advance(60_000);
    await outbox.drain(async () => {
      attempted += 1;
      return { ok: true };
    });
    expect(attempted).toBe(1);
  });

  test("backoff grows with each attempt", async () => {
    const { outbox, clock } = makeOutbox();
    await outbox.enqueue({ type: "GATE_ENTRY", idempotencyKey: "a", payload: {} });

    await outbox.drain(async () => ({ ok: false, retryable: true }));
    const [afterFirst] = await outbox.all();
    const firstWait = (afterFirst?.nextAttemptAt ?? 0) - clock.now();

    clock.advance(firstWait);
    await outbox.drain(async () => ({ ok: false, retryable: true }));
    const [afterSecond] = await outbox.all();
    const secondWait = (afterSecond?.nextAttemptAt ?? 0) - clock.now();

    expect(secondWait).toBeGreaterThan(firstWait);
  });
});

describe("records are never silently dropped", () => {
  test("a permanently rejected record is parked as BLOCKED, not deleted", async () => {
    // The server rejecting a capture is not permission to lose it. A guard recorded a
    // real arrival; if it cannot be sent, a human has to see it and decide.
    const { outbox } = makeOutbox();
    await outbox.enqueue({ type: "GATE_ENTRY", idempotencyKey: "a", payload: {} });

    await outbox.drain(async () => ({ ok: false, retryable: false, reason: "SCHEMA_REJECTED" }));

    const [record] = await outbox.all();
    expect(record?.status).toBe("BLOCKED");
    expect(record?.lastError).toBe("SCHEMA_REJECTED");
    expect(await outbox.pendingCount()).toBe(0);
    expect(await outbox.blockedCount()).toBe(1);
  });

  test("a blocked record is not retried by the drain", async () => {
    const { outbox, clock } = makeOutbox();
    await outbox.enqueue({ type: "GATE_ENTRY", idempotencyKey: "a", payload: {} });
    await outbox.drain(async () => ({ ok: false, retryable: false, reason: "SCHEMA_REJECTED" }));

    clock.advance(24 * 60 * 60 * 1000);
    let attempted = 0;
    await outbox.drain(async () => {
      attempted += 1;
      return { ok: true };
    });

    expect(attempted).toBe(0);
  });
});

describe("drain stops at the first retryable failure", () => {
  test("does not skip past a stuck record to send later ones", async () => {
    // Order is the point. Draining past a blocked-but-retryable record would let a
    // later gate entry arrive before an earlier one.
    const { outbox } = makeOutbox();
    await outbox.enqueue({ type: "GATE_ENTRY", idempotencyKey: "a", payload: {} });
    await outbox.enqueue({ type: "GATE_ENTRY", idempotencyKey: "b", payload: {} });

    const attempted: string[] = [];
    await outbox.drain(async (record) => {
      attempted.push(record.idempotencyKey);
      return { ok: false, retryable: true };
    });

    expect(attempted).toEqual(["a"]);
  });
});

describe("backlog depth", () => {
  // The single best early warning that a device is failing silently, per ADR 0004.
  let outbox: Outbox;
  beforeEach(() => {
    outbox = makeOutbox().outbox;
  });

  test("counts pending records", async () => {
    await outbox.enqueue({ type: "GATE_ENTRY", idempotencyKey: "a", payload: {} });
    await outbox.enqueue({ type: "GATE_ENTRY", idempotencyKey: "b", payload: {} });
    expect(await outbox.pendingCount()).toBe(2);
  });

  test("reports the age of the oldest pending record", async () => {
    const { outbox: ob, clock } = makeOutbox();
    await ob.enqueue({ type: "GATE_ENTRY", idempotencyKey: "a", payload: {} });
    clock.advance(90 * 60 * 1000);
    expect(await ob.oldestPendingAgeMs()).toBe(90 * 60 * 1000);
  });

  test("reports null age when nothing is pending", async () => {
    expect(await outbox.oldestPendingAgeMs()).toBeNull();
  });
});
