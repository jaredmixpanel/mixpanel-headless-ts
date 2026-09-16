// The live trace the code panel writes beside a running loop: one comment
// line naming the iteration in flight (or, before the loop has run, that
// nothing has), then a summary once the loop is done — each opened by an
// emoji for the state: a stopwatch before, a clock face whose hands turn
// while a call is in flight, a check when done. Pure text over the calls
// and their timings, so the panel decorates the rendered program without
// changing it (the program the tests re-parse is the program on screen).

import type { Call } from "./call.js";

/** One call of a loop with what the run recorded about it. */
export interface TracedCall {
  readonly call: Call;
  /** Wall time of the call in milliseconds; `null` while it is pending. */
  readonly durationMs: number | null;
  /** Whether the call ended in an error. */
  readonly failed: boolean;
}

/** A trace comment: the state emoji, then the text that follows it. */
export interface TraceLine {
  readonly emoji: string;
  readonly text: string;
}

/** What the live line knows beyond the calls. */
export interface LiveTraceOptions {
  /** Index of the call in flight, or `null` when none is. */
  readonly current: number | null;
  /** How long the call in flight has been running, or `null` to leave it out. */
  readonly elapsedMs: number | null;
  /** The clock face to open an in-flight line with (see {@link clockFace}). */
  readonly clock: string;
}

/** Before the loop has run: a stopwatch, with its emoji presentation selector. */
export const IDLE_EMOJI = "⏱️";

/** Once the loop is done. */
export const DONE_EMOJI = "✅";

/**
 * The twenty-four clock faces in order of the time they show, twelve
 * o'clock first, hour and half-hour alternating — stepped through, the
 * hands appear to turn.
 */
export const CLOCK_FACES: readonly string[] = Array.from(
  { length: 24 },
  (_, i) => {
    // U+1F550–U+1F55B are one to twelve o'clock, U+1F55C–U+1F567 the half
    // hours after each; twelve comes first so the dial starts upright.
    const hour = (Math.floor(i / 2) + 11) % 12;
    const base = i % 2 === 0 ? 0x1f550 : 0x1f55c;
    return String.fromCodePoint(base + hour);
  },
);

/** Durations from here up print in seconds. */
const SECOND_MS = 1000;

/**
 * The clock face for a tick of the panel's timer, wrapping every
 * twenty-four ticks.
 *
 * @param tick - Ticks since the loop started (any non-negative integer).
 * @returns One of {@link CLOCK_FACES}.
 */
export function clockFace(tick: number): string {
  return CLOCK_FACES[Math.max(0, Math.trunc(tick)) % CLOCK_FACES.length] ?? "";
}

/**
 * Format a duration the way a profiler would: whole milliseconds below a
 * second, one decimal of seconds from there.
 *
 * @param ms - The duration in milliseconds.
 * @returns e.g. `183 ms` or `4.2 s` (the space is a no-break space).
 */
export function formatDuration(ms: number): string {
  const rounded = Math.max(0, Math.round(ms));
  // A no-break space keeps the unit with its number when the line wraps.
  return rounded < SECOND_MS
    ? `${String(rounded)}\u00A0ms`
    : `${(rounded / SECOND_MS).toFixed(1)}\u00A0s`;
}

/**
 * The events a loop call is about, quoted as the program quotes them: the
 * two steps of a funnel joined by an arrow, the return event of a
 * retention query, else the call's binding.
 *
 * @param call - The call.
 * @returns e.g. `"Signup" → "Note Saved"` or `"Note Shared"`.
 */
export function traceLabel(call: Call): string {
  const [first, second] = call.args;
  if (call.method === "queryFunnel" && Array.isArray(first)) {
    return first
      .filter((step): step is string => typeof step === "string")
      .map((step) => JSON.stringify(step))
      .join(" → ");
  }
  if (call.method === "queryRetention" && typeof second === "string") {
    return JSON.stringify(second);
  }
  return call.binding;
}

/**
 * The comment under the loop's `await` line: the iteration in flight with
 * its elapsed time, or — before any call has run — that none has. `null`
 * once the loop is done (the summary takes over) and for an empty loop.
 *
 * @param calls - The loop's calls in order, with their timings so far.
 * @param options - The call in flight, its elapsed time, the clock face.
 * @returns The line, or `null`.
 * @example
 * ```ts
 * liveTrace(calls, { current: 11, elapsedMs: 183, clock: "🕒" });
 * // { emoji: "🕒", text: '12 / 20 · "Signup" → "Note Saved" · 183 ms' }
 * ```
 */
export function liveTrace(
  calls: readonly TracedCall[],
  options: LiveTraceOptions,
): TraceLine | null {
  const total = String(calls.length);
  const { current } = options;
  const running = current === null ? undefined : calls[current];
  if (running !== undefined && current !== null) {
    const elapsed =
      options.elapsedMs === null
        ? ""
        : ` · ${formatDuration(options.elapsedMs)}`;
    return {
      emoji: options.clock,
      text: `${String(current + 1)} / ${total} · ${traceLabel(running.call)}${elapsed}`,
    };
  }
  const settled = calls.some((entry) => entry.durationMs !== null);
  if (calls.length === 0 || settled) {
    return null;
  }
  return { emoji: IDLE_EMOJI, text: `0 / ${total}` };
}

/**
 * The comment that closes a finished loop: how many queries ran, their
 * summed wall time, and the slowest one.
 *
 * @param calls - The loop's calls in order, with their timings.
 * @returns The line, or `null` when no call settled.
 * @example
 * ```ts
 * traceSummary(calls);
 * // { emoji: "✅", text: '20 queries · 4.2 s · slowest "Upgrade" → "Signup" 412 ms' }
 * ```
 */
export function traceSummary(calls: readonly TracedCall[]): TraceLine | null {
  const settled = calls.filter((entry) => entry.durationMs !== null);
  const slowest = settled.reduce<TracedCall | null>(
    (best, entry) =>
      best === null || (entry.durationMs ?? 0) > (best.durationMs ?? 0)
        ? entry
        : best,
    null,
  );
  if (slowest === null) {
    return null;
  }
  const total = settled.reduce(
    (sum, entry) => sum + (entry.durationMs ?? 0),
    0,
  );
  // A loop a fatal error stopped says how far it got.
  const count =
    settled.length === calls.length
      ? `${String(settled.length)} queries`
      : `${String(settled.length)} of ${String(calls.length)} queries`;
  return {
    emoji: DONE_EMOJI,
    text: `${count} · ${formatDuration(total)} · slowest ${traceLabel(slowest.call)} ${formatDuration(slowest.durationMs ?? 0)}`,
  };
}
