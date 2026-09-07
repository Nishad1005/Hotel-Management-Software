import type { OutboxRecord } from "@golai/outbox";
import { describe, expect, it } from "vitest";
import type { GolaiClient } from "./client";
import { createSender, type SyncTarget } from "./sync";

type PgError = { code?: string; message: string; details?: string } | null;

/** Records what the sender asked the server to do, and answers with a scripted error. */
function fakeClient(error: PgError = null) {
  const calls: { kind: "insert" | "rpc"; name: string; body: unknown }[] = [];
  const client = {
    from(table: string) {
      return {
        insert(row: unknown) {
          calls.push({ kind: "insert", name: table, body: row });
          return { select: async () => ({ error }) };
        },
      };
    },
    async rpc(fn: string, args: unknown) {
      calls.push({ kind: "rpc", name: fn, body: args });
      return { data: null, error };
    },
  } as unknown as GolaiClient;
  return { client, calls };
}

const record = (type = "GRN_POST"): OutboxRecord => ({
  id: "rec-1",
  type,
  idempotencyKey: "key-1",
  payload: {},
  status: "PENDING",
  attempts: 0,
  createdAt: 0,
  nextAttemptAt: 0,
});

const send = (target: SyncTarget | null, error: PgError = null) => {
  const { client, calls } = fakeClient(error);
  return { run: createSender({ client, route: () => target }), calls };
};

const RPC: SyncTarget = {
  fn: "post_grn",
  args: { p_property_id: "p1", p_idempotency_key: "key-1", p_lines: [] },
};

const INSERT: SyncTarget = {
  table: "gate_entry",
  row: { gate_entry_no: "TW-GE-000001" },
  idempotentOn: "gate_entry_no_unique_per_property",
};

describe("createSender — transactions", () => {
  it("calls the function with its named arguments", async () => {
    const { run, calls } = send(RPC);

    expect(await run(record())).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        kind: "rpc",
        name: "post_grn",
        body: { p_property_id: "p1", p_idempotency_key: "key-1", p_lines: [] },
      },
    ]);
  });

  it("parks a refusal the function raised, rather than retrying it forever", async () => {
    // Every raise in post_grn and issue_stock carries an explicit errcode, so a
    // business refusal arrives as a permanent code and not as an unclassified P0001.
    const { run } = send(RPC, {
      code: "42501",
      message: "You do not have permission to receive goods at this property.",
    });

    const result = await run(record());

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ retryable: false });
  });

  it("parks a rule violation from inside the transaction", async () => {
    const { run } = send(RPC, { code: "23514", message: "Only 4 available on TEST-RICE." });

    expect(await run(record())).toMatchObject({ ok: false, retryable: false });
  });

  it("waits out a network failure instead of parking the receipt", async () => {
    const { run } = send(RPC, { message: "Failed to fetch" });

    expect(await run(record())).toEqual({ ok: false, retryable: true });
  });

  it("parks a unique violation escaping a transaction, since a replay never reaches here", async () => {
    // The function returns the first attempt's result for a repeated submission key,
    // so a 23505 getting out is a real clash and not this device's own retry.
    const { run } = send(RPC, { code: "23505", message: "duplicate key value" });

    expect(await run(record())).toMatchObject({ ok: false, retryable: false });
  });
});

describe("createSender — rows", () => {
  it("still inserts, unchanged", async () => {
    const { run, calls } = send(INSERT);

    expect(await run(record("GATE_ENTRY"))).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({ kind: "insert", name: "gate_entry" });
  });

  it("still treats its own named constraint as success", async () => {
    const { run } = send(INSERT, {
      code: "23505",
      message: 'duplicate key value violates unique constraint "gate_entry_no_unique_per_property"',
    });

    expect(await run(record("GATE_ENTRY"))).toEqual({ ok: true });
  });

  it("still parks a collision on a constraint it did not name", async () => {
    const { run } = send(INSERT, {
      code: "23505",
      message: 'duplicate key value violates unique constraint "some_other_constraint"',
    });

    expect(await run(record("GATE_ENTRY"))).toMatchObject({ ok: false, retryable: false });
  });
});

describe("createSender — unknown captures", () => {
  it("parks a capture type this build has never heard of", async () => {
    const { run, calls } = send(null);

    expect(await run(record("SOMETHING_NEWER"))).toMatchObject({
      ok: false,
      retryable: false,
      reason: "UNKNOWN_CAPTURE_TYPE:SOMETHING_NEWER",
    });
    expect(calls).toEqual([]);
  });
});
