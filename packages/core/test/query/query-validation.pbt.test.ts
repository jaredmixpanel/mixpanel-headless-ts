/**
 * Layer-3 translation of `tests/unit/test_query_validation_pbt.py`
 * (Python revision: `ts-port/phase2-contract-support` HEAD; 237 LOC,
 * translated in full per b2-packets.md §V1a).
 *
 * Hypothesis `@given` + `@settings(max_examples=100)` translates to
 * fast-check `fc.assert(fc.property(...), { numRuns: 100 })` with the
 * same strategy shapes (phase2 `account.pbt.test.ts` precedent).
 *
 * Verifies that `validateQueryArgs` includes the same time- and
 * group-by-related validation errors produced by `validateTimeArgs` and
 * `validateGroupByArgs` for the same inputs.
 */

import fc from "fast-check";
import { describe, it, expect } from "vitest";
import { GroupBy } from "../../src/types/index.js";
import { ParamValidationError } from "../../src/errors.js";
import {
  validateGroupByArgs,
  validateQueryArgs,
  validateTimeArgs,
} from "../../src/query/validation-args.js";

// =============================================================================
// Strategies (test_query_validation_pbt.py:26-84)
// =============================================================================

/**
 * Port of `st.from_regex(r"20[2-3][0-9]-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])")`
 * — built compositionally because fast-check has no regex arbitrary.
 */
const validDatesArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 2020, max: 2039 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 31 }),
  )
  .map(
    ([y, m, d]) =>
      `${String(y)}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
  );

/** Port of the `invalid_dates` sampled_from strategy. */
const invalidDatesArb: fc.Arbitrary<string> = fc.constantFrom(
  "01/01/2024",
  "Jan 15 2025",
  "2024-13-01",
  "2024-02-30",
  "not-a-date",
  "",
  "2024/01/01",
);

/** Port of `maybe_dates = st.one_of(valid_dates, invalid_dates, st.none())`. */
const maybeDatesArb: fc.Arbitrary<string | null> = fc.oneof(
  validDatesArb,
  invalidDatesArb,
  fc.constant(null),
);

/** Port of `last_values = st.integers(min_value=-100, max_value=5000)`. */
const lastValuesArb = fc.integer({ min: -100, max: 5000 });

/** Letters + digits, mirroring `st.characters(categories=("L", "N"))`. */
const LN_ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

/** Port of `property_names` (min_size=1, max_size=30, categories L/N). */
const propertyNamesArb: fc.Arbitrary<string> = fc
  .array(fc.integer({ min: 0, max: LN_ALPHABET.length - 1 }), {
    minLength: 1,
    maxLength: 30,
  })
  .map((idxs) => idxs.map((i) => LN_ALPHABET[i] ?? "a").join(""));

/** Port of `property_types`. */
const propertyTypesArb = fc.constantFrom(
  "string",
  "number",
  "boolean",
  "datetime",
) as fc.Arbitrary<"string" | "number" | "boolean" | "datetime">;

/** Port of `bucket_sizes` (None | float in [-10, 100] | NaN | inf). */
const bucketSizesArb: fc.Arbitrary<number | null> = fc.oneof(
  fc.constant(null),
  fc.double({ min: -10, max: 100, noNaN: true, noDefaultInfinity: true }),
  fc.constant(Number.NaN),
  fc.constant(Number.POSITIVE_INFINITY),
);

/** Port of `bucket_bounds` (None | float in [-1000, 1000] | NaN | inf). */
const bucketBoundsArb: fc.Arbitrary<number | null> = fc.oneof(
  fc.constant(null),
  fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true }),
  fc.constant(Number.NaN),
  fc.constant(Number.POSITIVE_INFINITY),
);

/** Port of `TIME_ERROR_CODES`. */
const TIME_ERROR_CODES: ReadonlySet<string> = new Set([
  "V7_LAST_POSITIVE",
  "V8_DATE_FORMAT",
  "V8_DATE_INVALID",
  "V9_TO_REQUIRES_FROM",
  "V10_DATE_LAST_EXCLUSIVE",
  "V15_DATE_ORDER",
  "V20_LAST_TOO_LARGE",
]);

/** Port of `GROUP_ERROR_CODES`. */
const GROUP_ERROR_CODES: ReadonlySet<string> = new Set([
  "V11_BUCKET_REQUIRES_SIZE",
  "V12_BUCKET_SIZE_POSITIVE",
  "V12B_BUCKET_REQUIRES_NUMBER",
  "V12C_BUCKET_REQUIRES_BOUNDS",
  "V18_BUCKET_ORDER",
  "V24_BUCKET_NOT_FINITE",
]);

// =============================================================================
// Time Validation Equivalence
// =============================================================================

describe("TestTimeValidationEquivalence", () => {
  it("test_time_errors_match", () => {
    fc.assert(
      fc.property(
        maybeDatesArb,
        maybeDatesArb,
        lastValuesArb,
        (from_date, to_date, last) => {
          const standaloneCodes = new Set(
            validateTimeArgs({ from_date, to_date, last }).map((e) => e.code),
          );
          const monolithicTimeCodes = new Set(
            validateQueryArgs({
              events: ["TestEvent"],
              math: "total",
              math_property: null,
              per_user: null,
              from_date,
              to_date,
              last,
              has_formula: false,
              rolling: null,
              cumulative: false,
              group_by: null,
            })
              .map((e) => e.code)
              .filter((c) => TIME_ERROR_CODES.has(c)),
          );
          expect(
            standaloneCodes,
            `Mismatch for from_date=${JSON.stringify(from_date)}, ` +
              `to_date=${JSON.stringify(to_date)}, last=${String(last)}`,
          ).toEqual(monolithicTimeCodes);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// GroupBy Validation Equivalence
// =============================================================================

describe("TestGroupByValidationEquivalence", () => {
  it("test_groupby_errors_match", () => {
    fc.assert(
      fc.property(
        propertyNamesArb,
        propertyTypesArb,
        bucketSizesArb,
        bucketBoundsArb,
        bucketBoundsArb,
        (prop, prop_type, bucket_size, bucket_min, bucket_max) => {
          let g: GroupBy;
          try {
            g = new GroupBy({
              property: prop,
              property_type: prop_type,
              bucket_size,
              bucket_min,
              bucket_max,
            });
          } catch (error) {
            // The constructor guard rejected this combination
            // (bucket_size <= 0, bucket_min >= bucket_max, or empty
            // property) — Python raises ValueError, the port raises
            // ParamValidationError.
            if (error instanceof ParamValidationError) {
              return;
            }
            throw error;
          }

          const standaloneCodes = new Set(
            validateGroupByArgs({ group_by: g }).map((e) => e.code),
          );
          const monolithicGroupCodes = new Set(
            validateQueryArgs({
              events: ["TestEvent"],
              math: "total",
              math_property: null,
              per_user: null,
              from_date: null,
              to_date: null,
              last: 30,
              has_formula: false,
              rolling: null,
              cumulative: false,
              group_by: g,
            })
              .map((e) => e.code)
              .filter((c) => GROUP_ERROR_CODES.has(c)),
          );
          expect(
            standaloneCodes,
            `Mismatch for GroupBy(${JSON.stringify(prop)}, ` +
              `type=${JSON.stringify(prop_type)}, size=${String(bucket_size)}, ` +
              `min=${String(bucket_min)}, max=${String(bucket_max)})`,
          ).toEqual(monolithicGroupCodes);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("test_none_groupby_no_errors", () => {
    const errors = validateGroupByArgs({ group_by: null });
    expect(errors).toEqual([]);
  });

  it("test_string_groupby_no_errors", () => {
    const errors = validateGroupByArgs({ group_by: "country" });
    expect(errors).toEqual([]);
  });
});
