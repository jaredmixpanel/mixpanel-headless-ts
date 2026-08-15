// Trivial skeleton test (TS-1): proves the vitest harness and NodeNext
// module resolution work for this package.
import { describe, expect, it } from "vitest";
import { CORE_PACKAGE_NAME } from "../src/index.js";

describe("@mixpanel-headless/core package skeleton", () => {
  it("exports its package name", () => {
    expect(CORE_PACKAGE_NAME).toBe("@mixpanel-headless/core");
  });
});
