// Translated round-2 validation-bypass tests (B5-S2, packet §3 + §8):
// the B2-M2 WHOLE-FILE deferral — assertion-for-assertion port of
// tests/test_validation_bypass_r2.py (R10.2), ALL 5 classes
// (TestR2V1FlowStepFiltersCPFixed :67,
// TestR2V2RetentionEventFiltersCPFixed :124, TestR2V3NaNFilterFixed
// :185, TestR2V4InfFilterFixed :223, TestR2CombinedFixes :259).
//
// Translation notes: identical to the sibling `validation-bypass.test.ts`
// header (the `ws` fixture, the message-substring assertions).
// `float("nan")` / `float("inf")` / `float("-inf")` are the JS
// `Number.NaN` / `Infinity` / `-Infinity` literals — the same IEEE
// doubles the B20b guard rejects.

import { describe, expect, it } from "vitest";
import { Workspace } from "../../src/workspace.js";
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
import { mockWorkspaceClient, TEST_SESSION } from "./workspace-test-helpers.js";

/**
 * The `ws` fixture (test_validation_bypass_r2.py:47-55).
 *
 * @returns A Workspace with mocked dependencies (no network).
 */
function makeWs(): Workspace {
  return new Workspace({
    session: TEST_SESSION,
    client: mockWorkspaceClient().client,
  });
}

// ===========================================================================
// FIXED: R2-V1 — FlowStep.filters custom-property scanning
// ===========================================================================

describe("TestR2V1FlowStepFiltersCPFixed", () => {
  it("CustomPropertyRef(0) in FlowStep.filters raises", async () => {
    await expect(
      makeWs().buildFlowParams(
        new FlowStep({
          event: "Purchase",
          filters: [Filter.isSet(new CustomPropertyRef({ id: 0 }))],
        }),
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeWs().buildFlowParams(
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
      makeWs().buildFlowParams(
        new FlowStep({
          event: "Purchase",
          filters: [Filter.isSet(new CustomPropertyRef({ id: -1 }))],
        }),
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeWs().buildFlowParams(
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
      makeWs().buildFlowParams(
        new FlowStep({ event: "Purchase", filters: [Filter.isSet(badCp)] }),
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeWs().buildFlowParams(
        new FlowStep({ event: "Purchase", filters: [Filter.isSet(badCp)] }),
        { last: 7 },
      ),
    ).rejects.toThrow(/non-empty/);
  });

  it("a valid CustomPropertyRef(42) passes", async () => {
    const params = await makeWs().buildFlowParams(
      new FlowStep({
        event: "Purchase",
        filters: [Filter.isSet(new CustomPropertyRef({ id: 42 }))],
      }),
      { last: 7 },
    );
    expect(Object.hasOwn(params, "steps")).toBe(true);
  });
});

// ===========================================================================
// FIXED: R2-V2 — RetentionEvent.filters custom-property scanning
// ===========================================================================

describe("TestR2V2RetentionEventFiltersCPFixed", () => {
  it("CustomPropertyRef(0) in the born event raises", async () => {
    await expect(
      makeWs().buildRetentionParams(
        new RetentionEvent({
          event: "Signup",
          filters: [Filter.isSet(new CustomPropertyRef({ id: 0 }))],
        }),
        "Login",
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeWs().buildRetentionParams(
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
      makeWs().buildRetentionParams(
        "Signup",
        new RetentionEvent({
          event: "Login",
          filters: [Filter.isSet(new CustomPropertyRef({ id: 0 }))],
        }),
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeWs().buildRetentionParams(
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
      makeWs().buildRetentionParams(
        new RetentionEvent({ event: "Signup", filters: [Filter.isSet(badCp)] }),
        "Login",
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeWs().buildRetentionParams(
        new RetentionEvent({ event: "Signup", filters: [Filter.isSet(badCp)] }),
        "Login",
        { last: 7 },
      ),
    ).rejects.toThrow(/non-empty/);
  });

  it("a valid CustomPropertyRef(42) passes", async () => {
    const params = await makeWs().buildRetentionParams(
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

// ===========================================================================
// FIXED: R2-V3 — NaN filter values
// ===========================================================================

describe("TestR2V3NaNFilterFixed", () => {
  it("NaN in a where filter raises", async () => {
    await expect(
      makeWs().buildParams("AnyEvent", {
        where: Filter.greaterThan("age", Number.NaN),
        last: 7,
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeWs().buildParams("AnyEvent", {
        where: Filter.greaterThan("age", Number.NaN),
        last: 7,
      }),
    ).rejects.toThrow(/finite number/);
  });

  it("NaN in Metric.filters raises", async () => {
    await expect(
      makeWs().buildParams(
        new Metric({
          event: "AnyEvent",
          filters: [Filter.greaterThan("age", Number.NaN)],
        }),
        { last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeWs().buildParams(
        new Metric({
          event: "AnyEvent",
          filters: [Filter.greaterThan("age", Number.NaN)],
        }),
        { last: 7 },
      ),
    ).rejects.toThrow(/finite number/);
  });

  it("normal finite values still pass", async () => {
    const params = await makeWs().buildParams("AnyEvent", {
      where: Filter.greaterThan("age", 18),
      last: 7,
    });
    expect(Object.hasOwn(params, "sections")).toBe(true);
  });
});

// ===========================================================================
// FIXED: R2-V4 — Inf filter values
// ===========================================================================

describe("TestR2V4InfFilterFixed", () => {
  it("Inf in a where filter raises", async () => {
    await expect(
      makeWs().buildParams("AnyEvent", {
        where: Filter.greaterThan("age", Infinity),
        last: 7,
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeWs().buildParams("AnyEvent", {
        where: Filter.greaterThan("age", Infinity),
        last: 7,
      }),
    ).rejects.toThrow(/finite number/);
  });

  it("negative infinity also raises", async () => {
    await expect(
      makeWs().buildParams("AnyEvent", {
        where: Filter.greaterThan("age", -Infinity),
        last: 7,
      }),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeWs().buildParams("AnyEvent", {
        where: Filter.greaterThan("age", -Infinity),
        last: 7,
      }),
    ).rejects.toThrow(/finite number/);
  });

  it("large but finite values still pass", async () => {
    const params = await makeWs().buildParams("AnyEvent", {
      where: Filter.greaterThan("age", 1e15),
      last: 7,
    });
    expect(Object.hasOwn(params, "sections")).toBe(true);
  });
});

// ===========================================================================
// FIXED: combined
// ===========================================================================

describe("TestR2CombinedFixes", () => {
  it("a FlowStep CP error is caught at L1 (before the L2 NaN check)", async () => {
    await expect(
      makeWs().buildFlowParams(
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
      makeWs().buildFlowParams(
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
      makeWs().buildRetentionParams(
        new RetentionEvent({
          event: "Signup",
          filters: [Filter.isSet(new CustomPropertyRef({ id: -1 }))],
        }),
        "Login",
        { where: Filter.greaterThan("age", Infinity), last: 7 },
      ),
    ).rejects.toBeInstanceOf(BookmarkValidationError);
    await expect(
      makeWs().buildRetentionParams(
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
