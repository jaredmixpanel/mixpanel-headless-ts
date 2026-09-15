/**
 * Layer-3 translation of `tests/unit/test_validation_pbt.py`
 * (Python revision: `ts-port/phase2-contract-support` HEAD; 373 LOC).
 *
 * Scope per b2-packets.md §V1a: time-args + custom-property PBT (all
 * four classes in that file are V1a-owned: `TestSuggestInvariants`,
 * `TestContainsControlChars`, `TestValidateTimeArgsSoundness`,
 * `TestCustomPropertyRefValidation`,
 * `TestInlineCustomPropertyValidation`).
 *
 * Hypothesis `@settings(max_examples=100)` → fast-check `numRuns: 100`.
 *
 * Fidelity note (Cautions §4): the Python `test_clean_strings_pass`
 * strategy draws from unicode categories L/N/P/Z/S minus the control
 * set. JS has no category-based generator, so the port draws from an
 * explicit representative alphabet spanning those categories (letters,
 * digits, punctuation, separators, symbols, plus a non-BMP symbol) —
 * the property under test (no control characters ⇒ not flagged) is
 * unchanged and the alphabet is strictly inside the Python one.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { pythonStrip, sortedByCodepoint } from "../../src/compat/index.js";
import { validateTimeArgs } from "../../src/query/validation-args.js";
import {
  _suggest,
  _validateCustomProperty,
  containsControlChars,
} from "../../src/query/validation-shared.js";
import {
  CustomPropertyRef,
  InlineCustomProperty,
  PropertyInput,
} from "../../src/types/index.js";

// =============================================================================
// Strategies (test_validation_pbt.py:34-72)
// =============================================================================

/** Port of `_CONTROL_CHARS` (the `_CONTROL_CHAR_RE` character set). */
const CONTROL_CHARS: readonly string[] = [
  ...Array.from({ length: 0x09 }, (_, c) => String.fromCodePoint(c)),
  String.fromCodePoint(0x0b),
  String.fromCodePoint(0x0c),
  ...Array.from({ length: 0x20 - 0x0e }, (_, c) =>
    String.fromCodePoint(0x0e + c),
  ),
  String.fromCodePoint(0x7f),
];

/** Port of `valid_date_strs` (year 2000-2030, month 1-12, day 1-28). */
const validDateStrsArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 2000, max: 2030 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }),
  )
  .map(
    ([y, m, d]) =>
      `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(
        d,
      ).padStart(2, "0")}`,
  );

/**
 * Representative alphabet for `st.characters(categories=("L", "N"))`.
 *
 * fast-check has no Unicode-category generator, so this is a NARROWED
 * stand-in (B2 arbiter fix, b2-review-resolution.md assertions-F1):
 * ASCII letters/digits plus explicit non-ASCII category-L/N members —
 * é (Ll), Ω (Lu), ж (Ll), 中 (Lo), ٤ (Nd), Ⅻ (Nl) and the non-BMP
 * 𝒳 (U+1D4B3, Lu) — every entry strictly inside Python's L/N domain.
 * Full-Unicode cross-language behavior is additionally locked by the
 * Python-side R10.9 fuzz strategies (`_B2_NON_BMP` edges).
 */
const LN_ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789éΩж中٤Ⅻ𝒳";

/**
 * Build an arbitrary string from an explicit alphabet.
 *
 * @param alphabet - Characters to draw from.
 * @param minLength - Minimum length.
 * @param maxLength - Maximum length.
 * @returns Arbitrary string over the alphabet.
 */
function stringFrom(
  alphabet: readonly string[],
  minLength: number,
  maxLength: number,
): fc.Arbitrary<string> {
  return fc
    .array(fc.integer({ min: 0, max: alphabet.length - 1 }), {
      minLength,
      maxLength,
    })
    .map((idxs) => idxs.map((i) => alphabet[i] ?? "a").join(""));
}

/** Port of `valid_sets` (frozensets of 1-30 L/N strings, 1-15 chars). */
const validSetsArb: fc.Arbitrary<ReadonlySet<string>> = fc
  .array(stringFrom([...LN_ALPHABET], 1, 15), { minLength: 1, maxLength: 30 })
  .map((items) => new Set(items));

/**
 * Port of `query_strings = st.text(min_size=0, max_size=20)` —
 * `unit: "binary"` for Python's full-Unicode `st.text()` domain
 * (B2 arbiter fix: the pre-fix default `fc.string()` was
 * printable-ASCII only, and Layer-3 is the sole lock on `_suggest`'s
 * Unicode behavior since suggestions are advisory, R5.3).
 */
const queryStringsArb = fc.string({ unit: "binary", maxLength: 20 });

/** Port of `uppercase_keys = st.from_regex(r"^[A-Z]$")`. */
const uppercaseKeysArb = fc.constantFrom(
  ...Array.from({ length: 26 }, (_, i) => String.fromCodePoint(0x41 + i)),
);

/** Port of `property_names` (1-30 chars, categories L/N). */
const propertyNamesArb = stringFrom([...LN_ALPHABET], 1, 30);

/**
 * Port of `nonempty_formulas` (full-Unicode `st.text()` 1-100 filtered
 * on `.strip()`) — `unit: "binary"` per the arbiter fix above.
 */
const nonemptyFormulasArb: fc.Arbitrary<string> = fc
  .string({ unit: "binary", minLength: 1, maxLength: 100 })
  .filter((s) => pythonStrip(s) !== "");

// =============================================================================
// _suggest invariants
// =============================================================================

describe("TestSuggestInvariants", () => {
  it("test_results_are_subset_of_valid", () => {
    fc.assert(
      fc.property(queryStringsArb, validSetsArb, (value, valid) => {
        const result = _suggest(value, valid);
        if (result !== null) {
          expect(
            result.every((r) => valid.has(r)),
            `Suggestions ${JSON.stringify(result)} not subset of valid`,
          ).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("test_result_length_bounded_by_n", () => {
    fc.assert(
      fc.property(
        queryStringsArb,
        validSetsArb,
        fc.integer({ min: 1, max: 10 }),
        (value, valid, n) => {
          const result = _suggest(value, valid, n);
          if (result !== null) {
            expect(
              result.length,
              `Got ${String(result.length)} suggestions but n=${String(n)}`,
            ).toBeLessThanOrEqual(n);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("test_exact_match_always_found", () => {
    fc.assert(
      fc.property(validSetsArb, (valid) => {
        // Python: `value = sorted(valid)[0]` — codepoint sort (R11.5).
        const value = sortedByCodepoint([...valid])[0]!;
        const result = _suggest(value, valid);
        expect(
          result,
          `Exact match ${JSON.stringify(value)} not found`,
        ).not.toBeNull();
        expect(
          result,
          `Exact match ${JSON.stringify(value)} missing from suggestions`,
        ).toContain(value);
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// contains_control_chars reference implementation
// =============================================================================

/** Port of `_CONTROL_CHAR_RE_REF` — the independent reference matcher. */
const CONTROL_CHAR_SET: ReadonlySet<string> = new Set(CONTROL_CHARS);

/**
 * Reference implementation: true when any codepoint of `s` is in the
 * control-character set (metamorphic twin of the regex under test).
 *
 * @param s - Arbitrary string.
 * @returns Whether any control character is present.
 */
function referenceHasControlChar(s: string): boolean {
  for (const ch of s) {
    if (CONTROL_CHAR_SET.has(ch)) {
      return true;
    }
  }
  return false;
}

describe("TestContainsControlChars", () => {
  it("test_agrees_with_reference", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 100, unit: "binary" }), (s) => {
        const expected = referenceHasControlChar(s);
        expect(
          containsControlChars(s),
          `Disagreement on ${JSON.stringify(s)}`,
        ).toBe(expected);
      }),
      { numRuns: 100 },
    );
  });

  it("test_detects_embedded_control_chars", () => {
    // Python draws prefix/suffix from categories L/N/P; the port uses an
    // explicit representative alphabet over the same categories.
    const safeAlphabet = [...`${LN_ALPHABET}.,;:!?-_()[]{}'"/@#`];
    fc.assert(
      fc.property(
        stringFrom(safeAlphabet, 0, 20),
        fc.constantFrom(...CONTROL_CHARS),
        stringFrom(safeAlphabet, 0, 20),
        (prefix, ctrl, suffix) => {
          const s = prefix + ctrl + suffix;
          expect(
            containsControlChars(s),
            `Failed to detect control char in ${JSON.stringify(s)}`,
          ).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("test_clean_strings_pass", () => {
    // Representative L/N/P/Z/S alphabet with the control set excluded
    // (see the file-header fidelity note).
    const cleanAlphabet = [
      ...`${LN_ALPHABET}.,;:!?-_()[]{}'"/@# +<=>|~$^\u00A0\u2003€é中`,
      "\u{1F600}",
    ];
    fc.assert(
      fc.property(stringFrom(cleanAlphabet, 0, 50), (s) => {
        expect(
          containsControlChars(s),
          `False positive on clean string ${JSON.stringify(s)}`,
        ).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// validate_time_args valid-inputs soundness
// =============================================================================

describe("TestValidateTimeArgsSoundness", () => {
  it("test_valid_ordered_dates_no_errors", () => {
    fc.assert(
      fc.property(validDateStrsArb, validDateStrsArb, (a, b) => {
        // Ensure chronological order (Python `if from_date > to_date`).
        let from_date = a;
        let to_date = b;
        if (from_date > to_date) {
          [from_date, to_date] = [to_date, from_date];
        }
        const errors = validateTimeArgs({ from_date, to_date, last: 30 });
        expect(
          errors,
          `Unexpected errors for valid dates ${from_date} to ${to_date}`,
        ).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it("test_valid_last_no_dates_no_errors", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3650 }), (last) => {
        const errors = validateTimeArgs({
          from_date: null,
          to_date: null,
          last,
        });
        expect(errors, `Unexpected errors for last=${String(last)}`).toEqual(
          [],
        );
      }),
      { numRuns: 100 },
    );
  });

  it("test_nonpositive_last_always_errors", () => {
    fc.assert(
      fc.property(fc.integer({ max: 0 }), (last) => {
        const errors = validateTimeArgs({
          from_date: null,
          to_date: null,
          last,
        });
        const codes = new Set(errors.map((e) => e.code));
        expect(
          codes.has("V7_LAST_POSITIVE"),
          `Expected V7_LAST_POSITIVE for last=${String(last)}`,
        ).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// =============================================================================
// _validate_custom_property boundary behavior
// =============================================================================

describe("TestCustomPropertyRefValidation", () => {
  it("test_positive_id_no_errors", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000 }), (propId) => {
        const ref = new CustomPropertyRef({ id: propId });
        const errors = _validateCustomProperty(ref, "test");
        expect(errors, `Unexpected errors for id=${String(propId)}`).toEqual(
          [],
        );
      }),
      { numRuns: 100 },
    );
  });

  it("test_nonpositive_id_produces_cp1", () => {
    fc.assert(
      fc.property(fc.integer({ max: 0 }), (propId) => {
        const ref = new CustomPropertyRef({ id: propId });
        const errors = _validateCustomProperty(ref, "test");
        expect(
          errors,
          `Expected exactly 1 error for id=${String(propId)}`,
        ).toHaveLength(1);
        expect(errors[0]!.code).toBe("CP1_INVALID_ID");
      }),
      { numRuns: 100 },
    );
  });
});

describe("TestInlineCustomPropertyValidation", () => {
  it("test_valid_inline_no_errors", () => {
    fc.assert(
      fc.property(
        nonemptyFormulasArb,
        fc.uniqueArray(uppercaseKeysArb, { minLength: 1, maxLength: 5 }),
        fc.array(propertyNamesArb, { minLength: 5, maxLength: 5 }),
        (formula, keys, names) => {
          const inputs: Record<string, PropertyInput> = {};
          keys.forEach((k, i) => {
            inputs[k] = new PropertyInput({ name: names[i]! });
          });
          const prop = new InlineCustomProperty({ formula, inputs });
          const errors = _validateCustomProperty(prop, "test");
          expect(
            errors,
            "Unexpected errors for valid InlineCustomProperty",
          ).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("test_whitespace_formula_produces_cp2", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(uppercaseKeysArb, { minLength: 1, maxLength: 3 }),
        fc.array(propertyNamesArb, { minLength: 3, maxLength: 3 }),
        (keys, names) => {
          const inputs: Record<string, PropertyInput> = {};
          keys.forEach((k, i) => {
            inputs[k] = new PropertyInput({ name: names[i]! });
          });
          const prop = new InlineCustomProperty({
            formula: " ".repeat(3),
            inputs,
          });
          const errors = _validateCustomProperty(prop, "test");
          const codes = new Set(errors.map((e) => e.code));
          expect(
            codes.has("CP2_EMPTY_FORMULA"),
            "Expected CP2_EMPTY_FORMULA for whitespace formula",
          ).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });
});
