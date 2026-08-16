/**
 * Layer-3 translation of `tests/unit/_internal/test_expressions_pbt.py`
 * (143 LOC, 1 class, 6 Hypothesis properties; Python revision:
 * `ts-port/phase2-contract-support` HEAD) — fast-check twins, per
 * `b3-packets.md` §"Packet K3".
 *
 * Strategy mirroring notes (R10.2; B2 ASSERT-F1 precedent — an
 * ASCII-only twin of `st.text()` is a silent narrowing and a finding):
 *
 * - `bare_property_names = st.text(min_size=1).filter(no accessor)` →
 *   `fc.string({ minLength: 1, unit: "binary" })` with the SAME filter
 *   predicate (`includes` on each of the three accessors). `unit:
 *   "binary"` draws the full code-point domain including non-BMP.
 * - `valid_expressions = st.sampled_from([...])` → `fc.constantFrom`
 *   over the identical five literals.
 * - `st.text()` (may be empty) → `fc.string({ unit: "binary" })`.
 * - `st.text(max_size=20)` for the quote-splice property → the same
 *   bound; the Python body `return`s early when the spliced name
 *   accidentally contains an accessor, which translates to `pre()`
 *   (fast-check's precondition — a skipped example, exactly like
 *   Python's silent early return).
 *
 * The upstream Python suite carries no `@settings(max_examples=...)`,
 * so the Hypothesis default (100 / CI 200) applies; `numRuns: 200` is
 * the deterministic twin used across this repo's PBT files.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { normalizeOnExpression } from "../../src/query/expressions.js";

/** The three accessors the Python module and its strategies both use. */
const ACCESSORS = ['properties["', 'user["', 'event["'] as const;

/** Twin of `bare_property_names`. */
const barePropertyNames = fc
  .string({ minLength: 1, unit: "binary" })
  .filter((s) => !ACCESSORS.some((accessor) => s.includes(accessor)));

/** Twin of `valid_expressions`. */
const validExpressions = fc.constantFrom(
  'properties["Source"]',
  'user["email"]',
  'event["name"]',
  'properties["x"] == "y"',
  'defined(properties["z"])',
);

/** Twin of `st.text()` — the unrestricted (possibly empty) domain. */
const anyText = fc.string({ unit: "binary" });

const RUNS = { numRuns: 200 } as const;

describe("normalizeOnExpression properties (PBT)", () => {
  it("wraps any bare property name", () => {
    fc.assert(
      fc.property(barePropertyNames, (name) => {
        const result = normalizeOnExpression(name);

        expect(result.startsWith('properties["')).toBe(true);
        expect(result.endsWith('"]')).toBe(true);

        const inner = result.slice('properties["'.length, -'"]'.length);
        const unescaped = inner.replaceAll('\\"', '"').replaceAll("\\\\", "\\");
        expect(unescaped).toBe(name);
      }),
      RUNS,
    );
  });

  it("passes expressions with accessor patterns through unchanged", () => {
    fc.assert(
      fc.property(validExpressions, (expr) => {
        expect(normalizeOnExpression(expr)).toBe(expr);
      }),
      RUNS,
    );
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(anyText, (name) => {
        const once = normalizeOnExpression(name);
        const twice = normalizeOnExpression(once);
        expect(twice).toBe(once);
      }),
      RUNS,
    );
  });

  it("always produces output containing an accessor", () => {
    fc.assert(
      fc.property(anyText, (name) => {
        const result = normalizeOnExpression(name);
        expect(ACCESSORS.some((accessor) => result.includes(accessor))).toBe(
          true,
        );
      }),
      RUNS,
    );
  });

  it("produces valid syntax for wrapped output", () => {
    fc.assert(
      fc.property(barePropertyNames, (name) => {
        const result = normalizeOnExpression(name);

        expect(result.startsWith('properties["')).toBe(true);
        expect(result.endsWith('"]')).toBe(true);

        const inner = result.slice('properties["'.length, -'"]'.length);
        const unescaped = inner.replaceAll('\\"', '"').replaceAll("\\\\", "\\");
        expect(unescaped).toBe(name);
      }),
      RUNS,
    );
  });

  it("escapes quotes embedded in names", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 20, unit: "binary" }),
        fc.string({ maxLength: 20, unit: "binary" }),
        (prefix, suffix) => {
          const name = `${prefix}"${suffix}`;

          // Python: `if accessor in name: return` — a silently skipped
          // example.
          fc.pre(!ACCESSORS.some((accessor) => name.includes(accessor)));

          const result = normalizeOnExpression(name);

          expect(result.startsWith('properties["')).toBe(true);
          expect(result.endsWith('"]')).toBe(true);
          const inner = result.slice('properties["'.length, -'"]'.length);
          const unescaped = inner
            .replaceAll('\\"', '"')
            .replaceAll("\\\\", "\\");
          expect(unescaped).toBe(name);
        },
      ),
      RUNS,
    );
  });
});
