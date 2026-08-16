/**
 * B6-W8 R10.9 harness — the schema-registry / enforcement / audit /
 * anomaly / deletion-request facade wire+edge set (packet
 * `b6-packets.md` §10 "R10.9 `throwaway/b6-w8/`").
 *
 * The W8 members are facade delegations with no oracle-call surface
 * (all-wire batch, §11.5), so the harness runs them through the
 * injected-fetch seam with hand-built interactions and asserts:
 *
 *   (i)   delegation equivalence — facade result === direct client
 *         result re-validated through the SAME model/native seam,
 *         over the same canned interaction;
 *   (ii)  wire status branches — `create_schema` (200 / 400 / 422)
 *         and `run_audit` (200 / 500), per the packet's named pairs;
 *   (iii) the mandatory edge set (18.0, 1.5, true, null, [], "", "𝒳")
 *         pushed through every param whose ANNOTATION admits it
 *         (Discrepancy #8): the two `schema_json: dict[str, Any]`
 *         request bodies, the `query_params: dict[str, str]` filter
 *         (strings only — the annotation admits nothing else) and the
 *         six `dict[str, Any]` / `list[dict[str, Any]]` opaque
 *         RESULT passthroughs. NO integer-like unknown keys (#9/#10).
 *   (iv)  EVERY W8-local branch: the `delete_schemas` guard, the two
 *         `run_audit*` composite bodies branch-for-branch (empty
 *         list, non-list head over six CPython type names, 1-element
 *         raw, non-dict metadata, absent `computed_at`), the three
 *         dump spellings, the `?? null` kwarg forwards, and
 *         `RESPONSE_VALIDATION_ERROR` from a malformed 200 for every
 *         validated member.
 *
 *     npx vite-node throwaway/b6-w8/wire-edges.ts
 *
 * Deterministic: no RNG, no seed, no timers — every case is a
 * hand-built canned interaction over the injected-fetch seam.
 *
 * THROWAWAY: deleted at the B6 gate; the RUN record lives in
 * `context/phase3/notes/B6-W8-notes.md` §3, which survives.
 */

import {
  createMockClient,
  makeSession,
  type CannedResponse,
  type CapturedFetchRequest,
} from "../../packages/core/test/client/client-test-helpers.js";
import type { MixpanelClient } from "../../packages/core/src/client/client.js";
import { toNativeJson } from "../../packages/core/src/client/json-value.js";
import {
  validateResponseModel,
  validateResponseModels,
} from "../../packages/core/src/client/response-validation.js";
import { Workspace } from "../../packages/core/src/workspace.js";
import {
  BulkAnomalyEntry,
  BulkCreateSchemasParams,
  BulkUpdateAnomalyParams,
  CreateDeletionRequestParams,
  EventDeletionRequest,
  InitSchemaEnforcementParams,
  PreviewDeletionFiltersParams,
  ReplaceSchemaEnforcementParams,
  SchemaEnforcementConfig,
  SchemaEntry,
  UpdateAnomalyParams,
  UpdateSchemaEnforcementParams,
} from "../../packages/core/src/types/entities/schemas.js";
import {
  runAudit as runAuditMember,
  runAuditEventsOnly as runAuditEventsOnlyMember,
} from "../../packages/core/src/workspace-members/schemas-audit.js";

let checks = 0;
let failures = 0;

/**
 * Compare two values by JSON text and record the outcome.
 *
 * @param label - What is being checked.
 * @param actual - The observed value.
 * @param expected - The expected value.
 */
function check(label: string, actual: unknown, expected: unknown): void {
  checks += 1;
  const a = JSON.stringify(actual) ?? "undefined";
  const b = JSON.stringify(expected) ?? "undefined";
  if (a !== b) {
    failures += 1;
    console.log(`FAIL ${label}\n  actual   ${a}\n  expected ${b}`);
  }
}

/**
 * Run a thunk and describe the thrown error.
 *
 * @param fn - The thunk.
 * @returns `[name, code]`, or `["<resolved>", ""]` when it did not throw.
 */
async function thrown(fn: () => Promise<unknown>): Promise<string[]> {
  try {
    await fn();
    return ["<resolved>", ""];
  } catch (error) {
    const err = error as { name?: string; code?: string };
    return [err.name ?? "?", err.code ?? "?"];
  }
}

const SESSION = makeSession({
  projectId: "12345",
  region: "us",
  oauthToken: "test-token",
});

/**
 * Build the facade + its client over one canned handler.
 *
 * @param handler - The canned-response handler.
 * @returns The facade, its client and the capture log.
 */
function rig(handler: (request: CapturedFetchRequest) => CannedResponse): {
  ws: Workspace;
  client: MixpanelClient;
  captures: readonly CapturedFetchRequest[];
} {
  const { client, transport } = createMockClient(SESSION, handler);
  return {
    ws: new Workspace({ session: SESSION, client }),
    client,
    captures: transport.captures,
  };
}

/**
 * A stub client whose named methods record their args and resolve.
 *
 * @param values - Resolved value per method name.
 * @param calls - Log receiving `[method, args]` per call.
 * @returns The stub cast to the client type.
 */
function stub(
  values: Readonly<Record<string, unknown>>,
  calls: unknown[][] = [],
): MixpanelClient {
  // The W1 facade constructor installs the /me-backed workspace
  // resolver on every client it is handed.
  const out: Record<string, unknown> = {
    hasWorkspaceResolver: false,
    setWorkspaceResolver: (): void => {},
  };
  for (const method of Object.keys(values)) {
    out[method] = (...args: unknown[]): Promise<unknown> => {
      calls.push([method, args]);
      return Promise.resolve(values[method]);
    };
  }
  return out as unknown as MixpanelClient;
}

/**
 * A 200 App-API envelope wrapping `results`.
 *
 * @param results - The `results` payload.
 * @returns The canned response.
 */
function ok(results: unknown): CannedResponse {
  return { status: 200, json: { status: "ok", results } };
}

/** A schema-registry entry payload. */
const ENTRY = {
  entityType: "event",
  name: "Purchase",
  schemaJson: { properties: { amount: { type: "number" } } },
};

/** An enforcement-config payload. */
const ENFORCEMENT = {
  id: 1,
  ruleEvent: "Warn and Accept",
  state: "ingested",
  notificationEmails: ["admin@example.com"],
  events: [],
  commonProperties: [],
  userProperties: [],
};

/** A deletion-request payload. */
const DELETION = {
  id: 1,
  displayName: null,
  eventName: "bad_event",
  fromDate: "2026-01-01",
  toDate: "2026-01-31",
  filters: null,
  status: "Submitted",
  deletedEventsCount: 0,
  created: "2026-01-15T00:00:00Z",
  requestingUser: { id: 1, email: "admin@example.com" },
};

/** An anomaly payload. */
const ANOMALY = {
  id: 1,
  timestamp: "2026-01-01T00:00:00Z",
  actualCount: 5000,
  predictedUpper: 3000,
  predictedLower: 1000,
  percentVariance: "66.7%",
  status: "open",
  project: 12345,
  event: 1,
  eventName: "Signup",
  property: null,
  propertyName: null,
  metric: null,
  metricName: null,
  metricType: null,
  primaryType: null,
  driftTypes: null,
  anomalyClass: "Event",
};

/**
 * The mandatory edge set (packet §0 / R10.9), as JSON text so the
 * float spellings survive the hand-built bodies.
 */
const EDGE_JSON = '[18.0, 1.5, true, null, [], "", "𝒳"]';

/**
 * Run the whole harness.
 *
 * @returns Nothing.
 */
async function main(): Promise<void> {
  // -------------------------------------------------------------------
  // (i) Delegation equivalence — the facade adds nothing but the model
  //     seam over the identical client product.
  // -------------------------------------------------------------------
  {
    const a = rig(() => ok([ENTRY]));
    check(
      "equivalence/list_schema_registry",
      (await a.ws.listSchemaRegistry()).map((m) => m.toJSON()),
      validateResponseModels(
        SchemaEntry,
        (await a.client.listSchemaRegistry({ entity_type: null })).map((r) =>
          toNativeJson(r),
        ),
        { endpoint: "list_schema_registry" },
      ).map((m) => m.toJSON()),
    );

    const b = rig(() => ok(ENFORCEMENT));
    check(
      "equivalence/get_schema_enforcement",
      (await b.ws.getSchemaEnforcement()).toJSON(),
      validateResponseModel(
        SchemaEnforcementConfig,
        toNativeJson(await b.client.getSchemaEnforcement({ fields: null })),
        { endpoint: "get_schema_enforcement" },
      ).toJSON(),
    );

    const c = rig(() => ok([DELETION]));
    check(
      "equivalence/list_deletion_requests",
      (await c.ws.listDeletionRequests()).map((m) => m.toJSON()),
      validateResponseModels(
        EventDeletionRequest,
        (await c.client.listDeletionRequests()).map((r) => toNativeJson(r)),
        { endpoint: "list_deletion_requests" },
      ).map((m) => m.toJSON()),
    );

    const params = new PreviewDeletionFiltersParams({
      event_name: "e",
      from_date: "2026-01-01",
      to_date: "2026-01-31",
    });
    const d = rig(() => ok([{ property: "country" }]));
    check(
      "equivalence/preview_deletion_filters",
      await d.ws.previewDeletionFilters(params),
      (
        await d.client.previewDeletionFilters(
          params.modelDumpExcludeNone({ byAlias: true }),
        )
      ).map((r) => toNativeJson(r)),
    );
  }

  // -------------------------------------------------------------------
  // (ii) Wire status branches.
  // -------------------------------------------------------------------
  {
    const good = rig(() => ok({ entityType: "event", name: "P" }));
    check(
      "status/create_schema 200",
      await good.ws.createSchema("event", "P", { properties: {} }),
      { entityType: "event", name: "P" },
    );

    const bad400 = rig(() => ({
      status: 400,
      json: { error: "bad schema" },
    }));
    check(
      "status/create_schema 400",
      await thrown(() => bad400.ws.createSchema("event", "P", {})),
      ["QueryError", "QUERY_FAILED"],
    );

    const bad422 = rig(() => ({
      status: 422,
      json: { error: "unprocessable" },
    }));
    check(
      "status/create_schema 422",
      await thrown(() => bad422.ws.createSchema("event", "P", {})),
      ["QueryError", "QUERY_FAILED"],
    );

    const audit200 = rig(() =>
      ok([
        [{ violation: "Unexpected Event", name: "bad", count: 42 }],
        { computed_at: "2026-01-01T00:00:00Z" },
      ]),
    );
    const audit = await audit200.ws.runAudit();
    check("status/run_audit 200 violations", audit.violations.length, 1);
    check(
      "status/run_audit 200 computed_at",
      audit.computed_at,
      "2026-01-01T00:00:00Z",
    );

    const audit500 = rig(() => ({ status: 500, text: "boom" }));
    check("status/run_audit 500", await thrown(() => audit500.ws.runAudit()), [
      "ServerError",
      "SERVER_ERROR",
    ]);
  }

  // -------------------------------------------------------------------
  // (iii) The mandatory edge set.
  // -------------------------------------------------------------------
  {
    const edges = JSON.parse(EDGE_JSON) as unknown[];

    // `schema_json: dict[str, Any]` — every edge value as a mapping
    // value, on BOTH writers, round-tripped through the request body.
    for (const [index, value] of edges.entries()) {
      const bodies: string[] = [];
      const r = rig((request) => {
        bodies.push(request.bodyText);
        return ok({ ok: true });
      });
      await r.ws.createSchema("event", "E", { edge: value });
      await r.ws.updateSchema("event", "E", { edge: value });
      check(
        `edge/schema_json[${String(index)}] create`,
        JSON.parse(bodies[0] ?? "null"),
        { edge: value },
      );
      check(
        `edge/schema_json[${String(index)}] update`,
        JSON.parse(bodies[1] ?? "null"),
        { edge: value },
      );
    }

    // `query_params: dict[str, str]` — the annotation admits STRINGS
    // only, so the two string edges are the in-annotation set.
    for (const value of ["", "𝒳"]) {
      const urls: string[] = [];
      const r = rig((request) => {
        urls.push(request.url);
        return ok({ anomalies: [] });
      });
      await r.ws.listDataVolumeAnomalies({ query_params: { edge: value } });
      check(
        `edge/query_params ${JSON.stringify(value)}`,
        urls[0]?.includes(`edge=${encodeURIComponent(value)}`),
        true,
      );
    }

    // The six opaque RESULT passthroughs carry the whole set verbatim.
    const payload = { edges, nested: { edges } };
    const passthroughs: Array<[string, () => Promise<unknown>]> = [];
    {
      const r = rig(() => ok(payload));
      passthroughs.push(
        ["create_schema", () => r.ws.createSchema("event", "E", {})],
        ["update_schema", () => r.ws.updateSchema("event", "E", {})],
        [
          "init_schema_enforcement",
          () =>
            r.ws.initSchemaEnforcement(
              new InitSchemaEnforcementParams({ rule_event: "Warn and Drop" }),
            ),
        ],
        ["delete_schema_enforcement", () => r.ws.deleteSchemaEnforcement()],
        [
          "update_anomaly",
          () =>
            r.ws.updateAnomaly(
              new UpdateAnomalyParams({
                id: 1,
                status: "open",
                anomaly_class: "Event",
              }),
            ),
        ],
      );
      for (const [label, call] of passthroughs) {
        check(`edge/passthrough ${label}`, await call(), payload);
      }
    }
    {
      const r = rig(() => ok([payload]));
      check(
        "edge/passthrough preview_deletion_filters",
        await r.ws.previewDeletionFilters(
          new PreviewDeletionFiltersParams({
            event_name: "e",
            from_date: "2026-01-01",
            to_date: "2026-01-31",
          }),
        ),
        [payload],
      );
    }
  }

  // -------------------------------------------------------------------
  // (iv-a) The `delete_schemas` guard (`workspace.py:8864-8868`).
  // -------------------------------------------------------------------
  {
    const calls: unknown[][] = [];
    const s = stub({ deleteSchemas: { deleteCount: 0 } }, calls);
    const ws = new Workspace({ session: SESSION, client: s });
    check(
      "guard/entity_name without entity_type",
      await thrown(() => ws.deleteSchemas({ entity_name: "P" })),
      ["MixpanelHeadlessError", "UNKNOWN_ERROR"],
    );
    check("guard/no request issued", calls.length, 0);

    await ws.deleteSchemas();
    await ws.deleteSchemas({ entity_type: "event" });
    await ws.deleteSchemas({ entity_type: "event", entity_name: "P" });
    check("guard/allowed combinations forward", calls, [
      ["deleteSchemas", [{ entity_type: null, entity_name: null }]],
      ["deleteSchemas", [{ entity_type: "event", entity_name: null }]],
      ["deleteSchemas", [{ entity_type: "event", entity_name: "P" }]],
    ]);
  }

  // -------------------------------------------------------------------
  // (iv-b) The two `run_audit*` composite bodies, branch for branch.
  // -------------------------------------------------------------------
  {
    for (const [label, member] of [
      ["run_audit", runAuditMember],
      ["run_audit_events_only", runAuditEventsOnlyMember],
    ] as const) {
      const key = label === "run_audit" ? "runAudit" : "runAuditEventsOnly";

      const empty = await member(stub({ [key]: [] }));
      check(`audit/${label} empty`, empty.toJSON(), {
        violations: [],
        computed_at: "",
      });

      const oneElement = await member(stub({ [key]: [[]] }));
      check(`audit/${label} 1-element`, oneElement.toJSON(), {
        violations: [],
        computed_at: "",
      });

      const nonDictMeta = await member(stub({ [key]: [[], [1, 2]] }));
      check(`audit/${label} non-dict metadata`, nonDictMeta.computed_at, "");

      const noKey = await member(stub({ [key]: [[], { other: 1 }] }));
      check(
        `audit/${label} metadata without computed_at`,
        noKey.computed_at,
        "",
      );

      const extraElements = await member(
        stub({ [key]: [[], { computed_at: "T" }, "ignored"] }),
      );
      check(
        `audit/${label} extra elements ignored`,
        extraElements.computed_at,
        "T",
      );

      // Non-list head over every CPython type name the message can carry.
      const heads: Array<[unknown, string]> = [
        [{ computed_at: "x" }, "dict"],
        ["nope", "str"],
        [1, "int"],
        [1.5, "float"],
        [true, "bool"],
        [null, "NoneType"],
      ];
      for (const [head, name] of heads) {
        let message = "";
        try {
          await member(stub({ [key]: [head] }));
        } catch (error) {
          message = (error as Error).message;
        }
        check(
          `audit/${label} non-list head ${name}`,
          message,
          `Unexpected audit response: expected list of violations, got ${name}`,
        );
      }

      check(
        `audit/${label} non-list head code`,
        await thrown(() => member(stub({ [key]: ["x"] }))),
        ["MixpanelHeadlessError", "UNKNOWN_ERROR"],
      );

      check(
        `audit/${label} malformed violation`,
        await thrown(() => member(stub({ [key]: [[{ name: "x" }], {}] }))),
        ["ResponseValidationError", "RESPONSE_VALIDATION_ERROR"],
      );
    }
  }

  // -------------------------------------------------------------------
  // (iv-c) The three dump spellings (W8-D1), measured against pydantic
  //        2026-08-16 (`uv run python` probe recorded in the notes).
  // -------------------------------------------------------------------
  {
    const replace = new ReplaceSchemaEnforcementParams({
      common_properties: [],
      user_properties: [],
      events: [],
      rule_event: "Warn and Drop",
      notification_emails: [],
    });
    check(
      "dump/exclude_none+by_alias drops schemaId",
      replace.modelDumpExcludeNone({ byAlias: true }),
      {
        commonProperties: [],
        userProperties: [],
        events: [],
        ruleEvent: "Warn and Drop",
        notificationEmails: [],
      },
    );
    check(
      "dump/plain by_alias KEEPS schemaId=null",
      replace.modelDump({ byAlias: true }),
      {
        commonProperties: [],
        userProperties: [],
        events: [],
        ruleEvent: "Warn and Drop",
        notificationEmails: [],
        schemaId: null,
      },
    );

    const bulkAnomalies = new BulkUpdateAnomalyParams({
      anomalies: [new BulkAnomalyEntry({ id: 1, anomaly_class: "Event" })],
      status: "dismissed",
    });
    check(
      "dump/plain by_alias recurses",
      bulkAnomalies.modelDump({ byAlias: true }),
      {
        anomalies: [{ id: 1, anomalyClass: "Event" }],
        status: "dismissed",
      },
    );

    const bulkSchemas = new BulkCreateSchemasParams({
      entries: [
        new SchemaEntry({
          entity_type: "event",
          name: "Test",
          schema_definition: { properties: {} },
        }),
      ],
    });
    check(
      "dump/bulk entries exclude_none+by_alias",
      bulkSchemas.modelDumpExcludeNone({ byAlias: true }),
      {
        entries: [
          { entityType: "event", name: "Test", schemaJson: { properties: {} } },
        ],
      },
    );

    // The two writers that dump PLAIN, observed on the wire.
    const bodies: string[] = [];
    const r = rig((request) => {
      bodies.push(request.bodyText);
      return ok({ updated: true });
    });
    await r.ws.updateAnomaly(
      new UpdateAnomalyParams({
        id: 7,
        status: "dismissed",
        anomaly_class: "Event",
      }),
    );
    await r.ws.bulkUpdateAnomalies(bulkAnomalies);
    check("dump/update_anomaly body", JSON.parse(bodies[0] ?? "null"), {
      id: 7,
      status: "dismissed",
      anomalyClass: "Event",
    });
    check("dump/bulk_update_anomalies body", JSON.parse(bodies[1] ?? "null"), {
      anomalies: [{ id: 1, anomalyClass: "Event" }],
      status: "dismissed",
    });

    const updateBodies: string[] = [];
    const u = rig((request) => {
      updateBodies.push(request.bodyText);
      return ok({});
    });
    await u.ws.updateSchemaEnforcement(
      new UpdateSchemaEnforcementParams({ rule_event: "Warn and Hide" }),
    );
    check(
      "dump/update_schema_enforcement drops unset",
      JSON.parse(updateBodies[0] ?? "null"),
      { ruleEvent: "Warn and Hide" },
    );

    const createBodies: string[] = [];
    const c = rig((request) => {
      createBodies.push(request.bodyText);
      return ok([DELETION]);
    });
    await c.ws.createDeletionRequest(
      new CreateDeletionRequestParams({
        event_name: "e",
        from_date: "2026-01-01",
        to_date: "2026-01-31",
      }),
    );
    // Key ORDER follows Python `model_fields` order (`types.py`:
    // from_date, to_date, event_name), which the TS field specs
    // mirror; the corpus records `json_body` with SORTED keys, so the
    // order is not vector-observable either way.
    check(
      "dump/create_deletion_request body",
      JSON.parse(createBodies[0] ?? "null"),
      { fromDate: "2026-01-01", toDate: "2026-01-31", eventName: "e" },
    );
  }

  // -------------------------------------------------------------------
  // (iv-d) The `?? null` kwarg forwards (the client owns every gate).
  // -------------------------------------------------------------------
  {
    const calls: unknown[][] = [];
    const s = stub(
      {
        listSchemaRegistry: [],
        getSchemaEnforcement: ENFORCEMENT,
        listDataVolumeAnomalies: [],
      },
      calls,
    );
    const ws = new Workspace({ session: SESSION, client: s });
    await ws.listSchemaRegistry();
    await ws.getSchemaEnforcement();
    await ws.listDataVolumeAnomalies();
    check("forward/absent kwargs become null", calls, [
      ["listSchemaRegistry", [{ entity_type: null }]],
      ["getSchemaEnforcement", [{ fields: null }]],
      ["listDataVolumeAnomalies", [{ query_params: null }]],
    ]);
  }

  // -------------------------------------------------------------------
  // (iv-e) RESPONSE_VALIDATION_ERROR from a malformed 200 body, for
  //        every one of the seven validated members.
  // -------------------------------------------------------------------
  {
    const cases: Array<[string, CannedResponse, () => Promise<unknown>]> = [];
    const listRig = rig(() => ok([{ name: "x" }]));
    const objRig = rig(() => ok({}));
    const anomalyRig = rig(() => ok({ anomalies: [{ id: 1 }] }));
    const enforcementRig = rig(() => ok({ id: "not-an-int" }));

    cases.push(
      ["list_schema_registry", ok([]), () => listRig.ws.listSchemaRegistry()],
      [
        "update_schemas_bulk",
        ok([]),
        () =>
          listRig.ws.updateSchemasBulk(
            new BulkCreateSchemasParams({ entries: [] }),
          ),
      ],
      [
        "list_deletion_requests",
        ok([]),
        () => listRig.ws.listDeletionRequests(),
      ],
      [
        "create_deletion_request",
        ok([]),
        () =>
          listRig.ws.createDeletionRequest(
            new CreateDeletionRequestParams({
              event_name: "e",
              from_date: "2026-01-01",
              to_date: "2026-01-31",
            }),
          ),
      ],
      [
        "cancel_deletion_request",
        ok([]),
        () => listRig.ws.cancelDeletionRequest(1),
      ],
      ["delete_schemas", ok({}), () => objRig.ws.deleteSchemas()],
      [
        "create_schemas_bulk",
        ok({}),
        () =>
          objRig.ws.createSchemasBulk(
            new BulkCreateSchemasParams({ entries: [] }),
          ),
      ],
      [
        "list_data_volume_anomalies",
        ok({}),
        () => anomalyRig.ws.listDataVolumeAnomalies(),
      ],
      [
        "get_schema_enforcement",
        ok({}),
        () => enforcementRig.ws.getSchemaEnforcement(),
      ],
    );
    for (const [label, , call] of cases) {
      check(`invalid/${label}`, await thrown(call), [
        "ResponseValidationError",
        "RESPONSE_VALIDATION_ERROR",
      ]);
    }

    // …and the model each failure names.
    const named: Array<[string, () => Promise<unknown>, string]> = [
      [
        "list_schema_registry",
        () => listRig.ws.listSchemaRegistry(),
        "SchemaEntry",
      ],
      [
        "list_data_volume_anomalies",
        () => anomalyRig.ws.listDataVolumeAnomalies(),
        "DataVolumeAnomaly",
      ],
      [
        "get_schema_enforcement",
        () => enforcementRig.ws.getSchemaEnforcement(),
        "SchemaEnforcementConfig",
      ],
    ];
    for (const [label, call, model] of named) {
      let observed = "";
      try {
        await call();
      } catch (error) {
        observed =
          (error as { details?: { model?: string } }).details?.model ?? "?";
      }
      check(`invalid/${label} model`, observed, model);
    }
  }

  // -------------------------------------------------------------------
  // (iv-f) The typed list/model members over a well-formed payload
  //        (the positive twin of the block above).
  // -------------------------------------------------------------------
  {
    const anomalies = rig(() => ok({ anomalies: [ANOMALY] }));
    check(
      "typed/list_data_volume_anomalies",
      (await anomalies.ws.listDataVolumeAnomalies()).map((m) => m.id),
      [1],
    );
    const cancel = rig(() => ok([DELETION]));
    check(
      "typed/cancel_deletion_request",
      (await cancel.ws.cancelDeletionRequest(42)).map((m) => m.event_name),
      ["bad_event"],
    );
    const bulk = rig(() => ok({ added: 1, deleted: 2 }));
    const bulkResult = await bulk.ws.createSchemasBulk(
      new BulkCreateSchemasParams({ entries: [] }),
    );
    check(
      "typed/create_schemas_bulk",
      [bulkResult.added, bulkResult.deleted],
      [1, 2],
    );
    const patch = rig(() =>
      ok([{ entityType: "event", name: "P", status: "error", error: "nope" }]),
    );
    check(
      "typed/update_schemas_bulk",
      (
        await patch.ws.updateSchemasBulk(
          new BulkCreateSchemasParams({ entries: [] }),
        )
      ).map((m) => [m.status, m.error]),
      [["error", "nope"]],
    );
    const events = rig(() =>
      ok([[{ violation: "V", name: "n", count: 1 }], { computed_at: "T" }]),
    );
    const eventsAudit = await events.ws.runAuditEventsOnly();
    check(
      "typed/run_audit_events_only",
      [eventsAudit.violations.length, eventsAudit.computed_at],
      [1, "T"],
    );
    const replace = rig(() => ok({ replaced: true }));
    check(
      "typed/replace_schema_enforcement",
      await replace.ws.replaceSchemaEnforcement(
        new ReplaceSchemaEnforcementParams({
          common_properties: [],
          user_properties: [],
          events: [],
          rule_event: "Warn and Drop",
          notification_emails: [],
        }),
      ),
      { replaced: true },
    );
  }

  console.log(`checks ${String(checks)}   failures ${String(failures)}`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

await main();
