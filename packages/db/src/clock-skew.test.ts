import { describe, expect, it } from "vitest";
import { JWT_AHEAD_CODE, SKEW_RETRY_DELAYS_MS, withClockSkewRetry } from "./clock-skew";

const skew = (): Response =>
  new Response(JSON.stringify({ code: JWT_AHEAD_CODE, message: "JWT issued at future" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });

const ok = (body = '{"ok":true}'): Response =>
  new Response(body, { status: 200, headers: { "content-type": "application/json" } });

/** A fetch that returns each queued response in turn and counts its calls. */
function scripted(responses: Response[]) {
  let calls = 0;
  const fn = (async () => {
    const res = responses[Math.min(calls, responses.length - 1)];
    calls += 1;
    return res;
  }) as unknown as typeof fetch;
  return { fn, calls: () => calls };
}

describe("withClockSkewRetry", () => {
  it("passes a successful response straight through without retrying", async () => {
    const { fn, calls } = scripted([ok()]);
    const wrapped = withClockSkewRetry(fn, async () => {});

    const res = await wrapped("https://example.test/rest/v1/membership");

    expect(res.status).toBe(200);
    expect(calls()).toBe(1);
  });

  it("retries the clock-skew refusal and returns the response that succeeds", async () => {
    const { fn, calls } = scripted([skew(), ok()]);
    const wrapped = withClockSkewRetry(fn, async () => {});

    const res = await wrapped("https://example.test/rest/v1/membership");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls()).toBe(2);
  });

  it("leaves the body readable on the response it returns", async () => {
    // The check reads a clone; if it read the response itself, the caller would get an
    // already-consumed body and supabase-js would report a parse failure instead.
    const { fn } = scripted([skew(), ok('{"rows":3}')]);
    const wrapped = withClockSkewRetry(fn, async () => {});

    expect(await (await wrapped("https://example.test/")).json()).toEqual({ rows: 3 });
  });

  it("gives up after the configured number of retries", async () => {
    const { fn, calls } = scripted([skew(), skew(), skew(), skew()]);
    const wrapped = withClockSkewRetry(fn, async () => {});

    const res = await wrapped("https://example.test/");

    expect(res.status).toBe(401);
    expect(calls()).toBe(SKEW_RETRY_DELAYS_MS.length + 1);
  });

  it("waits between attempts, in the configured order", async () => {
    const waited: number[] = [];
    const { fn } = scripted([skew(), skew(), ok()]);
    const wrapped = withClockSkewRetry(fn, async (ms) => {
      waited.push(ms);
    });

    await wrapped("https://example.test/");

    expect(waited).toEqual([...SKEW_RETRY_DELAYS_MS]);
  });

  it("does not retry a 401 that is not the skew refusal", async () => {
    // Bad credentials must fail on the first attempt. Retrying every 401 would turn a
    // wrong password into a four-second wait before the message appears.
    const bad = new Response(JSON.stringify({ code: "invalid_credentials" }), { status: 401 });
    const { fn, calls } = scripted([bad, ok()]);
    const wrapped = withClockSkewRetry(fn, async () => {});

    const res = await wrapped("https://example.test/auth/v1/token");

    expect(res.status).toBe(401);
    expect(calls()).toBe(1);
  });

  it("does not retry other PostgREST errors", async () => {
    const missing = new Response(JSON.stringify({ code: "PGRST200" }), { status: 400 });
    const { fn, calls } = scripted([missing, ok()]);
    const wrapped = withClockSkewRetry(fn, async () => {});

    expect((await wrapped("https://example.test/")).status).toBe(400);
    expect(calls()).toBe(1);
  });

  it("replays a write, because the refusal happened before the statement ran", async () => {
    const { fn, calls } = scripted([skew(), ok()]);
    const wrapped = withClockSkewRetry(fn, async () => {});

    const res = await wrapped("https://example.test/rest/v1/gate_entry", {
      method: "POST",
      body: JSON.stringify({ vehicle_number: "AS 06 AB 1234" }),
    });

    expect(res.status).toBe(200);
    expect(calls()).toBe(2);
  });

  it("refuses to replay a body it cannot send twice", async () => {
    // A stream is consumed by the first attempt. Retrying would send an empty request
    // and turn a transient refusal into a confusing, different failure.
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    });
    const { fn, calls } = scripted([skew(), ok()]);
    const wrapped = withClockSkewRetry(fn, async () => {});

    const res = await wrapped("https://example.test/", {
      method: "POST",
      body: stream as unknown as BodyInit,
    });

    expect(res.status).toBe(401);
    expect(calls()).toBe(1);
  });
});
