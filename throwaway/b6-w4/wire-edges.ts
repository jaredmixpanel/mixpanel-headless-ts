/**
 * B6-W4 R10.9 harness — the feature-flag/experiment facade wire/edge
 * set (packet `b6-packets.md` §6 "R10.9 `throwaway/b6-w4/`").
 *
 * The W4 members are facade delegations with no oracle-call surface
 * (all-wire batch, §11.5), so the harness runs them through the
 * injected-fetch seam with hand-built interactions and asserts:
 *
 *   (i)   delegation equivalence — facade result === direct client
 *         result re-validated through the SAME model seam, over the
 *         same canned interaction;
 *   (ii)  wire status branches — `get_feature_flag` (200 / 404) and
 *         `decide_experiment` (200 / 400 / 422), plus the
 *         empty-body arm;
 *   (iii) the mandatory edge set (18.0, 1.5, true, null, [], "", "𝒳")
 *         pushed through the flag `ruleset` dict and the experiment
 *         `settings` dict — the two `dict[str, Any]` annotations in
 *         the shard (Discrepancy #8 boundary; NO integer-like unknown
 *         keys per #9/#10);
 *   (iv)  EVERY W4-local branch — the six
 *         `API returned empty response for X` guards, the
 *         `get_flag_history` query-dict assembly (all four arms), the
 *         `conclude_experiment` `{}`-body arm, the bare-`model_dump`
 *         spelling on `set_flag_test_users`, and
 *         `RESPONSE_VALIDATION_ERROR` from a malformed 200 body.
 *
 *     npx vite-node throwaway/b6-w4/wire-edges.ts
 *
 * THROWAWAY: deleted at the B6 gate; the RUN record lives in
 * `context/phase3/notes/B6-W4-notes.md` §4, which survives.
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
  CreateFeatureFlagParams,
  FeatureFlag,
  FlagHistoryResponse,
  FlagLimitsResponse,
  SetTestUsersParams,
  UpdateFeatureFlagParams,
} from "../../packages/core/src/types/entities/feature-flags.js";
import {
  CreateExperimentParams,
  DuplicateExperimentParams,
  Experiment,
  ExperimentConcludeParams,
  ExperimentDecideParams,
  UpdateExperimentParams,
} from "../../packages/core/src/types/entities/experiments.js";
import { FeatureFlagStatus } from "../../packages/core/src/types/enums.js";
import * as members from "../../packages/core/src/workspace-members/flags-experiments.js";

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
 * Build the facade + its client over one canned handler
 * (`_make_workspace`, `test_workspace_flags.py:71-91`).
 *
 * @param handler - The canned-response handler.
 * @param workspaceId - Workspace pin (flags need one; experiments do not).
 * @returns The facade, its client and the capture log.
 */
function rig(
  handler: (request: CapturedFetchRequest) => CannedResponse,
  workspaceId: number | null = 100,
): {
  ws: Workspace;
  client: MixpanelClient;
  captures: readonly CapturedFetchRequest[];
} {
  const { client, transport } = createMockClient(SESSION, handler);
  client.setWorkspaceId(workspaceId);
  return {
    ws: new Workspace({ session: SESSION, client }),
    client,
    captures: transport.captures,
  };
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

/**
 * A feature-flag payload (`_flag_json` twin).
 *
 * @param id - Flag UUID.
 * @param name - Flag name.
 * @returns The payload.
 */
function ff(id: string, name: string): Record<string, unknown> {
  return {
    id,
    project_id: 12345,
    name,
    key: "k",
    status: "disabled",
    context: "default",
    serving_method: "client",
    ruleset: {},
    created: "2026-01-01T00:00:00Z",
    modified: "2026-01-01T00:00:00Z",
  };
}

/**
 * An experiment payload (`_experiment_json` twin).
 *
 * @param id - Experiment UUID.
 * @param name - Experiment name.
 * @param status - Lifecycle status.
 * @returns The payload.
 */
function ex(
  id: string,
  name: string,
  status = "draft",
): Record<string, unknown> {
  return { id, name, status };
}

/**
 * A client stub whose single method resolves to `value`.
 *
 * @param method - The client method name.
 * @param value - The resolved value.
 * @param calls - Log receiving each argument list.
 * @returns The stub.
 */
function stub(
  method: string,
  value: unknown,
  calls: unknown[][] = [],
): MixpanelClient {
  return {
    [method]: (...args: unknown[]): Promise<unknown> => {
      calls.push(args);
      return Promise.resolve(value);
    },
  } as unknown as MixpanelClient;
}

/** Run the whole harness. */
async function main(): Promise<void> {
  // -----------------------------------------------------------------
  // (i) delegation equivalence — facade === client + the same model seam
  // -----------------------------------------------------------------
  {
    const payload = [ff("id-1", "A"), ff("id-2", "B")];
    const direct = rig(() => ok(payload));
    const viaFacade = rig(() => ok(payload));
    const rawList = await direct.client.listFeatureFlags({
      include_archived: false,
    });
    check(
      "(i) list_feature_flags",
      (await viaFacade.ws.listFeatureFlags()).map((m) => m.toJSON()),
      validateResponseModels(
        FeatureFlag,
        rawList.map((item) => toNativeJson(item)),
        { endpoint: "list_feature_flags" },
      ).map((m) => m.toJSON()),
    );
  }
  {
    const payload = ff("abc-123", "One");
    const direct = rig(() => ok(payload));
    const viaFacade = rig(() => ok(payload));
    check(
      "(i) get_feature_flag",
      (await viaFacade.ws.getFeatureFlag("abc-123")).toJSON(),
      validateResponseModel(
        FeatureFlag,
        toNativeJson(await direct.client.getFeatureFlag("abc-123")),
        { endpoint: "get_feature_flag" },
      ).toJSON(),
    );
  }
  {
    const payload = { events: [[1, "created"]], count: 1 };
    const direct = rig(() => ok(payload));
    const viaFacade = rig(() => ok(payload));
    check(
      "(i) get_flag_history",
      (await viaFacade.ws.getFlagHistory("abc-123")).toJSON(),
      validateResponseModel(
        FlagHistoryResponse,
        toNativeJson(await direct.client.getFlagHistory("abc-123")),
        { endpoint: "get_flag_history" },
      ).toJSON(),
    );
  }
  {
    const payload = {
      limit: 100,
      is_trial: false,
      current_usage: 42,
      contract_status: "active",
    };
    const direct = rig(() => ok(payload));
    const viaFacade = rig(() => ok(payload));
    check(
      "(i) get_flag_limits",
      (await viaFacade.ws.getFlagLimits()).toJSON(),
      validateResponseModel(
        FlagLimitsResponse,
        toNativeJson(await direct.client.getFlagLimits()),
        { endpoint: "get_flag_limits" },
      ).toJSON(),
    );
  }
  {
    const payload = [ex("a", "A"), ex("b", "B")];
    const direct = rig(() => ok(payload), null);
    const viaFacade = rig(() => ok(payload), null);
    const rawList = await direct.client.listExperiments({
      include_archived: false,
    });
    check(
      "(i) list_experiments",
      (await viaFacade.ws.listExperiments()).map((m) => m.toJSON()),
      validateResponseModels(
        Experiment,
        rawList.map((item) => toNativeJson(item)),
        { endpoint: "list_experiments" },
      ).map((m) => m.toJSON()),
    );
  }
  {
    const payload = ex("xyz-456", "One");
    const direct = rig(() => ok(payload), null);
    const viaFacade = rig(() => ok(payload), null);
    check(
      "(i) get_experiment",
      (await viaFacade.ws.getExperiment("xyz-456")).toJSON(),
      validateResponseModel(
        Experiment,
        toNativeJson(await direct.client.getExperiment("xyz-456")),
        { endpoint: "get_experiment" },
      ).toJSON(),
    );
  }
  {
    const payload = [{ id: "erf-1", name: "ERF Exp" }];
    const direct = rig(() => ok(payload), null);
    const viaFacade = rig(() => ok(payload), null);
    check(
      "(i) list_erf_experiments",
      await viaFacade.ws.listErfExperiments(),
      (await direct.client.listErfExperiments()).map((item) =>
        toNativeJson(item),
      ),
    );
  }

  // -----------------------------------------------------------------
  // (ii) wire status branches
  // -----------------------------------------------------------------
  check(
    "(ii) get_feature_flag 200",
    (await rig(() => ok(ff("f1", "F"))).ws.getFeatureFlag("f1")).id,
    "f1",
  );
  check(
    "(ii) get_feature_flag 404",
    await thrown(() =>
      rig(() => ({
        status: 404,
        json: { error: "not found" },
      })).ws.getFeatureFlag("f1"),
    ),
    "QueryError/QUERY_FAILED",
  );
  check(
    "(ii) get_feature_flag 500",
    await thrown(() =>
      rig(() => ({ status: 500, text: "boom" })).ws.getFeatureFlag("f1"),
    ),
    "ServerError/SERVER_ERROR",
  );

  const decide = new ExperimentDecideParams({ success: true });
  check(
    "(ii) decide_experiment 200",
    (
      await rig(() => ok(ex("e1", "E", "success")), null).ws.decideExperiment(
        "e1",
        decide,
      )
    ).status,
    "success",
  );
  check(
    "(ii) decide_experiment 400",
    await thrown(() =>
      rig(
        () => ({ status: 400, json: { error: "bad" } }),
        null,
      ).ws.decideExperiment("e1", decide),
    ),
    "QueryError/QUERY_FAILED",
  );
  check(
    "(ii) decide_experiment 422",
    await thrown(() =>
      rig(
        () => ({ status: 422, json: { error: "unprocessable" } }),
        null,
      ).ws.decideExperiment("e1", decide),
    ),
    "QueryError/QUERY_FAILED",
  );
  check(
    "(ii) decide_experiment empty body",
    await thrown(() =>
      rig(() => ({ status: 204 }), null).ws.decideExperiment("e1", decide),
    ),
    "ResponseValidationError/RESPONSE_VALIDATION_ERROR",
  );

  // -----------------------------------------------------------------
  // (iii) the mandatory edge set through the two `dict[str, Any]`
  //       annotations in the shard (#8 boundary; NO integer-like keys)
  // -----------------------------------------------------------------
  const EDGES: ReadonlyArray<[string, unknown]> = [
    ["integral-float 18.0", 18.0],
    ["float 1.5", 1.5],
    ["bool true", true],
    ["null", null],
    ["empty list", []],
    ["empty string", ""],
    ["astral 𝒳", "𝒳"],
  ];
  for (const [label, value] of EDGES) {
    const bodies: string[] = [];
    const r = rig((request) => {
      bodies.push(request.bodyText);
      return ok(ff("new", "N"));
    });
    await r.ws.createFeatureFlag(
      new CreateFeatureFlagParams({
        name: "n",
        key: "k",
        ruleset: { probe: value },
      }),
    );
    check(
      `(iii) ruleset ${label} survives the dump`,
      (JSON.parse(bodies[0] ?? "{}") as Record<string, unknown>)["ruleset"],
      { probe: value },
    );
  }
  for (const [label, value] of EDGES) {
    const bodies: string[] = [];
    const r = rig((request) => {
      bodies.push(request.bodyText);
      return ok(ex("e1", "E"));
    }, null);
    await r.ws.updateExperiment(
      "e1",
      new UpdateExperimentParams({ settings: { probe: value } }),
    );
    const body = JSON.parse(bodies[0] ?? "{}") as Record<string, unknown>;
    check(`(iii) settings ${label} survives the dump`, body["settings"], {
      probe: value,
    });
  }
  // Discrepancy #12 class, RECORDED not asserted-against-Python: the
  // entity models hold plain JS numbers, so an integral float inside a
  // `dict[str, Any]` renders `18` on the wire where CPython's
  // `json.dumps(18.0)` writes `18.0`. No W4 vector asserts a request
  // body (all `body: null` in the corpus — measured), so nothing fails;
  // the spelling is pinned here so the review pair sees it.
  {
    const bodies: string[] = [];
    const r = rig((request) => {
      bodies.push(request.bodyText);
      return ok(ff("new", "N"));
    });
    await r.ws.createFeatureFlag(
      new CreateFeatureFlagParams({
        name: "n",
        key: "k",
        ruleset: { probe: 18.0 },
      }),
    );
    check(
      "(iii) integral-float wire spelling (#12 class, recorded)",
      /"probe":\s*([^,}]+)/.exec(bodies[0] ?? "")?.[1],
      "18",
    );
  }

  // exclude_none drops every unset optional (`model_dump(exclude_none=True)`)
  {
    const bodies: string[] = [];
    const r = rig((request) => {
      bodies.push(request.bodyText);
      return ok(ex("e1", "E"));
    }, null);
    await r.ws.updateExperiment(
      "e1",
      new UpdateExperimentParams({ name: "n" }),
    );
    check(
      "(iii) exclude_none drops unset optionals",
      JSON.parse(bodies[0] ?? "{}"),
      { name: "n" },
    );
  }

  // -----------------------------------------------------------------
  // (iv) every W4-local branch
  // -----------------------------------------------------------------
  // The six empty-response guards (unreachable through the wire — the
  // B4 client raises for a non-dict envelope first — so they are probed
  // at the member seam).
  check(
    "(iv) create_feature_flag empty guard",
    await thrown(() =>
      members.createFeatureFlag(
        stub("createFeatureFlag", null),
        new CreateFeatureFlagParams({ name: "n", key: "k" }),
      ),
    ),
    "MixpanelHeadlessError/UNKNOWN_ERROR",
  );
  check(
    "(iv) get_feature_flag empty guard",
    await thrown(() =>
      members.getFeatureFlag(stub("getFeatureFlag", null), "f1"),
    ),
    "MixpanelHeadlessError/UNKNOWN_ERROR",
  );
  check(
    "(iv) update_feature_flag empty guard",
    await thrown(() =>
      members.updateFeatureFlag(
        stub("updateFeatureFlag", null),
        "f1",
        new UpdateFeatureFlagParams({
          name: "n",
          key: "k",
          status: FeatureFlagStatus.ENABLED,
          ruleset: {},
        }),
      ),
    ),
    "MixpanelHeadlessError/UNKNOWN_ERROR",
  );
  check(
    "(iv) create_experiment empty guard",
    await thrown(() =>
      members.createExperiment(
        stub("createExperiment", null),
        new CreateExperimentParams({ name: "n" }),
      ),
    ),
    "MixpanelHeadlessError/UNKNOWN_ERROR",
  );
  check(
    "(iv) get_experiment empty guard",
    await thrown(() =>
      members.getExperiment(stub("getExperiment", null), "e1"),
    ),
    "MixpanelHeadlessError/UNKNOWN_ERROR",
  );
  check(
    "(iv) update_experiment empty guard",
    await thrown(() =>
      members.updateExperiment(
        stub("updateExperiment", null),
        "e1",
        new UpdateExperimentParams({ name: "n" }),
      ),
    ),
    "MixpanelHeadlessError/UNKNOWN_ERROR",
  );

  // The `get_flag_history` query-dict assembly — all four arms.
  {
    const canned = { events: [], count: 0 };
    for (const [label, options, expected] of [
      ["neither", {}, { params: null }],
      ["page only", { page: "c" }, { params: { page: "c" } }],
      ["page_size only", { page_size: 5 }, { params: { page_size: "5" } }],
      [
        "both",
        { page: "c", page_size: 50 },
        { params: { page: "c", page_size: "50" } },
      ],
    ] as ReadonlyArray<[string, Record<string, unknown>, unknown]>) {
      const calls: unknown[][] = [];
      await members.getFlagHistory(
        stub("getFlagHistory", canned, calls),
        "f1",
        options,
      );
      check(`(iv) get_flag_history query ${label}`, calls[0]?.[1], expected);
    }
    // `None` is explicitly-passed-absent, exactly like the kwarg default.
    const calls: unknown[][] = [];
    await members.getFlagHistory(stub("getFlagHistory", canned, calls), "f1", {
      page: null,
      page_size: null,
    });
    check("(iv) get_flag_history explicit nulls", calls[0]?.[1], {
      params: null,
    });
  }

  // `conclude_experiment` always sends a body; `{}` when unset.
  {
    const calls: unknown[][] = [];
    await members.concludeExperiment(
      stub("concludeExperiment", ex("e1", "E", "concluded"), calls),
      "e1",
    );
    check("(iv) conclude_experiment default body", calls[0]?.[1], {});
  }
  {
    const calls: unknown[][] = [];
    await members.concludeExperiment(
      stub("concludeExperiment", ex("e1", "E", "concluded"), calls),
      "e1",
      { params: new ExperimentConcludeParams({ end_date: "2026-04-01" }) },
    );
    check("(iv) conclude_experiment params body", calls[0]?.[1], {
      end_date: "2026-04-01",
    });
  }
  {
    const calls: unknown[][] = [];
    await members.concludeExperiment(
      stub("concludeExperiment", ex("e1", "E", "concluded"), calls),
      "e1",
      { params: new ExperimentConcludeParams({}) },
    );
    check("(iv) conclude_experiment empty-params body", calls[0]?.[1], {});
  }

  // `set_flag_test_users` — the shard's ONE bare `model_dump()`.
  {
    const calls: unknown[][] = [];
    await members.setFlagTestUsers(
      stub("setFlagTestUsers", undefined, calls),
      "f1",
      new SetTestUsersParams({ users: { on: "u1" } }),
    );
    check("(iv) set_flag_test_users body", calls[0]?.[1], {
      users: { on: "u1" },
    });
  }
  {
    const calls: unknown[][] = [];
    await members.setFlagTestUsers(
      stub("setFlagTestUsers", undefined, calls),
      "f1",
      new SetTestUsersParams({ users: {} }),
    );
    check("(iv) set_flag_test_users empty mapping", calls[0]?.[1], {
      users: {},
    });
  }

  // `duplicate_experiment` — positional required params, exclude_none dump.
  {
    const calls: unknown[][] = [];
    await members.duplicateExperiment(
      stub("duplicateExperiment", ex("dup", "Copy"), calls),
      "e1",
      new DuplicateExperimentParams({ name: "Copy" }),
    );
    check("(iv) duplicate_experiment body", calls[0]?.[1], { name: "Copy" });
  }

  // RESPONSE_VALIDATION_ERROR from a malformed 200 body (the four
  // model-returning shapes: single, list, history, limits).
  check(
    "(iv) get_feature_flag malformed 200",
    await thrown(() => rig(() => ok({})).ws.getFeatureFlag("f1")),
    "ResponseValidationError/RESPONSE_VALIDATION_ERROR",
  );
  check(
    "(iv) list_experiments malformed item",
    await thrown(() => rig(() => ok([{}]), null).ws.listExperiments()),
    "ResponseValidationError/RESPONSE_VALIDATION_ERROR",
  );
  check(
    "(iv) get_flag_history malformed 200",
    await thrown(() =>
      rig(() => ok({ events: "nope" })).ws.getFlagHistory("f1"),
    ),
    "ResponseValidationError/RESPONSE_VALIDATION_ERROR",
  );
  check(
    "(iv) get_flag_limits malformed 200",
    await thrown(() => rig(() => ok({})).ws.getFlagLimits()),
    "ResponseValidationError/RESPONSE_VALIDATION_ERROR",
  );

  // The void members forward and return undefined (no result contract).
  {
    const r = rig(() => ({ status: 204 }));
    check(
      "(iv) void members resolve undefined",
      [
        await r.ws.deleteFeatureFlag("f1"),
        await r.ws.archiveFeatureFlag("f1"),
        await r.ws.setFlagTestUsers(
          "f1",
          new SetTestUsersParams({ users: {} }),
        ),
      ],
      [undefined, undefined, undefined],
    );
  }
  {
    const r = rig(() => ({ status: 204 }), null);
    check(
      "(iv) void experiment members resolve undefined",
      [await r.ws.deleteExperiment("e1"), await r.ws.archiveExperiment("e1")],
      [undefined, undefined],
    );
  }

  console.log(`\nchecks ${String(checks)}   failures ${String(failures)}`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

await main();
