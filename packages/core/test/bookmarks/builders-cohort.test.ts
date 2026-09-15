/**
 * Layer-3 translation of the `bookmark_builders.py` test corpus
 * (Python revision: `ts-port/phase2-contract-support` HEAD).
 *
 * Sources translated here, per b3-packets.md §"Packet K2":
 *
 * | Python file | classes translated |
 * |---|---|
 * | `tests/unit/test_bookmark_builders.py` (1,396 LOC, 18 classes) | all 18 |
 * | `tests/test_custom_property_builders.py` (461 LOC) | `TestBuildComposedProperties`, `TestBuildGroupSectionCustomProperties`, `TestBuildFilterEntryCustomProperties` |
 *
 * **Deferrals (header citations, R10.1):**
 *
 * - `tests/test_custom_property_builders.py::TestMeasurementPropertyBuilder`
 *   drives `Workspace.build_params` → **B5-S2** (no implementation exists
 *   to test at B3). The packet flags this file as a playbook omission that
 *   is nonetheless IN scope for its builder-direct classes (15 measured K2
 *   vectors come from it).
 * - `tests/unit/test_bookmark_builders_pbt.py`'s three equivalence classes
 *   (`TestTimeSectionEquivalence`, `TestFilterSectionEquivalence`,
 *   `TestGroupSectionEquivalence`) assert
 *   `ws._build_query_params(...) == build_*(...)` → **B5-S2**. Only
 *   `TestListContainsRoundTrip` is builder-direct; it is translated as a
 *   fast-check property in `builders.pbt.test.ts`.
 * - `tests/test_build_cohort_params.py` and `tests/test_query_params.py`
 *   are B5-owned files (playbook B5 row); their K2 vectors replay at the
 *   B3 gate regardless (vector api gates, not test-file ownership). The
 *   `buildFlowCohortFilter` describe block below is therefore marked
 *   `// NEW` and cites the corpus vector ids it mirrors.
 *
 * R10.2: assertion-for-assertion, codes not messages. Python
 * `pytest.raises(TypeError, match=…)` pairs become
 * `toThrow(ParamTypeError)` plus an explicit `.code` assertion, since
 * `ParamTypeError`/`ParamValidationError` are the ported twins of
 * Python's `TypeError`/`ValueError` subclasses (the "stays catchable as
 * TypeError/ValueError" asserts translate to the base-class check —
 * see `errors.ts`).
 */

import { describe, expect, it } from "vitest";

import {
  buildFlowCohortFilter,
  buildGroupSection,
} from "../../src/bookmarks/builders.js";
import { ParamValidationError } from "../../src/errors.js";
import {
  CohortBreakdown,
  CohortCriteria,
  CohortDefinition,
  Filter,
} from "../../src/types/index.js";
import { expectThrows } from "../../test-support/raises.js";

// =============================================================================
// NEW — buildFlowCohortFilter (`bookmark_builders.py`)
//
// `tests/test_build_cohort_params.py` is a B5-owned Layer-3 file (packet
// §K2 "Layer-3 test translation" defers it), but its 16
// `build_flow_cohort_filter` vectors replay at the B3 gate. These cases
// mirror those corpus vector ids one-for-one:
//   filters/bookmark_builders.build_flow_cohort_filter/
//     test_build_cohort_params-testbuildflowcohortfilterdirect-*
//     test_build_cohort_params-testcodedflowcohortfiltercodes-*
// =============================================================================

describe("buildFlowCohortFilter (NEW — corpus-vector mirrors)", () => {
  it("saved cohort filter", () => {
    const f = Filter.inCohort(123, "PU");
    expect(buildFlowCohortFilter(f)).toStrictEqual({
      name: "PU",
      negated: false,
      id: 123,
    });
  });

  it("not in cohort negated", () => {
    const f = Filter.notInCohort(123, "Bots");
    expect(buildFlowCohortFilter(f)).toStrictEqual({
      name: "Bots",
      negated: true,
      id: 123,
    });
  });

  it("inline cohort filter carries raw_cohort, not id", () => {
    const definition = CohortDefinition.allOf(
      CohortCriteria.didEvent("Purchase", { at_least: 1, within_days: 30 }),
    );
    const f = Filter.inCohort(definition, "Active");
    const result = buildFlowCohortFilter(f);
    expect(result).not.toBeNull();
    expect(result!["name"]).toBe("Active");
    expect(result!["negated"]).toBe(false);
    expect(Object.hasOwn(result!, "raw_cohort")).toBe(true);
    expect(Object.hasOwn(result!, "id")).toBe(false);
  });

  it("empty list returns null", () => {
    expect(buildFlowCohortFilter([])).toBeNull();
  });

  it("BB4 — a non-cohort property filter raises", () => {
    const error = expectThrows(
      () => buildFlowCohortFilter([Filter.equals("country", "US")]),
      "expected ParamValidationError",
    );
    expect(error).toBeInstanceOf(ParamValidationError);
    expect((error as ParamValidationError).code).toBe(
      "BB4_FLOW_COHORT_FILTER_TYPE",
    );
  });

  it("BB4 fires before BB5 (guard order is Python source order)", () => {
    // Python loops all filters for BB4 BEFORE the len>1 BB5 check.
    const error = expectThrows(
      () =>
        buildFlowCohortFilter([
          Filter.inCohort(1, "A"),
          Filter.equals("country", "US"),
        ]),
      "expected ParamValidationError",
    );
    expect((error as ParamValidationError).code).toBe(
      "BB4_FLOW_COHORT_FILTER_TYPE",
    );
  });

  it("BB5 — two cohort filters raise", () => {
    const error = expectThrows(
      () =>
        buildFlowCohortFilter([
          Filter.inCohort(1, "A"),
          Filter.inCohort(2, "B"),
        ]),
      "expected ParamValidationError",
    );
    expect((error as ParamValidationError).code).toBe(
      "BB5_FLOW_MULTIPLE_COHORT_FILTERS",
    );
  });

  it("BB6 — non-list _value raises", () => {
    const f = new Filter({
      _property: "$cohorts",
      _operator: "contains",
      _value: "oops",
      _property_type: "list",
      _resource_type: "events",
    });
    const error = expectThrows(
      () => buildFlowCohortFilter(f),
      "expected ParamValidationError",
    );
    expect((error as ParamValidationError).code).toBe(
      "BB6_COHORT_VALUE_NOT_LIST",
    );
  });

  it("BB6 — empty-list _value raises (len check, not truthiness)", () => {
    const f = new Filter({
      _property: "$cohorts",
      _operator: "contains",
      _value: [],
      _property_type: "list",
      _resource_type: "events",
    });
    const error = expectThrows(
      () => buildFlowCohortFilter(f),
      "expected ParamValidationError",
    );
    expect((error as ParamValidationError).code).toBe(
      "BB6_COHORT_VALUE_NOT_LIST",
    );
  });

  it("BB7 — non-dict first item raises (isPythonDict, watchlist #13)", () => {
    for (const value of [[42], ["cohort"]]) {
      const f = new Filter({
        _property: "$cohorts",
        _operator: "contains",
        _value: value,
        _property_type: "list",
        _resource_type: "events",
      });
      const error = expectThrows(
        () => buildFlowCohortFilter(f),
        "expected ParamValidationError",
      );
      expect((error as ParamValidationError).code).toBe(
        "BB7_COHORT_VALUE_NOT_DICT",
      );
    }
  });

  it("BB8 — missing/non-dict 'cohort' key raises", () => {
    for (const value of [[{}], [{ cohort: "nope" }]]) {
      const f = new Filter({
        _property: "$cohorts",
        _operator: "contains",
        _value: value,
        _property_type: "list",
        _resource_type: "events",
      });
      const error = expectThrows(
        () => buildFlowCohortFilter(f),
        "expected ParamValidationError",
      );
      expect((error as ParamValidationError).code).toBe(
        "BB8_COHORT_KEY_MISSING",
      );
    }
  });

  it("BB guards stay catchable as ValueError analogues", () => {
    expect(() =>
      buildFlowCohortFilter([Filter.equals("country", "US")]),
    ).toThrow(ParamValidationError);
  });

  it("name defaults to '' when the cohort dict has no name key", () => {
    const f = new Filter({
      _property: "$cohorts",
      _operator: "contains",
      _value: [{ cohort: { id: 9 } }],
      _property_type: "list",
      _resource_type: "events",
    });
    expect(buildFlowCohortFilter(f)).toStrictEqual({
      name: "",
      negated: false,
      id: 9,
    });
  });

  it("a single Filter (not a list) is wrapped — `isinstance(where, list)`", () => {
    // NOTE the asymmetry with buildFilterSection: this site tests
    // `list` ONLY, not `(list, tuple)`.
    expect(buildFlowCohortFilter(Filter.inCohort(5, "X"))).toStrictEqual({
      name: "X",
      negated: false,
      id: 5,
    });
  });
});

// =============================================================================
// NEW — buildCohortGroupEntry reached through buildGroupSection
// (`bookmark_builders.py`)
// =============================================================================

describe("buildGroupSection — CohortBreakdown entries (NEW)", () => {
  it("saved cohort produces id + empty groups and both labels", () => {
    const entry = buildGroupSection(
      new CohortBreakdown({ cohort: 123, name: "PU" }),
    )[0]!;
    expect(entry["value"]).toStrictEqual(["PU", "Not In PU"]);
    expect(entry["resourceType"]).toBe("events");
    expect(entry["profileType"]).toBeNull();
    expect(entry["search"]).toBe("");
    expect(entry["dataGroupId"]).toBeNull();
    expect(entry["propertyType"]).toBeNull();
    expect(entry["typeCast"]).toBeNull();
    expect(entry["isHidden"]).toBe(false);
    const cohorts = entry["cohorts"] as Array<Record<string, unknown>>;
    expect(cohorts).toHaveLength(2);
    expect(cohorts[0]).toStrictEqual({
      name: "PU",
      negated: false,
      data_group_id: null,
      id: 123,
      groups: [],
    });
    expect(cohorts[1]!["negated"]).toBe(true);
  });

  it("include_negated=false emits one cohort and one label", () => {
    const entry = buildGroupSection(
      new CohortBreakdown({
        cohort: 123,
        name: "PU",
        include_negated: false,
      }),
    )[0]!;
    expect(entry["value"]).toStrictEqual(["PU"]);
    expect(entry["cohorts"] as unknown[]).toHaveLength(1);
  });

  it("name=null collapses to '' in both the entry and the label", () => {
    // `name = cb.name or ""` — falsy-OR catches None AND "" (caution 10).
    const entry = buildGroupSection(new CohortBreakdown({ cohort: 7 }))[0]!;
    expect(entry["value"]).toStrictEqual(["", "Not In "]);
    const cohorts = entry["cohorts"] as Array<Record<string, unknown>>;
    expect(cohorts[0]!["name"]).toBe("");
  });

  it("the negated copy is a SHALLOW spread of the base cohort", () => {
    // `{**base_cohort, "negated": True}` (`:453`) — `groups` is the SAME
    // array instance in both entries (caution 14: do not deep-copy).
    const entry = buildGroupSection(
      new CohortBreakdown({ cohort: 123, name: "PU" }),
    )[0]!;
    const cohorts = entry["cohorts"] as Array<Record<string, unknown>>;
    expect(cohorts[0]!["groups"]).toBe(cohorts[1]!["groups"]);
  });

  it("inline cohort emits raw_cohort instead of id/groups", () => {
    const definition = CohortDefinition.allOf(
      CohortCriteria.didEvent("Purchase", { at_least: 1, within_days: 30 }),
    );
    const entry = buildGroupSection(
      new CohortBreakdown({ cohort: definition, name: "Active" }),
    )[0]!;
    const cohorts = entry["cohorts"] as Array<Record<string, unknown>>;
    expect(Object.hasOwn(cohorts[0]!, "raw_cohort")).toBe(true);
    expect(Object.hasOwn(cohorts[0]!, "id")).toBe(false);
    expect(Object.hasOwn(cohorts[0]!, "groups")).toBe(false);
  });
});
