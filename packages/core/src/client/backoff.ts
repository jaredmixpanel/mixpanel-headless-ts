/**
 * Rate-limit retry timing trio — TS port of
 * `MixpanelAPIClient._calculate_backoff` (`api_client.py:664-681`),
 * `_retry_wait_seconds` (`:683-704`), and `_parse_retry_after`
 * (`:1159-1185`) — Phase-3 packet B0-2, R10.8 (ported once, by name;
 * the B0/B4 retry loops import these, never re-derive them).
 *
 * Units (R2.12): everything in THIS module speaks Python's seconds — the
 * single seconds→milliseconds conversion happens at the sleep-seam call
 * sites (`sleep(seconds * 1000)` in `executeWithRetry`/`appRequest`).
 *
 * Jitter (rulebook Discrepancy #1, resolved to source truth): the
 * exponential FALLBACK path jitters via an injectable RNG; a
 * server-supplied Retry-After is honored verbatim (capped) with NO
 * jitter. Conformance bindings inject `random: () => 0`.
 */

import { MixpanelHeadlessError } from "../errors.js";
import { pythonInt } from "../compat/index.js";

/**
 * Exponential-backoff bounds shared by {@link calculateBackoff} and the
 * Retry-After clamp (Python `_BACKOFF_BASE_SECONDS` /
 * `_BACKOFF_MAX_SECONDS`, `api_client.py:77-78`). A server-supplied
 * Retry-After is honored up to the max; anything larger would park the
 * process for hours.
 */
export const BACKOFF_BASE_SECONDS = 1.0;

/** See {@link BACKOFF_BASE_SECONDS}. */
export const BACKOFF_MAX_SECONDS = 60.0;

/** Uniform-[0,1) random source (the `random.uniform` seam, R6.3-style). */
export type RandomSource = () => number;

/** The slice of a response `parseRetryAfter` reads (case-insensitive). */
export interface HeaderCarrier {
  /**
   * Look up a response header by name, case-insensitively (httpx
   * `Headers.get` semantics).
   *
   * @param name - Header name.
   * @returns The header value, or `null` when absent.
   */
  header(name: string): string | null;
}

/**
 * Calculate the exponential backoff delay with jitter — TS port of
 * `_calculate_backoff`.
 *
 * Formula: `min(1.0 * 2^attempt, 60.0) + uniform(0, delay * 0.1)`
 * (the jitter prevents thundering herd; `random.uniform(0, x)` ports as
 * `random() * x` from the injected source).
 *
 * @param attempt - Zero-based attempt number (0, 1, 2, ...).
 * @param random - Injected uniform-[0,1) source.
 * @returns Delay in seconds including jitter.
 */
export function calculateBackoff(
  attempt: number,
  random: RandomSource,
): number {
  const delay = Math.min(
    BACKOFF_BASE_SECONDS * 2 ** attempt,
    BACKOFF_MAX_SECONDS,
  );
  const jitter = random() * (delay * 0.1);
  return delay + jitter;
}

/**
 * Resolve how long to wait before retrying a rate-limited request — TS
 * port of `_retry_wait_seconds`.
 *
 * `Retry-After` is server-controlled and therefore untrusted input.
 * {@link parseRetryAfter} already rejects unparseable and negative
 * values; this function additionally caps an implausibly large header
 * (`Retry-After: 86400`) at the same ceiling the exponential backoff
 * uses, so a single header can never park the process for hours.
 *
 * @param retryAfter - Validated Retry-After value in seconds, or `null`
 *   when the header was absent or unusable.
 * @param attempt - Zero-based attempt number, used for the backoff
 *   fallback.
 * @param random - Injected RNG for the fallback's jitter (header path
 *   never jitters).
 * @returns A non-negative delay in seconds, at most
 *   {@link BACKOFF_MAX_SECONDS} when it came from the header (the
 *   backoff fallback adds its own jitter on top of that ceiling).
 */
export function retryWaitSeconds(
  retryAfter: number | null,
  attempt: number,
  random: RandomSource,
): number {
  if (retryAfter === null) {
    return calculateBackoff(attempt, random);
  }
  return Math.min(retryAfter, BACKOFF_MAX_SECONDS);
}

/**
 * Parse the Retry-After header if present and usable — TS port of
 * `_parse_retry_after`.
 *
 * The header is attacker-controllable, so anything that is not a
 * non-negative integer count of seconds is treated as absent. In
 * particular a negative value is rejected: it would reach the sleep seam
 * and would be echoed as `RateLimitError.retry_after`, whose documented
 * usage is `sleep(exc.retry_after or 60)`. HTTP-date form is not
 * supported and also reads as absent.
 *
 * Parsing uses the FULL CPython `int(str)` grammar via `pythonInt`
 * (R11.3): underscores between digits, surrounding Python whitespace,
 * signs, and non-ASCII Nd digits all parse exactly as in Python. The one
 * sanctioned divergence (B0-notes decision 7, arbiter-blessed as
 * playbook Discrepancy #6 — b0-review-resolution F2): a hostile header
 * beyond 2^53 − 1 throws `PY_INT_UNSAFE_INTEGER` inside `pythonInt` and
 * reads as absent here, where CPython parses the raw big int (sleeping
 * the capped 60s and reporting it in `RateLimitError.retry_after`). The
 * 60s cap keeps the sleep path behaviorally inert; the detail-bag delta
 * (`retry_after: null` vs the huge int) exists only in that corner and
 * is never vector-asserted.
 *
 * @param response - Response carrying the headers.
 * @returns Seconds to wait as a non-negative integer, or `null` when the
 *   header is missing, unparseable, or negative.
 */
export function parseRetryAfter(response: HeaderCarrier): number | null {
  const retryAfter = response.header("Retry-After");
  if (retryAfter !== null) {
    let parsed: number;
    try {
      parsed = pythonInt(retryAfter);
    } catch (cause) {
      // Python: `except ValueError: return None`. pythonInt's coded
      // errors (PY_INT_INVALID_LITERAL / PY_INT_UNSAFE_INTEGER) are the
      // ValueError analog; anything else is a programming error.
      if (cause instanceof MixpanelHeadlessError) {
        return null;
      }
      throw cause;
    }
    if (parsed >= 0) {
      return parsed;
    }
  }
  return null;
}
