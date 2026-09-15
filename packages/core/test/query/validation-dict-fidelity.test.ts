// Python `isinstance(x, dict)` is False for floats and for class instances
// (`Filter`, ...), so the bookmark/sorting validators' dict predicates must
// reject the rig's float carrier (a `{ spelling }` class instance) and
// reconstructed instances, and CM5 must fire on `CohortDefinition` instances
// only. TS-only suite; every expectation is a CPython transcript.
import { describe, expect, it } from "vitest";

import { validateUserParams } from "../../src/query/user-validators.js";
import { validateQueryArgs } from "../../src/query/validation-args.js";
import {
  validateBookmark,
  validateFlowBookmark,
  validateSortingBlock,
} from "../../src/query/validation-bookmark.js";
import { CohortMetric, Filter } from "../../src/types/index.js";

/**
 * Structural twin of the rig's `PyFloat` carrier
 * (`conformance-runner/src/codecs.ts` — the library cannot import rig
 * code): a CLASS instance with a string `spelling` field. The library
 * discriminates carriers from consumer dicts by prototype
 * (`isFloatCarrier` rejects plain objects), so the stub must be a
 * class instance exactly like the real carrier.
 */
class PyFloatStub {
  /** The canonical CPython float spelling. */
  readonly spelling: string;

  /**
   * Wrap a spelling.
   *
   * @param spelling - Canonical CPython `repr(float)` output.
   */
  constructor(spelling: string) {
    this.spelling = spelling;
  }
}

/** A PyFloat carrier for the Python float `5.0`. */
const FLOAT_5 = new PyFloatStub("5.0");

/**
 * Build minimal valid insights bookmark params
 * (`tests/unit/test_validation.py::_minimal_bookmark` shape).
 *
 * @param over - Top-level key overrides.
 * @returns A fresh params dict.
 */
function bm(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sections: {
      show: [{ formula: "A" }],
    },
    displayOptions: { chartType: "line" },
    ...over,
  };
}

/**
 * Project an error list onto its `{path, code, severity}` triples —
 * the contract surface; messages stay advisory.
 *
 * @param errors - Result of a validator call.
 * @returns The comparable triples, emission order preserved.
 */
function triples(
  errors: ReadonlyArray<{ path: string; code: string; severity: string }>,
): Array<{ path: string; code: string; severity: string }> {
  return errors.map((e) => ({
    path: e.path,
    code: e.code,
    severity: e.severity,
  }));
}

describe("float carriers / class instances are not dicts (validateBookmark)", () => {
  it("sections=<float> reports B1_MISSING_SECTIONS, exactly like Python's non-dict sections", () => {
    const errors = validateBookmark(bm({ sections: FLOAT_5 }));
    expect(triples(errors)).toStrictEqual([
      { path: "sections", code: "B1_MISSING_SECTIONS", severity: "error" },
    ]);
  });

  it("sections.time=[<float>] reports B12_INVALID_TIME_UNIT (Python: non-dict time clause)", () => {
    const params = bm();
    (params["sections"] as Record<string, unknown>)["time"] = [FLOAT_5];
    expect(triples(validateBookmark(params))).toStrictEqual([
      {
        path: "sections.time[0]",
        code: "B12_INVALID_TIME_UNIT",
        severity: "error",
      },
    ]);
  });

  it("sections.group=[<float>] reports B17_INVALID_PROPERTY_TYPE (Python: non-dict group clause)", () => {
    const params = bm();
    (params["sections"] as Record<string, unknown>)["group"] = [FLOAT_5];
    expect(triples(validateBookmark(params))).toStrictEqual([
      {
        path: "sections.group[0]",
        code: "B17_INVALID_PROPERTY_TYPE",
        severity: "error",
      },
    ]);
  });

  it("sections.filter=[Filter instance] reports B14_INVALID_FILTER_TYPE (instance is not a dict)", () => {
    const params = bm();
    (params["sections"] as Record<string, unknown>)["filter"] = [
      Filter.equals("a", "b"),
    ];
    expect(triples(validateBookmark(params))).toStrictEqual([
      {
        path: "sections.filter[0]",
        code: "B14_INVALID_FILTER_TYPE",
        severity: "error",
      },
    ]);
  });

  it("show[0].behavior=<float> reports the missing-behavior error (non-dict behavior)", () => {
    const params = bm();
    (params["sections"] as Record<string, unknown>)["show"] = [
      { behavior: FLOAT_5 },
    ];
    expect(triples(validateBookmark(params))).toStrictEqual([
      {
        path: "sections.show[0].behavior",
        code: "B6_MISSING_BEHAVIOR",
        severity: "error",
      },
    ]);
  });

  it("displayOptions=<float> is skipped exactly like Python's isinstance gate", () => {
    expect(validateBookmark(bm({ displayOptions: FLOAT_5 }))).toStrictEqual([]);
  });
});

describe("float carriers / class instances are not dicts (flow + sorting)", () => {
  it("flow steps=[<float>] are skipped (Python's isinstance gate)", () => {
    const errors = validateFlowBookmark({
      steps: [FLOAT_5],
      date_range: {},
      version: 2,
    });
    expect(errors).toStrictEqual([]);
  });

  it("sorting=<float> reports S5_NOT_A_DICT", () => {
    expect(triples(validateSortingBlock(FLOAT_5))).toStrictEqual([
      { path: "sorting", code: "S5_NOT_A_DICT", severity: "error" },
    ]);
  });

  it("params.sorting=<float> reports S5_NOT_A_DICT through validateBookmark", () => {
    expect(triples(validateBookmark(bm({ sorting: FLOAT_5 })))).toStrictEqual([
      { path: "sorting", code: "S5_NOT_A_DICT", severity: "error" },
    ]);
  });

  it("sorting.bar=<float> reports S5 at sorting.bar (model walk)", () => {
    expect(triples(validateSortingBlock({ bar: FLOAT_5 }))).toStrictEqual([
      { path: "sorting.bar", code: "S5_NOT_A_DICT", severity: "error" },
    ]);
  });

  it("table colSortAttrs=[<float>] reports S5 at the element (model walk)", () => {
    const errors = validateSortingBlock({
      table: { sortBy: "column", colSortAttrs: [FLOAT_5] },
    });
    expect(triples(errors)).toStrictEqual([
      {
        path: "sorting.table.colSortAttrs[0]",
        code: "S5_NOT_A_DICT",
        severity: "error",
      },
    ]);
  });
});

describe("CM5 fires on CohortDefinition instances only", () => {
  /** The base kwargs every validateQueryArgs call in this block uses. */
  const BASE = {
    math: "total",
    math_property: null,
    per_user: null,
    from_date: "2024-01-01",
    to_date: "2024-01-31",
    last: 30,
    has_formula: false,
    rolling: null,
    cumulative: false,
    group_by: null,
  } as const;

  it("CohortMetric(cohort=True) passes clean — Python: [] (bool is not a CohortDefinition)", () => {
    // Constructible in BOTH languages: Python's ctor guard is
    // `isinstance(cohort, int) and cohort <= 0` (True passes); TS's
    // `isPyInt(true)` is false so the guard skips.
    const metric = new CohortMetric({
      cohort: true as unknown as number,
    });
    expect(validateQueryArgs({ ...BASE, events: [metric] })).toStrictEqual([]);
    expect(
      validateQueryArgs({ ...BASE, events: ["Login", metric] }),
    ).toStrictEqual([]);
  });

  it("CohortMetric with a float-carrier cohort passes clean — Python: []", () => {
    // `CohortMetric(cohort=5.0)` is ctor-accepted in Python and its
    // cohort field decodes to a PyFloat carrier in the rig's domain.
    const metric = new CohortMetric({
      cohort: FLOAT_5 as unknown as number,
    });
    expect(validateQueryArgs({ ...BASE, events: [metric] })).toStrictEqual([]);
  });
});

describe("a consumer dict carrying a 'spelling' key is a dict, not a carrier", () => {
  // CPython reference: the carrier is
  // a class instance in the rig domain, so a PLAIN `{"spelling": ...}`
  // object must take Python's dict paths.

  it("sections={spelling: '5.0'} is a dict missing 'show' — B3_MISSING_SHOW, exactly like Python", () => {
    const errors = validateBookmark(bm({ sections: { spelling: "5.0" } }));
    expect(triples(errors)).toStrictEqual([
      { path: "sections", code: "B3_MISSING_SHOW", severity: "error" },
    ]);
  });

  it("chartType={spelling: '2.0'} raises Python's unhashable-dict TypeError", () => {
    expect(() =>
      validateBookmark(
        bm({ displayOptions: { chartType: { spelling: "2.0" } } }),
      ),
    ).toThrow(TypeError);
  });

  it("filter value={spelling: 'hi'} is a truthy dict — no missing-property error, no float-literal crash", () => {
    const params = bm();
    (params["sections"] as Record<string, unknown>)["filter"] = [
      { value: { spelling: "hi" } },
    ];
    expect(validateBookmark(params)).toStrictEqual([]);
  });

  it("sorting.bar={spelling: '1.5'} walks the model as a dict (S8/S2/S3)", () => {
    expect(
      triples(validateSortingBlock({ bar: { spelling: "1.5" } })),
    ).toStrictEqual([
      {
        path: "sorting.bar.sortBy",
        code: "S8_MISSING_SORT_BY",
        severity: "error",
      },
      {
        path: "sorting.bar.colSortAttrs",
        code: "S2_MISSING_COL_SORT_ATTRS",
        severity: "error",
      },
      {
        path: "sorting.bar.spelling",
        code: "S3_UNKNOWN_FIELD",
        severity: "error",
      },
    ]);
  });

  it("filter_by_cohort={spelling: '5.0'} is a dict without id/raw_cohort — UP2", () => {
    const errors = validateUserParams({
      filter_by_cohort: { spelling: "5.0" },
    });
    expect(triples(errors)).toStrictEqual([
      { path: "filter_by_cohort", code: "UP2", severity: "error" },
    ]);
  });

  it("filter_by_cohort=<carrier instance> is a Python float — no UP2", () => {
    expect(validateUserParams({ filter_by_cohort: FLOAT_5 })).toStrictEqual([]);
  });
});
