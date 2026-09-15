// Layer-3 translation of tests/unit/test_api_client.py::TestParseRetryAfter
// (:3499-3551) and ::TestRetryWaitSeconds (:3554-3592) — the B0-2
// retry/backoff trio unit locks (playbook B0-2 table row; loop-level
// hardening lives in internals.test.ts / app-request.test.ts).
//
// Entry-point substitution (B0-notes decision 13): Python drives client
// methods (`client._parse_retry_after(response)` etc.); the TS trio are
// free functions with the RNG injected (playbook: jitter behind an
// injectable RNG; conformance/tests inject a fixed source).
import { describe, expect, it } from "vitest";

import {
  calculateBackoff,
  parseRetryAfter,
  retryWaitSeconds,
} from "../../src/client/backoff.js";

/**
 * Build the minimal header carrier `parseRetryAfter` reads.
 *
 * @param retryAfter - The Retry-After header value, or none.
 * @returns A response-like carrier with case-insensitive lookup.
 */
function response(retryAfter?: string): {
  header: (name: string) => string | null;
} {
  return {
    header(name: string): string | null {
      if (retryAfter !== undefined && name.toLowerCase() === "retry-after") {
        return retryAfter;
      }
      return null;
    },
  };
}

/** Fixed RNG: kills jitter (uniform(0, x) -> 0). */
const zeroRandom = (): number => 0;

describe("TestParseRetryAfter", () => {
  it("test_parses_positive_integer", () => {
    expect(parseRetryAfter(response("7"))).toBe(7);
  });

  it("test_parses_zero", () => {
    // "Retry-After: 0" means "retry immediately" and is preserved.
    expect(parseRetryAfter(response("0"))).toBe(0);
  });

  it("test_missing_header_returns_none", () => {
    expect(parseRetryAfter(response())).toBeNull();
  });

  it.each([
    "abc",
    "5.5",
    "",
    "Wed, 21 Oct 2015 07:28:00 GMT",
    "1e3",
    "0x10",
    "nan",
  ])("test_unparseable_header_returns_none(%j)", (raw) => {
    // Non-integer header values are treated as absent (CPython int()
    // grammar via pythonInt, R11.3).
    expect(parseRetryAfter(response(raw))).toBeNull();
  });

  it.each(["-1", "-3600"])("test_negative_header_returns_none(%j)", (raw) => {
    // A negative Retry-After is invalid and must not reach the sleep seam.
    expect(parseRetryAfter(response(raw))).toBeNull();
  });

  // CPython int() accepts underscores, surrounding whitespace, and
  // non-ASCII Nd digits — attacker-controlled input parses with the FULL
  // Python grammar (playbook B0-1 item 1 rationale).
  it("parses with the CPython int grammar (underscores/whitespace/Nd)", () => {
    expect(parseRetryAfter(response("1_0"))).toBe(10);
    expect(parseRetryAfter(response("  7  "))).toBe(7);
    expect(parseRetryAfter(response("٤٢"))).toBe(42);
    expect(parseRetryAfter(response("+3"))).toBe(3);
  });
});

describe("TestRetryWaitSeconds", () => {
  it("test_none_falls_back_to_backoff", () => {
    // Python: pytest.approx(client._calculate_backoff(0), rel=0.2) — with
    // the injected RNG both sides are deterministic and exactly equal.
    expect(retryWaitSeconds(null, 0, zeroRandom)).toBe(
      calculateBackoff(0, zeroRandom),
    );
  });

  it("test_honors_reasonable_header", () => {
    expect(retryWaitSeconds(5, 3, zeroRandom)).toBe(5.0);
  });

  it("test_zero_header_is_honored", () => {
    // "Retry-After: 0" sleeps zero seconds rather than backing off.
    expect(retryWaitSeconds(0, 5, zeroRandom)).toBe(0.0);
  });

  it.each([61, 3600, 86400, 2 ** 40])(
    "test_huge_header_is_capped(%d)",
    (retryAfter) => {
      expect(retryWaitSeconds(retryAfter, 0, zeroRandom)).toBe(60.0);
    },
  );

  it("test_wait_never_exceeds_cap_for_late_attempts", () => {
    // The backoff fallback still honors its own ceiling plus jitter
    // (max jitter = 10% of the 60s cap).
    expect(retryWaitSeconds(null, 40, () => 1)).toBeLessThanOrEqual(66.0);
  });
});

// calculateBackoff formula lock (api_client.py:664-681):
// min(1.0 * 2^attempt, 60.0) + uniform(0, delay * 0.1); jitter rides the
// FALLBACK path only (rulebook Discrepancy #1 resolution — port source
// truth, injectable RNG).
describe("calculateBackoff", () => {
  it("doubles from 1s and caps at 60s (zero jitter)", () => {
    expect(calculateBackoff(0, zeroRandom)).toBe(1.0);
    expect(calculateBackoff(1, zeroRandom)).toBe(2.0);
    expect(calculateBackoff(2, zeroRandom)).toBe(4.0);
    expect(calculateBackoff(6, zeroRandom)).toBe(60.0);
    expect(calculateBackoff(40, zeroRandom)).toBe(60.0);
  });

  it("adds uniform(0, delay*0.1) jitter from the injected RNG", () => {
    // random() = 1 -> jitter = delay * 0.1 exactly.
    expect(calculateBackoff(0, () => 1)).toBe(1.1);
    expect(calculateBackoff(2, () => 0.5)).toBe(4.2);
    expect(calculateBackoff(6, () => 1)).toBe(66.0);
  });

  it("header path never jitters (retryWaitSeconds ignores the RNG)", () => {
    expect(retryWaitSeconds(59, 0, () => 1)).toBe(59.0);
  });
});
