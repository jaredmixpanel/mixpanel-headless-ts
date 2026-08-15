// invariant() tests (R6.8): throws the hierarchy base on violation,
// narrows the condition type on success.
import { describe, expect, it } from "vitest";
import { MixpanelHeadlessError } from "../src/errors.js";
import { invariant } from "../src/invariant.js";

describe("invariant", () => {
  it("passes silently on truthy conditions", () => {
    expect(() => invariant(true, "never")).not.toThrow();
    expect(() => invariant(1, "never")).not.toThrow();
    expect(() => invariant("x", "never")).not.toThrow();
  });

  it("throws MixpanelHeadlessError (code UNKNOWN_ERROR) on falsy", () => {
    try {
      invariant(false, "the invariant text");
      expect.unreachable();
    } catch (exc) {
      expect(exc).toBeInstanceOf(MixpanelHeadlessError);
      const err = exc as MixpanelHeadlessError;
      expect(err.code).toBe("UNKNOWN_ERROR");
      expect(err.message).toBe("the invariant text");
    }
  });

  it("throws on every falsy JS value", () => {
    for (const falsy of [false, 0, "", null, undefined, Number.NaN]) {
      expect(() => invariant(falsy, "boom")).toThrow(MixpanelHeadlessError);
    }
  });

  it("narrows the asserted type for control-flow analysis", () => {
    const maybe: string | null = Math.random() >= 0 ? "present" : null;
    invariant(maybe !== null, "value must be present");
    // Type-level check: `maybe` is `string` after the invariant.
    expect(maybe.length).toBeGreaterThan(0);
  });
});
