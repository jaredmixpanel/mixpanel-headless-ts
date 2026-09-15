// fast-check twins of `tests/unit/_internal/test_expressions_pbt.py` for
// `normalizeOnExpression`. `st.text()` → `fc.string({ unit: "binary" })` (the
// full code-point domain, non-BMP included) with the same accessor filter;
// Python's silent early `return` becomes `fc.pre()`; the upstream suite sets
// no `max_examples`, so `numRuns: 200` (the Hypothesis CI default) is used.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { normalizeOnExpression } from "../../src/query/expressions.js";

/** The three accessors the Python module and its strategies both use. */
const ACCESSORS = ['properties["', 'user["', 'event["'] as const;

/** Twin of `bare_property_names`. */
const barePropertyNames = fc
  .string({ minLength: 1, unit: "binary" })
  .filter((s) => ACCESSORS.every((accessor) => !s.includes(accessor)));

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
        const unescaped = inner
          .replaceAll(String.raw`\"`, '"')
          .replaceAll("\\\\", "\\");
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
        const unescaped = inner
          .replaceAll(String.raw`\"`, '"')
          .replaceAll("\\\\", "\\");
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
          fc.pre(ACCESSORS.every((accessor) => !name.includes(accessor)));

          const result = normalizeOnExpression(name);

          expect(result.startsWith('properties["')).toBe(true);
          expect(result.endsWith('"]')).toBe(true);
          const inner = result.slice('properties["'.length, -'"]'.length);
          const unescaped = inner
            .replaceAll(String.raw`\"`, '"')
            .replaceAll("\\\\", "\\");
          expect(unescaped).toBe(name);
        },
      ),
      RUNS,
    );
  });
});
