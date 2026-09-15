// RetentionEvent construction and guards (EV1 / EV2). Mirrors
// tests/test_types_retention.py (TestRetentionEventConstruction) and
// TestRetentionEventGuardVectors of conformance/tests/test_coverage_cases.py;
// the frozen-dataclass immutability tests have no TS runtime analog.
import { describe, expect, it } from "vitest";

import { Filter } from "../../../src/types/query-params/filter.js";
import { RetentionEvent } from "../../../src/types/query-params/retention.js";
import { expectGuard } from "../../../test-support/raises.js";

describe("RetentionEvent construction", () => {
  it("constructs with an event only and applies the Python defaults", () => {
    const born = new RetentionEvent({ event: "Signup" });
    expect(born.event).toBe("Signup");
    expect(born.filters).toBeNull();
    expect(born.filters_combinator).toBe("all");
  });

  it("accepts all fields explicitly", () => {
    const born = new RetentionEvent({
      event: "Signup",
      filters: [Filter.equals("source", "organic")],
      filters_combinator: "any",
    });
    expect(born.event).toBe("Signup");
    expect(born.filters).toHaveLength(1);
    expect(born.filters_combinator).toBe("any");
  });

  it("preserves the filters list contents", () => {
    const first = Filter.equals("country", "US");
    const second = Filter.greaterThan("amount", 10);
    const born = new RetentionEvent({
      event: "Purchase",
      filters: [first, second],
    });
    expect(born.filters?.[0]).toBe(first);
    expect(born.filters?.[1]).toBe(second);
  });
});

describe("RetentionEvent guards", () => {
  it("EV1_EMPTY_EVENT on empty/blank events", () => {
    for (const event of ["", " ".repeat(3)]) {
      expectGuard(() => new RetentionEvent({ event }), "EV1_EMPTY_EVENT");
    }
  });

  it("EV2_CONTROL_CHAR_EVENT on control characters", () => {
    for (const event of ["a\x00b", "a\x7Fb"]) {
      expectGuard(
        () => new RetentionEvent({ event }),
        "EV2_CONTROL_CHAR_EVENT",
      );
    }
  });
});
