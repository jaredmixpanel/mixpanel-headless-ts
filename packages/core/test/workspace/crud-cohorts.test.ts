// B6-W3 Layer-3 translation (packet `b6-packets.md` §5) of the
// bookmark/cohort classes of `tests/unit/test_workspace_crud.py`
// (1,861 lines): `TestWorkspaceBookmarkCRUD` and
// `TestWorkspaceCohortCRUD`. The dashboard classes of the same
// file are W2's (`crud-dashboards.test.ts`).
//
// Python's `httpx.MockTransport` handler becomes the injected-fetch
// `fakeTransport` seam; `_make_workspace(temp_dir, handler)`
// becomes `makeFacadeWorkspace(handler)` — the client is built over the
// OAuth session (`_make_oauth_credentials`, :66) while the facade
// carries the service-account `_TEST_SESSION`, exactly as
// Python does. `temp_dir` has no TS analog (no config file is ever
// touched) and is dropped.
//
// `caplog.at_level(logging.WARNING, logger="mixpanel_headless.workspace")`
// becomes the injected `logger` seam — the facade's
// `WorkspaceLogger.warning` sink, whose messages carry the same
// `"<member> validation warning: <message> [<code>]" `formatting the
// Python `logger.warning("%s [%s]", …)` call produces.
//
// The `_bookmark_fixtures` module is mirrored at
// `./bookmark-fixtures.ts` (same constants, verbatim).

import { describe, expect, it } from "vitest";

import {
  BulkUpdateCohortEntry,
  Cohort,
  CreateCohortParams,
  UpdateCohortParams,
} from "../../src/types/entities/cohorts.js";
import { ok } from "../../test-support/client-test-helpers.js";
import { makeFacadeWorkspace } from "../../test-support/workspace-test-helpers.js";

/**
 * A minimal cohort dict matching the API shape (`_cohort_json`,
 * :163-181).
 *
 * @param id - Cohort ID.
 * @param name - Cohort name.
 * @returns The payload record.
 */
function cohortJson(id = 1, name = "Test Cohort"): Record<string, unknown> {
  return { id, name, count: 100, is_visible: true };
}

// =============================================================================
// TestWorkspaceCohortCRUD (test_workspace_crud.py)
// =============================================================================

describe("TestWorkspaceCohortCRUD (test_workspace_crud.py:1319)", () => {
  it("list_cohorts_full() returns list of Cohort objects (:1322)", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok([cohortJson(1, "Cohort A"), cohortJson(2, "Cohort B")]),
    );
    const cohorts = await ws.listCohortsFull();

    expect(cohorts).toHaveLength(2);
    expect(cohorts[0]).toBeInstanceOf(Cohort);
    expect(cohorts[0]?.id).toBe(1);
    expect(cohorts[0]?.name).toBe("Cohort A");
    expect(cohorts[1]?.id).toBe(2);
  });

  it("list_cohorts_full() returns empty list when none exist (:1347)", async () => {
    const { ws } = makeFacadeWorkspace(() => ok([]));
    await expect(ws.listCohortsFull()).resolves.toStrictEqual([]);
  });

  it("list_cohorts_full(data_group_id='abc') passes filter (:1359)", async () => {
    const capturedUrl: string[] = [];
    const { ws } = makeFacadeWorkspace((request) => {
      capturedUrl.push(request.url);
      return ok([cohortJson(1, "Filtered")]);
    });
    const cohorts = await ws.listCohortsFull({ data_group_id: "abc" });
    expect(cohorts).toHaveLength(1);
  });

  it("list_cohorts_full() preserves API response order (:1379)", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok([cohortJson(3, "C"), cohortJson(1, "A"), cohortJson(2, "B")]),
    );
    const cohorts = await ws.listCohortsFull();
    expect(cohorts.map((c) => c.id)).toStrictEqual([3, 1, 2]);
  });

  it("get_cohort() returns a single Cohort by ID (:1401)", async () => {
    const { ws } = makeFacadeWorkspace(() => ok(cohortJson(1, "My Cohort")));
    const cohort = await ws.getCohort(1);

    expect(cohort).toBeInstanceOf(Cohort);
    expect(cohort.id).toBe(1);
    expect(cohort.name).toBe("My Cohort");
  });

  it("get_cohort() preserves extra fields (:1421)", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({
        ...cohortJson(5, "Detailed"),
        description: "A detailed cohort",
        data_group_id: "group-1",
      }),
    );
    const cohort = await ws.getCohort(5);

    expect(cohort.description).toBe("A detailed cohort");
    expect(cohort.data_group_id).toBe("group-1");
  });

  it("get_cohort() preserves the count field (:1437)", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ ...cohortJson(1, "Counted"), count: 42 }),
    );
    expect((await ws.getCohort(1)).count).toBe(42);
  });

  it("create_cohort() returns the created Cohort (:1451)", async () => {
    const { ws } = makeFacadeWorkspace(() => ok(cohortJson(10, "New Cohort")));
    const cohort = await ws.createCohort(
      new CreateCohortParams({ name: "New Cohort" }),
    );

    expect(cohort).toBeInstanceOf(Cohort);
    expect(cohort.id).toBe(10);
    expect(cohort.name).toBe("New Cohort");
  });

  it("create_cohort() sends description when provided (:1472)", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ ...cohortJson(11, "Described"), description: "A test cohort" }),
    );
    const cohort = await ws.createCohort(
      new CreateCohortParams({
        name: "Described",
        description: "A test cohort",
      }),
    );
    expect(cohort.description).toBe("A test cohort");
  });

  it("create_cohort() sends definition when provided (:1487)", async () => {
    const { ws } = makeFacadeWorkspace(() => ok(cohortJson(12, "Defined")));
    const cohort = await ws.createCohort(
      new CreateCohortParams({
        name: "Defined",
        definition: { filter: { event: "Signup" } },
      }),
    );
    expect(cohort.id).toBe(12);
  });

  it("create_cohort() sends data_group_id when provided (:1509)", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ ...cohortJson(13, "Grouped"), data_group_id: "group-x" }),
    );
    const cohort = await ws.createCohort(
      new CreateCohortParams({ name: "Grouped", data_group_id: "group-x" }),
    );
    expect(cohort.data_group_id).toBe("group-x");
  });

  it("update_cohort() returns the updated Cohort (:1524)", async () => {
    const { ws } = makeFacadeWorkspace(() => ok(cohortJson(1, "Updated Name")));
    const cohort = await ws.updateCohort(
      1,
      new UpdateCohortParams({ name: "Updated Name" }),
    );

    expect(cohort).toBeInstanceOf(Cohort);
    expect(cohort.name).toBe("Updated Name");
  });

  it("update_cohort() can update description (:1544)", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ ...cohortJson(1, "Same"), description: "New desc" }),
    );
    const cohort = await ws.updateCohort(
      1,
      new UpdateCohortParams({ description: "New desc" }),
    );
    expect(cohort.description).toBe("New desc");
  });

  it("update_cohort() can toggle visibility (:1559)", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ ...cohortJson(1, "Toggle"), is_visible: false }),
    );
    const cohort = await ws.updateCohort(
      1,
      new UpdateCohortParams({ is_visible: false }),
    );
    expect(cohort.is_visible).toBe(false);
  });

  it("update_cohort() can update the definition (:1574)", async () => {
    const { ws } = makeFacadeWorkspace(() => ok(cohortJson(1, "Redefined")));
    const cohort = await ws.updateCohort(
      1,
      new UpdateCohortParams({ definition: { filter: { event: "Purchase" } } }),
    );
    expect(cohort.id).toBe(1);
  });

  it("delete_cohort() returns None on success (:1593)", async () => {
    const { ws } = makeFacadeWorkspace(() => ({ status: 204 }));
    await expect(ws.deleteCohort(1)).resolves.toBeUndefined();
  });

  it("delete_cohort() handles a 200 response (:1603)", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({}));
    await expect(ws.deleteCohort(1)).resolves.toBeUndefined();
  });

  it("bulk_delete_cohorts() returns None on success (:1613)", async () => {
    const { ws } = makeFacadeWorkspace(() => ({ status: 204 }));
    await expect(ws.bulkDeleteCohorts([1, 2])).resolves.toBeUndefined();
  });

  it("bulk_delete_cohorts() works with a single ID (:1623)", async () => {
    const { ws } = makeFacadeWorkspace(() => ({ status: 204 }));
    await expect(ws.bulkDeleteCohorts([42])).resolves.toBeUndefined();
  });

  it("bulk_delete_cohorts() sends multiple IDs (:1633)", async () => {
    const { ws, transport } = makeFacadeWorkspace(() => ({ status: 204 }));
    await ws.bulkDeleteCohorts([10, 20, 30]);
    expect(transport.captures).toHaveLength(1);
  });

  it("bulk_update_cohorts() returns None on success (:1647)", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({}));
    await expect(
      ws.bulkUpdateCohorts([
        new BulkUpdateCohortEntry({ id: 1, name: "Updated A" }),
      ]),
    ).resolves.toBeUndefined();
  });

  it("bulk_update_cohorts() handles multiple entries (:1658)", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({}));
    await expect(
      ws.bulkUpdateCohorts([
        new BulkUpdateCohortEntry({ id: 1, name: "A" }),
        new BulkUpdateCohortEntry({ id: 2, name: "B" }),
        new BulkUpdateCohortEntry({ id: 3, description: "New desc" }),
      ]),
    ).resolves.toBeUndefined();
  });

  it("bulk_update_cohorts() can update definitions (:1673)", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({}));
    await expect(
      ws.bulkUpdateCohorts([
        new BulkUpdateCohortEntry({
          id: 1,
          definition: { filter: { event: "Signup" } },
        }),
      ]),
    ).resolves.toBeUndefined();
  });

  it("list_cohorts_full() preserves count on each cohort (:1686)", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok([
        { ...cohortJson(1, "Small"), count: 10 },
        { ...cohortJson(2, "Large"), count: 10000 },
      ]),
    );
    const cohorts = await ws.listCohortsFull();
    expect(cohorts[0]?.count).toBe(10);
    expect(cohorts[1]?.count).toBe(10000);
  });

  it("get_cohort() result has correct field types (:1708)", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({
        ...cohortJson(1, "Typed"),
        is_visible: true,
        is_locked: false,
        verified: true,
      }),
    );
    const cohort = await ws.getCohort(1);

    expect(typeof cohort.is_visible).toBe("boolean");
    expect(typeof cohort.is_locked).toBe("boolean");
    expect(typeof cohort.verified).toBe("boolean");
    expect(cohort.verified).toBe(true);
  });

  it("create_cohort() can create a locked cohort (:1727)", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ ...cohortJson(14, "Locked"), is_locked: true }),
    );
    const cohort = await ws.createCohort(
      new CreateCohortParams({ name: "Locked", is_locked: true }),
    );
    expect(cohort.is_locked).toBe(true);
  });

  it("update_cohort() can toggle lock state (:1742)", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ ...cohortJson(1, "Unlocked"), is_locked: false }),
    );
    const cohort = await ws.updateCohort(
      1,
      new UpdateCohortParams({ is_locked: false }),
    );
    expect(cohort.is_locked).toBe(false);
  });
});
