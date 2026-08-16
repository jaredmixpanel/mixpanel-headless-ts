/**
 * Layer-3 translation of the builder-direct half of
 * `tests/unit/test_bookmark_builders_pbt.py` (Python revision:
 * `ts-port/phase2-contract-support` HEAD; 394 LOC, 4 classes) —
 * fast-check twins of the Hypothesis strategies.
 *
 * **Scope (b3-packets.md §K2 "Layer-3 test translation" + R10.1).**
 * Three of the four Python classes — `TestTimeSectionEquivalence`,
 * `TestFilterSectionEquivalence`, `TestGroupSectionEquivalence` —
 * assert `ws._build_query_params(...) == build_*(...)`, i.e. they are
 * WIRING tests for the `Workspace` facade. No facade exists at B3, so
 * they defer to **B5-S2** (the `workspace.build_*params` packet) rather
 * than being weakened here; their builder halves are already covered
 * assertion-for-assertion by `builders.test.ts`.
 *
 * `TestListContainsRoundTrip` (`:354-394`) IS builder-direct and is
 * translated below.
 *
 * Strategy mirroring notes (R10.2):
 * - `property_names = st.text(min_size=1, max_size=30,
 *   alphabet=st.characters(categories=("L", "N")))` → the same size
 *   window over a letter/number alphabet that INCLUDES non-ASCII and
 *   non-BMP members (B2 ASSERT-F1 precedent: an ASCII-only twin is a
 *   silent narrowing).
 * - `_subprop_names = st.text(min_size=1, max_size=10,
 *   alphabet=st.characters(categories=["L"]))` → letters only. Python
 *   passes these as `**kwargs`, so the dictionary shape is the twin of
 *   `st.dictionaries(min_size=1, max_size=5)`; the TS
 *   `Filter.listContains(..., { equals })` record is the ported
 *   calling convention for `**equals`.
 * - `st.text(min_size=1, max_size=20)` values → `fc.string` with
 *   `unit: "binary"` (full code-point domain).
 * - `@settings(max_examples=50)` → `fc.assert(..., { numRuns: 50 })`.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";

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
  /^[A-Za-z0-9éЖ中٩\u{1d4b3}\u{1d7ce}]{1,30}$/u,
);

/** Twin of `_subprop_names` — letters only, 1..10 chars. */
const subpropNames = fc.stringMatching(/^[A-Za-zéЖ中\u{1d4b3}]{1,10}$/u);

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
          fc.pre(Object.keys(pairs).length >= 1);
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
            expect(sub["filterValue"]).toEqual([pairs[subValue]]);
          }
          // Completeness: every original kwarg shows up exactly once.
          const emittedKeys = new Set(inner.map((sub) => sub["value"]));
          expect(emittedKeys).toEqual(new Set(Object.keys(pairs)));
        },
      ),
      { numRuns: 50 },
    );
  });
});

// =============================================================================
// NEW properties — invariants the packet's R10.9 spec relies on, stated
// once here so a regression fails in vitest before it reaches the
// differential harness.
// =============================================================================

describe("builder invariants (NEW)", () => {
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
          groups.forEach((g, i) => {
            const expected = typeof g === "string" ? g : g.property;
            expect(section[i]!["value"]).toBe(expected);
          });
        },
      ),
      { numRuns: 200 },
    );
  });
});
