// B6-W7 Layer-3 translation (packet `b6-packets.md` §9) — the class
// split of `tests/unit/test_workspace_data_governance.py` (1,842 lines)
// that W7 owns:
//
//   drop filters      : `TestListDropFilters`,
//     `TestCreateDropFilter`, `TestUpdateDropFilter`,
//     `TestDeleteDropFilter`, `TestGetDropFilterLimits`
//   custom properties : `TestListCustomProperties`,
//     `TestCreateCustomProperty`, `TestGetCustomProperty`,
//     `TestUpdateCustomProperty`, `TestDeleteCustomProperty`
//     (:891), `TestValidateCustomProperty` (:905)
//   custom events     : `TestCreateCustomEvent`,
//     `TestListCustomEvents`, `TestUpdateCustomEvent`,
//     `TestDeleteCustomEvent`
//   lookup tables     : `TestListLookupTables`,
//     `TestUploadLookupTable`, `TestMarkLookupTableReady`
//     (:1648), `TestGetLookupUploadUrl` (:1672),
//     `TestGetLookupUploadStatus`, `TestUpdateLookupTable`
//     (:1751), `TestDeleteLookupTables` (:1775),
//     `TestDownloadLookupTable`, `TestGetLookupDownloadUrl`
//
// The lexicon / tags / tracking-history classes in the same Python file
// belong to W6 (`b6-packets.md` §8) and are NOT re-translated here.
//
// Python's `httpx.MockTransport` handler becomes the injected-fetch
// `fakeTransport` seam; `_make_workspace(temp_dir, handler)`
// becomes `makeWorkspace(handler)` — the client is built over the OAuth
// session (`_make_oauth_credentials`, :82-88) while the facade carries
// the service-account `_TEST_SESSION`, exactly as Python does.
// `temp_dir` has no TS analog EXCEPT in `TestUploadLookupTable`, where
// Python writes a real CSV and the facade reads it with
// `Path(...).read_bytes()`; the TS twin injects the W7-D1 `readFile`
// seam with the same bytes (packet §9 W7-D1: `packages/core` is
// runtime-agnostic, so `node:fs` is a B8 wiring job).
//
// ADDITIVE sections (clearly headed, never substituting for a
// translated Python assertion — B5 Caution #13 / packet §0.2): the
// facade-local branches Python's suite does not cover — the
// `displayFormula` corruption re-raise, the
// `to_form_body` JSON spelling, the `readFile` seam default, the
// `REVOKED` / `NOTFOUND` / non-dict-result poll arms
// (`workspace.py`) and the per-member delegation contracts
// (which client method, with which arguments).

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
 * (`_drop_filter_json`, :187-205).
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

describe("TestListDropFilters", () => {
  it("list_drop_filters() returns list of DropFilter objects", async () => {
    const { ws } = makeWorkspace(() =>
      ok([dropFilterJson(1, "debug_log"), dropFilterJson(2, "test_event")]),
    );
    const filters = await ws.listDropFilters();

    expect(filters).toHaveLength(2);
    expect(filters[0]).toBeInstanceOf(DropFilter);
    expect(filters[0]?.event_name).toBe("debug_log");
    expect(filters[1]?.id).toBe(2);
  });

  it("list_drop_filters() returns empty list when none exist", async () => {
    const { ws } = makeWorkspace(() => ok([]));
    await expect(ws.listDropFilters()).resolves.toStrictEqual([]);
  });
});

describe("TestCreateDropFilter", () => {
  it("create_drop_filter() returns the full list of DropFilter objects", async () => {
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

describe("TestUpdateDropFilter", () => {
  it("update_drop_filter() returns the full list of DropFilter objects", async () => {
    const { ws } = makeWorkspace(() => ok([dropFilterJson(1, "debug_log")]));
    const params = new UpdateDropFilterParams({ id: 1, active: false });
    const result = await ws.updateDropFilter(params);

    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(DropFilter);
  });
});

describe("TestDeleteDropFilter", () => {
  it("delete_drop_filter() returns the remaining list of DropFilter objects", async () => {
    const { ws } = makeWorkspace(() => ok([dropFilterJson(2, "kept_filter")]));
    const result = await ws.deleteDropFilter(1);

    expect(result).toHaveLength(1);
    expect(result[0]?.event_name).toBe("kept_filter");
  });
});

describe("TestGetDropFilterLimits", () => {
  it("get_drop_filter_limits() returns DropFilterLimitsResponse", async () => {
    const { ws } = makeWorkspace(() => ok({ filter_limit: 10 }));
    const limits = await ws.getDropFilterLimits();

    expect(limits).toBeInstanceOf(DropFilterLimitsResponse);
    expect(limits.filter_limit).toBe(10);
  });
});
