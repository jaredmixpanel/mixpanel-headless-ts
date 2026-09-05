// ADDITIVE (no Python twin): network-free guards on the positional
// entity-id parameters of the `Workspace` facade.
//
// Motivation — a live run passed `{ annotation_id: 2078447 }` where
// `deleteAnnotation(annotationId: number)` expects the bare number; the
// port interpolated `/annotations/[object Object]/` into the path and
// surfaced the server's 404 as `QUERY_FAILED`. Python does not guard
// these arguments (its signatures are `int`-typed), so the TS guard is
// additive hardening: every `int`-typed positional id on the facade now
// rejects a non-positive-integer BEFORE any request is assembled, with
// Python's own `RL6_INVALID_ID` ("An id is a positive integer").
//
// Two layers: the `requireEntityId` helper table, and one probe per
// guarded facade member proving the guard fires with ZERO transport
// calls (the `httpx.MockTransport` twin records every request).

import { describe, expect, it } from "vitest";
import { Workspace } from "../../src/workspace.js";
import {
  requireEntityId,
  requireInt64Id,
} from "../../src/workspace-members/shared.js";
import {
  CODED_GUARD_REGISTRY,
  ParamValidationError,
} from "../../src/errors.js";
import {
  createMockClient,
  makeSession,
  type CannedResponse,
  type CapturedFetchRequest,
} from "../client/client-test-helpers.js";
import { UpdateAnnotationParams } from "../../src/types/entities/annotations.js";

/** The OAuth session the mock client is built over. */
const CLIENT_SESSION = makeSession({
  projectId: "12345",
  region: "us",
  oauthToken: "test-token",
});

/** The service-account facade session (`_TEST_SESSION`). */
const FACADE_SESSION = makeSession({
  projectId: "12345",
  region: "us",
  username: "test_user",
  secret: "test_secret",
});

/**
 * Build a Workspace whose transport records every request and answers
 * `{status: "ok", results: {}}`.
 *
 * @returns The facade plus the request log.
 */
function makeWorkspace(): { ws: Workspace; calls: CapturedFetchRequest[] } {
  const calls: CapturedFetchRequest[] = [];
  const { client } = createMockClient(CLIENT_SESSION, (request) => {
    calls.push(request);
    const response: CannedResponse = {
      status: 200,
      json: { status: "ok", results: {} },
    };
    return response;
  });
  return { ws: new Workspace({ session: FACADE_SESSION, client }), calls };
}

/**
 * Await `thunk` (sync or async) and return what it threw.
 *
 * @param thunk - The call under test.
 * @returns The thrown value.
 */
async function caught(thunk: () => unknown): Promise<unknown> {
  try {
    await thunk();
  } catch (exc) {
    return exc;
  }
  return undefined;
}

// =============================================================================
// requireEntityId — the shared helper
// =============================================================================

describe("requireEntityId", () => {
  it("is coded with a registered guard code", () => {
    expect(CODED_GUARD_REGISTRY.has("RL6_INVALID_ID")).toBe(true);
  });

  it.each([1, 42, 2078447, Number.MAX_SAFE_INTEGER])(
    "passes a positive integer through unchanged (%s)",
    (value) => {
      expect(requireEntityId("annotation_id", value)).toBe(value);
    },
  );

  it.each<[string, unknown, string]>([
    ["zero", 0, "number 0"],
    ["negative", -5, "number -5"],
    ["non-integer", 1.5, "number 1.5"],
    ["NaN", Number.NaN, "number NaN"],
    ["Infinity", Number.POSITIVE_INFINITY, "number Infinity"],
    ["beyond safe-integer range", 2 ** 53, "number 9007199254740992"],
    ['string "12"', "12", 'string "12"'],
    ["object", { annotation_id: 2078447 }, "object (Object)"],
    ["array", [1], "array"],
    ["null-prototype object", Object.create(null), "object (null prototype)"],
    ["undefined", undefined, "undefined"],
    ["null", null, "null"],
    ["boolean", true, "boolean true"],
    ["bigint", 7n, "bigint 7"],
    ["function", () => 1, "function"],
  ])("rejects %s with RL6_INVALID_ID naming the field", (_, value, shown) => {
    let error: unknown;
    try {
      requireEntityId("annotation_id", value);
    } catch (exc) {
      error = exc;
    }
    expect(error).toBeInstanceOf(ParamValidationError);
    const coded = error as ParamValidationError;
    expect(coded.code).toBe("RL6_INVALID_ID");
    expect(coded.message).toBe(
      `Invalid annotation_id: expected a positive integer id, received ${shown}.`,
    );
    expect(coded.details).toEqual({ field: "annotation_id", received: shown });
  });

  it("never echoes object contents or long strings", () => {
    const secretish = { token: "sk-live-very-secret" };
    const objErr = (() => {
      try {
        requireEntityId("bookmark_id", secretish);
      } catch (exc) {
        return exc as ParamValidationError;
      }
      return undefined;
    })();
    expect(objErr?.message).not.toContain("sk-live");
    const long = "x".repeat(200);
    const strErr = (() => {
      try {
        requireEntityId("bookmark_id", long);
      } catch (exc) {
        return exc as ParamValidationError;
      }
      return undefined;
    })();
    expect(strErr?.message).toContain(`"${"x".repeat(40)}"`);
    expect(strErr?.message).not.toContain("x".repeat(41));
  });
});

// =============================================================================
// requireInt64Id — the lookup-table twin (signed int64 ids)
// =============================================================================

describe("requireInt64Id", () => {
  const BIG = -8644926364725811123n; // a live lookup-table data_group_id

  it.each<number | bigint>([
    1,
    -5,
    42,
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
    7n,
    -7n,
    BIG,
    2n ** 60n,
  ])("passes a non-zero integer through unchanged (%s)", (value) => {
    expect(requireInt64Id("data_group_id", value)).toBe(value);
  });

  it.each<[string, unknown, string]>([
    ["zero", 0, "number 0"],
    ["bigint zero", 0n, "bigint 0"],
    ["non-integer", 1.5, "number 1.5"],
    ["NaN", Number.NaN, "number NaN"],
    ["Infinity", Number.POSITIVE_INFINITY, "number Infinity"],
    ['string "12"', "12", 'string "12"'],
    [
      "decimal string of a big id",
      "-8644926364725811123",
      'string "-8644926364725811123"',
    ],
    ["object", { data_group_id: 5 }, "object (Object)"],
    ["array", [1], "array"],
    ["undefined", undefined, "undefined"],
    ["null", null, "null"],
    ["boolean", true, "boolean true"],
  ])("rejects %s with RL6_INVALID_ID naming the field", (_, value, shown) => {
    let error: unknown;
    try {
      requireInt64Id("data_group_id", value);
    } catch (exc) {
      error = exc;
    }
    expect(error).toBeInstanceOf(ParamValidationError);
    const coded = error as ParamValidationError;
    expect(coded.code).toBe("RL6_INVALID_ID");
    expect(coded.message).toBe(
      `Invalid data_group_id: expected a non-zero integer id (number or bigint), received ${shown}.`,
    );
    expect(coded.details).toEqual({ field: "data_group_id", received: shown });
  });

  it.each<[string, number, string]>([
    ["2 ** 53", 2 ** 53, "number 9007199254740992"],
    // JS prints 2 ** 60 shortest-round-trip: not its exact digits.
    ["2 ** 60", 2 ** 60, "number 1152921504606847000"],
    ["-(2 ** 53)", -(2 ** 53), "number -9007199254740992"],
    [
      "JSON.parse'd big id (already rounded)",
      JSON.parse("-8644926364725811123") as number,
      "number -8644926364725811000",
    ],
  ])(
    "refuses an unsafe-magnitude number (%s) and says to pass a bigint",
    (_, value, shown) => {
      let error: unknown;
      try {
        requireInt64Id("data_group_id", value);
      } catch (exc) {
        error = exc;
      }
      expect(error).toBeInstanceOf(ParamValidationError);
      const coded = error as ParamValidationError;
      expect(coded.code).toBe("RL6_INVALID_ID");
      expect(coded.message).toBe(
        `Invalid data_group_id: received ${shown}, which is beyond ` +
          `Number.MAX_SAFE_INTEGER and already rounded; pass the id as a ` +
          `bigint (e.g. -8644926364725811123n or BigInt("<digits>")).`,
      );
      expect(coded.details).toEqual({
        field: "data_group_id",
        received: shown,
      });
    },
  );
});

// =============================================================================
// Facade members — the guard fires before the client is touched
// =============================================================================

/** The live-run shape: an object where the bare id was expected. */
const BAD_ID = { annotation_id: 2078447 } as unknown as number;

/**
 * Every guarded facade member: `[family, member, python field, call]`.
 * The call passes `BAD_ID` in the guarded slot; where a member takes
 * two ids the SECOND slot is probed separately below.
 */
const GUARDED: ReadonlyArray<
  [string, string, string, (ws: Workspace) => unknown]
> = [
  // live query
  [
    "query",
    "funnel",
    "funnel_id",
    (ws) =>
      ws.funnel(BAD_ID, { from_date: "2025-01-01", to_date: "2025-01-02" }),
  ],
  [
    "query",
    "querySavedReport",
    "bookmark_id",
    (ws) => ws.querySavedReport(BAD_ID),
  ],
  [
    "query",
    "querySavedFlows",
    "bookmark_id",
    (ws) => ws.querySavedFlows(BAD_ID),
  ],
  // dashboards
  [
    "dashboards",
    "getDashboard",
    "dashboard_id",
    (ws) => ws.getDashboard(BAD_ID),
  ],
  [
    "dashboards",
    "updateDashboard",
    "dashboard_id",
    (ws) => ws.updateDashboard(BAD_ID, {} as never),
  ],
  [
    "dashboards",
    "deleteDashboard",
    "dashboard_id",
    (ws) => ws.deleteDashboard(BAD_ID),
  ],
  [
    "dashboards",
    "favoriteDashboard",
    "dashboard_id",
    (ws) => ws.favoriteDashboard(BAD_ID),
  ],
  [
    "dashboards",
    "unfavoriteDashboard",
    "dashboard_id",
    (ws) => ws.unfavoriteDashboard(BAD_ID),
  ],
  [
    "dashboards",
    "pinDashboard",
    "dashboard_id",
    (ws) => ws.pinDashboard(BAD_ID),
  ],
  [
    "dashboards",
    "unpinDashboard",
    "dashboard_id",
    (ws) => ws.unpinDashboard(BAD_ID),
  ],
  [
    "dashboards",
    "removeReportFromDashboard",
    "dashboard_id",
    (ws) => ws.removeReportFromDashboard(BAD_ID, 1),
  ],
  [
    "dashboards",
    "removeReportFromDashboard",
    "bookmark_id",
    (ws) => ws.removeReportFromDashboard(1, BAD_ID),
  ],
  [
    "dashboards",
    "addReportToDashboard",
    "dashboard_id",
    (ws) => ws.addReportToDashboard(BAD_ID, 1),
  ],
  [
    "dashboards",
    "addReportToDashboard",
    "bookmark_id",
    (ws) => ws.addReportToDashboard(1, BAD_ID),
  ],
  [
    "dashboards",
    "getBlueprintConfig",
    "dashboard_id",
    (ws) => ws.getBlueprintConfig(BAD_ID),
  ],
  [
    "dashboards",
    "getBookmarkDashboardIds",
    "bookmark_id",
    (ws) => ws.getBookmarkDashboardIds(BAD_ID),
  ],
  [
    "dashboards",
    "getDashboardErf",
    "dashboard_id",
    (ws) => ws.getDashboardErf(BAD_ID),
  ],
  [
    "dashboards",
    "updateReportLink",
    "dashboard_id",
    (ws) => ws.updateReportLink(BAD_ID, 1, {} as never),
  ],
  [
    "dashboards",
    "updateReportLink",
    "report_link_id",
    (ws) => ws.updateReportLink(1, BAD_ID, {} as never),
  ],
  [
    "dashboards",
    "updateTextCard",
    "dashboard_id",
    (ws) => ws.updateTextCard(BAD_ID, 1, {} as never),
  ],
  [
    "dashboards",
    "updateTextCard",
    "text_card_id",
    (ws) => ws.updateTextCard(1, BAD_ID, {} as never),
  ],
  // bookmarks
  ["bookmarks", "getBookmark", "bookmark_id", (ws) => ws.getBookmark(BAD_ID)],
  [
    "bookmarks",
    "updateBookmark",
    "bookmark_id",
    (ws) => ws.updateBookmark(BAD_ID, {} as never),
  ],
  [
    "bookmarks",
    "deleteBookmark",
    "bookmark_id",
    (ws) => ws.deleteBookmark(BAD_ID),
  ],
  [
    "bookmarks",
    "bookmarkLinkedDashboardIds",
    "bookmark_id",
    (ws) => ws.bookmarkLinkedDashboardIds(BAD_ID),
  ],
  [
    "bookmarks",
    "getBookmarkHistory",
    "bookmark_id",
    (ws) => ws.getBookmarkHistory(BAD_ID),
  ],
  // cohorts
  ["cohorts", "getCohort", "cohort_id", (ws) => ws.getCohort(BAD_ID)],
  [
    "cohorts",
    "updateCohort",
    "cohort_id",
    (ws) => ws.updateCohort(BAD_ID, {} as never),
  ],
  ["cohorts", "deleteCohort", "cohort_id", (ws) => ws.deleteCohort(BAD_ID)],
  // annotations
  [
    "annotations",
    "getAnnotation",
    "annotation_id",
    (ws) => ws.getAnnotation(BAD_ID),
  ],
  [
    "annotations",
    "updateAnnotation",
    "annotation_id",
    (ws) =>
      ws.updateAnnotation(
        BAD_ID,
        new UpdateAnnotationParams({ description: "x" }),
      ),
  ],
  [
    "annotations",
    "deleteAnnotation",
    "annotation_id",
    (ws) => ws.deleteAnnotation(BAD_ID),
  ],
  // alerts
  ["alerts", "getAlert", "alert_id", (ws) => ws.getAlert(BAD_ID)],
  [
    "alerts",
    "updateAlert",
    "alert_id",
    (ws) => ws.updateAlert(BAD_ID, {} as never),
  ],
  ["alerts", "deleteAlert", "alert_id", (ws) => ws.deleteAlert(BAD_ID)],
  ["alerts", "getAlertHistory", "alert_id", (ws) => ws.getAlertHistory(BAD_ID)],
  // lexicon
  [
    "lexicon",
    "updateLexiconTag",
    "tag_id",
    (ws) => ws.updateLexiconTag(BAD_ID, {} as never),
  ],
  // governance / data
  [
    "governance",
    "deleteDropFilter",
    "drop_filter_id",
    (ws) => ws.deleteDropFilter(BAD_ID),
  ],
  [
    "governance",
    "updateCustomEvent",
    "custom_event_id",
    (ws) => ws.updateCustomEvent(BAD_ID, {} as never),
  ],
  [
    "governance",
    "deleteCustomEvent",
    "custom_event_id",
    (ws) => ws.deleteCustomEvent(BAD_ID),
  ],
  [
    "governance",
    "cancelDeletionRequest",
    "request_id",
    (ws) => ws.cancelDeletionRequest(BAD_ID),
  ],
  // report links (sync builder)
  [
    "report-links",
    "savedReportLink",
    "bookmark_id",
    (ws) => ws.savedReportLink(BAD_ID),
  ],
];

/**
 * The lookup-table members: their `data_group_id` is a signed int64
 * (negative ids beyond 2^53 are the norm), so they take the
 * `requireInt64Id` guard instead — same code, different acceptance.
 */
const INT64_GUARDED: ReadonlyArray<
  [string, string, string, (ws: Workspace, id: number | bigint) => unknown]
> = [
  [
    "governance",
    "updateLookupTable",
    "data_group_id",
    (ws, id) => ws.updateLookupTable(id, {} as never),
  ],
  [
    "governance",
    "downloadLookupTable",
    "data_group_id",
    (ws, id) => ws.downloadLookupTable(id),
  ],
  [
    "governance",
    "getLookupDownloadUrl",
    "data_group_id",
    (ws, id) => ws.getLookupDownloadUrl(id),
  ],
  [
    "governance",
    "deleteLookupTables",
    "data_group_ids",
    (ws, id) => ws.deleteLookupTables([id]),
  ],
];

describe("Workspace positional entity-id guards (network-free)", () => {
  it.each(GUARDED)(
    "[%s] %s rejects a non-integer %s before any request",
    async (_family, _member, field, call) => {
      const { ws, calls } = makeWorkspace();
      const error = await caught(() => call(ws));
      expect(error).toBeInstanceOf(ParamValidationError);
      const coded = error as ParamValidationError;
      expect(coded.code).toBe("RL6_INVALID_ID");
      expect(coded.message).toBe(
        `Invalid ${field}: expected a positive integer id, received object (Object).`,
      );
      expect(calls).toEqual([]);
    },
  );

  it.each(INT64_GUARDED)(
    "[%s] %s rejects a non-integer %s before any request (int64 guard)",
    async (_family, _member, field, call) => {
      const { ws, calls } = makeWorkspace();
      const error = await caught(() => call(ws, BAD_ID));
      expect(error).toBeInstanceOf(ParamValidationError);
      const coded = error as ParamValidationError;
      expect(coded.code).toBe("RL6_INVALID_ID");
      expect(coded.message).toBe(
        `Invalid ${field}: expected a non-zero integer id (number or bigint), received object (Object).`,
      );
      expect(calls).toEqual([]);
    },
  );

  it.each(INT64_GUARDED)(
    "[%s] %s refuses an already-rounded %s (2 ** 60) and asks for a bigint",
    async (_family, _member, field, call) => {
      const { ws, calls } = makeWorkspace();
      const error = await caught(() => call(ws, 2 ** 60));
      const coded = error as ParamValidationError;
      expect(coded.code).toBe("RL6_INVALID_ID");
      expect(coded.message).toContain(`Invalid ${field}:`);
      expect(coded.message).toContain("pass the id as a bigint");
      expect(calls).toEqual([]);
    },
  );

  it("covers every int-typed positional id on the facade (41 members + deleteLookupTables)", () => {
    const members = new Set(GUARDED.map(([, member]) => member));
    const int64Members = new Set(INT64_GUARDED.map(([, member]) => member));
    expect(members.size).toBe(38);
    expect(int64Members.size).toBe(4);
    expect([...members].some((member) => int64Members.has(member))).toBe(false);
  });

  it("the live-run shape: deleteAnnotation({annotation_id}) never builds `/annotations/[object Object]/`", async () => {
    const { ws, calls } = makeWorkspace();
    const error = await caught(() => ws.deleteAnnotation(BAD_ID));
    expect((error as ParamValidationError).code).toBe("RL6_INVALID_ID");
    expect(calls).toEqual([]);
  });

  it("a valid id passes through to the transport unchanged", async () => {
    const { ws, calls } = makeWorkspace();
    await ws.deleteAnnotation(2078447);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("/annotations/2078447/");
  });

  it.each([0, -1, 1.5, Number.NaN, "12" as unknown as number])(
    "getDashboard(%s) is rejected without a request",
    async (value) => {
      const { ws, calls } = makeWorkspace();
      const error = await caught(() => ws.getDashboard(value));
      expect((error as ParamValidationError).code).toBe("RL6_INVALID_ID");
      expect(calls).toEqual([]);
    },
  );
});
