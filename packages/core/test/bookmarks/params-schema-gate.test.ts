// The network-free bookmark params schema gate as consumers reach it from
// the barrel: dry-run / proposal layers over `Workspace` validate a payload
// without a session. No Python twin — the standalone gate is TS-only; the
// schema rules themselves are covered by schema.test.ts.
import { describe, expect, it } from "vitest";

import { validateBookmarkParamsSchema } from "../../src/index.js";

describe("validateBookmarkParamsSchema from the barrel", () => {
  it("passes an empty partial payload and rejects a malformed sorting block", () => {
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
