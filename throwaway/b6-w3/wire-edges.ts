/**
 * B6-W3 R10.9 harness — the bookmark/cohort facade wire/edge set
 * (packet `b6-packets.md` §5 "R10.9 `throwaway/b6-w3/`").
 *
 * The W3 members are facade delegations with no oracle-call surface
 * (all-wire batch, §11.5), so the harness runs them through the
 * injected-fetch seam with hand-built interactions and asserts:
 *
 *   (i)   delegation equivalence — facade result === direct client
 *         result re-validated through the SAME model seam, over the
 *         same canned interaction;
 *   (ii)  wire status branches — `get_bookmark` (200 / 404 / 500) and
 *         `create_cohort` (200 / 400 / empty-body);
 *   (iii) the mandatory edge set (18.0, 1.5, true, null, [], "", "𝒳")
 *         pushed through the bookmark `params` dict and the cohort
 *         `definition` dict where the annotation admits them
 *         (Discrepancy #8 boundary; NO integer-like unknown keys per
 *         #9/#10 — see the §10 note in `B6-W3-notes.md`);
 *   (iv)  EVERY W3-local error branch — the five
 *         `API returned empty response for X` guards, the
 *         `dashboard_id is required` guard, BOTH
 *         `_validate_bookmark_params_schema` gates (error → raise,
 *         warning → log-and-continue) and `RESPONSE_VALIDATION_ERROR`
 *         from a malformed 200 body.
 *
 *     npx vite-node throwaway/b6-w3/wire-edges.ts
 *
 * THROWAWAY: deleted at the B6 gate; the RUN record lives in
 * `context/phase3/notes/B6-W3-notes.md` §R10.9.
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
  Bookmark,
  BookmarkHistoryResponse,
  BulkUpdateBookmarkEntry,
  CreateBookmarkParams,
  UpdateBookmarkParams,
} from "../../packages/core/src/types/entities/bookmarks.js";
import {
  BulkUpdateCohortEntry,
  Cohort,
  CreateCohortParams,
  UpdateCohortParams,
} from "../../packages/core/src/types/entities/cohorts.js";
import * as members from "../../packages/core/src/workspace-members/bookmarks-cohorts.js";

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

/** Minimal-valid insights bookmark params (`_bookmark_fixtures`). */
const MINIMAL_INSIGHTS: Record<string, unknown> = {
  displayOptions: { chartType: "bar" },
  sections: {
    show: [{ type: "metric", behavior: { type: "event", name: "Login" } }],
    time: [],
  },
};

/**
 * A bookmark payload (`_bookmark_json` twin).
 *
 * @param id - Bookmark id.
 * @param name - Bookmark name.
 * @param type - Report type (wire spelling).
 * @returns The payload.
 */
function bm(
  id: number,
  name: string,
  type = "insights",
): Record<string, unknown> {
  return { id, name, type, params: { events: [] } };
}

/**
 * A cohort payload (`_cohort_json` twin).
 *
 * @param id - Cohort id.
 * @param name - Cohort name.
 * @returns The payload.
 */
function co(id: number, name: string): Record<string, unknown> {
  return { id, name, count: 100, is_visible: true };
}

/**
 * A dashboard payload — the `add_report_to_dashboard` PATCH reply the
 * create-bookmark path needs.
 *
 * @param id - Dashboard id.
 * @returns The payload.
 */
function dash(id: number): Record<string, unknown> {
  return {
    id,
    title: "T",
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
 * Build a facade whose transport dispatches on method (create-bookmark
 * needs a POST reply AND a PATCH reply).
 *
 * @param post - The POST reply.
 * @param patch - The PATCH reply.
 * @returns The facade plus a collected log line.
 */
function rigCreate(
  post: CannedResponse,
  patch: CannedResponse,
): { ws: Workspace; warnings: string[] } {
  const warnings: string[] = [];
  const { client } = createMockClient(SESSION, (request) =>
    request.method === "PATCH" ? patch : post,
  );
  return {
    ws: new Workspace({
      session: SESSION,
      client,
      logger: {
        warning(message: string): void {
          warnings.push(message);
        },
      },
    }),
    warnings,
  };
}

/**
 * A stub client whose one member resolves to `value`.
 *
 * @param member - The client method name.
 * @param value - The resolved value.
 * @returns The stub.
 */
function stubClient(member: string, value: unknown): MixpanelClient {
  return {
    ...RESOLVER_SEAM,
    [member]: () => Promise.resolve(value),
  } as unknown as MixpanelClient;
}

/**
 * The `setWorkspaceResolver` seam every `Workspace` constructor installs
 * (`workspace.py:775-793`; W1) — stub clients must carry it.
 */
const RESOLVER_SEAM = {
  hasWorkspaceResolver: false,
  setWorkspaceResolver: (): void => {},
  close: (): Promise<void> => Promise.resolve(),
};

/** The `results` envelope. */
const ok = (results: unknown): CannedResponse => ({
  status: 200,
  json: { status: "ok", results },
});

/** Run the harness. */
async function main(): Promise<void> {
  // -------------------------------------------------------------------
  // (i) delegation equivalence
  // -------------------------------------------------------------------
  {
    const payload = [bm(1, "A"), bm(2, "B", "funnels")];
    const { ws, client } = rig(ok(payload));
    const facade = await ws.listBookmarksV2();
    const direct = validateResponseModels(
      Bookmark,
      (await client.listBookmarksV2()).map((item) => toNativeJson(item)),
      { endpoint: "list_bookmarks_v2" },
    );
    check(
      "equiv/list_bookmarks_v2",
      facade.map((b) => b.toJSON()),
      direct.map((b) => b.toJSON()),
    );
  }
  {
    const { ws, client } = rig(ok(bm(7, "One", "retention")));
    const facade = await ws.getBookmark(7);
    const direct = validateResponseModel(
      Bookmark,
      toNativeJson(await client.getBookmark(7)),
      { endpoint: "get_bookmark" },
    );
    check("equiv/get_bookmark", facade.toJSON(), direct.toJSON());
  }
  {
    const { ws, client } = rig(
      ok({ results: [{ action: "created" }], pagination: { page_size: 5 } }),
    );
    const facade = await ws.getBookmarkHistory(7, { page_size: 5 });
    const direct = validateResponseModel(
      BookmarkHistoryResponse,
      toNativeJson(await client.getBookmarkHistory(7, { page_size: 5 })),
      { endpoint: "get_bookmark_history" },
    );
    check("equiv/get_bookmark_history", facade.toJSON(), direct.toJSON());
  }
  {
    const { ws, client } = rig(ok([co(1, "A"), co(2, "B")]));
    const facade = await ws.listCohortsFull();
    const direct = validateResponseModels(
      Cohort,
      (await client.listCohortsApp()).map((item) => toNativeJson(item)),
      { endpoint: "list_cohorts_full" },
    );
    check(
      "equiv/list_cohorts_full",
      facade.map((c) => c.toJSON()),
      direct.map((c) => c.toJSON()),
    );
  }
  {
    const { ws, client } = rig(ok(co(3, "One")));
    const facade = await ws.getCohort(3);
    const direct = validateResponseModel(
      Cohort,
      toNativeJson(await client.getCohort(3)),
      { endpoint: "get_cohort" },
    );
    check("equiv/get_cohort", facade.toJSON(), direct.toJSON());
  }
  {
    const { ws, client } = rig(ok([10, 20]));
    check(
      "equiv/bookmark_linked_dashboard_ids",
      await ws.bookmarkLinkedDashboardIds(1),
      (await client.bookmarkLinkedDashboardIds(1)).map((v) => toNativeJson(v)),
    );
  }

  // -------------------------------------------------------------------
  // (ii) wire status branches
  // -------------------------------------------------------------------
  for (const [status, expected] of [
    [200, "<resolved>"],
    [404, "QueryError/QUERY_FAILED"],
    [500, "ServerError/SERVER_ERROR"],
  ] as const) {
    const { ws } = rig(
      status === 200 ? ok(bm(1, "A")) : { status, json: { error: "boom" } },
    );
    check(
      `status/get_bookmark/${String(status)}`,
      await thrown(() => ws.getBookmark(1)),
      expected,
    );
  }
  for (const [label, response, expected] of [
    ["200", ok(co(1, "A")), "<resolved>"],
    [
      "400",
      { status: 400, json: { error: "bad" } } as CannedResponse,
      "QueryError/QUERY_FAILED",
    ],
    [
      "empty-body",
      { status: 200, text: "" } as CannedResponse,
      "MixpanelHeadlessError/INVALID_RESPONSE",
    ],
  ] as const) {
    const { ws } = rig(response);
    check(
      `status/create_cohort/${label}`,
      await thrown(() =>
        ws.createCohort(new CreateCohortParams({ name: "X" })),
      ),
      expected,
    );
  }

  // -------------------------------------------------------------------
  // (iii) the mandatory edge set through annotation-admitting fields
  // -------------------------------------------------------------------
  const EDGES: ReadonlyArray<readonly [string, unknown]> = [
    ["integral-float", 18.0],
    ["fraction", 1.5],
    ["true", true],
    ["null", null],
    ["empty-list", []],
    ["empty-string", ""],
    ["non-bmp", "𝒳"],
  ];
  for (const [label, value] of EDGES) {
    // Cohort `definition` is `dict[str, Any]` — every edge is in-annotation.
    const bodies: unknown[] = [];
    const { client } = createMockClient(SESSION, () => ok(co(1, "X")));
    const spy = {
      ...client,
      ...RESOLVER_SEAM,
      createCohort: (body: Record<string, unknown>) => {
        bodies.push(body);
        return Promise.resolve(co(1, "X") as never);
      },
    } as unknown as MixpanelClient;
    const ws = new Workspace({ session: SESSION, client: spy });
    await ws.createCohort(
      new CreateCohortParams({ name: "X", definition: { edge: value } }),
    );
    check(`edge/cohort-definition/${label}`, bodies[0], {
      name: "X",
      edge: value,
    });
  }
  {
    // A falsy definition (`{}`) drops entirely — `if definition:`.
    const bodies: unknown[] = [];
    const spy = {
      ...RESOLVER_SEAM,
      createCohort: (body: Record<string, unknown>) => {
        bodies.push(body);
        return Promise.resolve(co(1, "X") as never);
      },
    } as unknown as MixpanelClient;
    const ws = new Workspace({ session: SESSION, client: spy });
    await ws.createCohort(
      new CreateCohortParams({ name: "X", definition: {} }),
    );
    check("edge/cohort-definition/empty-dict-dropped", bodies[0], {
      name: "X",
    });
  }
  for (const [label, value] of EDGES) {
    // Bookmark `params` is `dict[str, Any]`; a non-canonical extra key
    // rides through partial-mode update validation untouched.
    const errors = members.validateBookmarkParamsSchema({ edge: value }, null, {
      partial: true,
    });
    check(`edge/bookmark-params/${label}`, errors.length, 0);
  }

  // -------------------------------------------------------------------
  // (iv) every W3-local error branch
  // -------------------------------------------------------------------
  const NULL_GUARDS: ReadonlyArray<readonly [string, () => Promise<unknown>]> =
    [
      [
        "create_bookmark",
        () =>
          members.createBookmark(
            stubClient("createBookmark", null),
            new CreateBookmarkParams({
              name: "X",
              bookmark_type: "insights",
              params: MINIMAL_INSIGHTS,
              dashboard_id: 1,
            }),
            () => Promise.resolve(null),
          ),
      ],
      [
        "get_bookmark",
        () => members.getBookmark(stubClient("getBookmark", null), 1),
      ],
      [
        "update_bookmark",
        () =>
          members.updateBookmark(
            stubClient("updateBookmark", null),
            1,
            new UpdateBookmarkParams({ name: "X" }),
          ),
      ],
      ["get_cohort", () => members.getCohort(stubClient("getCohort", null), 1)],
      [
        "create_cohort",
        () =>
          members.createCohort(
            stubClient("createCohort", null),
            new CreateCohortParams({ name: "X" }),
          ),
      ],
      [
        "update_cohort",
        () =>
          members.updateCohort(
            stubClient("updateCohort", null),
            1,
            new UpdateCohortParams({ name: "X" }),
          ),
      ],
    ];
  for (const [label, fn] of NULL_GUARDS) {
    check(
      `guard/empty-response/${label}`,
      await thrown(fn),
      "MixpanelHeadlessError/UNKNOWN_ERROR",
    );
  }
  {
    const { ws } = rig(ok(bm(1, "A")));
    check(
      "guard/create_bookmark/missing-dashboard-id",
      await thrown(() =>
        ws.createBookmark(
          new CreateBookmarkParams({
            name: "X",
            bookmark_type: "insights",
            params: MINIMAL_INSIGHTS,
          }),
        ),
      ),
      "MixpanelHeadlessError/UNKNOWN_ERROR",
    );
  }
  {
    // Schema gate — hard error path (create).
    const { ws } = rigCreate(ok(bm(1, "A")), ok(dash(9)));
    check(
      "guard/create_bookmark/schema-error",
      await thrown(() =>
        ws.createBookmark(
          new CreateBookmarkParams({
            name: "X",
            bookmark_type: "insights",
            params: {
              ...MINIMAL_INSIGHTS,
              sorting: {
                bar: { sortBy: "value", sortOrder: "asc", segmentation: "v" },
              },
            },
            dashboard_id: 9,
          }),
        ),
      ),
      "BookmarkValidationError/BOOKMARK_VALIDATION_ERROR",
    );
  }
  {
    // Schema gate — warning path (create): logs and continues.
    const { ws, warnings } = rigCreate(ok(bm(5, "W")), ok(dash(9)));
    const created = await ws.createBookmark(
      new CreateBookmarkParams({
        name: "W",
        bookmark_type: "insights",
        params: {
          ...MINIMAL_INSIGHTS,
          sorting: { barz: { sortBy: "column", colSortAttrs: [] } },
        },
        dashboard_id: 9,
      }),
    );
    check("guard/create_bookmark/warning-continues", created.id, 5);
    check(
      "guard/create_bookmark/warning-logged",
      warnings.some((m) => m.includes("S4_UNKNOWN_CHART_TYPE")),
      true,
    );
  }
  {
    // Schema gate — hard error path (update, partial mode).
    const { ws } = rig(ok(bm(1, "A")));
    check(
      "guard/update_bookmark/schema-error",
      await thrown(() =>
        ws.updateBookmark(
          1,
          new UpdateBookmarkParams({
            params: { displayOptions: { plotStyle: "stacked" } },
          }),
        ),
      ),
      "BookmarkValidationError/BOOKMARK_VALIDATION_ERROR",
    );
  }
  {
    // Schema gate — `params is None` skips validation entirely.
    const { ws } = rig(ok(bm(1, "A")));
    const updated = await ws.updateBookmark(
      1,
      new UpdateBookmarkParams({ name: "Renamed" }),
    );
    check("guard/update_bookmark/no-params-skips-gate", updated.id, 1);
  }
  for (const [label, call] of [
    ["list_bookmarks_v2", (ws: Workspace) => ws.listBookmarksV2()],
    ["get_bookmark", (ws: Workspace) => ws.getBookmark(1)],
    ["list_cohorts_full", (ws: Workspace) => ws.listCohortsFull()],
    ["get_cohort", (ws: Workspace) => ws.getCohort(1)],
  ] as const) {
    const isList = label.startsWith("list");
    const { ws } = rig(ok(isList ? [{}] : {}));
    check(
      `guard/response-validation/${label}`,
      await thrown(() => call(ws)),
      "ResponseValidationError/RESPONSE_VALIDATION_ERROR",
    );
  }

  // -------------------------------------------------------------------
  // bulk dumps: exclude_none + per-entry definition flattening
  // -------------------------------------------------------------------
  {
    const bodies: unknown[] = [];
    const spy = {
      ...RESOLVER_SEAM,
      bulkUpdateBookmarks: (entries: ReadonlyArray<unknown>) => {
        bodies.push(entries);
        return Promise.resolve();
      },
      bulkUpdateCohorts: (entries: ReadonlyArray<unknown>) => {
        bodies.push(entries);
        return Promise.resolve();
      },
    } as unknown as MixpanelClient;
    const ws = new Workspace({ session: SESSION, client: spy });
    await ws.bulkUpdateBookmarks([
      new BulkUpdateBookmarkEntry({ id: 1, name: "R" }),
    ]);
    check("bulk/bookmarks/exclude-none", bodies[0], [{ id: 1, name: "R" }]);
    await ws.bulkUpdateCohorts([
      new BulkUpdateCohortEntry({ id: 2, definition: { filter: "x" } }),
    ]);
    check("bulk/cohorts/flatten-definition", bodies[1], [
      { id: 2, filter: "x" },
    ]);
  }

  console.log(`\nchecks ${String(checks)}   failures ${String(failures)}`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

await main();
