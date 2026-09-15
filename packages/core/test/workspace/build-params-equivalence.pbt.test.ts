/**
 * Layer-3 translation of the three FACADE-WIRING equivalence classes of
 * `tests/unit/test_bookmark_builders_pbt.py` (B5-S2, packet §3 + §8 —
 * the B3-K2 deferral, `B3-K2-notes.md:120-122`):
 * TestTimeSectionEquivalence :81, TestFilterSectionEquivalence :164,
 * TestGroupSectionEquivalence :228.
 *
 * Each property asserts that the section the params builder emits is
 * IDENTICAL to what the standalone B3 builder returns for the same
 * inputs — i.e. that the facade wires the builders rather than
 * re-implementing them.
 *
 * Hypothesis `@settings(max_examples=N)` → fast-check `numRuns: N`.
 *
 * Fidelity notes:
 * - `date_strs` is `st.from_regex(r"20[2-3][0-9]-(0[1-9]|1[0-2])-(0[1-9]|
 *   [12][0-9]|3[01])", fullmatch=True)` — reproduced as a composed
 *   generator over the same digit ranges (the strings are only compared,
 *   never parsed, so a 2025-02-31 draw is as valid here as in Python).
 * - `property_names` (`st.characters(categories=("L","N"))`) becomes an
 *   explicit letter+digit alphabet spanning Latin / Greek / Cyrillic /
 *   CJK plus a non-BMP letter and non-ASCII digits (strictly inside the
 *   Python categories; the B2 ASSERT-F1 convention).
 * - `_build_query_params` is the exported {@link buildQueryParams}
 *   (R7.2 split); the Python `_make_workspace()` fixture is unused by
 *   the assertions beyond providing that method.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  buildFilterSection,
  buildGroupSection,
  buildTimeSection,
} from "../../src/bookmarks/builders.js";
import { Filter } from "../../src/types/query-params/filter.js";
import { GroupBy } from "../../src/types/query-params/group-by.js";
import {
  buildQueryParams,
  type BuildQueryParamsOptions,
  type ParamsDict,
} from "../../src/workspace-query-params.js";

// ===========================================================================
// Strategies (test file :44-56)
// ===========================================================================

/** `date_strs` — `20[2-3][0-9]-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])`. */
const dateStrs: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom("2", "3"),
    fc.integer({ min: 0, max: 9 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 31 }),
  )
  .map(
    ([decade, year, month, day]) =>
      `20${decade}${String(year)}-${`${month}`.padStart(2, "0")}-${`${day}`.padStart(2, "0")}`,
  );

/** `time_units`. */
const timeUnits: fc.Arbitrary<string> = fc.constantFrom(
  "hour",
  "day",
  "week",
  "month",
  "quarter",
);

/** `positive_ints` — 1..365. */
const positiveInts: fc.Arbitrary<number> = fc.integer({ min: 1, max: 365 });

/** `property_names` — L/N characters, 1..30. */
const propertyNames: fc.Arbitrary<string> = fc
  .array(
    fc.constantFrom(
      // L (letters), incl. a non-BMP letter
      "a",
      "Z",
      "é",
      "Δ",
      "Ж",
      "漢",
      "𝒳",
      // N (numbers), ASCII and non-ASCII decimal digits
      "0",
      "9",
      "٣",
      "۵",
    ),
    { minLength: 1, maxLength: 30 },
  )
  .map((chars) => chars.join(""));

/** The keyword-only bag every Python `_build_query_params` call spells. */
const BASE = {
  events: ["TestEvent"],
  math: "total",
  math_property: null,
  per_user: null,
  from_date: null,
  to_date: null,
  last: 30,
  unit: "day",
  group_by: null,
  where: null,
  formulas: [],
  rolling: null,
  cumulative: false,
  mode: "timeseries",
} as const satisfies BuildQueryParamsOptions;

/**
 * `ws._build_query_params(**BASE, **overrides)`.
 *
 * @param overrides - The kwargs the Python call overrides.
 * @returns The bookmark params.
 */
function build(overrides: Partial<BuildQueryParamsOptions> = {}): ParamsDict {
  return buildQueryParams({ ...BASE, ...overrides });
}

/** `params["sections"][name]`. */
function section(params: ParamsDict, name: string): unknown {
  return (params["sections"] as Record<string, unknown>)[name];
}

// ===========================================================================
// build_time_section wiring
// ===========================================================================

describe("TestTimeSectionEquivalence", () => {
  it("relative range: the section matches the standalone builder", () => {
    fc.assert(
      fc.property(timeUnits, positiveInts, (unit, last) => {
        const params = build({ last, unit });
        const direct = buildTimeSection({
          from_date: null,
          to_date: null,
          last,
          unit: unit as never,
        });
        expect(section(params, "time")).toStrictEqual(direct);
      }),
      { numRuns: 50 },
    );
  });

  it("absolute range: the section matches the standalone builder", () => {
    fc.assert(
      fc.property(dateStrs, dateStrs, timeUnits, (a, b, unit) => {
        // Ensure from_date <= to_date for a valid range
        const [fromDate, toDate] = a > b ? [b, a] : [a, b];
        const params = build({ from_date: fromDate, to_date: toDate, unit });
        const direct = buildTimeSection({
          from_date: fromDate,
          to_date: toDate,
          last: 30,
          unit: unit as never,
        });
        expect(section(params, "time")).toStrictEqual(direct);
      }),
      { numRuns: 50 },
    );
  });
});

// ===========================================================================
// build_filter_section wiring
// ===========================================================================

describe("TestFilterSectionEquivalence", () => {
  it("a single filter: the section matches the standalone builder", () => {
    fc.assert(
      fc.property(propertyNames, propertyNames, (prop, value) => {
        const f = Filter.equals(prop, value);
        const params = build({ where: f });
        expect(section(params, "filter")).toStrictEqual(buildFilterSection(f));
      }),
      { numRuns: 50 },
    );
  });

  it("where=null: the section is the builder's empty list", () => {
    const params = build();
    const direct = buildFilterSection(null);
    expect(section(params, "filter")).toStrictEqual(direct);
    expect(direct).toStrictEqual([]);
  });
});

// ===========================================================================
// build_group_section wiring
// ===========================================================================

describe("TestGroupSectionEquivalence", () => {
  it("a string group_by: the section matches the standalone builder", () => {
    fc.assert(
      fc.property(propertyNames, (prop) => {
        const params = build({ group_by: prop });
        expect(section(params, "group")).toStrictEqual(buildGroupSection(prop));
      }),
      { numRuns: 50 },
    );
  });

  it("a bucketed GroupBy: the section matches the standalone builder", () => {
    fc.assert(
      fc.property(
        propertyNames,
        fc.double({ min: 0.1, max: 1000.0, noNaN: true }),
        fc.double({ min: -1000.0, max: 0.0, noNaN: true }),
        fc.double({ min: 0.1, max: 10000.0, noNaN: true }),
        (prop, bucketSize, bucketMin, bucketMax) => {
          const g = new GroupBy({
            property: prop,
            property_type: "number",
            bucket_size: bucketSize,
            bucket_min: bucketMin,
            bucket_max: bucketMax,
          });
          const params = build({ group_by: g });
          expect(section(params, "group")).toStrictEqual(buildGroupSection(g));
        },
      ),
      { numRuns: 30 },
    );
  });
});
