// `Workspace` drop-filter members: list, create, update, delete and limits.
// Mirrors the `TestListDropFilters` / `TestCreateDropFilter` /
// `TestUpdateDropFilter` / `TestDeleteDropFilter` / `TestGetDropFilterLimits`
// classes of `tests/unit/test_workspace_data_governance.py`;
// `httpx.MockTransport` becomes the injected-fetch seam, `temp_dir` is dropped.

import { describe, expect, it } from "vitest";

import {
  CreateDropFilterParams,
  DropFilter,
  DropFilterLimitsResponse,
  UpdateDropFilterParams,
} from "../../src/types/entities/data-governance.js";
import { ok } from "../../test-support/client-test-helpers.js";
import { makeWorkspace } from "./governance-data-fixtures.js";

/**
 * A minimal drop filter dict matching the API shape
 * (`_drop_filter_json`).
 *
 * @param id - Drop filter ID.
 * @param eventName - Event name to filter.
 * @returns The payload record.
 */
function dropFilterJson(
  id = 1,
  eventName = "debug_log",
): Record<string, unknown> {
  return { id, event_name: eventName, filters: [], active: true };
}

// =============================================================================
// US3: Drop Filters
// =============================================================================

describe("List drop filters", () => {
  // python: TestListDropFilters
  it("listDropFilters() returns list of DropFilter objects", async () => {
    const { ws } = makeWorkspace(() =>
      ok([dropFilterJson(1, "debug_log"), dropFilterJson(2, "test_event")]),
    );
    const filters = await ws.listDropFilters();

    expect(filters).toHaveLength(2);
    expect(filters[0]).toBeInstanceOf(DropFilter);
    expect(filters[0]?.event_name).toBe("debug_log");
    expect(filters[1]?.id).toBe(2);
  });

  it("listDropFilters() returns empty list when none exist", async () => {
    const { ws } = makeWorkspace(() => ok([]));
    await expect(ws.listDropFilters()).resolves.toStrictEqual([]);
  });
});

describe("Create drop filter", () => {
  // python: TestCreateDropFilter
  it("createDropFilter() returns the full list of DropFilter objects", async () => {
    const { ws } = makeWorkspace(() =>
      ok([dropFilterJson(1, "debug_log"), dropFilterJson(2, "new_filter")]),
    );
    const params = new CreateDropFilterParams({
      event_name: "new_filter",
      filters: { property: "env", operator: "equals", value: "test" },
    });
    const result = await ws.createDropFilter(params);

    expect(result).toHaveLength(2);
    expect(result[0]).toBeInstanceOf(DropFilter);
    expect(result[1]?.event_name).toBe("new_filter");
  });
});

describe("Update drop filter", () => {
  // python: TestUpdateDropFilter
  it("updateDropFilter() returns the full list of DropFilter objects", async () => {
    const { ws } = makeWorkspace(() => ok([dropFilterJson(1, "debug_log")]));
    const params = new UpdateDropFilterParams({ id: 1, active: false });
    const result = await ws.updateDropFilter(params);

    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(DropFilter);
  });
});

describe("Delete drop filter", () => {
  // python: TestDeleteDropFilter
  it("deleteDropFilter() returns the remaining list of DropFilter objects", async () => {
    const { ws } = makeWorkspace(() => ok([dropFilterJson(2, "kept_filter")]));
    const result = await ws.deleteDropFilter(1);

    expect(result).toHaveLength(1);
    expect(result[0]?.event_name).toBe("kept_filter");
  });
});

describe("Get drop filter limits", () => {
  // python: TestGetDropFilterLimits
  it("getDropFilterLimits() returns DropFilterLimitsResponse", async () => {
    const { ws } = makeWorkspace(() => ok({ filter_limit: 10 }));
    const limits = await ws.getDropFilterLimits();

    expect(limits).toBeInstanceOf(DropFilterLimitsResponse);
    expect(limits.filter_limit).toBe(10);
  });
});
