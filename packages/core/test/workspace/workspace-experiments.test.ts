// B6-W4 Layer-3 translation (packet `b6-packets.md` §6) of the WHOLE
// of `tests/unit/test_workspace_experiments.py` (464 lines, 3 classes):
// `TestWorkspaceExperimentCRUD`,
// `TestWorkspaceExperimentLifecycle` and
// `TestWorkspaceExperimentManagement`.
//
// Python's `httpx.MockTransport` handler becomes the injected-fetch
// `fakeTransport` seam; `_make_workspace(temp_dir, handler)`
// becomes `makeFacadeWorkspace(handler)` — the client is built over the
// OAuth session (`_make_oauth_credentials`, :56) while the facade
// carries the service-account `_TEST_SESSION`, exactly as
// Python does. Unlike the flags module, NO workspace pin is installed:
// every experiment path is project-scoped (`experiments.ts`, B4-C4).
// `temp_dir` has no TS analog (no config file is ever touched) and is
// dropped.
//
// ADDITIVE sections (clearly headed, never substituting for a
// translated Python assertion — B5 Caution #13 / packet §0.2): the
// three empty-response guards Python's suite never reaches through the
// wire (`workspace.py:6151`, `:6183`, `:6221`) and the
// `conclude_experiment` `body or {}` branch (`:6300`).

import { describe, expect, it } from "vitest";

import {
  CreateExperimentParams,
  DuplicateExperimentParams,
  Experiment,
  ExperimentConcludeParams,
  ExperimentDecideParams,
  UpdateExperimentParams,
} from "../../src/types/entities/experiments.js";
import { ExperimentStatus } from "../../src/types/enums.js";
import {
  concludeExperiment as concludeExperimentMember,
  createExperiment as createExperimentMember,
  getExperiment as getExperimentMember,
  updateExperiment as updateExperimentMember,
} from "../../src/workspace-members/flags-experiments.js";
import { ok } from "../../test-support/client-test-helpers.js";
import {
  makeFacadeWorkspace,
  stubClient,
} from "../../test-support/workspace-test-helpers.js";

/**
 * A minimal experiment dict matching the API shape
 * (`_experiment_json`, :98-117).
 *
 * @param id - Experiment UUID.
 * @param name - Experiment name.
 * @param status - Experiment lifecycle status.
 * @returns The payload record.
 */
function experimentJson(
  id = "xyz-456",
  name = "Test Experiment",
  status = "draft",
): Record<string, unknown> {
  return { id, name, status };
}

// =============================================================================
// TestWorkspaceExperimentCRUD
// =============================================================================

describe("TestWorkspaceExperimentCRUD", () => {
  it("list_experiments() returns list of Experiment objects", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok([
        experimentJson("abc-123", "Exp A"),
        experimentJson("def-456", "Exp B"),
      ]),
    );
    const experiments = await ws.listExperiments();

    expect(experiments).toHaveLength(2);
    expect(experiments[0]).toBeInstanceOf(Experiment);
    expect(experiments[0]?.id).toBe("abc-123");
    expect(experiments[0]?.name).toBe("Exp A");
    expect(experiments[1]?.id).toBe("def-456");
    expect(experiments[1]?.name).toBe("Exp B");
  });

  it("list_experiments() returns empty list when no experiments exist", async () => {
    const { ws } = makeFacadeWorkspace(() => ok([]));
    await expect(ws.listExperiments()).resolves.toStrictEqual([]);
  });

  it("list_experiments(include_archived=True) passes param to API", async () => {
    const { ws, transport } = makeFacadeWorkspace(() => ok([experimentJson()]));
    const experiments = await ws.listExperiments({ include_archived: true });

    expect(experiments).toHaveLength(1);
    expect(experiments[0]).toBeInstanceOf(Experiment);
    expect(transport.captures[0]?.url).toContain("include_archived=true");
  });

  it("create_experiment() returns the created Experiment", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok(experimentJson("new-123", "New Experiment")),
    );
    const params = new CreateExperimentParams({ name: "New Experiment" });
    const experiment = await ws.createExperiment(params);

    expect(experiment).toBeInstanceOf(Experiment);
    expect(experiment.id).toBe("new-123");
    expect(experiment.name).toBe("New Experiment");
  });

  it("get_experiment() returns the requested Experiment", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok(experimentJson("xyz-456", "Got Experiment")),
    );
    const experiment = await ws.getExperiment("xyz-456");

    expect(experiment).toBeInstanceOf(Experiment);
    expect(experiment.id).toBe("xyz-456");
    expect(experiment.name).toBe("Got Experiment");
  });

  it("update_experiment() returns the updated Experiment", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok(experimentJson("xyz-456", "Updated Experiment")),
    );
    const params = new UpdateExperimentParams({ name: "Updated Experiment" });
    const experiment = await ws.updateExperiment("xyz-456", params);

    expect(experiment).toBeInstanceOf(Experiment);
    expect(experiment.id).toBe("xyz-456");
    expect(experiment.name).toBe("Updated Experiment");
  });

  it("delete_experiment() returns None on success", async () => {
    const { ws } = makeFacadeWorkspace(() => ({ status: 204 }));
    await expect(ws.deleteExperiment("xyz-456")).resolves.toBeUndefined();
  });
});

// =============================================================================
// TestWorkspaceExperimentLifecycle
// =============================================================================

describe("TestWorkspaceExperimentLifecycle", () => {
  it("launch_experiment() returns the launched Experiment", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok(experimentJson("xyz-456", "Test Experiment", "active")),
    );
    const experiment = await ws.launchExperiment("xyz-456");

    expect(experiment).toBeInstanceOf(Experiment);
    expect(experiment.id).toBe("xyz-456");
    expect(experiment.status).toBe(ExperimentStatus.ACTIVE);
  });

  it("conclude_experiment() without params returns the concluded Experiment", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok(experimentJson("xyz-456", "Test Experiment", "concluded")),
    );
    const experiment = await ws.concludeExperiment("xyz-456");

    expect(experiment).toBeInstanceOf(Experiment);
    expect(experiment.id).toBe("xyz-456");
    expect(experiment.status).toBe(ExperimentStatus.CONCLUDED);
  });

  it("conclude_experiment() with params passes them to the API", async () => {
    const capturedBody: unknown[] = [];
    const { ws } = makeFacadeWorkspace((request) => {
      if (request.bodyText !== "") {
        capturedBody.push(JSON.parse(request.bodyText));
      }
      return ok(experimentJson("xyz-456", "Test Experiment", "concluded"));
    });
    const params = new ExperimentConcludeParams({ end_date: "2026-04-01" });
    const experiment = await ws.concludeExperiment("xyz-456", { params });

    expect(experiment).toBeInstanceOf(Experiment);
    expect(experiment.status).toBe(ExperimentStatus.CONCLUDED);
    expect(capturedBody).toHaveLength(1);
    expect((capturedBody[0] as Record<string, unknown>)["end_date"]).toBe(
      "2026-04-01",
    );
  });

  it("decide_experiment() returns the decided Experiment", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok(experimentJson("xyz-456", "Test Experiment", "success")),
    );
    const params = new ExperimentDecideParams({
      success: true,
      variant: "treatment",
    });
    const experiment = await ws.decideExperiment("xyz-456", params);

    expect(experiment).toBeInstanceOf(Experiment);
    expect(experiment.id).toBe("xyz-456");
    expect(experiment.status).toBe(ExperimentStatus.SUCCESS);
  });
});

// =============================================================================
// TestWorkspaceExperimentManagement
// =============================================================================

describe("TestWorkspaceExperimentManagement", () => {
  it("archive_experiment() returns None on success", async () => {
    const { ws } = makeFacadeWorkspace(() => ({ status: 204 }));
    await expect(ws.archiveExperiment("xyz-456")).resolves.toBeUndefined();
  });

  it("restore_experiment() returns the restored Experiment", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok(experimentJson("xyz-456", "Restored Experiment", "draft")),
    );
    const experiment = await ws.restoreExperiment("xyz-456");

    expect(experiment).toBeInstanceOf(Experiment);
    expect(experiment.id).toBe("xyz-456");
    expect(experiment.name).toBe("Restored Experiment");
  });

  it("duplicate_experiment() with params returns the duplicated Experiment", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok(experimentJson("dup-789", "Copy of Test Experiment")),
    );
    const params = new DuplicateExperimentParams({
      name: "Copy of Test Experiment",
    });
    const experiment = await ws.duplicateExperiment("xyz-456", params);

    expect(experiment).toBeInstanceOf(Experiment);
    expect(experiment.id).toBe("dup-789");
    expect(experiment.name).toBe("Copy of Test Experiment");
  });

  it("duplicate_experiment() requires params with a name", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok(experimentJson("dup-789", "Auto Copy")),
    );
    const params = new DuplicateExperimentParams({ name: "Auto Copy" });
    const experiment = await ws.duplicateExperiment("xyz-456", params);

    expect(experiment).toBeInstanceOf(Experiment);
    expect(experiment.id).toBe("dup-789");
    expect(experiment.name).toBe("Auto Copy");
  });

  it("list_erf_experiments() returns list of dicts", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok([{ id: "erf-1", name: "ERF Exp" }]),
    );
    const results = await ws.listErfExperiments();

    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(1);
    expect(results[0]?.["id"]).toBe("erf-1");
  });
});

// =============================================================================
// ADDITIVE — facade-local branches Python's suite never reaches through
// the wire (B5 Caution #13 pattern). NOT substitutes for a translated
// Python assertion.
// =============================================================================

describe("ADDITIVE: conclude_experiment body assembly (`workspace.py:6300`)", () => {
  it("sends `{}` when no params are supplied", async () => {
    const calls: unknown[][] = [];
    const client = stubClient(
      "concludeExperiment",
      { id: "e1", name: "n", status: "concluded" },
      calls,
    );
    await concludeExperimentMember(client, "e1");

    expect(calls[0]?.[0]).toBe("e1");
    expect(calls[0]?.[1]).toStrictEqual({});
  });

  it("sends the exclude_none dump when params are supplied", async () => {
    const calls: unknown[][] = [];
    const client = stubClient(
      "concludeExperiment",
      { id: "e1", name: "n", status: "concluded" },
      calls,
    );
    await concludeExperimentMember(client, "e1", {
      params: new ExperimentConcludeParams({ end_date: "2026-04-01" }),
    });

    expect(calls[0]?.[1]).toStrictEqual({ end_date: "2026-04-01" });
  });
});

describe("ADDITIVE: empty-response guards (UNKNOWN_ERROR)", () => {
  const cases: ReadonlyArray<[string, () => Promise<unknown>]> = [
    [
      "create_experiment",
      (): Promise<unknown> =>
        createExperimentMember(
          stubClient("createExperiment", null),
          new CreateExperimentParams({ name: "n" }),
        ),
    ],
    [
      "get_experiment",
      (): Promise<unknown> =>
        getExperimentMember(stubClient("getExperiment", null), "e1"),
    ],
    [
      "update_experiment",
      (): Promise<unknown> =>
        updateExperimentMember(
          stubClient("updateExperiment", null),
          "e1",
          new UpdateExperimentParams({ name: "n" }),
        ),
    ],
  ];

  it.each(cases)(
    "%s raises MixpanelHeadlessError(UNKNOWN_ERROR) on a null payload",
    async (pythonName, call) => {
      await expect(call()).rejects.toMatchObject({
        name: "MixpanelHeadlessError",
        code: "UNKNOWN_ERROR",
        message: `API returned empty response for ${pythonName}`,
      });
    },
  );
});
