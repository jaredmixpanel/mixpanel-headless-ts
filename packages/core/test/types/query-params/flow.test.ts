// Guard + construction tests for FlowStep (phase2-design C7, packet
// P2-5c): translated from tests/test_types_flow.py
// (TestFlowStepConstruction / TestFlowStepSessionEvent /
// TestCodedFlowStepCodes), plus Risk #1 guard-order probes and a C9
// fast-check guard-totality property. (The Python frozen-dataclass
// immutability tests have no TS runtime analog — `readonly` is the
// compile-time equivalent.)
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  type MixpanelHeadlessError,
  ParamValidationError,
} from "../../../src/errors.js";
import { Filter } from "../../../src/types/query-params/filter.js";
import { FlowStep } from "../../../src/types/query-params/flow.js";

/**
 * Assert a thunk throws the exact guard `{class, code}` pair.
 *
 * @param thunk - The construction under test.
 * @param code - Expected registry code.
 */
function expectGuard(thunk: () => unknown, code: string): void {
  let thrown: unknown;
  try {
    thunk();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, `expected ${code}`).toBeInstanceOf(ParamValidationError);
  expect((thrown as MixpanelHeadlessError).code).toBe(code);
}

describe("FlowStep construction", () => {
  it("constructs with an event only and applies the Python defaults", () => {
    const step = new FlowStep({ event: "Purchase" });
    expect(step.event).toBe("Purchase");
    expect(step.forward).toBeNull();
    expect(step.reverse).toBeNull();
    expect(step.label).toBeNull();
    expect(step.filters).toBeNull();
    expect(step.filters_combinator).toBe("all");
    expect(step.session_event).toBeNull();
  });

  it("accepts all fields explicitly", () => {
    const step = new FlowStep({
      event: "Purchase",
      forward: 5,
      reverse: 3,
      label: "Buy",
      filters: [Filter.equals("country", "US")],
      filters_combinator: "any",
    });
    expect(step.event).toBe("Purchase");
    expect(step.forward).toBe(5);
    expect(step.reverse).toBe(3);
    expect(step.label).toBe("Buy");
    expect(step.filters).toHaveLength(1);
    expect(step.filters_combinator).toBe("any");
  });

  it("preserves the event name exactly (unicode, no stripping)", () => {
    expect(new FlowStep({ event: "My Custom Event ✨" }).event).toBe(
      "My Custom Event ✨",
    );
    expect(new FlowStep({ event: "  Purchase  " }).event).toBe("  Purchase  ");
  });

  it("preserves the filters list contents", () => {
    const step = new FlowStep({
      event: "Signup",
      filters: [
        Filter.equals("country", "US"),
        Filter.equals("platform", "iOS"),
      ],
    });
    expect(step.filters).toHaveLength(2);
  });

  it("accepts matching session anchors (FS1 happy paths)", () => {
    const start = new FlowStep({
      event: "$session_start",
      session_event: "start",
    });
    expect(start.session_event).toBe("start");
    expect(start.event).toBe("$session_start");
    const end = new FlowStep({ event: "$session_end", session_event: "end" });
    expect(end.session_event).toBe("end");
    expect(end.event).toBe("$session_end");
  });

  it("accepts the 0-5 forward/reverse boundary values", () => {
    expect(new FlowStep({ event: "Login", forward: 0 }).forward).toBe(0);
    expect(new FlowStep({ event: "Login", forward: 5 }).forward).toBe(5);
    expect(new FlowStep({ event: "Login", reverse: 0 }).reverse).toBe(0);
    expect(new FlowStep({ event: "Login", reverse: 5 }).reverse).toBe(5);
  });
});

describe("FlowStep guards (source order)", () => {
  it("EV1_EMPTY_EVENT / EV2_CONTROL_CHAR_EVENT via the shared guard", () => {
    for (const event of ["", " ".repeat(3)]) {
      expectGuard(() => new FlowStep({ event }), "EV1_EMPTY_EVENT");
    }
    expectGuard(
      () => new FlowStep({ event: "a\x00b" }),
      "EV2_CONTROL_CHAR_EVENT",
    );
  });

  it("FL3_FORWARD_RANGE when forward is outside 0-5", () => {
    for (const forward of [6, -1]) {
      expectGuard(
        () => new FlowStep({ event: "Login", forward }),
        "FL3_FORWARD_RANGE",
      );
    }
  });

  it("FL4_REVERSE_RANGE when reverse is outside 0-5", () => {
    for (const reverse of [6, -2]) {
      expectGuard(
        () => new FlowStep({ event: "Login", reverse }),
        "FL4_REVERSE_RANGE",
      );
    }
  });

  it("FS1_SESSION_EVENT_MISMATCH on session/event conflicts", () => {
    expectGuard(
      () => new FlowStep({ event: "Login", session_event: "start" }),
      "FS1_SESSION_EVENT_MISMATCH",
    );
    expectGuard(
      () => new FlowStep({ event: "Login", session_event: "end" }),
      "FS1_SESSION_EVENT_MISMATCH",
    );
    expectGuard(
      () => new FlowStep({ event: "$session_end", session_event: "start" }),
      "FS1_SESSION_EVENT_MISMATCH",
    );
    expectGuard(
      () => new FlowStep({ event: "$session_start", session_event: "end" }),
      "FS1_SESSION_EVENT_MISMATCH",
    );
  });

  it("guard order: EV1 -> FL3 -> FL4 -> FS1 (first failing wins)", () => {
    expectGuard(
      () =>
        new FlowStep({
          event: " ",
          forward: 9,
          reverse: 9,
          session_event: "start",
        }),
      "EV1_EMPTY_EVENT",
    );
    expectGuard(
      () =>
        new FlowStep({
          event: "Login",
          forward: 9,
          reverse: 9,
          session_event: "start",
        }),
      "FL3_FORWARD_RANGE",
    );
    expectGuard(
      () =>
        new FlowStep({ event: "Login", reverse: 9, session_event: "start" }),
      "FL4_REVERSE_RANGE",
    );
  });
});

describe("C9 guard-totality property (fast-check #4)", () => {
  it("out-of-range forward values always raise the FL3 registry code", () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: -1000, max: 1000 })
          .filter((value) => value < 0 || value > 5),
        (forward) => {
          try {
            new FlowStep({ event: "Login", forward });
            return false;
          } catch (error) {
            return (
              error instanceof ParamValidationError &&
              error.code === "FL3_FORWARD_RANGE"
            );
          }
        },
      ),
    );
  });

  it("every in-range forward/reverse pair constructs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0, max: 5 }),
        (forward, reverse) => {
          const step = new FlowStep({ event: "Login", forward, reverse });
          return step.forward === forward && step.reverse === reverse;
        },
      ),
    );
  });
});
