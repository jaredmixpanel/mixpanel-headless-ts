// Trivial skeleton test (TS-1): proves the vitest harness and NodeNext
// module resolution work for this package.
import { describe, expect, it } from "vitest";

import { BROWSER_PACKAGE_NAME } from "../src/index.js";

describe("@mixpanel-headless/browser package skeleton", () => {
  it("exports its package name", () => {
    expect(BROWSER_PACKAGE_NAME).toBe("@mixpanel-headless/browser");
  });
});
