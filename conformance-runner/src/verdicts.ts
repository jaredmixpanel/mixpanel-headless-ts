/**
 * The conformance verdict taxonomy and JSON report shape (design D12).
 *
 * Verdicts:
 * - `PASS` — replay matched the vector.
 * - `FAIL_OUTPUT` — the measured call's returned value (or a recorded
 *   callback's call log) diverged.
 * - `FAIL_REQUEST` — the request side diverged: wrong fields, extra or
 *   missing transport interactions anywhere across setup + measured.
 * - `FAIL_ERROR` — error-contract divergence: wrong/missing/unexpected
 *   raise, or structured error fields differ.
 * - `PRECISION_LOSS` — the ONLY divergence is double-rounding of integer
 *   tokens above 2^53 (D6; R4.5 escalation trigger).
 * - `UNPORTED` — target entry point known (api-index universe) but not yet
 *   bound to a TS implementation; counted, never failing, while the
 *   module's port batch is `'pending'` in `batch-status.ts`. Once the
 *   batch is declared `'done'` there, an unbound name is a straggler and
 *   the runner returns `FAIL_ERROR` instead (R10.5).
 * - `UNMAPPED_API` — the api name is in NO mapping source; always failing
 *   (naming-map §4).
 */

/** One vector's replay verdict. */
export type Verdict =
  | "PASS"
  | "FAIL_OUTPUT"
  | "FAIL_REQUEST"
  | "FAIL_ERROR"
  | "PRECISION_LOSS"
  | "UNPORTED"
  | "UNMAPPED_API";

/** The verdicts that count as failures in the report. */
const FAILING_VERDICTS: ReadonlySet<Verdict> = new Set([
  "FAIL_OUTPUT",
  "FAIL_REQUEST",
  "FAIL_ERROR",
  "PRECISION_LOSS",
  "UNMAPPED_API",
]);

/** The outcome of replaying one vector. */
export interface VectorResult {
  /** The vector id. */
  readonly id: string;
  /** The corpus capability (from the vector, or its id prefix). */
  readonly capability: string;
  /** The verdict. */
  readonly verdict: Verdict;
  /** Human-readable divergence description (failing verdicts only). */
  readonly diff?: string;
}

/** One failure row in the JSON report (design D12 reporting). */
export interface ReportFailure {
  /** The vector id. */
  readonly id: string;
  /** The failing verdict. */
  readonly verdict: Verdict;
  /** The divergence description. */
  readonly diff: string;
}

/** The `--report json` shape (design D12). */
export interface ConformanceReport {
  /** Total vectors replayed. */
  readonly total: number;
  /** Vectors with verdict `PASS`. */
  readonly passed: number;
  /** Vectors with a failing verdict (FAIL_*, PRECISION_LOSS, UNMAPPED_API). */
  readonly failed: number;
  /** Vectors with verdict `UNPORTED` (counted, never failing). */
  readonly skipped_unported: number;
  /** One row per failing vector, in replay order. */
  readonly failures: readonly ReportFailure[];
}

/**
 * Whether a verdict counts as a failure (design D12).
 *
 * @param verdict - The verdict to classify.
 * @returns `true` for `FAIL_*`, `PRECISION_LOSS`, and `UNMAPPED_API`.
 */
export function isFailingVerdict(verdict: Verdict): boolean {
  return FAILING_VERDICTS.has(verdict);
}

/**
 * Fold per-vector results into the D12 JSON report.
 *
 * @param results - All vector results, in replay order.
 * @returns The aggregate report.
 * @example
 * ```typescript
 * summarizeResults([{ id: "a", capability: "compat", verdict: "PASS" }]);
 * // { total: 1, passed: 1, failed: 0, skipped_unported: 0, failures: [] }
 * ```
 */
export function summarizeResults(
  results: readonly VectorResult[],
): ConformanceReport {
  let passed = 0;
  let skipped = 0;
  const failures: ReportFailure[] = [];
  for (const result of results) {
    if (result.verdict === "PASS") {
      passed += 1;
    } else if (result.verdict === "UNPORTED") {
      skipped += 1;
    } else {
      failures.push({
        id: result.id,
        verdict: result.verdict,
        diff: result.diff ?? "",
      });
    }
  }
  return {
    total: results.length,
    passed,
    failed: failures.length,
    skipped_unported: skipped,
    failures,
  };
}
