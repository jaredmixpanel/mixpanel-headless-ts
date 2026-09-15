// fast-check twins of `tests/unit/test_query_validation_pbt.py`: `validateQueryArgs`
// reports the same time and group-by errors as `validateTimeArgs` /
// `validateGroupByArgs` for the same inputs. Hypothesis
// `@settings(max_examples=100)` → `numRuns: 100` with the same strategy shapes.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { codepoints } from "../../src/compat/codepoint.js";
import { ParamValidationError } from "../../src/errors.js";
import {
  validateGroupByArgs,
  validateQueryArgs,
  validateTimeArgs,
} from "../../src/query/validation-args.js";
import { GroupBy } from "../../src/types/index.js";

// --- Strategies (test_query_validation_pbt.py) ---

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

/**
 * Representative alphabet for `st.characters(categories=("L", "N"))`,
 * split on code points (the non-BMP member must never yield a lone
 * surrogate).
 *
 * fast-check has no Unicode-category generator, so this is a NARROWED
 * stand-in:
 * ASCII letters/digits plus explicit non-ASCII category-L/N members —
 * é (Ll), Ω (Lu), ж (Ll), 中 (Lo), ٤ (Nd), Ⅻ (Nl) and the non-BMP
 * 𝒳 (U+1D4B3, Lu) — every entry strictly inside Python's L/N domain.
 * Full-Unicode cross-language behavior is additionally locked by the
 * Python-side differential-fuzz strategies (non-BMP edges).
 */
const LN_CHARS: readonly string[] = codepoints(
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789éΩж中٤Ⅻ𝒳",
);

/** Port of `property_names` (min_size=1, max_size=30, categories L/N). */
const propertyNamesArb: fc.Arbitrary<string> = fc
  .array(fc.integer({ min: 0, max: LN_CHARS.length - 1 }), {
    minLength: 1,
    maxLength: 30,
  })
  .map((idxs) => idxs.map((i) => LN_CHARS[i] ?? "a").join(""));

/** Port of `property_types`. */
const propertyTypesArb = fc.constantFrom(
  "string",
  "number",
  "boolean",
  "datetime",
);

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

// --- Time Validation Equivalence ---

describe("Time validation equivalence", () => {
  // python: TestTimeValidationEquivalence
  it("time errors match", () => {
    // python: test_time_errors_match
    fc.assert(
      fc.property(
        maybeDatesArb,
        maybeDatesArb,
        lastValuesArb,
        (fromDate, toDate, last) => {
          const standaloneCodes = new Set(
            validateTimeArgs({
              from_date: fromDate,
              to_date: toDate,
              last,
            }).map((e) => e.code),
          );
          const monolithicTimeCodes = new Set(
            validateQueryArgs({
              events: ["TestEvent"],
              math: "total",
              math_property: null,
              per_user: null,
              from_date: fromDate,
              to_date: toDate,
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
            `Mismatch for from_date=${JSON.stringify(fromDate)}, ` +
              `to_date=${JSON.stringify(toDate)}, last=${String(last)}`,
          ).toStrictEqual(monolithicTimeCodes);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- GroupBy Validation Equivalence ---

describe("Group by validation equivalence", () => {
  // python: TestGroupByValidationEquivalence
  it("groupby errors match", () => {
    // python: test_groupby_errors_match
    fc.assert(
      fc.property(
        propertyNamesArb,
        propertyTypesArb,
        bucketSizesArb,
        bucketBoundsArb,
        bucketBoundsArb,
        (prop, propType, bucketSize, bucketMin, bucketMax) => {
          let g: GroupBy;
          try {
            g = new GroupBy({
              property: prop,
              property_type: propType,
              bucket_size: bucketSize,
              bucket_min: bucketMin,
              bucket_max: bucketMax,
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
              `type=${JSON.stringify(propType)}, size=${String(bucketSize)}, ` +
              `min=${String(bucketMin)}, max=${String(bucketMax)})`,
          ).toStrictEqual(monolithicGroupCodes);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("null groupby no errors", () => {
    // python: test_none_groupby_no_errors
    const errors = validateGroupByArgs({ group_by: null });
    expect(errors).toStrictEqual([]);
  });

  it("string groupby no errors", () => {
    // python: test_string_groupby_no_errors
    const errors = validateGroupByArgs({ group_by: "country" });
    expect(errors).toStrictEqual([]);
  });
});
