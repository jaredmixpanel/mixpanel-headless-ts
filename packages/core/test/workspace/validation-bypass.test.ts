// Translated validation-bypass tests (B5-S2, packet §3 + §8): the B2-M2
// WHOLE-FILE deferral (`B2-M2-notes.md:120-132`,
// `validation-bookmark.test.ts:14-27` header) — assertion-for-assertion
// port of tests/test_validation_bypass.py, ALL 8 classes
// (TestVector1MetricFilterCPFixed :78,
// TestVector2FunnelStepFilterCPFixed :138,
// TestVector3InlineCohortDesignChoice :178,
// TestVector4WarningOnlyEnumDesignChoice :224,
// TestVector5NegativeCPRefFixed :270, TestVector6EmptyFormulaFixed :301,
// TestVector7FormulaShowClauseFixed :340, TestCombinedFixes :383).
//
// Translation notes:
// - The `ws` fixture builds a Workspace over the shared stub client; the
//   Python fixture also builds an unused `MagicMock()` ConfigManager
//   (dead since the 042 session redesign) which has no TS twin.
// - `pytest.raises(BookmarkValidationError, match="positive integer")`
//   translates to a class + message-substring assertion PAIR
//   (`.rejects.toBeInstanceOf` + `.rejects.toThrow`). The class half
//   was omitted by the original S2 translation despite this header —
//   added at B5-ARB (`b5-review-resolution.md` ASR-F1). R5.4 puts
//   message TEXT out of the VECTOR contract, but these Layer-3 cases
//   assert on it in Python, so the substrings are matched here too (the
//   TS messages are transcribed verbatim from Python).
// - The `params["sections"]["show"][0][...] = X` mutations index the
//   plain params dict exactly as Python does.

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
import { Workspace } from "../../src/workspace.js";
import {
  mockWorkspaceClient,
  TEST_SESSION,
} from "../../test-support/workspace-test-helpers.js";

/**
 * The `ws` fixture.
 *
 * @returns A Workspace with mocked dependencies (no network).
 */
function makeWs(): Workspace {
  return new Workspace({
    session: TEST_SESSION,
    client: mockWorkspaceClient().client,
  });
}

/** `_has_error(errors)` (test file :70-72). */
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

// ===========================================================================
// FIXED: Vector 1 — CustomPropertyRef(0) in Metric.filters
// ===========================================================================

describe("TestVector1MetricFilterCPFixed", () => {
  it("CustomPropertyRef(0) in Metric.filters raises", async () => {
    await expect(
      makeWs().buildParams(
        new Metric({
          event: "AnyEvent",
          filters: [Filter.isSet(new CustomPropertyRef({ id: 0 }))],
        }),
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeWs().buildParams(
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
      makeWs().buildParams(
        new Metric({
          event: "AnyEvent",
          filters: [Filter.isSet(new CustomPropertyRef({ id: -1 }))],
        }),
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeWs().buildParams(
        new Metric({
          event: "AnyEvent",
          filters: [Filter.isSet(new CustomPropertyRef({ id: -1 }))],
        }),
        { last: 7 },
      ),
    ).rejects.toThrow(/positive integer/);
  });

  it("CustomPropertyRef(42) in Metric.filters passes", async () => {
    const params = await makeWs().buildParams(
      new Metric({
        event: "AnyEvent",
        filters: [Filter.isSet(new CustomPropertyRef({ id: 42 }))],
      }),
      { last: 7 },
    );
    expect(Object.hasOwn(params, "sections")).toBe(true);
  });

  it("L2 B18b also catches an invalid customPropertyId", async () => {
    const params = await makeWs().buildParams(
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

// ===========================================================================
// FIXED: Vector 2 — CustomPropertyRef(0) in FunnelStep.filters
// ===========================================================================

describe("TestVector2FunnelStepFilterCPFixed", () => {
  it("CustomPropertyRef(0) in FunnelStep.filters raises", async () => {
    await expect(
      makeWs().buildFunnelParams(
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
      makeWs().buildFunnelParams(
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
    const params = await makeWs().buildFunnelParams(
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

// ===========================================================================
// DESIGN CHOICE: Vector 3 — inline CohortDefinition in CohortBreakdown
// ===========================================================================

describe("TestVector3InlineCohortDesignChoice", () => {
  it("an inline CohortDefinition breakdown passes both layers", async () => {
    const criteria = CohortCriteria.didEvent("FakeEvent", {
      at_least: 1,
      within_days: 30,
    });
    const defn = new CohortDefinition(criteria);
    const params = await makeWs().buildParams("AnyEvent", {
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
    const params = await makeWs().buildParams("AnyEvent", {
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

// ===========================================================================
// DESIGN CHOICE: Vector 4 — warning-only enum severity
// ===========================================================================

describe("TestVector4WarningOnlyEnumDesignChoice", () => {
  it("an invalid resourceType is a warning, not an error", async () => {
    const params = await makeWs().buildParams("AnyEvent", {
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
    const params = await makeWs().buildParams("AnyEvent", {
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

  it("an invalid behavior.type is a B7 warning", async () => {
    const params = await makeWs().buildParams("AnyEvent", { last: 7 });
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

// ===========================================================================
// FIXED: Vector 5 — negative CustomPropertyRef ID
// ===========================================================================

describe("TestVector5NegativeCPRefFixed", () => {
  it("CustomPropertyRef(-1) raises", async () => {
    await expect(
      makeWs().buildParams(
        new Metric({
          event: "AnyEvent",
          filters: [Filter.isSet(new CustomPropertyRef({ id: -1 }))],
        }),
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeWs().buildParams(
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
      makeWs().buildParams(
        new Metric({
          event: "AnyEvent",
          filters: [Filter.isSet(new CustomPropertyRef({ id: -999999 }))],
        }),
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeWs().buildParams(
        new Metric({
          event: "AnyEvent",
          filters: [Filter.isSet(new CustomPropertyRef({ id: -999999 }))],
        }),
        { last: 7 },
      ),
    ).rejects.toThrow(/positive integer/);
  });
});

// ===========================================================================
// FIXED: Vector 6 — empty-formula InlineCustomProperty
// ===========================================================================

describe("TestVector6EmptyFormulaFixed", () => {
  it("an empty formula in a per-metric filter raises", async () => {
    const badCp = new InlineCustomProperty({
      formula: "",
      inputs: { A: new PropertyInput({ name: "$browser" }) },
    });
    await expect(
      makeWs().buildParams(
        new Metric({ event: "AnyEvent", filters: [Filter.isSet(badCp)] }),
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeWs().buildParams(
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
    const params = await makeWs().buildParams(
      new Metric({ event: "AnyEvent", filters: [Filter.isSet(goodCp)] }),
      { last: 7 },
    );
    expect(Object.hasOwn(params, "sections")).toBe(true);
  });
});

// ===========================================================================
// FIXED: Vector 7 — formula show-clause injection
// ===========================================================================

describe("TestVector7FormulaShowClauseFixed", () => {
  it("a hybrid clause (formula + behavior) still validates the behavior", async () => {
    const params = await makeWs().buildParams("AnyEvent", { last: 7 });
    // Inject a formula key into a valid show clause — creates a hybrid
    showClause(params, 0)["formula"] = "";

    // Valid behavior + formula key -> behavior still validated, no errors
    expect(hasError(validateBookmark(params))).toBe(false);
  });

  it("a corrupted behavior is detected despite the formula key", async () => {
    const params = await makeWs().buildParams("AnyEvent", { last: 7 });
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
    // B7 is intentionally severity="warning" (forward compatibility)
    expect(b7Errors.every((e) => e.severity === "warning")).toBe(true);
  });
});

// ===========================================================================
// FIXED: combined
// ===========================================================================

describe("TestCombinedFixes", () => {
  it("an invalid CP ID in Metric.filters is caught alongside other params", async () => {
    await expect(
      makeWs().buildParams(
        new Metric({
          event: "AnyEvent",
          filters: [Filter.isSet(new CustomPropertyRef({ id: 0 }))],
        }),
        { group_by: "country", last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeWs().buildParams(
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
      makeWs().buildFunnelParams(
        [
          new FunnelStep({ event: "Step1", filters: [Filter.isSet(badCp)] }),
          "Step2",
        ],
        { last: 30 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeWs().buildFunnelParams(
        [
          new FunnelStep({ event: "Step1", filters: [Filter.isSet(badCp)] }),
          "Step2",
        ],
        { last: 30 },
      ),
    ).rejects.toThrow(/non-empty/);
  });
});
