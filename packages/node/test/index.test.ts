// Trivial skeleton test: proves the vitest harness and NodeNext
// module resolution work for this package.
import { describe, expect, it } from "vitest";

import { NODE_PACKAGE_NAME } from "../src/index.js";

describe("@mixpanel-headless/node package skeleton", () => {
  it("exports its package name", () => {
    expect(NODE_PACKAGE_NAME).toBe("@mixpanel-headless/node");
  });
});
