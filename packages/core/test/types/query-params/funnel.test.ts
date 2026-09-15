// FunnelStep / Exclusion / HoldingConstant construction and guards (EV1 /
// EV2, EX1 / EX2, HC1) with guard-order probes and fast-check guard-totality
// properties. Mirrors tests/test_types_funnel.py (TestFunnelStep,
// TestExclusion, TestHoldingConstant, coded-error suites) and
// TestFunnelStepGuardVectors of conformance/tests/test_coverage_cases.py.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { ParamValidationError } from "../../../src/errors.js";
import { Filter } from "../../../src/types/query-params/filter.js";
import {
  Exclusion,
  FunnelStep,
  HoldingConstant,
} from "../../../src/types/query-params/funnel.js";
import { expectGuard } from "../../../test-support/raises.js";

describe("FunnelStep construction", () => {
  it("constructs with an event only and applies the Python defaults", () => {
    const step = new FunnelStep({ event: "Signup" });
    expect(step.event).toBe("Signup");
    expect(step.label).toBeNull();
    expect(step.filters).toBeNull();
    expect(step.filters_combinator).toBe("all");
    expect(step.order).toBeNull();
  });

  it("accepts all fields explicitly", () => {
    const step = new FunnelStep({
      event: "Purchase",
      label: "High-Value Purchase",
      filters: [Filter.equals("country", "US")],
      filters_combinator: "any",
      order: "loose",
    });
    expect(step.event).toBe("Purchase");
    expect(step.label).toBe("High-Value Purchase");
    expect(step.filters).toHaveLength(1);
    expect(step.filters_combinator).toBe("any");
    expect(step.order).toBe("loose");
  });

  it("accepts multiple filters and keeps the default combinator", () => {
    const step = new FunnelStep({
      event: "Purchase",
      filters: [
        Filter.equals("country", "US"),
        Filter.greaterThan("amount", 50),
      ],
    });
    expect(step.filters).toHaveLength(2);
    expect(step.filters_combinator).toBe("all");
  });

  it("accepts order='any' and an empty filters list", () => {
    expect(new FunnelStep({ event: "Checkout", order: "any" }).order).toBe(
      "any",
    );
    expect(
      new FunnelStep({ event: "Signup", filters: [] }).filters,
    ).toStrictEqual([]);
  });

  it("coexists with plain strings in a steps list", () => {
    const steps: ReadonlyArray<FunnelStep | string> = [
      "Signup",
      new FunnelStep({ event: "Add to Cart" }),
      "Purchase",
    ];
    expect(steps).toHaveLength(3);
    expect(typeof steps[0]).toBe("string");
    expect(steps[1]).toBeInstanceOf(FunnelStep);
    expect(typeof steps[2]).toBe("string");
  });
});

describe("FunnelStep guards", () => {
  it("EV1_EMPTY_EVENT on empty/blank events", () => {
    for (const event of ["", " ".repeat(3)]) {
      expectGuard(() => new FunnelStep({ event }), "EV1_EMPTY_EVENT");
    }
  });

  it("EV2_CONTROL_CHAR_EVENT on control characters", () => {
    for (const event of ["a\x00b", "a\x7Fb"]) {
      expectGuard(() => new FunnelStep({ event }), "EV2_CONTROL_CHAR_EVENT");
    }
  });
});

describe("Exclusion construction", () => {
  it("constructs with an event only and applies the Python defaults", () => {
    const exclusion = new Exclusion({ event: "Logout" });
    expect(exclusion.event).toBe("Logout");
    expect(exclusion.from_step).toBe(0);
    expect(exclusion.to_step).toBeNull();
  });

  it("accepts all fields explicitly", () => {
    const exclusion = new Exclusion({
      event: "Refund",
      from_step: 1,
      to_step: 2,
    });
    expect(exclusion.event).toBe("Refund");
    expect(exclusion.from_step).toBe(1);
    expect(exclusion.to_step).toBe(2);
  });

  it("accepts from_step or to_step independently", () => {
    const fromOnly = new Exclusion({ event: "Cancel", from_step: 2 });
    expect(fromOnly.from_step).toBe(2);
    expect(fromOnly.to_step).toBeNull();
    const toOnly = new Exclusion({ event: "Cancel", to_step: 3 });
    expect(toOnly.from_step).toBe(0);
    expect(toOnly.to_step).toBe(3);
  });

  it("step indices are 0-indexed (from_step == to_step == 0 is valid)", () => {
    const exclusion = new Exclusion({
      event: "Refund",
      from_step: 0,
      to_step: 0,
    });
    expect(exclusion.from_step).toBe(0);
    expect(exclusion.to_step).toBe(0);
  });
});

describe("Exclusion guards (source order)", () => {
  it("EV1_EMPTY_EVENT / EV2_CONTROL_CHAR_EVENT via the shared guard", () => {
    for (const event of ["", "  ", " ".repeat(3)]) {
      expectGuard(() => new Exclusion({ event }), "EV1_EMPTY_EVENT");
    }
    expectGuard(
      () => new Exclusion({ event: "X\x00Y" }),
      "EV2_CONTROL_CHAR_EVENT",
    );
  });

  it("EX1_FROM_STEP_NEGATIVE on negative from_step", () => {
    for (const fromStep of [-1, -100]) {
      expectGuard(
        () => new Exclusion({ event: "Bounce", from_step: fromStep }),
        "EX1_FROM_STEP_NEGATIVE",
      );
    }
  });

  it("EX2_STEP_ORDER when to_step < from_step", () => {
    expectGuard(
      () => new Exclusion({ event: "Bounce", from_step: 2, to_step: 1 }),
      "EX2_STEP_ORDER",
    );
    expectGuard(
      () => new Exclusion({ event: "Refund", from_step: 3, to_step: 0 }),
      "EX2_STEP_ORDER",
    );
  });

  it("guard order: EV1 wins over EX1; EX1 wins over EX2", () => {
    expectGuard(
      () => new Exclusion({ event: " ", from_step: -1 }),
      "EV1_EMPTY_EVENT",
    );
    expectGuard(
      () => new Exclusion({ event: "X", from_step: -1, to_step: -5 }),
      "EX1_FROM_STEP_NEGATIVE",
    );
  });
});

describe("HoldingConstant construction + guards", () => {
  it("constructs with a property only, defaulting resource_type", () => {
    const holding = new HoldingConstant({ property: "platform" });
    expect(holding.property).toBe("platform");
    expect(holding.resource_type).toBe("events");
  });

  it("accepts both resource types explicitly", () => {
    expect(
      new HoldingConstant({ property: "browser", resource_type: "events" })
        .resource_type,
    ).toBe("events");
    const people = new HoldingConstant({
      property: "plan_tier",
      resource_type: "people",
    });
    expect(people.property).toBe("plan_tier");
    expect(people.resource_type).toBe("people");
  });

  it("HC1_EMPTY_PROPERTY on empty/blank properties", () => {
    for (const property of ["", " ".repeat(3)]) {
      expectGuard(
        () => new HoldingConstant({ property }),
        "HC1_EMPTY_PROPERTY",
      );
    }
  });
});

describe("guard-totality properties (fast-check)", () => {
  it("blank-or-control events always raise a registry-coded error", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.stringMatching(/^[ \t]*$/),
          fc.string({ minLength: 1 }).map((value) => `${value}\x00`),
        ),
        (event) => {
          try {
            new FunnelStep({ event });
            return false;
          } catch (error) {
            return (
              error instanceof ParamValidationError &&
              (error.code === "EV1_EMPTY_EVENT" ||
                error.code === "EV2_CONTROL_CHAR_EVENT")
            );
          }
        },
      ),
    );
  });

  it("negative from_step always raises the EX1 registry code", () => {
    fc.assert(
      fc.property(fc.integer({ min: -1000, max: -1 }), (fromStep) => {
        try {
          new Exclusion({ event: "Bounce", from_step: fromStep });
          return false;
        } catch (error) {
          return (
            error instanceof ParamValidationError &&
            error.code === "EX1_FROM_STEP_NEGATIVE"
          );
        }
      }),
    );
  });
});
