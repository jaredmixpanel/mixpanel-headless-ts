// Locks the `@mixpanel-headless/core` barrel: every public name the README
// quick start and downstream dry-run layers import must be reachable from
// the "." entry (a class can exist in src/ without its barrel line, and only
// this file notices). No Python twin — the barrel is a TS-only artefact.
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
  it("exports the facade, the bookmark validator and the replay label helpers", () => {
    expect(typeof Workspace).toBe("function");
    expect(typeof validateBookmark).toBe("function");
    expect(typeof defaultLabelFn).toBe("function");
    expect(typeof selectorLabelFn).toBe("function");
    expect(typeof urlNormalizer).toBe("function");
  });

  it("exports the network-free bookmark params schema gate", () => {
    // Consumers building a dry-run / proposal layer over `Workspace` run the
    // schema gate without a session; before the barrel line they had to
    // deep-import `workspace-members/bookmarks-cohorts.js`. An empty payload
    // is clean; a malformed `sorting` block is not.
    expect(typeof validateBookmarkParamsSchema).toBe("function");
    expect(
      validateBookmarkParamsSchema({}, null, { partial: true }),
    ).toStrictEqual([]);
    const malformedSorting = {
      sorting: { bar: { sortBy: "value", segmentation: "value" } },
    };
    expect(
      validateBookmarkParamsSchema(malformedSorting, null, { partial: true })
        .length,
    ).toBeGreaterThan(0);
  });
});
