import { describe, expect, it } from "vitest";
import {
  classifyEntry,
  emptyTrace,
  HUMAN_PAUSE_MS,
  observeChange,
  WEDGE_MAX_MS_PER_CHAR,
  type EntryTrace,
} from "./wedge";

/**
 * Replays a sequence of field values at given times, the way a screen would.
 *
 * `at` is absolute so the intent of each case reads off the numbers rather than off
 * accumulated arithmetic.
 */
function replay(events: [value: string, at: number][]): EntryTrace {
  let trace = emptyTrace();
  for (const [value, at] of events) trace = observeChange(trace, value, at);
  return trace;
}

/** Characters arriving one at a time, `gap` ms apart. */
function steady(code: string, gap: number, from = 1_000): [string, number][] {
  return [...code].map((_, i) => [code.slice(0, i + 1), from + i * gap]);
}

describe("classifying how a code was entered", () => {
  it("calls a fast burst hardware", () => {
    expect(classifyEntry(replay(steady("SB-DRY-R1-B1", 15)))).toBe("HARDWARE");
  });

  it("calls dock-speed typing typed", () => {
    expect(classifyEntry(replay(steady("SB-DRY-R1-B1", 260)))).toBe("TYPED");
  });

  it("calls a whole code arriving in one event hardware", () => {
    // A wedge outrunning the render loop. There is no gap to measure, so the
    // elapsed-time test alone would have to guess.
    expect(classifyEntry(replay([["SB-DRY-R1-B1", 1_000]]))).toBe("HARDWARE");
  });

  it("treats the threshold as inclusive", () => {
    expect(classifyEntry(replay(steady("ABCDEFGH", WEDGE_MAX_MS_PER_CHAR)))).toBe("HARDWARE");
    expect(classifyEntry(replay(steady("ABCDEFGH", WEDGE_MAX_MS_PER_CHAR + 1)))).toBe("TYPED");
  });
});

describe("the bias towards typed", () => {
  it("calls a code short enough that timing means nothing typed", () => {
    // Three characters is two gaps. A person can produce two fast gaps by accident; the
    // cost of believing them is a false claim that the label was scanned.
    expect(classifyEntry(replay(steady("A1B", 5)))).toBe("TYPED");
  });

  it("calls anything backspaced typed, however it started", () => {
    const trace = replay([...steady("SB-DRY-R1-B11", 12), ["SB-DRY-R1-B1", 900]]);
    expect(trace.edited).toBe(true);
    expect(classifyEntry(trace)).toBe("TYPED");
  });

  it("stays typed after a backspace even if the correction is fast", () => {
    const trace = replay([
      ...steady("SB-DRY-R1-B11", 12),
      ["SB-DRY-R1-B1", 200],
      ["SB-DRY-R1-B12", 210],
    ]);
    expect(classifyEntry(trace)).toBe("TYPED");
  });

  it("calls a fast code with one human pause in it typed", () => {
    // Scanned, then somebody stopped and appended by hand. The mean would still pass.
    const trace = replay([
      ...steady("SB-DRY-R1-B", 10),
      ["SB-DRY-R1-B1", 1_000 + 10 * 10 + HUMAN_PAUSE_MS + 1],
    ]);
    expect(classifyEntry(trace)).toBe("TYPED");
  });

  it("calls an empty field typed rather than anything", () => {
    expect(classifyEntry(emptyTrace())).toBe("TYPED");
  });
});

describe("the trace itself", () => {
  it("resets completely when the field is cleared", () => {
    const trace = replay([...steady("SB-DRY-R1-B1", 12), ["", 5_000]]);
    expect(trace).toEqual(emptyTrace());
  });

  it("survives a cleared field being scanned into again", () => {
    let trace = replay([...steady("WRONG", 300), ["", 5_000]]);
    for (const [value, at] of steady("SB-DRY-R1-B1", 12, 6_000)) {
      trace = observeChange(trace, value, at);
    }
    expect(classifyEntry(trace)).toBe("HARDWARE");
  });

  it("keeps the slowest gap, not the last one", () => {
    const trace = replay([
      ["A", 1_000],
      ["AB", 1_010],
      ["ABC", 2_000],
      ["ABCD", 2_010],
    ]);
    expect(trace.slowestGapMs).toBe(990);
  });

  it("counts characters rather than events", () => {
    const trace = replay([
      ["SB-", 1_000],
      ["SB-DRY", 1_012],
      ["SB-DRY-R1-B1", 1_030],
    ]);
    expect(trace.length).toBe(12);
    expect(classifyEntry(trace)).toBe("HARDWARE");
  });

  it("does not treat out-of-order timestamps as a negative gap", () => {
    const trace = replay([
      ["A", 2_000],
      ["AB", 1_000],
      ["ABC", 2_100],
      ["ABCD", 2_110],
    ]);
    expect(trace.slowestGapMs).toBeGreaterThanOrEqual(0);
  });
});
