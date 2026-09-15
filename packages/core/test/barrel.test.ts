// Locks the `@mixpanel-headless/core` barrel: the public names the README
// quick start and downstream dry-run layers import must be reachable from
// the "." entry (a class can exist in src/ without its barrel line, and
// only a test like this notices). No Python twin — the barrel is TS-only.
import { describe, expect, it } from "vitest";

import {
  defaultLabelFn,
  selectorLabelFn,
  urlNormalizer,
  validateBookmark,
  validateBookmarkParamsSchema,
  Workspace,
} from "../src/index.js";

describe("@mixpanel-headless/core barrel", () => {
  it("exports the facade, the bookmark validators and the replay label helpers", () => {
    expect(typeof Workspace).toBe("function");
    expect(typeof validateBookmark).toBe("function");
    expect(typeof validateBookmarkParamsSchema).toBe("function");
    expect(typeof defaultLabelFn).toBe("function");
    expect(typeof selectorLabelFn).toBe("function");
    expect(typeof urlNormalizer).toBe("function");
  });
});
