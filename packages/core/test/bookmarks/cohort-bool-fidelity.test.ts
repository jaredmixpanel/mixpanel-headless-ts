/**
 * Red-first locks for B3 arbiter fix **F1** (`b3-review-resolution.md`,
 * 2026-08-15; fidelity-lens finding F1, oracle-confirmed on both
 * bridges): Python `bool` IS `int` (`bool <: int`), so every
 * `isinstance(cohort, int)` site in the cohort path must accept
 * booleans exactly as CPython does — ratified Discrepancy #8 makes a
 * boolean cohort id IN-annotation (`cohort: int | CohortDefinition`),
 * and b3-packets Caution #11 states the direction flips per site.
 *
 * Reference outputs below are **oracle-py transcripts** (CPython
 * 3.14.6, `ts-port/phase2-contract-support` HEAD, probe
 * `/tmp/b3-bool-cohort-probe.py` re-run by the arbiter 2026-08-15):
 *
 * - `build_group_section(CohortBreakdown(True, "N"))` → a SAVED-cohort
 *   entry with `id: true, groups: []` (never the inline branch — the
 *   pre-fix TS crashed `TypeError: cb.cohort.toDict is not a
 *   function` here).
 * - `CohortBreakdown(False)` / `CohortMetric(False)` /
 *   `Filter.in_cohort(False)` → CB1/CM1/CF1 (`False <= 0` is True in
 *   Python; the pre-fix TS guard skipped booleans and constructed).
 * - `Filter.in_cohort(True)._value` →
 *   `[{"cohort": {"negated": false, "name": "", "id": true}}]`.
 *
 * The boolean is passed through an `as unknown as number` cast: the
 * compile-time signature stays `number | CohortDefinition` (TS
 * consumers are policed by the compiler), but the RUNTIME domain
 * includes booleans — the rig's vector codecs reconstruct
 * `CohortBreakdown` through this constructor with whatever JSON
 * carried, and JSON `true` is exactly what Python transports for a
 * `True` cohort id.
 */

import { describe, expect, it } from "vitest";

import { buildGroupSection } from "../../src/bookmarks/builders.js";
import { ParamValidationError } from "../../src/errors.js";
import {
  CohortBreakdown,
  CohortMetric,
  Filter,
} from "../../src/types/index.js";

/** `true` smuggled past the compile-time `number | CohortDefinition`. */
const TRUE_COHORT = true as unknown as number;

/** `false` smuggled past the compile-time `number | CohortDefinition`. */
const FALSE_COHORT = false as unknown as number;

describe("bool <: int — buildCohortGroupEntry saved-id branch (arbiter F1)", () => {
  it("CohortBreakdown(true) takes the SAVED branch: id: true, groups: []", () => {
    // oracle-py: build_group_section(CohortBreakdown(True, "N"))
    const section = buildGroupSection(
      new CohortBreakdown({ cohort: TRUE_COHORT, name: "N" }),
    );
    expect(section).toEqual([
      {
        value: ["N", "Not In N"],
        resourceType: "events",
        profileType: null,
        search: "",
        dataGroupId: null,
        propertyType: null,
        typeCast: null,
        cohorts: [
          {
            name: "N",
            negated: false,
            data_group_id: null,
            id: true,
            groups: [],
          },
          {
            name: "N",
            negated: true,
            data_group_id: null,
            id: true,
            groups: [],
          },
        ],
        isHidden: false,
      },
    ]);
    // Key INSERTION order is contract (Caution #13) — byte-diff the
    // serialized form against the CPython json.dumps transcript.
    expect(JSON.stringify(section)).toBe(
      '[{"value":["N","Not In N"],"resourceType":"events","profileType":null,' +
        '"search":"","dataGroupId":null,"propertyType":null,"typeCast":null,' +
        '"cohorts":[{"name":"N","negated":false,"data_group_id":null,"id":true,' +
        '"groups":[]},{"name":"N","negated":true,"data_group_id":null,"id":true,' +
        '"groups":[]}],"isHidden":false}]',
    );
  });

  it("include_negated=false keeps the single saved entry", () => {
    // oracle-py: build_group_section(CohortBreakdown(True, "N",
    // include_negated=False))
    const section = buildGroupSection(
      new CohortBreakdown({
        cohort: TRUE_COHORT,
        name: "N",
        include_negated: false,
      }),
    );
    expect(section).toEqual([
      {
        value: ["N"],
        resourceType: "events",
        profileType: null,
        search: "",
        dataGroupId: null,
        propertyType: null,
        typeCast: null,
        cohorts: [
          {
            name: "N",
            negated: false,
            data_group_id: null,
            id: true,
            groups: [],
          },
        ],
        isHidden: false,
      },
    ]);
  });
});

describe("bool <: int — ctor guards fire CB1/CM1/CF1 for false (arbiter F1 sweep)", () => {
  it("CohortBreakdown(false) fires CB1 exactly like Python's False <= 0", () => {
    let thrown: unknown;
    try {
      new CohortBreakdown({ cohort: FALSE_COHORT });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ParamValidationError);
    expect((thrown as ParamValidationError).code).toBe(
      "CB1_COHORT_ID_NOT_POSITIVE",
    );
  });

  it("CohortBreakdown(true) constructs (True <= 0 is False in Python)", () => {
    const cb = new CohortBreakdown({ cohort: TRUE_COHORT });
    expect(cb.cohort).toBe(true);
  });

  it("CohortMetric(false) fires CM1", () => {
    let thrown: unknown;
    try {
      new CohortMetric({ cohort: FALSE_COHORT });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ParamValidationError);
    expect((thrown as ParamValidationError).code).toBe(
      "CM1_COHORT_ID_NOT_POSITIVE",
    );
  });

  it("CohortMetric(true) constructs and keeps the boolean id", () => {
    const cm = new CohortMetric({ cohort: TRUE_COHORT });
    expect(cm.cohort).toBe(true);
  });
});

describe("bool <: int — Filter.inCohort saved-id branch (arbiter F1 sweep)", () => {
  it("inCohort(true) emits {id: true} — the saved-cohort entry", () => {
    // oracle-py: Filter.in_cohort(True)._value
    const f = Filter.inCohort(TRUE_COHORT);
    expect(f._property).toBe("$cohorts");
    expect(f._operator).toBe("contains");
    expect(f._value).toEqual([
      { cohort: { negated: false, name: "", id: true } },
    ]);
    // Entry key insertion order: negated, name, id (Python dict literal).
    expect(JSON.stringify(f._value)).toBe(
      '[{"cohort":{"negated":false,"name":"","id":true}}]',
    );
  });

  it("notInCohort(true, name) negates and keeps id: true", () => {
    // oracle-py: Filter.not_in_cohort(True, "VIPs")._value
    const f = Filter.notInCohort(TRUE_COHORT, "VIPs");
    expect(f._operator).toBe("does not contain");
    expect(f._value).toEqual([
      { cohort: { negated: true, name: "VIPs", id: true } },
    ]);
  });

  it("inCohort(false) fires CF1", () => {
    let thrown: unknown;
    try {
      Filter.inCohort(FALSE_COHORT);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ParamValidationError);
    expect((thrown as ParamValidationError).code).toBe(
      "CF1_COHORT_ID_NOT_POSITIVE",
    );
  });
});
