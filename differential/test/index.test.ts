// Trivial skeleton test (TS-1): proves the vitest harness and NodeNext
// module resolution work for this package.
import { describe, expect, it } from "vitest";
import { DIFFERENTIAL_PACKAGE_NAME } from "../src/index.js";

describe("@mixpanel-headless/differential package skeleton", () => {
  it("exports its package name", () => {
    expect(DIFFERENTIAL_PACKAGE_NAME).toBe("@mixpanel-headless/differential");
  });
});
