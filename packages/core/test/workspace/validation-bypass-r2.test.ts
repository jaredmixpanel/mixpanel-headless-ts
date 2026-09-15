// Round-2 validation-bypass regressions through the Workspace facade:
// CustomPropertyRef ids inside FlowStep and RetentionEvent filters, and NaN /
// Infinity filter values. Mirrors tests/test_validation_bypass_r2.py (all five
// classes). `float("nan"|"inf"|"-inf")` are `Number.NaN` / `Infinity` /
// `-Infinity`; failures are asserted as error class plus message substring.

import { describe, expect, it } from "vitest";

import { BookmarkValidationError } from "../../src/errors.js";
import {
  CustomPropertyRef,
  Filter,
  InlineCustomProperty,
  PropertyInput,
} from "../../src/types/query-params/filter.js";
import { FlowStep } from "../../src/types/query-params/flow.js";
import { Metric } from "../../src/types/query-params/metric.js";
import { RetentionEvent } from "../../src/types/query-params/retention.js";
import { makeStubWorkspace } from "../../test-support/workspace-test-helpers.js";

// --- R2-V1 — FlowStep.filters custom-property scanning ---

describe("R2 V1 flow step filters CP fixed", () => {
  // python: TestR2V1FlowStepFiltersCPFixed
  it("CustomPropertyRef(0) in FlowStep.filters raises", async () => {
    await expect(
      makeStubWorkspace().buildFlowParams(
        new FlowStep({
          event: "Purchase",
          filters: [Filter.isSet(new CustomPropertyRef({ id: 0 }))],
        }),
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildFlowParams(
        new FlowStep({
          event: "Purchase",
          filters: [Filter.isSet(new CustomPropertyRef({ id: 0 }))],
        }),
        { last: 7 },
      ),
    ).rejects.toThrow(/positive integer/);
  });

  it("CustomPropertyRef(-1) in FlowStep.filters raises", async () => {
    await expect(
      makeStubWorkspace().buildFlowParams(
        new FlowStep({
          event: "Purchase",
          filters: [Filter.isSet(new CustomPropertyRef({ id: -1 }))],
        }),
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildFlowParams(
        new FlowStep({
          event: "Purchase",
          filters: [Filter.isSet(new CustomPropertyRef({ id: -1 }))],
        }),
        { last: 7 },
      ),
    ).rejects.toThrow(/positive integer/);
  });

  it("an empty-formula InlineCustomProperty raises", async () => {
    const badCp = new InlineCustomProperty({
      formula: "",
      inputs: { A: new PropertyInput({ name: "$browser" }) },
    });
    await expect(
      makeStubWorkspace().buildFlowParams(
        new FlowStep({ event: "Purchase", filters: [Filter.isSet(badCp)] }),
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildFlowParams(
        new FlowStep({ event: "Purchase", filters: [Filter.isSet(badCp)] }),
        { last: 7 },
      ),
    ).rejects.toThrow(/non-empty/);
  });

  it("a valid CustomPropertyRef(42) passes", async () => {
    const params = await makeStubWorkspace().buildFlowParams(
      new FlowStep({
        event: "Purchase",
        filters: [Filter.isSet(new CustomPropertyRef({ id: 42 }))],
      }),
      { last: 7 },
    );
    expect(Object.hasOwn(params, "steps")).toBe(true);
  });
});

// --- R2-V2 — RetentionEvent.filters custom-property scanning ---

describe("R2 V2 retention event filters CP fixed", () => {
  // python: TestR2V2RetentionEventFiltersCPFixed
  it("CustomPropertyRef(0) in the born event raises", async () => {
    await expect(
      makeStubWorkspace().buildRetentionParams(
        new RetentionEvent({
          event: "Signup",
          filters: [Filter.isSet(new CustomPropertyRef({ id: 0 }))],
        }),
        "Login",
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildRetentionParams(
        new RetentionEvent({
          event: "Signup",
          filters: [Filter.isSet(new CustomPropertyRef({ id: 0 }))],
        }),
        "Login",
        { last: 7 },
      ),
    ).rejects.toThrow(/positive integer/);
  });

  it("CustomPropertyRef(0) in the return event raises", async () => {
    await expect(
      makeStubWorkspace().buildRetentionParams(
        "Signup",
        new RetentionEvent({
          event: "Login",
          filters: [Filter.isSet(new CustomPropertyRef({ id: 0 }))],
        }),
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildRetentionParams(
        "Signup",
        new RetentionEvent({
          event: "Login",
          filters: [Filter.isSet(new CustomPropertyRef({ id: 0 }))],
        }),
        { last: 7 },
      ),
    ).rejects.toThrow(/positive integer/);
  });

  it("an empty-formula InlineCustomProperty raises", async () => {
    const badCp = new InlineCustomProperty({
      formula: "",
      inputs: { A: new PropertyInput({ name: "$browser" }) },
    });
    await expect(
      makeStubWorkspace().buildRetentionParams(
        new RetentionEvent({ event: "Signup", filters: [Filter.isSet(badCp)] }),
        "Login",
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildRetentionParams(
        new RetentionEvent({ event: "Signup", filters: [Filter.isSet(badCp)] }),
        "Login",
        { last: 7 },
      ),
    ).rejects.toThrow(/non-empty/);
  });

  it("a valid CustomPropertyRef(42) passes", async () => {
    const params = await makeStubWorkspace().buildRetentionParams(
      new RetentionEvent({
        event: "Signup",
        filters: [Filter.isSet(new CustomPropertyRef({ id: 42 }))],
      }),
      "Login",
      { last: 7 },
    );
    expect(Object.hasOwn(params, "sections")).toBe(true);
  });
});

// --- R2-V3 — NaN filter values ---

describe("R2 V3 na n filter fixed", () => {
  // python: TestR2V3NaNFilterFixed
  it("NaN in a where filter raises", async () => {
    await expect(
      makeStubWorkspace().buildParams("AnyEvent", {
        where: Filter.greaterThan("age", Number.NaN),
        last: 7,
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams("AnyEvent", {
        where: Filter.greaterThan("age", Number.NaN),
        last: 7,
      }),
    ).rejects.toThrow(/finite number/);
  });

  it("NaN in Metric.filters raises", async () => {
    await expect(
      makeStubWorkspace().buildParams(
        new Metric({
          event: "AnyEvent",
          filters: [Filter.greaterThan("age", Number.NaN)],
        }),
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams(
        new Metric({
          event: "AnyEvent",
          filters: [Filter.greaterThan("age", Number.NaN)],
        }),
        { last: 7 },
      ),
    ).rejects.toThrow(/finite number/);
  });

  it("normal finite values still pass", async () => {
    const params = await makeStubWorkspace().buildParams("AnyEvent", {
      where: Filter.greaterThan("age", 18),
      last: 7,
    });
    expect(Object.hasOwn(params, "sections")).toBe(true);
  });
});

// --- R2-V4 — Inf filter values ---

describe("R2 V4 inf filter fixed", () => {
  // python: TestR2V4InfFilterFixed
  it("Inf in a where filter raises", async () => {
    await expect(
      makeStubWorkspace().buildParams("AnyEvent", {
        where: Filter.greaterThan("age", Infinity),
        last: 7,
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams("AnyEvent", {
        where: Filter.greaterThan("age", Infinity),
        last: 7,
      }),
    ).rejects.toThrow(/finite number/);
  });

  it("negative infinity also raises", async () => {
    await expect(
      makeStubWorkspace().buildParams("AnyEvent", {
        where: Filter.greaterThan("age", -Infinity),
        last: 7,
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildParams("AnyEvent", {
        where: Filter.greaterThan("age", -Infinity),
        last: 7,
      }),
    ).rejects.toThrow(/finite number/);
  });

  it("large but finite values still pass", async () => {
    const params = await makeStubWorkspace().buildParams("AnyEvent", {
      where: Filter.greaterThan("age", 1e15),
      last: 7,
    });
    expect(Object.hasOwn(params, "sections")).toBe(true);
  });
});

// --- Combined ---

describe("R2 combined fixes", () => {
  // python: TestR2CombinedFixes
  it("a FlowStep CP error is caught at L1 (before the L2 NaN check)", async () => {
    await expect(
      makeStubWorkspace().buildFlowParams(
        new FlowStep({
          event: "Purchase",
          filters: [
            Filter.isSet(new CustomPropertyRef({ id: 0 })),
            Filter.greaterThan("amount", Number.NaN),
          ],
        }),
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildFlowParams(
        new FlowStep({
          event: "Purchase",
          filters: [
            Filter.isSet(new CustomPropertyRef({ id: 0 })),
            Filter.greaterThan("amount", Number.NaN),
          ],
        }),
        { last: 7 },
      ),
    ).rejects.toThrow(/positive integer/);
  });

  it("a RetentionEvent CP error is caught", async () => {
    await expect(
      makeStubWorkspace().buildRetentionParams(
        new RetentionEvent({
          event: "Signup",
          filters: [Filter.isSet(new CustomPropertyRef({ id: -1 }))],
        }),
        "Login",
        { where: Filter.greaterThan("age", Infinity), last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeStubWorkspace().buildRetentionParams(
        new RetentionEvent({
          event: "Signup",
          filters: [Filter.isSet(new CustomPropertyRef({ id: -1 }))],
        }),
        "Login",
        { where: Filter.greaterThan("age", Infinity), last: 7 },
      ),
    ).rejects.toThrow(/positive integer/);
  });
});
