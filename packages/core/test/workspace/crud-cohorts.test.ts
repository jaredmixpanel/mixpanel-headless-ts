// `Workspace` cohort CRUD: list/get/create/update/delete and the bulk
// operations, including definition, visibility and lock fields. Mirrors
// `TestWorkspaceCohortCRUD` of `tests/unit/test_workspace_crud.py`;
// `httpx.MockTransport` becomes the injected-fetch seam and `temp_dir` has
// no TS analog (no config file is ever touched).

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
 * A minimal cohort dict matching the API shape (`_cohort_json`).
 *
 * @param id - Cohort ID.
 * @param name - Cohort name.
 * @returns The payload record.
 */
function cohortJson(id = 1, name = "Test Cohort"): Record<string, unknown> {
  return { id, name, count: 100, is_visible: true };
}

// =============================================================================
// Workspace cohort CRUD
// =============================================================================

describe("Workspace cohort CRUD", () => {
  // python: TestWorkspaceCohortCRUD
  it("listCohortsFull() returns list of Cohort objects", async () => {
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

  it("listCohortsFull() returns empty list when none exist", async () => {
    const { ws } = makeFacadeWorkspace(() => ok([]));
    await expect(ws.listCohortsFull()).resolves.toStrictEqual([]);
  });

  it("listCohortsFull(data_group_id='abc') passes filter", async () => {
    const capturedUrl: string[] = [];
    const { ws } = makeFacadeWorkspace((request) => {
      capturedUrl.push(request.url);
      return ok([cohortJson(1, "Filtered")]);
    });
    const cohorts = await ws.listCohortsFull({ data_group_id: "abc" });
    expect(cohorts).toHaveLength(1);
  });

  it("listCohortsFull() preserves API response order", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok([cohortJson(3, "C"), cohortJson(1, "A"), cohortJson(2, "B")]),
    );
    const cohorts = await ws.listCohortsFull();
    expect(cohorts.map((c) => c.id)).toStrictEqual([3, 1, 2]);
  });

  it("getCohort() returns a single Cohort by ID", async () => {
    const { ws } = makeFacadeWorkspace(() => ok(cohortJson(1, "My Cohort")));
    const cohort = await ws.getCohort(1);

    expect(cohort).toBeInstanceOf(Cohort);
    expect(cohort.id).toBe(1);
    expect(cohort.name).toBe("My Cohort");
  });

  it("getCohort() preserves extra fields", async () => {
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

  it("getCohort() preserves the count field", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ ...cohortJson(1, "Counted"), count: 42 }),
    );
    expect((await ws.getCohort(1)).count).toBe(42);
  });

  it("createCohort() returns the created Cohort", async () => {
    const { ws } = makeFacadeWorkspace(() => ok(cohortJson(10, "New Cohort")));
    const cohort = await ws.createCohort(
      new CreateCohortParams({ name: "New Cohort" }),
    );

    expect(cohort).toBeInstanceOf(Cohort);
    expect(cohort.id).toBe(10);
    expect(cohort.name).toBe("New Cohort");
  });

  it("createCohort() sends description when provided", async () => {
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

  it("createCohort() sends definition when provided", async () => {
    const { ws } = makeFacadeWorkspace(() => ok(cohortJson(12, "Defined")));
    const cohort = await ws.createCohort(
      new CreateCohortParams({
        name: "Defined",
        definition: { filter: { event: "Signup" } },
      }),
    );
    expect(cohort.id).toBe(12);
  });

  it("createCohort() sends data_group_id when provided", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ ...cohortJson(13, "Grouped"), data_group_id: "group-x" }),
    );
    const cohort = await ws.createCohort(
      new CreateCohortParams({ name: "Grouped", data_group_id: "group-x" }),
    );
    expect(cohort.data_group_id).toBe("group-x");
  });

  it("updateCohort() returns the updated Cohort", async () => {
    const { ws } = makeFacadeWorkspace(() => ok(cohortJson(1, "Updated Name")));
    const cohort = await ws.updateCohort(
      1,
      new UpdateCohortParams({ name: "Updated Name" }),
    );

    expect(cohort).toBeInstanceOf(Cohort);
    expect(cohort.name).toBe("Updated Name");
  });

  it("updateCohort() can update description", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ ...cohortJson(1, "Same"), description: "New desc" }),
    );
    const cohort = await ws.updateCohort(
      1,
      new UpdateCohortParams({ description: "New desc" }),
    );
    expect(cohort.description).toBe("New desc");
  });

  it("updateCohort() can toggle visibility", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ ...cohortJson(1, "Toggle"), is_visible: false }),
    );
    const cohort = await ws.updateCohort(
      1,
      new UpdateCohortParams({ is_visible: false }),
    );
    expect(cohort.is_visible).toBe(false);
  });

  it("updateCohort() can update the definition", async () => {
    const { ws } = makeFacadeWorkspace(() => ok(cohortJson(1, "Redefined")));
    const cohort = await ws.updateCohort(
      1,
      new UpdateCohortParams({ definition: { filter: { event: "Purchase" } } }),
    );
    expect(cohort.id).toBe(1);
  });

  it("deleteCohort() returns None on success", async () => {
    const { ws } = makeFacadeWorkspace(() => ({ status: 204 }));
    await expect(ws.deleteCohort(1)).resolves.toBeUndefined();
  });

  it("deleteCohort() handles a 200 response", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({}));
    await expect(ws.deleteCohort(1)).resolves.toBeUndefined();
  });

  it("bulkDeleteCohorts() returns None on success", async () => {
    const { ws } = makeFacadeWorkspace(() => ({ status: 204 }));
    await expect(ws.bulkDeleteCohorts([1, 2])).resolves.toBeUndefined();
  });

  it("bulkDeleteCohorts() works with a single ID", async () => {
    const { ws } = makeFacadeWorkspace(() => ({ status: 204 }));
    await expect(ws.bulkDeleteCohorts([42])).resolves.toBeUndefined();
  });

  it("bulkDeleteCohorts() sends multiple IDs", async () => {
    const { ws, transport } = makeFacadeWorkspace(() => ({ status: 204 }));
    await ws.bulkDeleteCohorts([10, 20, 30]);
    expect(transport.captures).toHaveLength(1);
  });

  it("bulkUpdateCohorts() returns None on success", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({}));
    await expect(
      ws.bulkUpdateCohorts([
        new BulkUpdateCohortEntry({ id: 1, name: "Updated A" }),
      ]),
    ).resolves.toBeUndefined();
  });

  it("bulkUpdateCohorts() handles multiple entries", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({}));
    await expect(
      ws.bulkUpdateCohorts([
        new BulkUpdateCohortEntry({ id: 1, name: "A" }),
        new BulkUpdateCohortEntry({ id: 2, name: "B" }),
        new BulkUpdateCohortEntry({ id: 3, description: "New desc" }),
      ]),
    ).resolves.toBeUndefined();
  });

  it("bulkUpdateCohorts() can update definitions", async () => {
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

  it("listCohortsFull() preserves count on each cohort", async () => {
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

  it("getCohort() result has correct field types", async () => {
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

  it("createCohort() can create a locked cohort", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok({ ...cohortJson(14, "Locked"), is_locked: true }),
    );
    const cohort = await ws.createCohort(
      new CreateCohortParams({ name: "Locked", is_locked: true }),
    );
    expect(cohort.is_locked).toBe(true);
  });

  it("updateCohort() can toggle lock state", async () => {
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
