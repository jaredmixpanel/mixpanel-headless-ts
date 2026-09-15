/**
 * Rate-limit retry timing — exponential backoff, the Retry-After clamp and
 * the Retry-After parser — shared by every retry loop in the package.
 * Everything here speaks Python's seconds; the one seconds→milliseconds
 * conversion sits at the sleep-seam call sites (`executeWithRetry`,
 * `appRequest`). The exponential fallback jitters through an injectable
 * RNG; a server-supplied Retry-After is honoured verbatim (capped) with
 * no jitter. The conformance bindings inject `random: () => 0`.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient._retry_wait_seconds
 */

import { pythonInt } from "../compat/index.js";
import { MixpanelHeadlessError } from "../errors.js";

/**
 * Exponential-backoff bounds shared by {@link calculateBackoff} and the
 * Retry-After clamp (Python `_BACKOFF_BASE_SECONDS` /
 * `_BACKOFF_MAX_SECONDS`). A server-supplied
 * Retry-After is honored up to the max; anything larger would park the
 * process for hours.
 */
const BACKOFF_BASE_SECONDS = 1.0;

/** See {@link BACKOFF_BASE_SECONDS}. */
export const BACKOFF_MAX_SECONDS = 60.0;

/** Uniform-[0,1) random source (the `random.uniform` seam). */
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
  header: (name: string) => string | null;
}

/**
 * Calculate the exponential backoff delay with jitter.
 *
 * @remarks
 * Formula: `min(1.0 * 2^attempt, 60.0) + uniform(0, delay * 0.1)`. The
 * jitter prevents a thundering herd; `random.uniform(0, x)` ports as
 * `random() * x` from the injected source.
 * @param attempt - Zero-based attempt number (0, 1, 2, …).
 * @param random - Injected uniform-[0, 1) source.
 * @returns Delay in seconds including jitter.
 * @example
 * ```typescript
 * calculateBackoff(2, () => 0); // 4
 * calculateBackoff(2, () => 0.5); // 4.2
 * ```
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient._calculate_backoff
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
 * Resolve how long to wait before retrying a rate-limited request.
 *
 * @remarks
 * `Retry-After` is server-controlled and therefore untrusted input.
 * {@link parseRetryAfter} already rejects unparseable and negative
 * values; this function additionally caps an implausibly large header
 * (`Retry-After: 86400`) at the same ceiling the exponential backoff
 * uses, so a single header can never park the process for hours.
 * @param retryAfter - Validated Retry-After value in seconds, or `null`
 *   when the header was absent or unusable.
 * @param attempt - Zero-based attempt number, used for the backoff
 *   fallback.
 * @param random - Injected RNG for the fallback's jitter (header path
 *   never jitters).
 * @returns A non-negative delay in seconds, at most
 *   {@link BACKOFF_MAX_SECONDS} when it came from the header (the
 *   backoff fallback adds its own jitter on top of that ceiling).
 * @example
 * ```typescript
 * retryWaitSeconds(120, 0, Math.random); // 60 (capped, no jitter)
 * retryWaitSeconds(null, 1, () => 0); // 2 (exponential fallback)
 * ```
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient._retry_wait_seconds
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
 * Parse the `Retry-After` header when present and usable.
 *
 * @remarks
 * The header is attacker-controllable, so anything that is not a
 * non-negative integer count of seconds is treated as absent. In
 * particular a negative value is rejected: it would reach the sleep seam
 * and would be echoed as `RateLimitError.retry_after`, whose documented
 * usage is `sleep(exc.retry_after or 60)`. HTTP-date form is not
 * supported and also reads as absent. Parsing uses the full CPython
 * `int(str)` grammar via `pythonInt`: underscores between digits,
 * surrounding Python whitespace, signs, and non-ASCII Nd digits all parse
 * exactly as in Python. Divergence: a header beyond 2^53 − 1 reads as
 * absent (`pythonInt` rejects it with `PY_INT_UNSAFE_INTEGER`), where
 * CPython parses the raw big int, sleeps the capped 60 s and reports it
 * in `RateLimitError.retry_after`. The cap keeps the sleep path
 * identical; only the detail bag differs (`retry_after: null` vs the
 * huge int).
 * @param response - Response carrying the headers.
 * @returns Seconds to wait as a non-negative integer, or `null` when the
 *   header is missing, unparseable, or negative.
 * @throws Any non-`MixpanelHeadlessError` raised by `pythonInt`, unchanged
 *   (a programming error, never a header value).
 * @example
 * ```typescript
 * parseRetryAfter({ header: () => "30" }); // 30
 * parseRetryAfter({ header: () => "-5" }); // null
 * parseRetryAfter({ header: () => null }); // null
 * ```
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient._parse_retry_after
 */
export function parseRetryAfter(response: HeaderCarrier): number | null {
  const retryAfter = response.header("Retry-After");
  if (retryAfter !== null) {
    let parsed: number;
    try {
      parsed = pythonInt(retryAfter);
    } catch (error) {
      // Python: `except ValueError: return None`. pythonInt's coded
      // errors (PY_INT_INVALID_LITERAL / PY_INT_UNSAFE_INTEGER) are the
      // ValueError analog; anything else is a programming error.
      if (error instanceof MixpanelHeadlessError) {
        return null;
      }
      throw error;
    }
    if (parsed >= 0) {
      return parsed;
    }
  }
  return null;
}
