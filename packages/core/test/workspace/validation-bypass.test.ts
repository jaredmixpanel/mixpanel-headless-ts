// Validation-bypass regressions through the Workspace facade: custom-property
// ids and formulas in metric / funnel-step filters, inline cohorts, warning-only
// enums and corrupted show clauses. Mirrors tests/test_validation_bypass.py
// (all eight classes). `pytest.raises(..., match=)` becomes an error-class plus
// message-substring pair; the TS messages are transcribed verbatim from Python.

import { describe, expect, it } from "vitest";

import {
  BookmarkValidationError,
  ParamValidationError,
  type ValidationError,
} from "../../src/errors.js";
import { validateBookmark } from "../../src/query/validation-bookmark.js";
import {
  CohortBreakdown,
  CohortCriteria,
  CohortDefinition,
} from "../../src/types/query-params/cohort.js";
import {
  CustomPropertyRef,
  Filter,
  InlineCustomProperty,
  PropertyInput,
} from "../../src/types/query-params/filter.js";
import { FunnelStep } from "../../src/types/query-params/funnel.js";
import { Metric } from "../../src/types/query-params/metric.js";
import { makeStubWorkspace } from "../../test-support/workspace-test-helpers.js";

/** `_has_error(errors)` . */
function hasError(errors: readonly ValidationError[]): boolean {
  return errors.some((e) => e.severity === "error");
}

/** Index into `params.sections.show[i]` the way Python subscripts do. */
function showClause(
  params: Record<string, unknown>,
  index: number,
): Record<string, unknown> {
  const sections = params["sections"] as Record<string, unknown>;
  const show = sections["show"] as Array<Record<string, unknown>>;
  return show[index]!;
}

/** Index into `params.sections.group[i]`. */
function groupEntry(
  params: Record<string, unknown>,
  index: number,
): Record<string, unknown> {
  const sections = params["sections"] as Record<string, unknown>;
  const group = sections["group"] as Array<Record<string, unknown>>;
  return group[index]!;
}

// --- Vector 1 — CustomPropertyRef(0) in Metric.filters ---

describe("Vector 1 metric filter CP fixed", () => {
  // python: TestVector1MetricFilterCPFixed
  it("CustomPropertyRef(0) in Metric.filters raises", async () => {
    await expect(
      makeStubWorkspace().buildParams(
        new Metric({
          event: "AnyEvent",
          filters: [Filter.isSet(new CustomPropertyRef({ id: 0 }))],
        }),
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams(
        new Metric({
          event: "AnyEvent",
          filters: [Filter.isSet(new CustomPropertyRef({ id: 0 }))],
        }),
        { last: 7 },
      ),
    ).rejects.toThrow(/positive integer/);
  });

  it("CustomPropertyRef(-1) in Metric.filters raises", async () => {
    await expect(
      makeStubWorkspace().buildParams(
        new Metric({
          event: "AnyEvent",
          filters: [Filter.isSet(new CustomPropertyRef({ id: -1 }))],
        }),
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams(
        new Metric({
          event: "AnyEvent",
          filters: [Filter.isSet(new CustomPropertyRef({ id: -1 }))],
        }),
        { last: 7 },
      ),
    ).rejects.toThrow(/positive integer/);
  });

  it("CustomPropertyRef(42) in Metric.filters passes", async () => {
    const params = await makeStubWorkspace().buildParams(
      new Metric({
        event: "AnyEvent",
        filters: [Filter.isSet(new CustomPropertyRef({ id: 42 }))],
      }),
      { last: 7 },
    );
    expect(Object.hasOwn(params, "sections")).toBe(true);
  });

  it("the bookmark schema layer also catches an invalid customPropertyId", async () => {
    const params = await makeStubWorkspace().buildParams(
      new Metric({
        event: "AnyEvent",
        filters: [Filter.isSet(new CustomPropertyRef({ id: 42 }))],
      }),
      { last: 7 },
    );
    // Mutate to inject an invalid ID after build (simulating an L2-only check)
    const behavior = showClause(params, 0)["behavior"] as Record<
      string,
      unknown
    >;
    const filters = behavior["filters"] as Array<Record<string, unknown>>;
    filters[0]!["customPropertyId"] = 0;

    const errors = validateBookmark(params);
    expect(hasError(errors)).toBe(true);
    expect(errors.some((e) => e.code.includes("B18B"))).toBe(true);
  });
});

// --- Vector 2 — CustomPropertyRef(0) in FunnelStep.filters ---

describe("Vector 2 funnel step filter CP fixed", () => {
  // python: TestVector2FunnelStepFilterCPFixed
  it("CustomPropertyRef(0) in FunnelStep.filters raises", async () => {
    await expect(
      makeStubWorkspace().buildFunnelParams(
        [
          new FunnelStep({
            event: "Step1",
            filters: [Filter.isSet(new CustomPropertyRef({ id: 0 }))],
          }),
          "Step2",
        ],
        { last: 30 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildFunnelParams(
        [
          new FunnelStep({
            event: "Step1",
            filters: [Filter.isSet(new CustomPropertyRef({ id: 0 }))],
          }),
          "Step2",
        ],
        { last: 30 },
      ),
    ).rejects.toThrow(/positive integer/);
  });

  it("CustomPropertyRef(42) in FunnelStep.filters passes", async () => {
    const params = await makeStubWorkspace().buildFunnelParams(
      [
        new FunnelStep({
          event: "Step1",
          filters: [Filter.isSet(new CustomPropertyRef({ id: 42 }))],
        }),
        "Step2",
      ],
      { last: 30 },
    );
    expect(Object.hasOwn(params, "sections")).toBe(true);
  });
});

// --- Vector 3 (design choice) — inline CohortDefinition in CohortBreakdown ---

describe("Vector 3 inline cohort design choice", () => {
  // python: TestVector3InlineCohortDesignChoice
  it("an inline CohortDefinition breakdown passes both layers", async () => {
    const criteria = CohortCriteria.didEvent("FakeEvent", {
      at_least: 1,
      within_days: 30,
    });
    const defn = new CohortDefinition(criteria);
    const params = await makeStubWorkspace().buildParams("AnyEvent", {
      group_by: new CohortBreakdown({ cohort: defn, name: "Test Cohort" }),
      last: 7,
    });
    expect(Object.hasOwn(params, "sections")).toBe(true);
  });

  it("CohortCriteria.did_event('') raises at construction", () => {
    expect(() =>
      CohortCriteria.didEvent("", { at_least: 1, within_days: 30 }),
    ).toThrow(ParamValidationError);
    expect(() =>
      CohortCriteria.didEvent("", { at_least: 1, within_days: 30 }),
    ).toThrow(/non-empty/);
  });

  it("raw_cohort is present in the group section", async () => {
    const criteria = CohortCriteria.didEvent("FakeEvent", {
      at_least: 1,
      within_days: 30,
    });
    const defn = new CohortDefinition(criteria);
    const params = await makeStubWorkspace().buildParams("AnyEvent", {
      group_by: new CohortBreakdown({ cohort: defn, name: "Test Cohort" }),
      last: 7,
    });

    const cohorts = groupEntry(params, 0)["cohorts"] as Array<
      Record<string, unknown>
    >;
    expect(cohorts.some((c) => Object.hasOwn(c, "raw_cohort"))).toBe(true);
    expect(hasError(validateBookmark(params))).toBe(false);
  });
});

// --- Vector 4 (design choice) — warning-only enum severity ---

describe("Vector 4 warning only enum design choice", () => {
  // python: TestVector4WarningOnlyEnumDesignChoice
  it("an invalid resourceType is a warning, not an error", async () => {
    const params = await makeStubWorkspace().buildParams("AnyEvent", {
      group_by: "country",
      last: 7,
    });
    groupEntry(params, 0)["resourceType"] = "BOGUS_TYPE";

    const errors = validateBookmark(params);
    const resourceErrors = errors.filter((e) => e.code.includes("B16"));
    expect(resourceErrors.length).toBeGreaterThan(0);
    expect(resourceErrors.every((e) => e.severity === "warning")).toBe(true);
    expect(hasError(errors)).toBe(false);
  });

  it("an invalid propertyType is a warning, not an error", async () => {
    const params = await makeStubWorkspace().buildParams("AnyEvent", {
      group_by: "country",
      last: 7,
    });
    groupEntry(params, 0)["propertyType"] = "FAKE_TYPE";

    const errors = validateBookmark(params);
    const propErrors = errors.filter((e) => e.code.includes("B17"));
    expect(propErrors.length).toBeGreaterThan(0);
    expect(propErrors.every((e) => e.severity === "warning")).toBe(true);
    expect(hasError(errors)).toBe(false);
  });

  it("an invalid behavior.type is a warning, not an error", async () => {
    const params = await makeStubWorkspace().buildParams("AnyEvent", {
      last: 7,
    });
    const behavior = showClause(params, 0)["behavior"] as Record<
      string,
      unknown
    >;
    behavior["type"] = "NONEXISTENT";

    const errors = validateBookmark(params);
    const b7Errors = errors.filter((e) => e.code.includes("B7"));
    expect(b7Errors.length).toBeGreaterThan(0);
    expect(b7Errors.every((e) => e.severity === "warning")).toBe(true);
  });
});

// --- Vector 5 — negative CustomPropertyRef ID ---

describe("Vector 5 negative CP ref fixed", () => {
  // python: TestVector5NegativeCPRefFixed
  it("CustomPropertyRef(-1) raises", async () => {
    await expect(
      makeStubWorkspace().buildParams(
        new Metric({
          event: "AnyEvent",
          filters: [Filter.isSet(new CustomPropertyRef({ id: -1 }))],
        }),
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams(
        new Metric({
          event: "AnyEvent",
          filters: [Filter.isSet(new CustomPropertyRef({ id: -1 }))],
        }),
        { last: 7 },
      ),
    ).rejects.toThrow(/positive integer/);
  });

  it("CustomPropertyRef(-999999) raises", async () => {
    await expect(
      makeStubWorkspace().buildParams(
        new Metric({
          event: "AnyEvent",
          filters: [Filter.isSet(new CustomPropertyRef({ id: -999999 }))],
        }),
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams(
        new Metric({
          event: "AnyEvent",
          filters: [Filter.isSet(new CustomPropertyRef({ id: -999999 }))],
        }),
        { last: 7 },
      ),
    ).rejects.toThrow(/positive integer/);
  });
});

// --- Vector 6 — empty-formula InlineCustomProperty ---

describe("Vector 6 empty formula fixed", () => {
  // python: TestVector6EmptyFormulaFixed
  it("an empty formula in a per-metric filter raises", async () => {
    const badCp = new InlineCustomProperty({
      formula: "",
      inputs: { A: new PropertyInput({ name: "$browser" }) },
    });
    await expect(
      makeStubWorkspace().buildParams(
        new Metric({ event: "AnyEvent", filters: [Filter.isSet(badCp)] }),
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams(
        new Metric({ event: "AnyEvent", filters: [Filter.isSet(badCp)] }),
        { last: 7 },
      ),
    ).rejects.toThrow(/non-empty/);
  });

  it("a valid InlineCustomProperty in Metric.filters passes", async () => {
    const goodCp = new InlineCustomProperty({
      formula: "A",
      inputs: { A: new PropertyInput({ name: "$browser" }) },
    });
    const params = await makeStubWorkspace().buildParams(
      new Metric({ event: "AnyEvent", filters: [Filter.isSet(goodCp)] }),
      { last: 7 },
    );
    expect(Object.hasOwn(params, "sections")).toBe(true);
  });
});

// --- Vector 7 — formula show-clause injection ---

describe("Vector 7 formula show clause fixed", () => {
  // python: TestVector7FormulaShowClauseFixed
  it("a hybrid clause (formula + behavior) still validates the behavior", async () => {
    const params = await makeStubWorkspace().buildParams("AnyEvent", {
      last: 7,
    });
    // Inject a formula key into a valid show clause — creates a hybrid
    showClause(params, 0)["formula"] = "";

    // Valid behavior + formula key -> behavior still validated, no errors
    expect(hasError(validateBookmark(params))).toBe(false);
  });

  it("a corrupted behavior is detected despite the formula key", async () => {
    const params = await makeStubWorkspace().buildParams("AnyEvent", {
      last: 7,
    });
    const behavior = showClause(params, 0)["behavior"] as Record<
      string,
      unknown
    >;
    behavior["type"] = "INVALID";
    // Attempt to hide it with a formula key — no longer works
    showClause(params, 0)["formula"] = "";

    const errors = validateBookmark(params);
    const b7Errors = errors.filter((e) => e.code.includes("B7"));
    expect(b7Errors.length).toBeGreaterThan(0);
    // The behavior-type rule is intentionally severity="warning" (forward
    // compatibility).
    expect(b7Errors.every((e) => e.severity === "warning")).toBe(true);
  });
});

// --- Combined ---

describe("Combined fixes", () => {
  // python: TestCombinedFixes
  it("an invalid CP ID in Metric.filters is caught alongside other params", async () => {
    await expect(
      makeStubWorkspace().buildParams(
        new Metric({
          event: "AnyEvent",
          filters: [Filter.isSet(new CustomPropertyRef({ id: 0 }))],
        }),
        { group_by: "country", last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams(
        new Metric({
          event: "AnyEvent",
          filters: [Filter.isSet(new CustomPropertyRef({ id: 0 }))],
        }),
        { group_by: "country", last: 7 },
      ),
    ).rejects.toThrow(/positive integer/);
  });

  it("an empty-formula CP in FunnelStep.filters is caught", async () => {
    const badCp = new InlineCustomProperty({
      formula: "",
      inputs: { A: new PropertyInput({ name: "$browser" }) },
    });
    await expect(
      makeStubWorkspace().buildFunnelParams(
        [
          new FunnelStep({ event: "Step1", filters: [Filter.isSet(badCp)] }),
          "Step2",
        ],
        { last: 30 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildFunnelParams(
        [
          new FunnelStep({ event: "Step1", filters: [Filter.isSet(badCp)] }),
          "Step2",
        ],
        { last: 30 },
      ),
    ).rejects.toThrow(/non-empty/);
  });
});
