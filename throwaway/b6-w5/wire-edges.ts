/**
 * B6-W5 R10.9 harness — the annotation/webhook/alert facade wire/edge
 * set (packet `b6-packets.md` §7 "R10.9 `throwaway/b6-w5/`").
 *
 * The W5 members are facade delegations with no oracle-call surface
 * (all-wire batch, §11.5), so the harness runs them through the
 * injected-fetch seam with hand-built interactions and asserts:
 *
 *   (i)   delegation equivalence — facade result === direct client
 *         result re-validated through the SAME model seam, over the
 *         same canned interaction;
 *   (ii)  wire status branches — `create_annotation` (200 / 400) and
 *         `test_webhook` (200 / 429-exhausted / 500);
 *   (iii) the mandatory edge set (18.0, 1.5, true, null, [], "", "𝒳")
 *         pushed through the alert `condition` dict and the
 *         `bookmark_params` dict — the shard's two `dict[str, Any]`
 *         param annotations (Discrepancy #8 boundary; NO integer-like
 *         unknown keys per #9/#10) — plus the watchlist-#5 date-string
 *         check: `from_date`/`to_date`/`CreateAnnotationParams.date`
 *         reach the wire as the caller's STRING, byte for byte;
 *   (iv)  EVERY W5-local branch. The shard has ZERO empty-response
 *         guards (grep-verified over `workspace.py:6462-7196`), so the
 *         local branch set is: the four option-bag `?? null` forwards
 *         (`list_annotations`, `list_alerts`, `get_alert_count`,
 *         `get_alert_history` — each in default and populated arms,
 *         plus the explicit-`false` arm that must NOT collapse to
 *         `None`), the `exclude_none` drop on all nine dumping
 *         members, the `test_alert` verbatim passthrough, and
 *         `RESPONSE_VALIDATION_ERROR` from a malformed 200 body for
 *         every validated model in the shard.
 *
 *     npx vite-node throwaway/b6-w5/wire-edges.ts
 *
 * THROWAWAY: deleted at the B6 gate; the RUN record lives in
 * `context/phase3/notes/B6-W5-notes.md` §3, which survives.
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
  Annotation,
  AnnotationTag,
  CreateAnnotationParams,
  CreateAnnotationTagParams,
  UpdateAnnotationParams,
} from "../../packages/core/src/types/entities/annotations.js";
import {
  CreateWebhookParams,
  ProjectWebhook,
  UpdateWebhookParams,
  WebhookTestParams,
  WebhookTestResult,
} from "../../packages/core/src/types/entities/webhooks.js";
import {
  AlertCount,
  AlertHistoryResponse,
  AlertScreenshotResponse,
  CreateAlertParams,
  CustomAlert,
  UpdateAlertParams,
  ValidateAlertsForBookmarkParams,
} from "../../packages/core/src/types/entities/alerts.js";
import * as members from "../../packages/core/src/workspace-members/annotations-webhooks-alerts.js";

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
 * Build the facade + its client over one canned handler
 * (`_make_workspace`, `test_workspace_alerts.py:68-85`).
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
 * A 200 App-API envelope wrapping `results`.
 *
 * @param results - The `results` payload.
 * @returns The canned response.
 */
function ok(results: unknown): CannedResponse {
  return { status: 200, json: { status: "ok", results } };
}

/**
 * An annotation payload (`_annotation_json` twin).
 *
 * @param id - Annotation ID.
 * @param description - Annotation text.
 * @returns The payload.
 */
function an(id: number, description: string): Record<string, unknown> {
  return {
    id,
    project_id: 12345,
    date: "2026-03-31",
    description,
    tags: [],
  };
}

/**
 * A webhook payload (`_webhook_json` twin).
 *
 * @param id - Webhook UUID.
 * @param name - Webhook name.
 * @returns The payload.
 */
function wh(id: string, name: string): Record<string, unknown> {
  return {
    id,
    name,
    url: "https://example.com/hook",
    is_enabled: true,
    auth_type: null,
    created: "2026-01-01T00:00:00Z",
    modified: "2026-01-01T00:00:00Z",
  };
}

/**
 * An alert payload (`_alert_json` twin).
 *
 * @param id - Alert ID.
 * @param name - Alert name.
 * @returns The payload.
 */
function al(id: number, name: string): Record<string, unknown> {
  return {
    id,
    name,
    condition: { operator: "less_than", value: 100 },
    frequency: 86400,
    paused: false,
    subscriptions: [{ type: "email", value: "test@co.com" }],
    created: "2026-01-01T00:00:00Z",
    modified: "2026-01-01T00:00:00Z",
    valid: true,
  };
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

/** The mandatory edge set, verbatim (packet §3 R10.9 wording). */
const EDGES: ReadonlyArray<readonly [string, unknown]> = [
  ["18.0", 18.0],
  ["1.5", 1.5],
  ["true", true],
  ["null", null],
  ["[]", []],
  ['""', ""],
  ['"𝒳"', "𝒳"],
];

/** Run the whole harness. */
async function main(): Promise<void> {
  // -----------------------------------------------------------------
  // (i) delegation equivalence — facade === client + the same model seam
  // -----------------------------------------------------------------
  {
    const payload = [an(1, "A"), an(2, "B")];
    const direct = rig(() => ok(payload));
    const viaFacade = rig(() => ok(payload));
    const rawList = await direct.client.listAnnotations({
      from_date: null,
      to_date: null,
      tags: null,
    });
    check(
      "(i) list_annotations",
      (await viaFacade.ws.listAnnotations()).map((m) => m.toJSON()),
      validateResponseModels(
        Annotation,
        rawList.map((item) => toNativeJson(item)),
        { endpoint: "list_annotations" },
      ).map((m) => m.toJSON()),
    );
  }
  {
    const payload = an(42, "Found it");
    const direct = rig(() => ok(payload));
    const viaFacade = rig(() => ok(payload));
    check(
      "(i) get_annotation",
      (await viaFacade.ws.getAnnotation(42)).toJSON(),
      validateResponseModel(
        Annotation,
        toNativeJson(await direct.client.getAnnotation(42)),
        { endpoint: "get_annotation" },
      ).toJSON(),
    );
  }
  {
    const payload = [{ id: 1, name: "releases" }];
    const direct = rig(() => ok(payload));
    const viaFacade = rig(() => ok(payload));
    check(
      "(i) list_annotation_tags",
      (await viaFacade.ws.listAnnotationTags()).map((m) => m.toJSON()),
      validateResponseModels(
        AnnotationTag,
        (await direct.client.listAnnotationTags()).map((i) => toNativeJson(i)),
        { endpoint: "list_annotation_tags" },
      ).map((m) => m.toJSON()),
    );
  }
  {
    const payload = [wh("id-1", "Hook A")];
    const direct = rig(() => ok(payload));
    const viaFacade = rig(() => ok(payload));
    check(
      "(i) list_webhooks",
      (await viaFacade.ws.listWebhooks()).map((m) => m.toJSON()),
      validateResponseModels(
        ProjectWebhook,
        (await direct.client.listWebhooks()).map((i) => toNativeJson(i)),
        { endpoint: "list_webhooks" },
      ).map((m) => m.toJSON()),
    );
  }
  {
    const payload = { success: true, status_code: 200, message: "OK" };
    const direct = rig(() => ok(payload));
    const viaFacade = rig(() => ok(payload));
    const params = new WebhookTestParams({ url: "https://e.co" });
    check(
      "(i) test_webhook",
      (await viaFacade.ws.testWebhook(params)).toJSON(),
      validateResponseModel(
        WebhookTestResult,
        toNativeJson(
          await direct.client.testWebhook(params.modelDumpExcludeNone()),
        ),
        { endpoint: "test_webhook" },
      ).toJSON(),
    );
  }
  {
    const payload = [al(1, "Alert A"), al(2, "Alert B")];
    const direct = rig(() => ok(payload));
    const viaFacade = rig(() => ok(payload));
    check(
      "(i) list_alerts",
      (await viaFacade.ws.listAlerts()).map((m) => m.toJSON()),
      validateResponseModels(
        CustomAlert,
        (
          await direct.client.listAlerts({
            bookmark_id: null,
            skip_user_filter: null,
          })
        ).map((i) => toNativeJson(i)),
        { endpoint: "list_alerts" },
      ).map((m) => m.toJSON()),
    );
  }
  {
    const payload = {
      anomaly_alerts_count: 5,
      alert_limit: 100,
      is_below_limit: true,
    };
    const direct = rig(() => ok(payload));
    const viaFacade = rig(() => ok(payload));
    check(
      "(i) get_alert_count",
      (await viaFacade.ws.getAlertCount()).toJSON(),
      validateResponseModel(
        AlertCount,
        toNativeJson(await direct.client.getAlertCount({ alert_type: null })),
        { endpoint: "get_alert_count" },
      ).toJSON(),
    );
  }
  {
    const payload = {
      results: [{ fired: true }],
      pagination: { page_size: 20 },
    };
    const direct = rig(() => ok(payload));
    const viaFacade = rig(() => ok(payload));
    check(
      "(i) get_alert_history",
      (await viaFacade.ws.getAlertHistory(42)).toJSON(),
      validateResponseModel(
        AlertHistoryResponse,
        toNativeJson(
          await direct.client.getAlertHistory(42, {
            page_size: null,
            next_cursor: null,
            previous_cursor: null,
          }),
        ),
        { endpoint: "get_alert_history" },
      ).toJSON(),
    );
  }
  {
    const payload = { signed_url: "https://storage.googleapis.com/a.png" };
    const direct = rig(() => ok(payload));
    const viaFacade = rig(() => ok(payload));
    check(
      "(i) get_alert_screenshot_url",
      (await viaFacade.ws.getAlertScreenshotUrl("k/a.png")).toJSON(),
      validateResponseModel(
        AlertScreenshotResponse,
        toNativeJson(await direct.client.getAlertScreenshotUrl("k/a.png")),
        { endpoint: "get_alert_screenshot_url" },
      ).toJSON(),
    );
  }
  {
    const payload = { status: "sent", nested: { n: 1 } };
    const direct = rig(() => ok(payload));
    const viaFacade = rig(() => ok(payload));
    const params = new CreateAlertParams({
      bookmark_id: 1,
      name: "T",
      condition: {},
      frequency: 60,
      paused: false,
      subscriptions: [],
    });
    check(
      "(i) test_alert (opaque passthrough)",
      await viaFacade.ws.testAlert(params),
      toNativeJson(
        await direct.client.testAlert(params.modelDumpExcludeNone()),
      ),
    );
  }

  // -----------------------------------------------------------------
  // (ii) wire status branches
  // -----------------------------------------------------------------
  {
    const { ws } = rig(() => ok(an(10, "New")));
    check(
      "(ii) create_annotation 200",
      (
        await ws.createAnnotation(
          new CreateAnnotationParams({
            date: "2026-03-31",
            description: "New",
          }),
        )
      ).id,
      10,
    );
  }
  check(
    "(ii) create_annotation 400",
    await thrown(() =>
      rig(() => ({ status: 400, json: { error: "bad" } })).ws.createAnnotation(
        new CreateAnnotationParams({ date: "2026-03-31", description: "x" }),
      ),
    ),
    ["QueryError", "QUERY_FAILED"],
  );
  {
    const { ws } = rig(() =>
      ok({ success: true, status_code: 200, message: "OK" }),
    );
    check(
      "(ii) test_webhook 200",
      (await ws.testWebhook(new WebhookTestParams({ url: "https://e.co" })))
        .success,
      true,
    );
  }
  {
    let calls = 0;
    const { ws } = rig(() => {
      calls += 1;
      return { status: 429, json: { error: "slow down" } };
    });
    check(
      "(ii) test_webhook 429-exhausted",
      await thrown(() =>
        ws.testWebhook(new WebhookTestParams({ url: "https://e.co" })),
      ),
      ["RateLimitError", "RATE_LIMITED"],
    );
    check("(ii) test_webhook 429 retried", calls > 1, true);
  }
  check(
    "(ii) test_webhook 500",
    await thrown(() =>
      rig(() => ({ status: 500, text: "boom" })).ws.testWebhook(
        new WebhookTestParams({ url: "https://e.co" }),
      ),
    ),
    ["ServerError", "SERVER_ERROR"],
  );

  // -----------------------------------------------------------------
  // (iii) edge set — the two `dict[str, Any]` param annotations, plus
  //       the watchlist-#5 date-string guarantee.
  // -----------------------------------------------------------------
  for (const [label, value] of EDGES) {
    const calls: unknown[][] = [];
    await members.createAlert(
      stub("createAlert", al(1, "A"), calls),
      new CreateAlertParams({
        bookmark_id: 1,
        name: "A",
        condition: { edge: value },
        frequency: 60,
        paused: false,
        subscriptions: [],
      }),
    );
    const body = calls[0]?.[0] as Record<string, unknown>;
    check(
      `(iii) create_alert condition edge ${label}`,
      (body["condition"] as Record<string, unknown>)["edge"],
      value,
    );
  }
  for (const [label, value] of EDGES) {
    const calls: unknown[][] = [];
    await members.validateAlertsForBookmark(
      stub(
        "validateAlertsForBookmark",
        { alert_validations: [], invalid_count: 0 },
        calls,
      ),
      new ValidateAlertsForBookmarkParams({
        alert_ids: [1],
        bookmark_type: "insights",
        bookmark_params: { edge: value },
      }),
    );
    const body = calls[0]?.[0] as Record<string, unknown>;
    check(
      `(iii) validate_alerts bookmark_params edge ${label}`,
      (body["bookmark_params"] as Record<string, unknown>)["edge"],
      value,
    );
  }
  {
    // Watchlist #5 — dates are STRINGS end-to-end; never a `Date`.
    const { ws, captures } = rig(() => ok([]));
    await ws.listAnnotations({
      from_date: "2026-01-01",
      to_date: "2026-03-31",
    });
    check(
      "(iii) list_annotations date strings on the wire",
      [captures[0]?.params["fromDate"], captures[0]?.params["toDate"]],
      ["2026-01-01", "2026-03-31"],
    );
  }
  {
    const calls: unknown[][] = [];
    await members.createAnnotation(
      stub("createAnnotation", an(1, "x"), calls),
      new CreateAnnotationParams({
        date: "2026-03-31 12:00:00",
        description: "x",
      }),
    );
    check(
      "(iii) create_annotation date string verbatim",
      (calls[0]?.[0] as Record<string, unknown>)["date"],
      "2026-03-31 12:00:00",
    );
  }

  // -----------------------------------------------------------------
  // (iv) W5-local branches
  // -----------------------------------------------------------------
  // (iv.a) the four option-bag `?? null` forwards.
  {
    const calls: unknown[][] = [];
    const client = stub("listAnnotations", [], calls);
    await members.listAnnotations(client);
    await members.listAnnotations(client, {
      from_date: "a",
      to_date: "b",
      tags: [1],
    });
    check("(iv) list_annotations default bag", calls[0]?.[0], {
      from_date: null,
      to_date: null,
      tags: null,
    });
    check("(iv) list_annotations populated bag", calls[1]?.[0], {
      from_date: "a",
      to_date: "b",
      tags: [1],
    });
  }
  {
    const calls: unknown[][] = [];
    const client = stub("listAlerts", [], calls);
    await members.listAlerts(client);
    await members.listAlerts(client, {
      bookmark_id: 42,
      skip_user_filter: false,
    });
    check("(iv) list_alerts default bag", calls[0]?.[0], {
      bookmark_id: null,
      skip_user_filter: null,
    });
    // `False is not None` — the explicit false must NOT collapse.
    check("(iv) list_alerts explicit false survives", calls[1]?.[0], {
      bookmark_id: 42,
      skip_user_filter: false,
    });
  }
  {
    const calls: unknown[][] = [];
    const client = stub(
      "getAlertCount",
      { anomaly_alerts_count: 0, alert_limit: 1, is_below_limit: true },
      calls,
    );
    await members.getAlertCount(client);
    await members.getAlertCount(client, { alert_type: "anomaly" });
    check("(iv) get_alert_count default bag", calls[0]?.[0], {
      alert_type: null,
    });
    check("(iv) get_alert_count populated bag", calls[1]?.[0], {
      alert_type: "anomaly",
    });
  }
  {
    const calls: unknown[][] = [];
    const client = stub("getAlertHistory", { results: [] }, calls);
    await members.getAlertHistory(client, 42);
    await members.getAlertHistory(client, 42, {
      page_size: 20,
      next_cursor: "n",
      previous_cursor: "p",
    });
    check("(iv) get_alert_history default bag", calls[0]?.[1], {
      page_size: null,
      next_cursor: null,
      previous_cursor: null,
    });
    check("(iv) get_alert_history populated bag", calls[1]?.[1], {
      page_size: 20,
      next_cursor: "n",
      previous_cursor: "p",
    });
  }

  // (iv.b) exclude_none drop on all nine dumping members.
  {
    const c1: unknown[][] = [];
    await members.createAnnotation(
      stub("createAnnotation", an(1, "x"), c1),
      new CreateAnnotationParams({ date: "d", description: "x" }),
    );
    check("(iv) create_annotation exclude_none", c1[0]?.[0], {
      date: "d",
      description: "x",
    });

    const c2: unknown[][] = [];
    await members.updateAnnotation(
      stub("updateAnnotation", an(1, "x"), c2),
      1,
      new UpdateAnnotationParams({ description: "x" }),
    );
    check("(iv) update_annotation exclude_none", c2[0]?.[1], {
      description: "x",
    });

    const c3: unknown[][] = [];
    await members.createAnnotationTag(
      stub("createAnnotationTag", { id: 1, name: "t" }, c3),
      new CreateAnnotationTagParams({ name: "t" }),
    );
    check("(iv) create_annotation_tag exclude_none", c3[0]?.[0], { name: "t" });

    const c4: unknown[][] = [];
    await members.createWebhook(
      stub("createWebhook", { id: "w", name: "n" }, c4),
      new CreateWebhookParams({ name: "n", url: "https://e.co" }),
    );
    check("(iv) create_webhook exclude_none", c4[0]?.[0], {
      name: "n",
      url: "https://e.co",
    });

    const c5: unknown[][] = [];
    await members.updateWebhook(
      stub("updateWebhook", { id: "w", name: "n" }, c5),
      "w",
      new UpdateWebhookParams({ name: "n" }),
    );
    check("(iv) update_webhook exclude_none", c5[0]?.[1], { name: "n" });

    const c6: unknown[][] = [];
    await members.testWebhook(
      stub(
        "testWebhook",
        { success: true, status_code: 200, message: "OK" },
        c6,
      ),
      new WebhookTestParams({ url: "https://e.co" }),
    );
    check("(iv) test_webhook exclude_none", c6[0]?.[0], {
      url: "https://e.co",
    });

    const c7: unknown[][] = [];
    await members.createAlert(
      stub("createAlert", al(1, "A"), c7),
      new CreateAlertParams({
        bookmark_id: 1,
        name: "A",
        condition: {},
        frequency: 60,
        paused: false,
        subscriptions: [],
      }),
    );
    // `notification_windows` is None → ABSENT (R3.5).
    check(
      "(iv) create_alert exclude_none drops notification_windows",
      c7[0]?.[0],
      {
        bookmark_id: 1,
        name: "A",
        condition: {},
        frequency: 60,
        paused: false,
        subscriptions: [],
      },
    );

    const c8: unknown[][] = [];
    await members.updateAlert(
      stub("updateAlert", al(1, "A"), c8),
      1,
      new UpdateAlertParams({ name: "R" }),
    );
    check("(iv) update_alert exclude_none", c8[0]?.[1], { name: "R" });

    const c9: unknown[][] = [];
    await members.validateAlertsForBookmark(
      stub(
        "validateAlertsForBookmark",
        { alert_validations: [], invalid_count: 0 },
        c9,
      ),
      new ValidateAlertsForBookmarkParams({
        alert_ids: [1],
        bookmark_type: "insights",
        bookmark_params: {},
      }),
    );
    check("(iv) validate_alerts_for_bookmark exclude_none", c9[0]?.[0], {
      alert_ids: [1],
      bookmark_type: "insights",
      bookmark_params: {},
    });
  }

  // (iv.c) RESPONSE_VALIDATION_ERROR from a malformed 200 body, one per
  // validated model in the shard.
  const malformed: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
    [
      "list_annotations",
      () => rig(() => ok([{ nope: 1 }])).ws.listAnnotations(),
    ],
    ["get_annotation", () => rig(() => ok({ nope: 1 })).ws.getAnnotation(1)],
    [
      "list_annotation_tags",
      () => rig(() => ok([{ nope: 1 }])).ws.listAnnotationTags(),
    ],
    ["list_webhooks", () => rig(() => ok([{ nope: 1 }])).ws.listWebhooks()],
    [
      "create_webhook",
      () =>
        rig(() => ok({ nope: 1 })).ws.createWebhook(
          new CreateWebhookParams({ name: "n", url: "https://e.co" }),
        ),
    ],
    [
      "test_webhook",
      () =>
        rig(() => ok({ nope: 1 })).ws.testWebhook(
          new WebhookTestParams({ url: "https://e.co" }),
        ),
    ],
    ["list_alerts", () => rig(() => ok([{ nope: 1 }])).ws.listAlerts()],
    ["get_alert", () => rig(() => ok({ nope: 1 })).ws.getAlert(1)],
    ["get_alert_count", () => rig(() => ok({})).ws.getAlertCount()],
    [
      "get_alert_screenshot_url",
      () => rig(() => ok({})).ws.getAlertScreenshotUrl("k"),
    ],
    [
      // Both declared fields DEFAULT (`[]` / `0`), so `{}` is a VALID
      // body — the failing shape has to violate a type instead.
      "validate_alerts_for_bookmark",
      () =>
        rig(() => ok({ invalid_count: "nope" })).ws.validateAlertsForBookmark(
          new ValidateAlertsForBookmarkParams({
            alert_ids: [1],
            bookmark_type: "insights",
            bookmark_params: {},
          }),
        ),
    ],
  ];
  for (const [label, fn] of malformed) {
    check(`(iv) ${label} malformed 200`, await thrown(fn), [
      "ResponseValidationError",
      "RESPONSE_VALIDATION_ERROR",
    ]);
  }

  // (iv.d) the void members forward and resolve undefined (no result
  // contract); `test_alert` returns the payload verbatim.
  {
    const r = rig(() => ({ status: 204 }));
    check(
      "(iv) void members resolve undefined",
      [
        await r.ws.deleteAnnotation(1),
        await r.ws.deleteWebhook("w"),
        await r.ws.deleteAlert(1),
        await r.ws.bulkDeleteAlerts([1, 2]),
      ],
      [undefined, undefined, undefined, undefined],
    );
  }
  {
    const calls: unknown[][] = [];
    const opaque = { status: "sent", extra: [1, { deep: true }] };
    check(
      "(iv) test_alert verbatim (no model construction)",
      await members.testAlert(
        stub("testAlert", opaque, calls),
        new CreateAlertParams({
          bookmark_id: 1,
          name: "A",
          condition: {},
          frequency: 60,
          paused: false,
          subscriptions: [],
        }),
      ),
      opaque,
    );
  }

  console.log(`\nchecks ${String(checks)}   failures ${String(failures)}`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

await main();
