// fast-check twins of the builder-direct half of
// `tests/unit/test_bookmark_builders_pbt.py` (`TestListContainsRoundTrip`); the
// `*Equivalence` classes there exercise `Workspace._build_query_params` and
// live with the workspace tests. Strategy twins: `st.text` → `fc.string({ unit:
// "binary" })`, `**equals` → the `{ equals }` record, `max_examples=50` → `numRuns: 50`.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  buildFilterEntry,
  buildGroupSection,
  buildTimeSection,
} from "../../src/bookmarks/builders.js";
import { Filter, GroupBy } from "../../src/types/index.js";

/**
 * Twin of `property_names` — 1..30 chars drawn from Unicode letter /
 * number categories, ASCII and beyond.
 *
 * `GroupBy`'s `GB1_EMPTY_PROPERTY` guard rejects blank strings, and
 * every member of the alphabet below is non-blank, so no filter is
 * needed (Python relies on the same category property).
 */
const propertyNames = fc.stringMatching(
  /^[A-Za-z0-9éЖ中٩\u{1D4B3}\u{1D7CE}]{1,30}$/u,
);

/** Twin of `_subprop_names` — letters only, 1..10 chars. */
const subpropNames = fc.stringMatching(/^[A-Za-zéЖ中\u{1D4B3}]{1,10}$/u);

/** Twin of `st.text(min_size=1, max_size=20)` for kwarg VALUES. */
const kwargValues = fc.string({
  minLength: 1,
  maxLength: 20,
  unit: "binary",
});

describe("Filter.listContains round-trip invariants (PBT)", () => {
  it("kwargs shorthand always emits the listItemFilters wire shape", () => {
    fc.assert(
      fc.property(
        propertyNames,
        fc.dictionary(subpropNames, kwargValues, {
          minKeys: 1,
          maxKeys: 5,
        }),
        fc.constantFrom("any" as const, "all" as const),
        (prop, pairs, quantifier) => {
          // fc.dictionary can shrink below minKeys when keys collide;
          // Python's st.dictionaries cannot, so re-establish the
          // precondition rather than weakening the assertions.
          fc.pre(Object.keys(pairs).length > 0);
          const f = Filter.listContains(prop, [], {
            quantifier,
            equals: pairs,
          });
          const entry = buildFilterEntry(f);
          expect(entry["filterType"]).toBe("object");
          expect(entry["defaultType"]).toBe("object");
          expect(entry["filterJoinType"]).toBe("list");
          expect(entry["listQuantifier"]).toBe(quantifier);
          expect(entry["filterOperator"]).toBe("true");
          expect(entry["filterValue"]).toBe(true);
          expect(entry["dataset"]).toBe("$mixpanel");
          expect(entry["value"]).toBe(prop);
          const inner = entry["listItemFilters"] as Array<
            Record<string, unknown>
          >;
          expect(inner).toHaveLength(Object.keys(pairs).length);
          for (const sub of inner) {
            expect(sub["dataset"]).toBe("$mixpanel");
            expect(sub["filterOperator"]).toBe("equals");
            expect(sub["filterType"]).toBe("string");
            const subValue = sub["value"] as string;
            expect(Object.hasOwn(pairs, subValue)).toBe(true);
            expect(sub["filterValue"]).toStrictEqual([pairs[subValue]]);
          }
          // Completeness: every original kwarg shows up exactly once.
          const emittedKeys = new Set(inner.map((sub) => sub["value"]));
          expect(emittedKeys).toStrictEqual(new Set(Object.keys(pairs)));
        },
      ),
      { numRuns: 50 },
    );
  });
});

// --- Builder invariants (TS-only) ---
// Invariants the differential fuzz relies on, stated once here so a
// regression fails in vitest before it reaches the oracle harness.

describe("builder invariants", () => {
  it("buildTimeSection always returns exactly one entry", () => {
    fc.assert(
      fc.property(
        fc.option(fc.constantFrom("2025-01-01", "2026-06-30"), { nil: null }),
        fc.option(fc.constantFrom("2025-12-31", "2026-07-01"), { nil: null }),
        fc.integer({ min: -5, max: 365 }),
        fc.constantFrom(
          "hour" as const,
          "day" as const,
          "week" as const,
          "month" as const,
          "quarter" as const,
        ),
        (fromDate, toDate, last, unit) => {
          const result = buildTimeSection({
            from_date: fromDate,
            to_date: toDate,
            last,
            unit,
            today: () => "2026-01-15",
          });
          expect(result).toHaveLength(1);
          const entry = result[0]!;
          expect(entry["unit"]).toBe(unit);
          // Exactly one of `value` / `window` is present.
          expect(
            Number(Object.hasOwn(entry, "value")) +
              Number(Object.hasOwn(entry, "window")),
          ).toBe(1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("buildGroupSection preserves element order and arity", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.oneof(
            propertyNames,
            propertyNames.map(
              (p) => new GroupBy({ property: p, property_type: "number" }),
            ),
          ),
          { minLength: 0, maxLength: 6 },
        ),
        (groups) => {
          const section = buildGroupSection(groups);
          expect(section).toHaveLength(groups.length);
          for (const [i, g] of groups.entries()) {
            const expected = typeof g === "string" ? g : g.property;
            expect(section[i]!["value"]).toBe(expected);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
