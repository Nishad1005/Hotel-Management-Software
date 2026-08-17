/**
 * Telling a scan apart from typing.
 *
 * A USB barcode scanner is a keyboard. It types the code and presses Enter, and nothing
 * in the keystrokes themselves says "machine" — so the only signal available is speed.
 * A wedge delivers a whole code in tens of milliseconds; a person at a dock, in gloves,
 * does not.
 *
 * ## Why this matters more than it looks
 *
 * Hard rule 13 requires a SCANNED put-away destination and permits no typed one. This
 * build allows typing, because the pilot's labels are not printed yet — so the honest
 * version of that concession is to record which one happened (PRD section 2, witness
 * before you enforce). If the app simply asked "did you scan it?", every answer would be
 * yes, and the register would carry an assertion nobody checked.
 *
 * That makes this classifier the thing standing between an honest record and a decorative
 * one. It is deliberately biased towards TYPED: a scan misread as typing understates
 * compliance, which is recoverable, while typing misread as a scan is the false assertion
 * the whole rule exists to prevent.
 *
 * ## No I/O, no clock
 *
 * Time comes in as a parameter (ADR 0009). The caller has the events; this has the rule.
 */

/**
 * Milliseconds per character at or below which input is machine-fast.
 *
 * Eighty is the figure golaiv1 arrived at against real hardware. A cheap wedge delivers
 * around 10-20 ms per character; a fast touch typist on a physical keyboard manages
 * about 120 ms, and nobody achieves 80 on a tablet in the cold.
 */
export const WEDGE_MAX_MS_PER_CHAR = 80;

/**
 * A gap this long means somebody stopped to think or to look.
 *
 * Separate from the average because a long code can absorb one human-sized pause without
 * moving its mean past the threshold — a code scanned and then hand-edited would
 * otherwise still classify as a scan.
 */
export const HUMAN_PAUSE_MS = 400;

/** Below this, timing says nothing. Two characters have one gap, and one gap is noise. */
export const WEDGE_MIN_LENGTH = 4;

export interface EntryTrace {
  /** Characters currently in the field. */
  length: number;
  /** When the first character arrived, or null while the field is empty. */
  startedAt: number | null;
  /** When the most recent change arrived. */
  lastAt: number | null;
  /** The slowest gap between consecutive changes so far. */
  slowestGapMs: number;
  /**
   * Set once and never cleared. A field that was edited by hand stays edited by hand,
   * however fast the rest of it arrived.
   */
  edited: boolean;
}

export function emptyTrace(): EntryTrace {
  return { length: 0, startedAt: null, lastAt: null, slowestGapMs: 0, edited: false };
}

/**
 * Folds one change event into the trace.
 *
 * Takes the field's whole value rather than a keystroke, because that is what a React
 * Native `onChangeText` gives — and because a wedge is fast enough that several
 * characters routinely arrive in one event, which is itself part of the signature.
 */
export function observeChange(trace: EntryTrace, value: string, at: number): EntryTrace {
  if (value.length === 0) return emptyTrace();

  // Shorter than it was means a backspace. Scanners do not delete, so from here on this
  // entry is a person's regardless of how it started.
  const shortened = value.length < trace.length;

  if (trace.startedAt === null || trace.lastAt === null) {
    return {
      length: value.length,
      startedAt: at,
      lastAt: at,
      slowestGapMs: 0,
      edited: shortened,
    };
  }

  const gap = Math.max(0, at - trace.lastAt);

  return {
    length: value.length,
    startedAt: trace.startedAt,
    lastAt: at,
    slowestGapMs: Math.max(trace.slowestGapMs, gap),
    edited: trace.edited || shortened,
  };
}

/**
 * How the code in the field was established.
 *
 * Returns only HARDWARE or TYPED. CAMERA is not a guess — the camera path knows what it
 * is and says so, which is why it is not a possible answer here.
 */
export function classifyEntry(trace: EntryTrace): "HARDWARE" | "TYPED" {
  if (trace.edited) return "TYPED";
  if (trace.length < WEDGE_MIN_LENGTH) return "TYPED";
  if (trace.slowestGapMs > HUMAN_PAUSE_MS) return "TYPED";
  if (trace.startedAt === null || trace.lastAt === null) return "TYPED";

  // One event carrying the whole code is a wedge outrunning the render loop, which no
  // person can do — and the elapsed-time test cannot see it, because it has no gap to
  // measure.
  const spans = trace.length - 1;
  if (spans <= 0) return "TYPED";

  const elapsed = trace.lastAt - trace.startedAt;
  if (elapsed === 0) return "HARDWARE";

  return elapsed / spans <= WEDGE_MAX_MS_PER_CHAR ? "HARDWARE" : "TYPED";
}
