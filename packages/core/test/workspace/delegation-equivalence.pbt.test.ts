/**
 * B6-W3 Layer-3 translation (packet `b6-packets.md` §5) of
 * `tests/unit/test_delegation_equivalence_pbt.py` — the WHOLE file:
 * `TestFunnelDelegation` (:102), `TestRetentionDelegation` (:152),
 * `TestMathPropertyMatrix` (:204) and `TestEventNameConsistency`
 * (:337).
 *
 * The second CROSS-ENTITY suite W3 owns. It is TIER-INDEPENDENT: every
 * surface it touches (`validateTimeArgs`, `validateFunnelArgs`,
 * `validateRetentionArgs`, `validateQueryArgs`, `validateFlowArgs` plus
 * the `bookmarks/enums.ts` math sets) is B2/B3 code that has been live
 * since those batches, so no facade member is required.
 *
 * Hypothesis `@given` + `@settings(max_examples=100)` translates to
 * fast-check `fc.assert(fc.property(...), { numRuns: 100 })` with the
 * same strategy shapes (`query/query-validation.pbt.test.ts`
 * precedent, whose date/`last` strategies this file re-derives verbatim
 * rather than importing across suites).
 *
 * Python's kwargs become the single options bag each validator takes;
 * the VALUES are identical. `sorted(VALID_MATH_*)` becomes a sorted
 * array over the `ReadonlySet` so the sampled domain matches Python's
 * ordering exactly.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  MATH_PROPERTY_OPTIONAL,
  MATH_REQUIRING_PROPERTY,
  VALID_MATH_FUNNELS,
  VALID_MATH_INSIGHTS,
} from "../../src/bookmarks/enums.js";
import { pythonStrip } from "../../src/compat/index.js";
import type { ValidationError } from "../../src/errors.js";
import {
  validateFlowArgs,
  validateFunnelArgs,
  validateQueryArgs,
  validateRetentionArgs,
  validateTimeArgs,
} from "../../src/query/validation-args.js";
import type {
  ConversionWindowUnit,
  FunnelMathType,
  MathType,
} from "../../src/types/literals.js";

// =============================================================================
// Strategies (test_delegation_equivalence_pbt.py:31-95)
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

/** Port of the `invalid_dates` sampled_from strategy (:39-49). */
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

/** Port of `TIME_ERROR_CODES` (:54-64). */
const TIME_ERROR_CODES: ReadonlySet<string> = new Set([
  "V7_LAST_POSITIVE",
  "V8_DATE_FORMAT",
  "V8_DATE_INVALID",
  "V9_TO_REQUIRES_FROM",
  "V10_DATE_LAST_EXCLUSIVE",
  "V15_DATE_ORDER",
  "V20_LAST_TOO_LARGE",
]);

/** Port of `_CONTROL_CHARS` (:67-72) — `_CONTROL_CHAR_RE`'s domain. */
const CONTROL_CHARS: readonly string[] = [
  ...Array.from({ length: 0x09 }, (_unused, c) => String.fromCharCode(c)),
  "\x0B",
  "\x0C",
  ...Array.from({ length: 0x20 - 0x0e }, (_unused, i) =>
    String.fromCharCode(0x0e + i),
  ),
  "\x7F",
];

/** Port of `_INVISIBLE_CHARS` (:75). */
const INVISIBLE_CHARS: readonly string[] = [
  " ",
  "\u200B",
  "\u200C",
  "\u200D",
  "\uFEFF",
  "\u00AD",
  "\u2060",
];

/**
 * Representative alphabet for `st.characters(categories=("L", "N"))` —
 * the NARROWED stand-in the B2 arbiter ratified
 * (`query-validation.pbt.test.ts` header): ASCII letters/digits plus
 * explicit non-ASCII category-L/N members, split on code points.
 */
const LN_CHARS: readonly string[] = [
  ...("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789" +
    "éΩж中٤Ⅻ𝒳"),
];

/** Port of `safe_text` (max_size=10, categories L/N, :78-81). */
const safeTextArb: fc.Arbitrary<string> = fc
  .array(fc.integer({ min: 0, max: LN_CHARS.length - 1 }), {
    minLength: 0,
    maxLength: 10,
  })
  .map((idxs) => idxs.map((i) => LN_CHARS[i] ?? "a").join(""));

/** Port of `insights_math_types = st.sampled_from(sorted(VALID_MATH_INSIGHTS))`. */
const insightsMathArb: fc.Arbitrary<string> = fc.constantFrom(
  ...[...VALID_MATH_INSIGHTS].sort(),
);

/** Port of `funnel_math_types = st.sampled_from(sorted(VALID_MATH_FUNNELS))`. */
const funnelMathArb: fc.Arbitrary<string> = fc.constantFrom(
  ...[...VALID_MATH_FUNNELS].sort(),
);

/**
 * `{e.code for e in errors}` — the code set every assertion compares.
 *
 * @param errors - The validator output.
 * @returns The distinct codes.
 */
function codesOf(errors: readonly ValidationError[]): Set<string> {
  return new Set(errors.map((e) => e.code));
}

/**
 * Python `set == set` over two code sets.
 *
 * @param left - First set.
 * @param right - Second set.
 * @returns True when both hold the same codes.
 */
function sameCodes(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  if (left.size !== right.size) {
    return false;
  }
  for (const code of left) {
    if (!right.has(code)) {
      return false;
    }
  }
  return true;
}

// =============================================================================
// Funnel/Retention Delegation Equivalence
// =============================================================================

describe("TestFunnelDelegation (test_delegation_equivalence_pbt.py:102)", () => {
  it("time error codes from standalone match the funnel validator (:111)", () => {
    fc.assert(
      fc.property(
        maybeDatesArb,
        maybeDatesArb,
        lastValuesArb,
        (fromDate, toDate, last) => {
          const standaloneCodes = codesOf(
            validateTimeArgs({
              from_date: fromDate,
              to_date: toDate,
              last,
            }),
          );
          const funnelErrors = validateFunnelArgs({
            steps: ["Signup", "Purchase"],
            conversion_window: 14,
            exclusions: null,
            holding_constant: null,
            from_date: fromDate,
            to_date: toDate,
            last,
            group_by: null,
          });
          const funnelTimeCodes = new Set(
            [...codesOf(funnelErrors)].filter((code) =>
              TIME_ERROR_CODES.has(code),
            ),
          );
          expect(sameCodes(standaloneCodes, funnelTimeCodes)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("TestRetentionDelegation (test_delegation_equivalence_pbt.py:152)", () => {
  it("time error codes from standalone match the retention validator (:161)", () => {
    fc.assert(
      fc.property(
        maybeDatesArb,
        maybeDatesArb,
        lastValuesArb,
        (fromDate, toDate, last) => {
          const standaloneCodes = codesOf(
            validateTimeArgs({
              from_date: fromDate,
              to_date: toDate,
              last,
            }),
          );
          const retentionErrors = validateRetentionArgs({
            born_event: "Signup",
            return_event: "Login",
            from_date: fromDate,
            to_date: toDate,
            last,
          });
          const retentionTimeCodes = new Set(
            [...codesOf(retentionErrors)].filter((code) =>
              TIME_ERROR_CODES.has(code),
            ),
          );
          expect(sameCodes(standaloneCodes, retentionTimeCodes)).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Math/Property Compatibility Matrix
// =============================================================================

describe("TestMathPropertyMatrix (test_delegation_equivalence_pbt.py:204)", () => {
  it("V1 fires iff math requires a property; V2 iff it rejects one (:212)", () => {
    fc.assert(
      fc.property(insightsMathArb, fc.boolean(), (math, hasProperty) => {
        const mathProperty = hasProperty ? "revenue" : null;

        // Skip percentile/histogram — they have additional constraints
        // beyond math/property compatibility (V26/V27).
        if (math === "percentile" || math === "histogram") {
          return;
        }

        const codes = codesOf(
          validateQueryArgs({
            events: ["TestEvent"],
            math: math as MathType,
            math_property: mathProperty,
            per_user: null,
            from_date: null,
            to_date: null,
            last: 30,
            has_formula: false,
            rolling: null,
            cumulative: false,
            group_by: null,
          }),
        );

        // V1: property-requiring math without property
        expect(codes.has("V1_MATH_REQUIRES_PROPERTY")).toBe(
          MATH_REQUIRING_PROPERTY.has(math) && !hasProperty,
        );

        // V2: non-property math with property
        const rejectsProperty =
          !MATH_REQUIRING_PROPERTY.has(math) &&
          !MATH_PROPERTY_OPTIONAL.has(math);
        expect(codes.has("V2_MATH_REJECTS_PROPERTY")).toBe(
          rejectsProperty && hasProperty,
        );
      }),
      { numRuns: 100 },
    );
  });

  it("F10 fires iff funnel math requires a property; F11 iff it rejects one (:273)", () => {
    fc.assert(
      fc.property(funnelMathArb, fc.boolean(), (math, hasProperty) => {
        const mathProperty = hasProperty ? "revenue" : null;

        // Handle session math coupling.
        const cwUnit: ConversionWindowUnit =
          math === "conversion_rate_session" ? "session" : "day";
        const cw = cwUnit === "session" ? 1 : 14;

        const codes = codesOf(
          validateFunnelArgs({
            steps: ["Signup", "Purchase"],
            conversion_window: cw,
            conversion_window_unit: cwUnit,
            math: math as FunnelMathType,
            math_property: mathProperty,
            exclusions: null,
            holding_constant: null,
            from_date: null,
            to_date: null,
            last: 30,
            group_by: null,
          }),
        );

        // F10: property-requiring math without property
        expect(codes.has("F10_MATH_MISSING_PROPERTY")).toBe(
          MATH_REQUIRING_PROPERTY.has(math) && !hasProperty,
        );

        // F11: non-property math with property
        const rejectsProperty =
          !MATH_REQUIRING_PROPERTY.has(math) &&
          !MATH_PROPERTY_OPTIONAL.has(math);
        expect(codes.has("F11_MATH_REJECTS_PROPERTY")).toBe(
          rejectsProperty && hasProperty,
        );
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// Event Name Validation Consistency
// =============================================================================

describe("TestEventNameConsistency (test_delegation_equivalence_pbt.py:337)", () => {
  it("all four validators detect control chars in event names (:350)", () => {
    fc.assert(
      fc.property(
        safeTextArb,
        fc.constantFrom(...CONTROL_CHARS),
        safeTextArb,
        (prefix, ctrl, suffix) => {
          const name = prefix + ctrl + suffix;
          if (pythonStrip(name) === "") {
            // Empty-after-strip names trigger different rules; skip
            // (`if not name.strip()`, :364). R11.7: the guard MUST be
            // `pythonStrip`, never JS `trim` — CPython's `str.strip()`
            // treats U+001C..U+001F as whitespace (`"\x1f".isspace()`
            // is True) while `trim` does not, so a bare `trim` let the
            // single-`\x1f` name through to the V22 assertion even
            // though the validator had already short-circuited on V17.
            // Found as a ~1-in-N `npm run check` flake at B6-W6;
            // fix recorded in `B6-W6-notes.md` §4.
            return;
          }

          // Insights (V22)
          const insightsCodes = codesOf(
            validateQueryArgs({
              events: [name],
              math: "total",
              math_property: null,
              per_user: null,
              from_date: null,
              to_date: null,
              last: 30,
              has_formula: false,
              rolling: null,
              cumulative: false,
              group_by: null,
            }),
          );
          expect(insightsCodes.has("V22_CONTROL_CHAR_EVENT")).toBe(true);

          // Funnel (F2)
          const funnelCodes = codesOf(
            validateFunnelArgs({
              steps: [name, "ValidStep"],
              conversion_window: 14,
              exclusions: null,
              holding_constant: null,
              from_date: null,
              to_date: null,
              last: 30,
              group_by: null,
            }),
          );
          expect(funnelCodes.has("F2_CONTROL_CHAR_STEP_EVENT")).toBe(true);

          // Retention born_event (R1)
          const retentionCodes = codesOf(
            validateRetentionArgs({
              born_event: name,
              return_event: "ValidReturn",
            }),
          );
          expect(retentionCodes.has("R1_CONTROL_CHAR_BORN_EVENT")).toBe(true);

          // Flow (FL2)
          const flowCodes = codesOf(validateFlowArgs({ steps: [name] }));
          expect(flowCodes.has("FL2_CONTROL_CHAR_STEP_EVENT")).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("all four validators detect invisible-only event names (:430)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...INVISIBLE_CHARS), {
          minLength: 1,
          maxLength: 10,
        }),
        (chars) => {
          const name = chars.join("");
          if (name === "") {
            return;
          }

          // Insights — invisible-only names that are whitespace-only
          // trigger V17_EMPTY_EVENT (stripped to empty), not
          // V22_INVISIBLE. Only the name-is-caught property is tested.
          const insightsCodes = codesOf(
            validateQueryArgs({
              events: [name],
              math: "total",
              math_property: null,
              per_user: null,
              from_date: null,
              to_date: null,
              last: 30,
              has_formula: false,
              rolling: null,
              cumulative: false,
              group_by: null,
            }),
          );
          expect(
            insightsCodes.has("V17_EMPTY_EVENT") ||
              insightsCodes.has("V22_INVISIBLE_EVENT"),
          ).toBe(true);

          // Funnel
          const funnelCodes = codesOf(
            validateFunnelArgs({
              steps: [name, "ValidStep"],
              conversion_window: 14,
              exclusions: null,
              holding_constant: null,
              from_date: null,
              to_date: null,
              last: 30,
              group_by: null,
            }),
          );
          expect(
            funnelCodes.has("F2_EMPTY_STEP_EVENT") ||
              funnelCodes.has("F2_INVISIBLE_STEP_EVENT"),
          ).toBe(true);

          // Retention born_event
          const retentionCodes = codesOf(
            validateRetentionArgs({
              born_event: name,
              return_event: "ValidReturn",
            }),
          );
          expect(
            retentionCodes.has("R1_EMPTY_BORN_EVENT") ||
              retentionCodes.has("R1_INVISIBLE_BORN_EVENT"),
          ).toBe(true);

          // Flow
          const flowCodes = codesOf(validateFlowArgs({ steps: [name] }));
          expect(
            flowCodes.has("FL2_EMPTY_STEP_EVENT") ||
              flowCodes.has("FL2_INVISIBLE_STEP_EVENT"),
          ).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
