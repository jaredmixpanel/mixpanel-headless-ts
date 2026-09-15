/**
 * R10.7 bug-compatibility locks for the Python `value not in FROZENSET`
 * membership guards in `validation.py`'s Layer-2 validators.
 *
 * CPython hashes the candidate in `x in frozenset`, so a `list`/`dict`
 * value at any of the 16 membership sites raises
 * `TypeError: cannot use 'list' as a set element (unhashable type: …)`
 * instead of returning an enum error. B2-M2 shipped the total-function
 * spelling and flagged the deviation for adjudication
 * (`B2-M2-notes.md` finding 2, the module-header `TODO(port)`); the
 * B2-BIND differential fuzz then hit it as a REAL divergence
 * (`conformance/differential/repros/2026-08-15-validation-validate_bookmark.json`
 * — Python `TypeError` vs TS `ok`), so R10.7 rules: port the raise.
 *
 * TS-only suite (no Python test asserts the raises — the corpus is
 * silent by construction); every case below was probe-verified against
 * CPython 3.14.6 on 2026-08-15 (B2-BIND notes, probe matrix: 16 raise
 * sites + hashable non-raise controls). Python source sites:
 * validation.py :1832 (FLB3), :1845 (FLB4), :2483 (B7), :2549 (B19),
 * :2618 (B9), :2647 (B11), :2662 (B17), :2674 (B16), :2712 (B5),
 * :2754 (B12), :2767 (B13), :2846 (B16), :2860 (B14), :2873 (B15),
 * :2981 (B17), :2995 (B16).
 */

import { describe, expect, it } from "vitest";

import {
  validateBookmark,
  validateFlowBookmark,
} from "../../src/query/validation-bookmark.js";

/** A poison value Python cannot hash (JSON array → Python list). */
const LIST: readonly never[] = [];

/** A poison value Python cannot hash (JSON object → Python dict). */
const DICT = {};

/**
 * Build the minimal valid insights bookmark params dict
 * (`tests/unit/test_validation.py::_minimal_bookmark` shape).
 *
 * @param over - Top-level key overrides.
 * @returns A fresh params dict.
 */
function bm(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sections: {
      show: [
        {
          behavior: {
            type: "event",
            resourceType: "events",
            value: { name: "Login" },
          },
          measurement: { math: "total" },
        },
      ],
      time: [{ unit: "day", dateRangeType: "in the last", value: 30 }],
      filter: [],
      group: [],
    },
    displayOptions: { chartType: "line", analysis: "linear" },
    ...over,
  };
}

/**
 * Bookmark params with one replaced show clause.
 *
 * @param clause - The show-clause value.
 * @returns The params dict.
 */
function bmShow(clause: unknown): Record<string, unknown> {
  const base = bm();
  base["sections"] = {
    ...(base["sections"] as Record<string, unknown>),
    show: [clause],
  };
  return base;
}

/**
 * Bookmark params with one clause in the given section.
 *
 * @param section - `"filter"` / `"group"` / `"time"`.
 * @param clause - The clause value.
 * @returns The params dict.
 */
function bmSection(section: string, clause: unknown): Record<string, unknown> {
  const base = bm();
  base["sections"] = {
    ...(base["sections"] as Record<string, unknown>),
    [section]: [clause],
  };
  return base;
}

/**
 * Build the minimal valid flow bookmark params dict.
 *
 * @param over - Top-level key overrides.
 * @returns A fresh params dict.
 */
function fb(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    steps: [{ event: "Purchase" }],
    date_range: { type: "in the last" },
    chartType: "sankey",
    count_type: "unique",
    version: 2,
    ...over,
  };
}

describe("validateBookmark unhashable membership candidates (R10.7)", () => {
  const raising: ReadonlyArray<
    readonly [string, () => Record<string, unknown>]
  > = [
    ["B5 chartType=[]", () => bm({ displayOptions: { chartType: LIST } })],
    ["B5 chartType={}", () => bm({ displayOptions: { chartType: DICT } })],
    [
      "B7 behavior.type=[]",
      () =>
        bmShow({ behavior: { type: LIST }, measurement: { math: "total" } }),
    ],
    [
      "B19 filtersDeterminer=[]",
      () =>
        bmShow({
          behavior: {
            type: "event",
            value: { name: "L" },
            filtersDeterminer: LIST,
          },
        }),
    ],
    [
      "B9 math=[]",
      () =>
        bmShow({
          behavior: { type: "event", value: { name: "L" } },
          measurement: { math: LIST },
        }),
    ],
    [
      "B9 math={}",
      () =>
        bmShow({
          behavior: { type: "event", value: { name: "L" } },
          measurement: { math: DICT },
        }),
    ],
    [
      "B11 perUserAggregation=[]",
      () =>
        bmShow({
          behavior: { type: "event", value: { name: "L" } },
          measurement: { math: "total", perUserAggregation: LIST },
        }),
    ],
    [
      "B17 measurement.property.type=[]",
      () =>
        bmShow({
          behavior: { type: "event", value: { name: "L" } },
          measurement: { math: "total", property: { type: LIST } },
        }),
    ],
    [
      "B16 measurement.property.resourceType=[]",
      () =>
        bmShow({
          behavior: { type: "event", value: { name: "L" } },
          measurement: {
            math: "total",
            property: { type: "number", resourceType: LIST },
          },
        }),
    ],
    ["B12 time.unit=[]", () => bmSection("time", { unit: LIST })],
    [
      "B13 time.dateRangeType=[]",
      () => bmSection("time", { unit: "day", dateRangeType: LIST }),
    ],
    [
      "B16 filter.resourceType=[]",
      () => bmSection("filter", { resourceType: LIST }),
    ],
    ["B14 filterType=[]", () => bmSection("filter", { filterType: LIST })],
    [
      "B15 filterOperator=[]",
      () => bmSection("filter", { filterOperator: LIST }),
    ],
    [
      "B17 group.propertyType=[]",
      () => bmSection("group", { propertyName: "p", propertyType: LIST }),
    ],
    [
      "B16 group.resourceType=[]",
      () => bmSection("group", { propertyName: "p", resourceType: LIST }),
    ],
  ];

  it.each(raising)("%s raises TypeError like CPython", (_label, params) => {
    expect(() => validateBookmark(params())).toThrow(TypeError);
  });

  it("hashable non-string values still return enum errors (probe controls)", () => {
    // CPython: True / 1.5 hash fine → membership False → enum error.
    const mathTrue = validateBookmark(
      bmShow({
        behavior: { type: "event", value: { name: "L" } },
        measurement: { math: true },
      }),
    );
    expect(mathTrue.map((e) => e.code)).toContain("B9_INVALID_MATH");
    const mathFloat = validateBookmark(
      bmShow({
        behavior: { type: "event", value: { name: "L" } },
        measurement: { math: 1.5 },
      }),
    );
    expect(mathFloat.map((e) => e.code)).toContain("B9_INVALID_MATH");
    // chartType=None takes the missing branch — never hashed.
    const chartNone = validateBookmark(
      bm({ displayOptions: { chartType: null } }),
    );
    expect(chartNone.map((e) => e.code)).toContain("B5_INVALID_CHART_TYPE");
  });
});

describe("validateFlowBookmark unhashable membership candidates (R10.7)", () => {
  it("FLB3 count_type=[] raises TypeError like CPython", () => {
    expect(() => validateFlowBookmark(fb({ count_type: LIST }))).toThrow(
      TypeError,
    );
  });

  it("FLB4 chartType={} raises TypeError like CPython", () => {
    expect(() => validateFlowBookmark(fb({ chartType: DICT }))).toThrow(
      TypeError,
    );
  });

  it("FLB3 count_type=True stays an enum error (hashable control)", () => {
    const errors = validateFlowBookmark(fb({ count_type: true }));
    expect(errors.map((e) => e.code)).toContain("FLB3_INVALID_COUNT_TYPE");
  });
});
