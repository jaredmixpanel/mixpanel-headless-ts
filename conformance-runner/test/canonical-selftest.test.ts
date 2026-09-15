// Selftest-driven suite for the D6 canonicalizer (design D6/D12, TS-3).
//
// Iterates every case in the shared `canonical-selftest.json` — the
// cross-language contract artifact authored by Python task PR-4 and
// executed on the Python side by conformance/tests/test_canonical_selftest.py
// — through the TS canonicalizer. Dispatch per case `kind` follows the
// selftest file's own `$comment` prescription: `value`/`error`/`interactions`
// compare canonical strings, `headers` compares the match verdict, `reject`
// expects CanonicalizationError. Every case's `input_json` is parsed with
// the LOSSLESS loader so raw number tokens survive (D6 rule 3 — plain
// `JSON.parse` would collapse `18.0` to `18` and fail the float-token cases
// by design).
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CanonicalizationError,
  canonicalize,
  canonicalizeError,
  canonicalizeInteractions,
  headersMatch,
} from "../src/canonical.js";
import type { JsonValue } from "../src/json-value.js";
import { parseLossless } from "../src/lossless-json.js";
import { resolveSelftestPath } from "../src/selftest-path.js";

/** One case object from `canonical-selftest.json` (shape per PR-4). */
interface SelftestCase {
  /** Unique case id, used as the test name. */
  readonly id: string;
  /** Dispatch kind: value | error | interactions | headers | reject. */
  readonly kind: string;
  /** Raw JSON text of the input value (absent for `special` rejects). */
  readonly input_json?: string;
  /** Expected canonical string (value/error/interactions kinds). */
  readonly canonical?: string;
  /** Expected-header object (headers kind). */
  readonly headers_contain?: Record<string, JsonValue>;
  /** Actual-header map (headers kind). */
  readonly actual_headers?: Record<string, string>;
  /** Expected match verdict (headers kind). */
  readonly matches?: boolean;
  /** Non-finite double spelling (reject kind without input_json). */
  readonly special?: string;
  /** Free-form rationale (not used by the harness). */
  readonly notes?: string;
}

/** The selftest document shape. */
interface SelftestDocument {
  /** Selftest schema version stamp. */
  readonly schema_version: string;
  /** The case list, executed in file order. */
  readonly cases: readonly SelftestCase[];
}

/** Non-finite doubles constructible only via the `special` field. */
const SPECIAL_FLOATS: Readonly<Record<string, number>> = {
  nan: Number.NaN,
  infinity: Number.POSITIVE_INFINITY,
  negative_infinity: Number.NEGATIVE_INFINITY,
};

const SELFTEST_PATH = resolveSelftestPath();
const DOCUMENT = JSON.parse(
  readFileSync(SELFTEST_PATH, "utf8"),
) as SelftestDocument;

/**
 * Read a required case field, failing the test with context when absent.
 *
 * @param testCase - The selftest case under execution.
 * @param field - The field name to read.
 * @returns The field value.
 * @throws Error - If the field is missing (malformed selftest case).
 */
function required<K extends keyof SelftestCase>(
  testCase: SelftestCase,
  field: K,
): NonNullable<SelftestCase[K]> {
  const value = testCase[field];
  if (value === undefined) {
    throw new Error(
      `selftest case ${testCase.id} is missing required field ${field}`,
    );
  }
  return value;
}

describe(`canonical-selftest.json (${DOCUMENT.cases.length} cases from ${SELFTEST_PATH})`, () => {
  it("carries the ~40-case coverage the design mandates (D6)", () => {
    expect(DOCUMENT.cases.length).toBeGreaterThanOrEqual(40);
  });

  it("has unique case ids", () => {
    const ids = DOCUMENT.cases.map((testCase) => testCase.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const testCase of DOCUMENT.cases) {
    it(`${testCase.kind}: ${testCase.id}`, () => {
      switch (testCase.kind) {
        case "value": {
          const input = parseLossless(required(testCase, "input_json"));
          expect(canonicalize(input)).toBe(required(testCase, "canonical"));
          break;
        }
        case "error": {
          const input = parseLossless(required(testCase, "input_json"));
          expect(canonicalizeError(input)).toBe(
            required(testCase, "canonical"),
          );
          break;
        }
        case "interactions": {
          const input = parseLossless(required(testCase, "input_json"));
          expect(Array.isArray(input)).toBe(true);
          expect(canonicalizeInteractions(input as JsonValue[])).toBe(
            required(testCase, "canonical"),
          );
          break;
        }
        case "headers": {
          const verdict = headersMatch(
            required(testCase, "headers_contain"),
            required(testCase, "actual_headers"),
          );
          expect(verdict).toBe(required(testCase, "matches"));
          break;
        }
        case "reject": {
          const value =
            testCase.special === undefined
              ? parseLossless(required(testCase, "input_json"))
              : SPECIAL_FLOATS[testCase.special];
          expect(value).toBeDefined();
          expect(() => canonicalize(value as JsonValue)).toThrow(
            CanonicalizationError,
          );
          break;
        }
        default: {
          throw new Error(`unknown selftest case kind ${testCase.kind}`);
        }
      }
    });
  }
});
