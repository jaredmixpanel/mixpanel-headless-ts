/**
 * B6-W2 R10.9 harness — the dashboard facade wire/edge set (packet
 * `b6-packets.md` §4 "R10.9 `throwaway/b6-w2/`").
 *
 * The W2 members are facade delegations with no oracle-call surface
 * (all-wire batch, §11.5), so the harness runs them through the
 * injected-fetch seam with hand-built interactions and asserts:
 *
 *   (i)   delegation equivalence — facade result === direct client
 *         result re-validated through the SAME model seam, over the
 *         same canned interaction;
 *   (ii)  wire status branches — `get_dashboard` (200 / 404 /
 *         empty-body) and `add_report_to_dashboard` (200 / 400 /
 *         422-via-app_request);
 *   (iii) the mandatory edge set (18.0, 1.5, true, null, [], "", "𝒳")
 *         pushed through `ids=` and the `CreateDashboardParams`
 *         `title` / `duplicate` fields (Discrepancy #8 boundary);
 *   (iv)  EVERY facade-local error branch — the seven
 *         `API returned empty response for X` guards, both
 *         `add_report_to_dashboard` guard flavors, and
 *         `RESPONSE_VALIDATION_ERROR` from a malformed 200 body.
 *
 *     npx vite-node throwaway/b6-w2/wire-edges.ts
 *
 * THROWAWAY: deleted at the B6 gate; the RUN record lives in
 * `context/phase3/notes/B6-W2-notes.md` §R10.9.
 */

import {
  createMockClient,
  makeSession,
  type CannedResponse,
} from "../../packages/core/test/client/client-test-helpers.js";
import type { MixpanelClient } from "../../packages/core/src/client/client.js";
import { toNativeJson } from "../../packages/core/src/client/json-value.js";
import {
  validateResponseModel,
  validateResponseModels,
} from "../../packages/core/src/client/response-validation.js";
import { Workspace } from "../../packages/core/src/workspace.js";
import {
  BlueprintFinishParams,
  CreateDashboardParams,
  CreateRcaDashboardParams,
  Dashboard,
  RcaSourceData,
  UpdateDashboardParams,
} from "../../packages/core/src/types/entities/dashboards.js";
import * as members from "../../packages/core/src/workspace-members/dashboards.js";

let checks = 0;
let failures = 0;

/**
 * Record one expectation.
 *
 * @param label - What is being checked.
 * @param actual - The observed value (JSON-compared).
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
 * @returns `"<Class>/<code>"`, or `"<resolved>"` when it did not throw.
 */
async function thrown(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "<resolved>";
  } catch (error) {
    const err = error as { name?: string; code?: string };
    return `${err.name ?? "?"}/${err.code ?? "?"}`;
  }
}

const SESSION = makeSession({
  projectId: "12345",
  region: "us",
  oauthToken: "test-token",
});

/**
 * A dashboard payload (`_dashboard_json` twin).
 *
 * @param id - Dashboard id.
 * @param title - Dashboard title.
 * @returns The payload.
 */
function dash(id: number, title: string): Record<string, unknown> {
  return {
    id,
    title,
    is_private: false,
    is_restricted: false,
    is_favorited: false,
    can_update_basic: true,
    can_share: true,
    can_view: true,
    can_update_restricted: false,
    can_update_visibility: false,
    is_superadmin: false,
    allow_staff_override: false,
    can_pin: true,
    is_shared_with_project: true,
    ancestors: [],
  };
}

/**
 * Build a facade + its client over a fixed canned response.
 *
 * @param response - The canned response every request receives.
 * @returns The facade and the underlying client.
 */
function rig(response: CannedResponse): {
  ws: Workspace;
  client: MixpanelClient;
} {
  const { client } = createMockClient(SESSION, () => response);
  return { ws: new Workspace({ session: SESSION, client }), client };
}

/**
 * A stub client whose one member resolves to `value`.
 *
 * @param member - The client method name.
 * @param value - The resolved value.
 * @returns The stub.
 */
function stub(member: string, value: unknown): MixpanelClient {
  return {
    [member]: () => Promise.resolve(value),
  } as unknown as MixpanelClient;
}

/** (i) delegation equivalence — facade === client + model seam. */
async function groupDelegation(): Promise<void> {
  const single: CannedResponse = {
    status: 200,
    json: { status: "ok", results: dash(1, "Equivalence") },
  };
  const list: CannedResponse = {
    status: 200,
    json: { status: "ok", results: [dash(1, "A"), dash(2, "B")] },
  };

  {
    const { ws, client } = rig(single);
    const viaFacade = (await ws.getDashboard(1)).toJSON();
    const viaClient = validateResponseModel(
      Dashboard,
      toNativeJson(await client.getDashboard(1)),
      { endpoint: "get_dashboard" },
    ).toJSON();
    check("(i) get_dashboard", viaFacade, viaClient);
  }
  {
    const { ws, client } = rig(list);
    const viaFacade = (await ws.listDashboards()).map((d) => d.toJSON());
    const viaClient = validateResponseModels(
      Dashboard,
      (await client.listDashboards()).map((item) => toNativeJson(item)),
      { endpoint: "list_dashboards" },
    ).map((d) => d.toJSON());
    check("(i) list_dashboards", viaFacade, viaClient);
  }
  {
    const { ws, client } = rig(single);
    const params = new CreateDashboardParams({ title: "Equivalence" });
    const viaFacade = (await ws.createDashboard(params)).toJSON();
    const viaClient = validateResponseModel(
      Dashboard,
      toNativeJson(await client.createDashboard(params.modelDumpExcludeNone())),
      { endpoint: "create_dashboard" },
    ).toJSON();
    check("(i) create_dashboard", viaFacade, viaClient);
  }
  {
    const { ws, client } = rig(single);
    const viaFacade = (
      await ws.updateDashboard(1, new UpdateDashboardParams({ title: "T" }))
    ).toJSON();
    const viaClient = validateResponseModel(
      Dashboard,
      toNativeJson(await client.updateDashboard(1, { title: "T" })),
      { endpoint: "update_dashboard" },
    ).toJSON();
    check("(i) update_dashboard", viaFacade, viaClient);
  }
  {
    const { ws, client } = rig(single);
    const viaFacade = (await ws.addReportToDashboard(1, 42)).toJSON();
    const viaClient = validateResponseModel(
      Dashboard,
      toNativeJson(await client.addReportToDashboard(1, 42)),
      { endpoint: "add_report_to_dashboard" },
    ).toJSON();
    check("(i) add_report_to_dashboard", viaFacade, viaClient);
  }
  {
    const { ws, client } = rig(single);
    const viaFacade = (await ws.removeReportFromDashboard(1, 42)).toJSON();
    const viaClient = validateResponseModel(
      Dashboard,
      toNativeJson(await client.removeReportFromDashboard(1, 42)),
      { endpoint: "remove_report_from_dashboard" },
    ).toJSON();
    check("(i) remove_report_from_dashboard", viaFacade, viaClient);
  }
  {
    const ids: CannedResponse = {
      status: 200,
      json: { status: "ok", results: [7, 8] },
    };
    const { ws, client } = rig(ids);
    check(
      "(i) get_bookmark_dashboard_ids",
      await ws.getBookmarkDashboardIds(42),
      (await client.getBookmarkDashboardIds(42)).map((v) => toNativeJson(v)),
    );
  }
  {
    const erf: CannedResponse = {
      status: 200,
      json: { status: "ok", results: { metrics: { views: 3 } } },
    };
    const { ws, client } = rig(erf);
    check(
      "(i) get_dashboard_erf",
      await ws.getDashboardErf(1),
      toNativeJson(await client.getDashboardErf(1)),
    );
  }
  {
    const templates: CannedResponse = {
      status: 200,
      json: {
        status: "ok",
        results: {
          templates: {
            kpis: {
              title_key: "t",
              description_key: "d",
              number_of_reports: 2,
            },
          },
        },
      },
    };
    const { ws } = rig(templates);
    const got = await ws.listBlueprintTemplates();
    check("(i) list_blueprint_templates count", got.length, 1);
    check(
      "(i) list_blueprint_templates name extra",
      got[0]?.__extras["name"],
      "kpis",
    );
  }
  {
    const config: CannedResponse = {
      status: 200,
      json: { status: "ok", results: { variables: { a: "b" } } },
    };
    const { ws } = rig(config);
    check(
      "(i) get_blueprint_config",
      (await ws.getBlueprintConfig(1)).variables,
      { a: "b" },
    );
  }
  {
    const { ws } = rig({ status: 204 });
    check("(i) delete_dashboard", await ws.deleteDashboard(1), undefined);
    check("(i) pin_dashboard", await ws.pinDashboard(1), undefined);
  }
}

/** (ii) wire status branches. */
async function groupStatus(): Promise<void> {
  {
    const { ws } = rig({
      status: 200,
      json: { status: "ok", results: dash(1, "OK") },
    });
    check("(ii) get_dashboard 200", (await ws.getDashboard(1)).id, 1);
  }
  {
    const { ws } = rig({ status: 404, json: { error: "not found" } });
    check(
      "(ii) get_dashboard 404",
      await thrown(() => ws.getDashboard(1)),
      "QueryError/QUERY_FAILED",
    );
  }
  {
    // Empty body: `{"results": null}` unwraps to None, so the CLIENT's
    // `expectRecordResult` guard fires before the facade's.
    const { ws } = rig({ status: 200, json: { status: "ok", results: null } });
    check(
      "(ii) get_dashboard empty-body",
      await thrown(() => ws.getDashboard(1)),
      "MixpanelHeadlessError/UNKNOWN_ERROR",
    );
  }
  {
    const { ws } = rig({
      status: 200,
      json: { status: "ok", results: dash(1, "Added") },
    });
    check(
      "(ii) add_report_to_dashboard 200",
      (await ws.addReportToDashboard(1, 42)).title,
      "Added",
    );
  }
  {
    const { ws } = rig({ status: 400, json: { error: "bad" } });
    check(
      "(ii) add_report_to_dashboard 400",
      await thrown(() => ws.addReportToDashboard(1, 42)),
      "QueryError/QUERY_FAILED",
    );
  }
  {
    const { ws } = rig({ status: 422, json: { error: "unprocessable" } });
    check(
      "(ii) add_report_to_dashboard 422",
      await thrown(() => ws.addReportToDashboard(1, 42)),
      "QueryError/QUERY_FAILED",
    );
  }
  {
    const { ws } = rig({ status: 500, text: "boom" });
    check(
      "(ii) get_dashboard 500",
      await thrown(() => ws.getDashboard(1)),
      "ServerError/SERVER_ERROR",
    );
  }
}

/** The mandatory edge set (packet §0.4 / R10.9). */
const EDGES: ReadonlyArray<[string, unknown]> = [
  ["18.0", 18.0],
  ["1.5", 1.5],
  ["true", true],
  ["null", null],
  ["[]", []],
  ['""', ""],
  ['"𝒳"', "\u{1d4b3}"],
];

/** (iii) edge set through `ids=` and the params fields. */
async function groupEdges(): Promise<void> {
  // `ids=` — plain kwarg, no pydantic layer: Python str()-joins each
  // element (`api_client.py:3678`) and `if ids:` skips empty lists.
  // MEASURED (Python, 2026-08-16): `','.join(str(i) for i in [v])`.
  // The `18.0` row is the ONLY divergence — Python renders the float
  // as `"18.0"`, JS has no float/int distinction for an integral
  // literal so `pythonStr(18)` renders `"18"`. `ids` is annotated
  // `list[int] | None`, so a float element is OUT OF ANNOTATION and
  // unspecified per ratified Discrepancy #8 (same class as the
  // Discrepancy #12 integral-float spelling rule).
  const idsExpected: Record<string, string> = {
    "18.0": "18",
    "1.5": "1.5",
    true: "True",
    null: "None",
    "[]": "[]",
    '""': "",
    '"𝒳"': "\u{1d4b3}",
  };
  for (const [label, value] of EDGES) {
    const { client, transport } = createMockClient(SESSION, () => ({
      status: 200,
      json: { status: "ok", results: [] },
    }));
    const ws = new Workspace({ session: SESSION, client });
    await ws.listDashboards({ ids: [value] as unknown as readonly number[] });
    check(
      `(iii) ids=[${label}] wire param`,
      transport.captures[0]?.params["ids"],
      idsExpected[label],
    );
  }
  {
    // `if ids:` — an EMPTY list sends no param at all.
    const { client, transport } = createMockClient(SESSION, () => ({
      status: 200,
      json: { status: "ok", results: [] },
    }));
    const ws = new Workspace({ session: SESSION, client });
    await ws.listDashboards({ ids: [] });
    check(
      "(iii) ids=[] sends no param",
      transport.captures[0]?.params["ids"],
      undefined,
    );
  }
  // `title` (annotation `str`) and `duplicate` (annotation `int | None`).
  for (const [label, value] of EDGES) {
    check(
      `(iii) CreateDashboardParams(title=${label})`,
      await thrown(() =>
        Promise.resolve(
          new CreateDashboardParams({
            title: value as string,
          }).modelDumpExcludeNone(),
        ),
      ),
      label === '""' || label === '"𝒳"'
        ? "<resolved>"
        : "ResponseValidationError/RESPONSE_VALIDATION_ERROR",
    );
  }
  for (const [label, value] of EDGES) {
    const dump = await thrown(() =>
      Promise.resolve(
        new CreateDashboardParams({
          title: "X",
          duplicate: value as number,
        }).modelDumpExcludeNone(),
      ),
    );
    // Python: 18.0 → 18, True → 1 (bool IS an int in pydantic lax mode),
    // None → dropped; 1.5 / [] / "" / "𝒳" → ValidationError. TS diverges
    // on `true` by the ratified R4.12 rule (booleans are never ints).
    const expected =
      label === "18.0" || label === "null"
        ? "<resolved>"
        : "ResponseValidationError/RESPONSE_VALIDATION_ERROR";
    check(`(iii) CreateDashboardParams(duplicate=${label})`, dump, expected);
  }
}

/** (iv) every facade-local error branch. */
async function groupErrors(): Promise<void> {
  const empties: ReadonlyArray<[string, () => Promise<unknown>]> = [
    [
      "create_dashboard",
      () =>
        members.createDashboard(
          stub("createDashboard", null),
          new CreateDashboardParams({ title: "X" }),
        ),
    ],
    [
      "get_dashboard",
      () => members.getDashboard(stub("getDashboard", null), 1),
    ],
    [
      "update_dashboard",
      () =>
        members.updateDashboard(
          stub("updateDashboard", null),
          1,
          new UpdateDashboardParams({ title: "X" }),
        ),
    ],
    [
      "create_blueprint",
      () => members.createBlueprint(stub("createBlueprint", null), "kpis"),
    ],
    [
      "get_blueprint_config",
      () => members.getBlueprintConfig(stub("getBlueprintConfig", null), 1),
    ],
    [
      "finalize_blueprint",
      () =>
        members.finalizeBlueprint(
          stub("finalizeBlueprint", null),
          new BlueprintFinishParams({ dashboard_id: 1, cards: [] }),
        ),
    ],
    [
      "create_rca_dashboard",
      () =>
        members.createRcaDashboard(
          stub("createRcaDashboard", null),
          new CreateRcaDashboardParams({
            rca_source_id: 1,
            rca_source_data: new RcaSourceData({ source_type: "anomaly" }),
          }),
        ),
    ],
  ];
  for (const [name, call] of empties) {
    let message = "<resolved>";
    try {
      await call();
    } catch (error) {
      message = (error as Error).message;
    }
    check(
      `(iv) empty-response guard ${name}`,
      message,
      `API returned empty response for ${name}`,
    );
  }

  {
    // 204 → the client's `{status: "ok"}` envelope carries no `id`.
    const { ws } = rig({ status: 204 });
    check(
      "(iv) add_report guard (204 envelope)",
      await thrown(() => ws.addReportToDashboard(1, 42)),
      "MixpanelHeadlessError/UNKNOWN_ERROR",
    );
  }
  {
    const { ws } = rig({
      status: 200,
      json: { status: "ok", results: { title: "No ID" } },
    });
    let message = "";
    try {
      await ws.addReportToDashboard(1, 42);
    } catch (error) {
      message = (error as Error).message;
    }
    check(
      "(iv) add_report guard (dict without id) repr",
      message,
      "Unexpected response from add_report_to_dashboard: expected " +
        "dashboard dict with 'id', got {'title': 'No ID'}",
    );
  }
  {
    const { ws } = rig({ status: 200, json: { status: "ok", results: [{}] } });
    check(
      "(iv) list_dashboards RESPONSE_VALIDATION_ERROR",
      await thrown(() => ws.listDashboards()),
      "ResponseValidationError/RESPONSE_VALIDATION_ERROR",
    );
  }
  {
    const { ws } = rig({ status: 200, json: { status: "ok", results: {} } });
    check(
      "(iv) create_dashboard RESPONSE_VALIDATION_ERROR",
      await thrown(() =>
        ws.createDashboard(new CreateDashboardParams({ title: "X" })),
      ),
      "ResponseValidationError/RESPONSE_VALIDATION_ERROR",
    );
  }
  {
    const { ws } = rig({
      status: 200,
      json: { status: "ok", results: { variables: 7 } },
    });
    // MEASURED DIVERGENCE (Phase-2 model gap, NOT a W2 body defect —
    // recorded in `B6-W2-notes.md` §5): Python's
    // `BlueprintConfig.variables: dict[str, str]` rejects a scalar
    // (`ValidationError`, measured 2026-08-16); the Phase-2 TS spec
    // declares the field with no kind/container, so it validates
    // clean. Asserted AS MEASURED so the RUN record carries it.
    check(
      "(iv) get_blueprint_config scalar variables (divergence)",
      await thrown(() => ws.getBlueprintConfig(1)),
      "<resolved>",
    );
  }
  {
    const { ws } = rig({
      status: 200,
      json: { status: "ok", results: { templates: { a: { title_key: "t" } } } },
    });
    check(
      "(iv) list_blueprint_templates RESPONSE_VALIDATION_ERROR",
      await thrown(() => ws.listBlueprintTemplates()),
      "ResponseValidationError/RESPONSE_VALIDATION_ERROR",
    );
  }
}

await groupDelegation();
await groupStatus();
await groupEdges();
await groupErrors();

console.log(`\nchecks ${String(checks)}   failures ${String(failures)}`);
if (failures > 0) {
  process.exitCode = 1;
}
