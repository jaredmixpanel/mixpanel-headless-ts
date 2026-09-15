// Trivial skeleton test: proves the vitest harness and NodeNext
// module resolution work for this package.
import { describe, expect, it } from "vitest";

import { RUNNER_PACKAGE_NAME } from "../src/index.js";

describe("@mixpanel-headless/conformance-runner package skeleton", () => {
  it("exports its package name", () => {
    expect(RUNNER_PACKAGE_NAME).toBe("@mixpanel-headless/conformance-runner");
  });
});
