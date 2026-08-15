/**
 * Virtual clock, deterministic UUID stream, and virtual sleep (design
 * D12, mirroring the Python record/replay shims in
 * `conformance/record/clock.py` and design D1.4/D7).
 *
 * Both runners replay under the SAME frozen instant (`RECORD_EPOCH`, from
 * the corpus manifest) so date-defaulting code paths (`to_date=today`,
 * 30-day funnel windows, ...) reproduce the recorded payloads exactly.
 * Sleep is VIRTUAL, not a plain no-op: `sleep(d)` advances the frozen
 * clock (wall AND monotonic) by `d` and resolves immediately, so
 * wall-clock-deadline poll loops terminate after a deterministic,
 * machine-independent number of iterations and backoff vectors replay
 * instantly (D1.4).
 *
 * The UUID stream mirrors `DeterministicUuidStream`: counter-seeded
 * `00000000-0000-4000-8000-{seq:012d}` values in call order, starting at
 * sequence 0, reset per vector (a fresh {@link RunnerShims} is created for
 * every vector run).
 */

/** Template for the deterministic UUID stream (D1.4). */
const UUID_TEMPLATE_PREFIX = "00000000-0000-4000-8000-";

/**
 * The injectable clock/UUID/sleep surface handed to TS entry points at
 * replay (design D12: the TS client takes injectable `now()`/`today()`/
 * `uuid()`; the runner injects the record epoch and the deterministic
 * UUID stream).
 */
export interface RunnerShims {
  /**
   * The current VIRTUAL instant.
   *
   * @returns A `Date` at the record epoch plus all virtually slept time.
   */
  now(): Date;

  /**
   * The current virtual calendar date.
   *
   * @returns An ISO `YYYY-MM-DD` string (UTC, matching the frozen epoch).
   */
  today(): string;

  /**
   * The next deterministic UUID.
   *
   * @returns `00000000-0000-4000-8000-{seq:012d}` with `seq` starting at 0.
   */
  uuid(): string;

  /**
   * Virtually sleep: advance the frozen clock and resolve immediately.
   *
   * @param seconds - The requested sleep duration in seconds.
   * @returns A promise that resolves on the next microtask.
   */
  sleep(seconds: number): Promise<void>;

  /**
   * The virtual monotonic clock (frozen; advanced only by {@link sleep}).
   *
   * @returns Seconds elapsed on the virtual monotonic clock since the
   *   shims were created.
   */
  monotonic(): number;
}

/**
 * Create fresh per-vector shims (design D1.4/D7/D12).
 *
 * @param recordEpoch - The frozen record instant, ISO-8601 (the corpus
 *   manifest's `record_epoch`, e.g. `"2026-01-15T12:00:00Z"`).
 * @returns A {@link RunnerShims} with the clock frozen at `recordEpoch`,
 *   the UUID counter at 0, and zero virtual elapsed time.
 * @throws Error - If `recordEpoch` is not a parseable ISO-8601 instant.
 *
 * @example
 * ```typescript
 * const shims = createShims("2026-01-15T12:00:00Z");
 * shims.today();
 * // "2026-01-15"
 * shims.uuid();
 * // "00000000-0000-4000-8000-000000000000"
 * await shims.sleep(90);
 * shims.monotonic();
 * // 90
 * ```
 */
export function createShims(recordEpoch: string): RunnerShims {
  const epochMs = Date.parse(recordEpoch);
  if (Number.isNaN(epochMs)) {
    throw new Error(
      `invalid recordEpoch ${JSON.stringify(recordEpoch)}: not an ISO-8601 instant`,
    );
  }
  let elapsedSeconds = 0;
  let uuidCounter = 0;
  return {
    now(): Date {
      return new Date(epochMs + elapsedSeconds * 1000);
    },
    today(): string {
      const iso = new Date(epochMs + elapsedSeconds * 1000).toISOString();
      return iso.slice(0, 10);
    },
    uuid(): string {
      const seq = String(uuidCounter).padStart(12, "0");
      uuidCounter += 1;
      return `${UUID_TEMPLATE_PREFIX}${seq}`;
    },
    async sleep(seconds: number): Promise<void> {
      elapsedSeconds += seconds;
      await Promise.resolve();
    },
    monotonic(): number {
      return elapsedSeconds;
    },
  };
}
