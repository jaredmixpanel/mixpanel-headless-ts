// B6-W8 Layer-3 translation (packet `b6-packets.md` §10) — the WHOLE
// of `tests/unit/test_workspace_governance.py` (781 lines, 14 classes
// :194-:781):
//
//   enforcement : `TestGetSchemaEnforcement`,
//     `TestInitSchemaEnforcement`,
//     `TestUpdateSchemaEnforcement`,
//     `TestReplaceSchemaEnforcement`,
//     `TestDeleteSchemaEnforcement`
//   auditing    : `TestRunAudit`, `TestRunAuditEventsOnly`
//   anomalies   : `TestListDataVolumeAnomalies`,
//     `TestUpdateAnomaly`, `TestBulkUpdateAnomalies`
//   deletion    : `TestListDeletionRequests`,
//     `TestCreateDeletionRequest`,
//     `TestCancelDeletionRequest`,
//     `TestPreviewDeletionFilters`
//
// Python's `httpx.MockTransport` handler becomes the injected-fetch
// `fakeTransport` seam; `_make_workspace(temp_dir, handler)`
// becomes `makeWorkspace(handler)`. `temp_dir` has no TS analog and is
// dropped (the W6/W7 precedent).
//
// ADDITIVE sections (clearly headed, never substituting for a
// translated Python assertion — B5 Caution #13 / packet §0.2): the
// facade-local branches Python's suite does not reach — the two
// `run_audit*` composite bodies branch-for-branch
// (`workspace.py:9050-9067`, `:9088-9104`), the delegation contracts,
// and the two dump spellings (`model_dump(by_alias=True)` at `:9169`
// / `:9198` vs `model_dump(exclude_none=True, by_alias=True)`
// everywhere else).

import { describe, expect, it } from "vitest";

import type { MixpanelClient } from "../../src/client/client.js";
import { MixpanelHeadlessError } from "../../src/errors.js";
import {
  AuditResponse,
  AuditViolation,
  BulkAnomalyEntry,
  BulkUpdateAnomalyParams,
  CreateDeletionRequestParams,
  DataVolumeAnomaly,
  EventDeletionRequest,
  InitSchemaEnforcementParams,
  PreviewDeletionFiltersParams,
  ReplaceSchemaEnforcementParams,
  SchemaEnforcementConfig,
  UpdateAnomalyParams,
  UpdateSchemaEnforcementParams,
} from "../../src/types/entities/schemas.js";
import { Workspace } from "../../src/workspace.js";
import {
  bulkUpdateAnomalies as bulkUpdateAnomaliesMember,
  cancelDeletionRequest as cancelDeletionRequestMember,
  createDeletionRequest as createDeletionRequestMember,
  deleteSchemaEnforcement as deleteSchemaEnforcementMember,
  getSchemaEnforcement as getSchemaEnforcementMember,
  initSchemaEnforcement as initSchemaEnforcementMember,
  listDataVolumeAnomalies as listDataVolumeAnomaliesMember,
  listDeletionRequests as listDeletionRequestsMember,
  previewDeletionFilters as previewDeletionFiltersMember,
  replaceSchemaEnforcement as replaceSchemaEnforcementMember,
  runAudit as runAuditMember,
  runAuditEventsOnly as runAuditEventsOnlyMember,
  updateAnomaly as updateAnomalyMember,
  updateSchemaEnforcement as updateSchemaEnforcementMember,
} from "../../src/workspace-members/schemas-audit.js";
import {
  type CannedResponse,
  type CapturedFetchRequest,
  createMockClient,
  type FakeTransport,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** A canned-response handler (the `httpx.MockTransport` handler twin). */
type Handler = (request: CapturedFetchRequest) => CannedResponse;

/** The OAuth session the mock client is built over (`:62-68`). */
const CLIENT_SESSION = makeSession({
  projectId: "12345",
  region: "us",
  oauthToken: "test-token",
});

/** The canonical service-account facade session (`_TEST_SESSION`, :46-55). */
const FACADE_SESSION = makeSession({
  projectId: "12345",
  region: "us",
  username: "test_user",
  secret: "test_secret",
});

/**
 * Build a Workspace whose client routes through `handler`
 * (`_make_workspace`, :76-93).
 *
 * @param handler - The canned-response handler.
 * @returns The facade plus the transport capture log.
 */
function makeWorkspace(handler: Handler): {
  ws: Workspace;
  transport: FakeTransport;
} {
  const { client, transport } = createMockClient(CLIENT_SESSION, handler);
  return { ws: new Workspace({ session: FACADE_SESSION, client }), transport };
}

/**
 * The App-API envelope every handler in the Python file returns.
 *
 * @param results - The `results` member.
 * @returns The canned 200 response.
 */
function ok(results: unknown): CannedResponse {
  return { status: 200, json: { status: "ok", results } };
}

/**
 * A minimal enforcement config dict (`_enforcement_json`, :101-116).
 *
 * @returns The payload record.
 */
function enforcementJson(): Record<string, unknown> {
  return {
    id: 1,
    ruleEvent: "Warn and Accept",
    state: "ingested",
    notificationEmails: ["admin@example.com"],
    events: [],
    commonProperties: [],
    userProperties: [],
  };
}

/**
 * A minimal anomaly dict (`_anomaly_json`, :119-153).
 *
 * @param id - Anomaly ID.
 * @param eventName - Event name.
 * @param status - Anomaly status.
 * @param anomalyClass - Class of anomaly.
 * @returns The payload record.
 */
function anomalyJson(
  id = 1,
  eventName = "Signup",
  status = "open",
  anomalyClass = "Event",
): Record<string, unknown> {
  return {
    id,
    timestamp: "2026-01-01T00:00:00Z",
    actualCount: 5000,
    predictedUpper: 3000,
    predictedLower: 1000,
    percentVariance: "66.7%",
    status,
    project: 12345,
    event: 1,
    eventName,
    property: null,
    propertyName: null,
    metric: null,
    metricName: null,
    metricType: null,
    primaryType: null,
    driftTypes: null,
    anomalyClass,
  };
}

/**
 * A minimal deletion request dict (`_deletion_request_json`,
 * :156-186).
 *
 * @param id - Request ID.
 * @param eventName - Event name to delete.
 * @param status - Request status.
 * @returns The payload record.
 */
function deletionRequestJson(
  id = 1,
  eventName = "bad_event",
  status = "Submitted",
): Record<string, unknown> {
  return {
    id,
    displayName: null,
    eventName,
    fromDate: "2026-01-01",
    toDate: "2026-01-31",
    filters: null,
    status,
    deletedEventsCount: 0,
    created: "2026-01-15T00:00:00Z",
    requestingUser: { id: 1, email: "admin@example.com" },
  };
}

// ===========================================================================
// Schema Enforcement
// ===========================================================================

describe("Workspace.getSchemaEnforcement", () => {
  it("returns a SchemaEnforcementConfig (:197)", async () => {
    const { ws } = makeWorkspace(() => ok(enforcementJson()));

    const result = await ws.getSchemaEnforcement();

    expect(result).toBeInstanceOf(SchemaEnforcementConfig);
    expect(result.rule_event).toBe("Warn and Accept");
    expect(result.state).toBe("ingested");
    expect(result.id).toBe(1);
  });

  it("returns a partial config with fields=... (:215)", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ ruleEvent: "Warn and Accept", state: "ingested" }),
    );

    const result = await ws.getSchemaEnforcement({ fields: "ruleEvent,state" });

    expect(result).toBeInstanceOf(SchemaEnforcementConfig);
    expect(result.rule_event).toBe("Warn and Accept");
  });
});

describe("Workspace.initSchemaEnforcement", () => {
  it("returns a dict response (:241)", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ id: 1, ruleEvent: "Warn and Drop", state: "planned" }),
    );

    const result = await ws.initSchemaEnforcement(
      new InitSchemaEnforcementParams({ rule_event: "Warn and Drop" }),
    );

    expect(result).toBeTypeOf("object");
    expect(result["ruleEvent"]).toBe("Warn and Drop");
  });
});

describe("Workspace.updateSchemaEnforcement", () => {
  it("returns a dict response (:269)", async () => {
    const { ws } = makeWorkspace(() =>
      ok({
        ruleEvent: "Warn and Hide",
        notificationEmails: ["new@example.com"],
      }),
    );

    const result = await ws.updateSchemaEnforcement(
      new UpdateSchemaEnforcementParams({
        rule_event: "Warn and Hide",
        notification_emails: ["new@example.com"],
      }),
    );

    expect(result).toBeTypeOf("object");
    expect(result["ruleEvent"]).toBe("Warn and Hide");
  });
});

describe("Workspace.replaceSchemaEnforcement", () => {
  it("returns a dict response (:299)", async () => {
    const { ws } = makeWorkspace(() =>
      ok({
        ruleEvent: "Warn and Drop",
        notificationEmails: ["admin@example.com"],
        events: [{ name: "Signup" }],
        commonProperties: [{ name: "utm_source" }],
        userProperties: [{ name: "$email" }],
      }),
    );

    const result = await ws.replaceSchemaEnforcement(
      new ReplaceSchemaEnforcementParams({
        rule_event: "Warn and Drop",
        notification_emails: ["admin@example.com"],
        events: [{ name: "Signup" }],
        common_properties: [{ name: "utm_source" }],
        user_properties: [{ name: "$email" }],
      }),
    );

    expect(result).toBeTypeOf("object");
    expect(result["ruleEvent"]).toBe("Warn and Drop");
  });
});

describe("Workspace.deleteSchemaEnforcement", () => {
  it("returns a dict response (:335)", async () => {
    const { ws } = makeWorkspace(() => ok({ deleted: true }));

    const result = await ws.deleteSchemaEnforcement();

    expect(result).toBeTypeOf("object");
    expect(result["deleted"]).toBe(true);
  });
});

// ===========================================================================
// Data Auditing
// ===========================================================================

describe("Workspace.runAudit", () => {
  it("returns an AuditResponse with parsed violations (:360)", async () => {
    const { ws } = makeWorkspace(() =>
      ok([
        [
          { violation: "Unexpected Event", name: "bad_event", count: 42 },
          {
            violation: "Missing Property",
            name: "utm_source",
            event: "Signup",
            count: 10,
          },
        ],
        { computed_at: "2026-01-01T00:00:00Z" },
      ]),
    );

    const result = await ws.runAudit();

    expect(result).toBeInstanceOf(AuditResponse);
    expect(result.violations).toHaveLength(2);
    expect(result.violations[0]).toBeInstanceOf(AuditViolation);
    expect(result.violations[0]?.violation).toBe("Unexpected Event");
    expect(result.violations[0]?.name).toBe("bad_event");
    expect(result.violations[0]?.count).toBe(42);
    expect(result.violations[1]?.violation).toBe("Missing Property");
    expect(result.violations[1]?.event).toBe("Signup");
    expect(result.computed_at).toBe("2026-01-01T00:00:00Z");
  });

  it("handles an empty violations list (:401)", async () => {
    const { ws } = makeWorkspace(() =>
      ok([[], { computed_at: "2026-01-01T12:00:00Z" }]),
    );

    const result = await ws.runAudit();

    expect(result).toBeInstanceOf(AuditResponse);
    expect(result.violations).toStrictEqual([]);
    expect(result.computed_at).toBe("2026-01-01T12:00:00Z");
  });

  it("returns an empty AuditResponse for an empty results list (:421)", async () => {
    const { ws } = makeWorkspace(() => ok([]));

    const result = await ws.runAudit();

    expect(result).toBeInstanceOf(AuditResponse);
    expect(result.violations).toStrictEqual([]);
    expect(result.computed_at).toBe("");
  });
});

describe("Workspace.runAuditEventsOnly", () => {
  it("returns an AuditResponse (:446)", async () => {
    const { ws } = makeWorkspace(() =>
      ok([
        [{ violation: "Unexpected Event", name: "rogue_event", count: 100 }],
        { computed_at: "2026-01-02T00:00:00Z" },
      ]),
    );

    const result = await ws.runAuditEventsOnly();

    expect(result).toBeInstanceOf(AuditResponse);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.violation).toBe("Unexpected Event");
    expect(result.violations[0]?.name).toBe("rogue_event");
    expect(result.computed_at).toBe("2026-01-02T00:00:00Z");
  });

  it("returns an empty AuditResponse when empty (:477)", async () => {
    const { ws } = makeWorkspace(() => ok([]));

    const result = await ws.runAuditEventsOnly();

    expect(result).toBeInstanceOf(AuditResponse);
    expect(result.violations).toStrictEqual([]);
    expect(result.computed_at).toBe("");
  });
});

// ===========================================================================
// Data Volume Anomalies
// ===========================================================================

describe("Workspace.listDataVolumeAnomalies", () => {
  it("returns a list of DataVolumeAnomaly (:507)", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ anomalies: [anomalyJson(1, "Signup"), anomalyJson(2, "Login")] }),
    );

    const result = await ws.listDataVolumeAnomalies();

    expect(result).toHaveLength(2);
    expect(result[0]).toBeInstanceOf(DataVolumeAnomaly);
    expect(result[0]?.id).toBe(1);
    expect(result[0]?.event_name).toBe("Signup");
    expect(result[0]?.status).toBe("open");
    expect(result[0]?.anomaly_class).toBe("Event");
    expect(result[1]).toBeInstanceOf(DataVolumeAnomaly);
    expect(result[1]?.id).toBe(2);
    expect(result[1]?.event_name).toBe("Login");
  });

  it("returns an empty list when none exist (:538)", async () => {
    const { ws } = makeWorkspace(() => ok({ anomalies: [] }));

    await expect(ws.listDataVolumeAnomalies()).resolves.toStrictEqual([]);
  });

  it("passes query_params filters (:553)", async () => {
    const capturedUrls: string[] = [];
    const { ws } = makeWorkspace((request) => {
      capturedUrls.push(request.url);
      return ok({ anomalies: [anomalyJson(1)] });
    });

    const result = await ws.listDataVolumeAnomalies({
      query_params: { status: "open" },
    });

    expect(result).toHaveLength(1);
    expect(capturedUrls[0]).toContain("status=open");
  });
});

describe("Workspace.updateAnomaly", () => {
  it("returns a dict response (:578)", async () => {
    const { ws } = makeWorkspace(() => ok({ updated: true }));

    const result = await ws.updateAnomaly(
      new UpdateAnomalyParams({
        id: 123,
        status: "dismissed",
        anomaly_class: "Event",
      }),
    );

    expect(result).toBeTypeOf("object");
    expect(result["updated"]).toBe(true);
  });
});

describe("Workspace.bulkUpdateAnomalies", () => {
  it("returns a dict response (:599)", async () => {
    const { ws } = makeWorkspace(() => ok({ updated: 2 }));

    const result = await ws.bulkUpdateAnomalies(
      new BulkUpdateAnomalyParams({
        anomalies: [
          new BulkAnomalyEntry({ id: 1, anomaly_class: "Event" }),
          new BulkAnomalyEntry({ id: 2, anomaly_class: "Property" }),
        ],
        status: "dismissed",
      }),
    );

    expect(result).toBeTypeOf("object");
    expect(result["updated"]).toBe(2);
  });
});

// ===========================================================================
// Event Deletion Requests
// ===========================================================================

describe("Workspace.listDeletionRequests", () => {
  it("returns a list of EventDeletionRequest (:631)", async () => {
    const { ws } = makeWorkspace(() =>
      ok([
        deletionRequestJson(1, "event_a"),
        deletionRequestJson(2, "event_b"),
      ]),
    );

    const result = await ws.listDeletionRequests();

    expect(result).toHaveLength(2);
    expect(result[0]).toBeInstanceOf(EventDeletionRequest);
    expect(result[0]?.id).toBe(1);
    expect(result[0]?.event_name).toBe("event_a");
    expect(result[0]?.status).toBe("Submitted");
    expect(result[1]).toBeInstanceOf(EventDeletionRequest);
    expect(result[1]?.id).toBe(2);
  });

  it("returns an empty list when none exist (:658)", async () => {
    const { ws } = makeWorkspace(() => ok([]));

    await expect(ws.listDeletionRequests()).resolves.toStrictEqual([]);
  });
});

describe("Workspace.createDeletionRequest", () => {
  it("returns the updated list of EventDeletionRequest (:677)", async () => {
    const { ws } = makeWorkspace(() =>
      ok([
        deletionRequestJson(1, "existing"),
        deletionRequestJson(2, "new_event"),
      ]),
    );

    const result = await ws.createDeletionRequest(
      new CreateDeletionRequestParams({
        event_name: "new_event",
        from_date: "2026-01-01",
        to_date: "2026-01-31",
      }),
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toBeInstanceOf(EventDeletionRequest);
    expect(result[1]).toBeInstanceOf(EventDeletionRequest);
    expect(result[1]?.event_name).toBe("new_event");
  });
});

describe("Workspace.cancelDeletionRequest", () => {
  it("returns the updated list of EventDeletionRequest (:710)", async () => {
    const { ws } = makeWorkspace(() =>
      ok([deletionRequestJson(1, "remaining")]),
    );

    const result = await ws.cancelDeletionRequest(42);

    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(EventDeletionRequest);
    expect(result[0]?.event_name).toBe("remaining");
  });
});

describe("Workspace.previewDeletionFilters", () => {
  it("returns a list of filter dicts (:734)", async () => {
    const { ws } = makeWorkspace(() =>
      ok([
        { property: "country", op: "equals", value: "US" },
        { property: "platform", op: "equals", value: "iOS" },
      ]),
    );

    const result = await ws.previewDeletionFilters(
      new PreviewDeletionFiltersParams({
        event_name: "Signup",
        from_date: "2026-01-01",
        to_date: "2026-01-31",
      }),
    );

    expect(result).toHaveLength(2);
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]?.["property"]).toBe("country");
    expect(result[1]?.["property"]).toBe("platform");
  });

  it("returns an empty list when no filters match (:763)", async () => {
    const { ws } = makeWorkspace(() => ok([]));

    const result = await ws.previewDeletionFilters(
      new PreviewDeletionFiltersParams({
        event_name: "NoMatch",
        from_date: "2026-01-01",
        to_date: "2026-01-31",
      }),
    );

    expect(result).toStrictEqual([]);
  });
});

// ===========================================================================
// ADDITIVE (B5 Caution #13): the `run_audit*` composite branches and the
// facade-local delegation contracts. These do NOT substitute for any
// translated Python assertion.
// ===========================================================================

/** One recorded delegation call. */
interface DelegationCall {
  /** The client method name. */
  readonly method: string;
  /** The positional arguments, verbatim. */
  readonly args: readonly unknown[];
}

/**
 * A client stub recording every W8 enforcement/audit/anomaly/deletion
 * call.
 *
 * @param returns - Per-method canned return values.
 * @returns The stub plus its call log.
 */
function delegationStub(returns: Readonly<Record<string, unknown>>): {
  client: MixpanelClient;
  calls: DelegationCall[];
} {
  const calls: DelegationCall[] = [];
  const record =
    (method: string) =>
    (...args: unknown[]): Promise<unknown> => {
      calls.push({ method, args });
      return Promise.resolve(returns[method]);
    };
  const stub = {
    getSchemaEnforcement: record("getSchemaEnforcement"),
    initSchemaEnforcement: record("initSchemaEnforcement"),
    updateSchemaEnforcement: record("updateSchemaEnforcement"),
    replaceSchemaEnforcement: record("replaceSchemaEnforcement"),
    deleteSchemaEnforcement: record("deleteSchemaEnforcement"),
    runAudit: record("runAudit"),
    runAuditEventsOnly: record("runAuditEventsOnly"),
    listDataVolumeAnomalies: record("listDataVolumeAnomalies"),
    updateAnomaly: record("updateAnomaly"),
    bulkUpdateAnomalies: record("bulkUpdateAnomalies"),
    listDeletionRequests: record("listDeletionRequests"),
    createDeletionRequest: record("createDeletionRequest"),
    cancelDeletionRequest: record("cancelDeletionRequest"),
    previewDeletionFilters: record("previewDeletionFilters"),
  };
  return { client: stub as unknown as MixpanelClient, calls };
}

describe("ADDITIVE: run_audit composite branches (`workspace.py:9050-9067`)", () => {
  it("raises when the first element is not a list (both members)", async () => {
    const { client } = delegationStub({
      runAudit: [{ computed_at: "x" }],
      runAuditEventsOnly: ["nope"],
    });

    await expect(runAuditMember(client)).rejects.toBeInstanceOf(
      MixpanelHeadlessError,
    );
    await expect(runAuditMember(client)).rejects.toThrow(
      /Unexpected audit response: expected list of violations, got dict/,
    );
    await expect(runAuditEventsOnlyMember(client)).rejects.toThrow(/got str/);
  });

  it("carries the exceptions.py default code UNKNOWN_ERROR", async () => {
    const { client } = delegationStub({ runAudit: [42] });

    await expect(runAuditMember(client)).rejects.toMatchObject({
      code: "UNKNOWN_ERROR",
    });
  });

  it("falls back to {} metadata when raw has a single element", async () => {
    const { client } = delegationStub({ runAudit: [[]] });

    const result = await runAuditMember(client);

    expect(result.computed_at).toBe("");
    expect(result.violations).toStrictEqual([]);
  });

  it("falls back to {} metadata when raw[1] is not a dict (watchlist #13)", async () => {
    const { client } = delegationStub({ runAudit: [[], ["not", "a", "dict"]] });

    expect((await runAuditMember(client)).computed_at).toBe("");
  });

  it("defaults computed_at to '' when the metadata omits the key", async () => {
    const { client } = delegationStub({ runAudit: [[], { other: 1 }] });

    expect((await runAuditMember(client)).computed_at).toBe("");
  });

  it("validates each violation with the member's own endpoint string", async () => {
    const events = delegationStub({
      runAuditEventsOnly: [[{ name: "x" }], {}],
    });

    await expect(runAuditEventsOnlyMember(events.client)).rejects.toMatchObject(
      {
        code: "RESPONSE_VALIDATION_ERROR",
        details: { model: "AuditViolation" },
      },
    );
  });
});

describe("ADDITIVE: delegation contracts", () => {
  it("the enforcement members forward the dumped body / options bag", async () => {
    const { client, calls } = delegationStub({
      getSchemaEnforcement: {},
      initSchemaEnforcement: {},
      updateSchemaEnforcement: {},
      replaceSchemaEnforcement: {},
      deleteSchemaEnforcement: {},
    });

    await getSchemaEnforcementMember(client, { fields: "ruleEvent" });
    await getSchemaEnforcementMember(client);
    await initSchemaEnforcementMember(
      client,
      new InitSchemaEnforcementParams({ rule_event: "Warn and Drop" }),
    );
    await updateSchemaEnforcementMember(
      client,
      new UpdateSchemaEnforcementParams({ rule_event: "Warn and Hide" }),
    );
    await replaceSchemaEnforcementMember(
      client,
      // Every field but `schema_id` is REQUIRED on this model
      // (`types.py` `ReplaceSchemaEnforcementParams`), so the bag is
      // full and only the unset `schema_id` can drop.
      new ReplaceSchemaEnforcementParams({
        common_properties: [],
        user_properties: [],
        events: [],
        rule_event: "Warn and Drop",
        notification_emails: [],
      }),
    );
    await deleteSchemaEnforcementMember(client);

    expect(calls).toStrictEqual([
      { method: "getSchemaEnforcement", args: [{ fields: "ruleEvent" }] },
      { method: "getSchemaEnforcement", args: [{ fields: null }] },
      // `exclude_none=True` drops every unset field; `by_alias=True`
      // camel-cases what remains (`workspace.py:8940`, `:8970`, `:9002`).
      {
        method: "initSchemaEnforcement",
        args: [{ ruleEvent: "Warn and Drop" }],
      },
      {
        method: "updateSchemaEnforcement",
        args: [{ ruleEvent: "Warn and Hide" }],
      },
      {
        method: "replaceSchemaEnforcement",
        args: [
          {
            commonProperties: [],
            userProperties: [],
            events: [],
            ruleEvent: "Warn and Drop",
            notificationEmails: [],
          },
        ],
      },
      { method: "deleteSchemaEnforcement", args: [] },
    ]);
  });

  it("the anomaly writers use the PLAIN by_alias dump (:9169, :9198)", async () => {
    const { client, calls } = delegationStub({
      listDataVolumeAnomalies: [],
      updateAnomaly: {},
      bulkUpdateAnomalies: {},
    });

    await listDataVolumeAnomaliesMember(client, {
      query_params: { status: "open" },
    });
    await listDataVolumeAnomaliesMember(client);
    await updateAnomalyMember(
      client,
      new UpdateAnomalyParams({
        id: 7,
        status: "dismissed",
        anomaly_class: "Event",
      }),
    );
    await bulkUpdateAnomaliesMember(
      client,
      new BulkUpdateAnomalyParams({
        anomalies: [new BulkAnomalyEntry({ id: 1, anomaly_class: "Event" })],
        status: "dismissed",
      }),
    );

    expect(calls).toStrictEqual([
      {
        method: "listDataVolumeAnomalies",
        args: [{ query_params: { status: "open" } }],
      },
      { method: "listDataVolumeAnomalies", args: [{ query_params: null }] },
      {
        method: "updateAnomaly",
        args: [{ id: 7, status: "dismissed", anomalyClass: "Event" }],
      },
      {
        method: "bulkUpdateAnomalies",
        args: [
          {
            anomalies: [{ id: 1, anomalyClass: "Event" }],
            status: "dismissed",
          },
        ],
      },
    ]);
  });

  it("the deletion members forward the id / dumped body verbatim", async () => {
    const { client, calls } = delegationStub({
      listDeletionRequests: [],
      createDeletionRequest: [],
      cancelDeletionRequest: [],
      previewDeletionFilters: [{ property: "country" }],
    });

    await listDeletionRequestsMember(client);
    await createDeletionRequestMember(
      client,
      new CreateDeletionRequestParams({
        event_name: "e",
        from_date: "2026-01-01",
        to_date: "2026-01-31",
      }),
    );
    await cancelDeletionRequestMember(client, 42);
    const preview = await previewDeletionFiltersMember(
      client,
      new PreviewDeletionFiltersParams({
        event_name: "e",
        from_date: "2026-01-01",
        to_date: "2026-01-31",
      }),
    );

    expect(calls).toStrictEqual([
      { method: "listDeletionRequests", args: [] },
      {
        method: "createDeletionRequest",
        args: [
          { eventName: "e", fromDate: "2026-01-01", toDate: "2026-01-31" },
        ],
      },
      { method: "cancelDeletionRequest", args: [42] },
      {
        method: "previewDeletionFilters",
        args: [
          { eventName: "e", fromDate: "2026-01-01", toDate: "2026-01-31" },
        ],
      },
    ]);
    // Opaque passthrough: no model validation, no pre-shaping.
    expect(preview).toStrictEqual([{ property: "country" }]);
  });

  it("the model-validating members name their own model on a bad payload", async () => {
    const anomalies = makeWorkspace(() => ok({ anomalies: [{ id: 1 }] }));
    await expect(anomalies.ws.listDataVolumeAnomalies()).rejects.toMatchObject({
      code: "RESPONSE_VALIDATION_ERROR",
      details: { model: "DataVolumeAnomaly" },
    });

    const deletions = makeWorkspace(() => ok([{}]));
    await expect(deletions.ws.listDeletionRequests()).rejects.toMatchObject({
      code: "RESPONSE_VALIDATION_ERROR",
      details: { model: "EventDeletionRequest" },
    });

    const enforcement = makeWorkspace(() => ok({ id: "not-an-int" }));
    await expect(enforcement.ws.getSchemaEnforcement()).rejects.toMatchObject({
      code: "RESPONSE_VALIDATION_ERROR",
      details: { model: "SchemaEnforcementConfig" },
    });
  });
});
