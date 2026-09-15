// ReplaysService: sign(), the fetch_files CDN walker (ordering, 404
// termination, 403 re-sign, credential redaction, mobile detection) and
// discover() / events_for() parsing. Mirrors all nine classes of
// tests/unit/_internal/test_replays_service.py. The real client runs over a
// canned transport, CDN GETs use the injected `fetchImpl`, warnings a sink.
import { describe, expect, it } from "vitest";

import {
  MixpanelHeadlessError,
  ReplayNotFoundError,
  SignedURLExpiredError,
  UnsupportedReplayFormatError,
} from "../../src/errors.js";
import type { WarningSink } from "../../src/services/discovery.js";
import { ReplaysService } from "../../src/services/replays.js";
import { SignedReplay } from "../../src/types/results/replay-models.js";
import {
  type CannedHandler,
  type CannedResponse,
  type CapturedFetchRequest,
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** A CDN handler that may also throw (the transport-error path). */
type CdnHandler = (url: string) => CannedResponse;

/**
 * The `_mock_api_client` fixture — a real client over a canned App-API
 * transport, so `api.sign_replays` asserts read the captured POST bodies.
 *
 * @param options - `projectId` (default `"12345"`) and the
 *   `signResponse` served by `POST /replays/sign/bulk`.
 * @returns The client plus the sign-call capture log.
 */
function mockApiClient(
  options: {
    projectId?: string;
    signResponse?: () => unknown;
  } = {},
): {
  client: ReturnType<typeof createMockClient>["client"];
  signCalls: CapturedFetchRequest[];
} {
  const signCalls: CapturedFetchRequest[] = [];
  const handler: CannedHandler = (request) => {
    if (request.url.includes("/replays/sign/bulk")) {
      signCalls.push(request);
      return { status: 200, json: options.signResponse?.() ?? [] };
    }
    return { status: 404, json: { error: "unexpected app call" } };
  };
  const { client } = createMockClient(
    makeSession({ projectId: options.projectId ?? "12345" }),
    handler,
  );
  return { client, signCalls };
}

/**
 * Build a `SignedReplay` pointing at the fake CDN host used in the
 * fixtures (`_signed`, `test_replays_service.py`).
 *
 * @param replayId - The replay id (default `"r-1"`).
 * @param env - The environment (default `"prod"`).
 * @returns The signed handle.
 */
function signedFixture(
  replayId = "r-1",
  env: "prod" | "dev" = "prod",
): SignedReplay {
  return new SignedReplay({
    replay_id: replayId,
    url: `https://cdn.test/srr-us/sha-${replayId}/`,
    query_string: "URLPrefix=A&Expires=1&KeyName=K&Signature=S",
    env,
    signed_at: 1716810000.0,
  });
}

/**
 * Build a minimal rrweb-shaped event (`_rrweb_event`,
 * `test_replays_service.py`).
 *
 * @param timestamp - Unix ms.
 * @param type_ - The rrweb type discriminator (default `3`).
 * @returns The event dict.
 */
function rrwebEvent(timestamp: number, type_ = 3): Record<string, unknown> {
  return { type: type_, data: {}, timestamp };
}

/**
 * Pull the NNNN file index out of a CDN URL (`_parse_file_num`,
 * `test_replays_service.py`).
 *
 * @param url - The full CDN URL.
 * @returns The parsed file number.
 */
function parseFileNum(url: string): number {
  const path = new URL(url).pathname;
  const last = path.slice(path.lastIndexOf("/") + 1);
  return Number(last.slice(0, last.indexOf("-")));
}

/**
 * Turn a CDN handler into an injected fetch (the `_async_transport`
 * seam).
 *
 * @param handler - Receives the URL, returns the canned response, or
 *   throws a `TypeError` for the `httpx.ConnectError` analog.
 * @returns The fetch implementation.
 */
function cdnFetch(handler: CdnHandler): typeof fetch {
  return (input: string | URL | Request): Promise<Response> => {
    let url: string;
    if (typeof input === "string") {
      url = input;
    } else if (input instanceof URL) {
      url = input.href;
    } else {
      url = input.url;
    }
    const canned = handler(url);
    const headers = new Headers(canned.headers ?? {});
    let body: string | null = null;
    if (canned.json !== undefined) {
      body = JSON.stringify(canned.json);
      headers.set("content-type", "application/json");
    } else if (canned.text !== undefined) {
      body = canned.text;
    }
    return Promise.resolve(
      new Response(body, { status: canned.status, headers }),
    );
  };
}

/**
 * Build a CDN handler that serves file fixtures (`_make_cdn_handler`,
 * `test_replays_service.py`).
 *
 * @param options - `fileContents` (file number → events, or `null` for
 *   404), `files403`, and an optional `callLog`.
 * @returns The handler.
 */
function makeCdnHandler(
  options: {
    fileContents?: ReadonlyMap<
      number,
      ReadonlyArray<Record<string, unknown>> | null
    >;
    files403?: ReadonlySet<number>;
    callLog?: number[];
  } = {},
): CdnHandler {
  const fileContents = options.fileContents ?? new Map();
  const files403 = options.files403 ?? new Set<number>();
  return (url) => {
    const fileNum = parseFileNum(url);
    options.callLog?.push(fileNum);
    if (files403.has(fileNum)) {
      return { status: 403, text: "signature expired" };
    }
    const contents = fileContents.get(fileNum);
    if (contents === undefined || contents === null) {
      return { status: 404 };
    }
    return { status: 200, json: contents };
  };
}

// =============================================================================
// sign()
// =============================================================================

describe("sign wraps the client call in SignedReplay objects", () => {
  // python: TestSignWrapping
  it("sign returns list of signed replay", async () => {
    // python: test_sign_returns_list_of_signed_replay
    const { client, signCalls } = mockApiClient({
      signResponse: () => [
        {
          replay_id: "r-1",
          url: "https://cdn.test/srr-us/sha-1/",
          query_string: "URLPrefix=A&Signature=X",
        },
        {
          replay_id: "r-2",
          url: "https://cdn.test/srr-us/sha-2/",
          query_string: "URLPrefix=B&Signature=Y",
        },
      ],
    });
    const service = new ReplaysService(client);

    const result = await service.sign(["r-1", "r-2"], "prod");

    expect(result).toHaveLength(2);
    expect(result.every((r) => r instanceof SignedReplay)).toBe(true);
    expect(result[0]?.replay_id).toBe("r-1");
    expect(result[1]?.replay_id).toBe("r-2");
    expect(result[0]?.env).toBe("prod");
    expect(result[0]?.signed_at).toBeGreaterThan(0);
    // `api.sign_replays.assert_called_once_with(["r-1","r-2"], env="prod")`
    // — the ported client's request body is the observable twin.
    expect(signCalls).toHaveLength(1);
    expect(JSON.parse(signCalls[0]?.bodyText ?? "")).toStrictEqual({
      replays: [
        { replay_id: "r-1", replay_env: "prod" },
        { replay_id: "r-2", replay_env: "prod" },
      ],
    });
  });
});

// =============================================================================
// fetch_files() — the CDN walker
// =============================================================================

describe("buffered fetch concatenates + sorts", () => {
  // python: TestFetchFilesHappyPath
  it("returns timestamp sorted events", async () => {
    // python: test_returns_timestamp_sorted_events
    const fileContents = new Map<
      number,
      ReadonlyArray<Record<string, unknown>> | null
    >([
      [0, [rrwebEvent(20), rrwebEvent(10)]],
      [1, [rrwebEvent(40), rrwebEvent(30)]],
      [2, null], // 404 → end of replay
    ]);
    const { client } = mockApiClient();
    const service = new ReplaysService(client, {
      fetchImpl: cdnFetch(makeCdnHandler({ fileContents })),
    });

    const events = await service.fetchFiles(signedFixture(), {
      retentionDays: 30,
      maxFiles: 500,
      concurrency: 50,
    });

    expect(events.map((e) => e["timestamp"])).toStrictEqual([10, 20, 30, 40]);
  });

  it("uses correct file naming", async () => {
    // python: test_uses_correct_file_naming
    const callLog: number[] = [];
    const fileContents = new Map<
      number,
      ReadonlyArray<Record<string, unknown>> | null
    >([
      [0, [rrwebEvent(10)]],
      [1, [rrwebEvent(20)]],
      [2, null],
    ]);
    const { client } = mockApiClient();
    const service = new ReplaysService(client, {
      fetchImpl: cdnFetch(makeCdnHandler({ fileContents, callLog })),
    });

    await service.fetchFiles(signedFixture(), {
      retentionDays: 30,
      maxFiles: 500,
      concurrency: 1,
    });
    // Sequential walk stops the moment file 2 returns 404.
    expect([...callLog].sort((a, b) => a - b)).toStrictEqual([0, 1, 2]);
  });

  it("respects max files bound", async () => {
    // python: test_respects_max_files_bound
    const fileContents = new Map<
      number,
      ReadonlyArray<Record<string, unknown>> | null
    >();
    for (let n = 0; n < 200; n += 1) {
      fileContents.set(n, [rrwebEvent(n * 10)]);
    }
    const callLog: number[] = [];
    const { client } = mockApiClient();
    const service = new ReplaysService(client, {
      fetchImpl: cdnFetch(makeCdnHandler({ fileContents, callLog })),
    });

    const events = await service.fetchFiles(signedFixture(), {
      retentionDays: 30,
      maxFiles: 10,
      concurrency: 4,
    });

    expect(events).toHaveLength(10);
    expect(Math.max(...callLog)).toBe(9);
  });
});

describe("404 termination semantics", () => {
  // python: TestFetchFilesTermination
  it("first file 404 raises replay not found", async () => {
    // python: test_first_file_404_raises_replay_not_found
    const { client } = mockApiClient();
    const service = new ReplaysService(client, {
      fetchImpl: cdnFetch(makeCdnHandler()),
    });

    let caught: unknown;
    try {
      await service.fetchFiles(signedFixture(), {
        retentionDays: 30,
        maxFiles: 500,
        concurrency: 50,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ReplayNotFoundError);
    const exc = caught as ReplayNotFoundError;
    expect(exc.details["replay_id"]).toBe("r-1");
    expect(exc.details["retention_days"]).toBe(30);
    expect(String(exc.details["cdn_url_prefix"]).endsWith("/")).toBe(true);
  });

  it("mid walk 404 terminates cleanly", async () => {
    // python: test_mid_walk_404_terminates_cleanly
    const fileContents = new Map<
      number,
      ReadonlyArray<Record<string, unknown>> | null
    >([
      [0, [rrwebEvent(10)]],
      [1, [rrwebEvent(20)]],
      [2, [rrwebEvent(30)]],
      // file 3 absent → 404
    ]);
    const { client } = mockApiClient();
    const service = new ReplaysService(client, {
      fetchImpl: cdnFetch(makeCdnHandler({ fileContents })),
    });

    const events = await service.fetchFiles(signedFixture(), {
      retentionDays: 30,
      maxFiles: 500,
      concurrency: 50,
    });
    expect(events.map((e) => e["timestamp"])).toStrictEqual([10, 20, 30]);
  });
});

describe("403 re-sign retry", () => {
  // python: TestFetchFiles403Retry
  it("403 with re sign succeeds after resign", async () => {
    // python: test_403_with_re_sign_succeeds_after_resign
    const state = { resigned: false };
    const signCalls: CapturedFetchRequest[] = [];
    const handler: CannedHandler = (request) => {
      if (request.url.includes("/replays/sign/bulk")) {
        signCalls.push(request);
        state.resigned = true;
        return {
          status: 200,
          json: [
            {
              replay_id: "r-1",
              url: "https://cdn.test/srr-us/sha-1/",
              query_string: "URLPrefix=Z&Signature=NEW",
            },
          ],
        };
      }
      return { status: 404, json: { error: "unexpected app call" } };
    };
    const { client } = createMockClient(makeSession(), handler);
    const service = new ReplaysService(client, {
      fetchImpl: cdnFetch((url) => {
        const fileNum = parseFileNum(url);
        if (fileNum >= 2) {
          return { status: 404 };
        }
        if (!state.resigned) {
          return { status: 403, text: "signature expired" };
        }
        return { status: 200, json: [rrwebEvent(fileNum * 10)] };
      }),
    });

    const events = await service.fetchFiles(signedFixture(), {
      retentionDays: 30,
      maxFiles: 500,
      concurrency: 50,
      reSignOnExpiry: true,
    });
    // Re-sign was called exactly once.
    expect(signCalls).toHaveLength(1);
    // After re-sign we got the events for files 0 and 1.
    expect(events.map((e) => e["timestamp"])).toStrictEqual([0, 10]);
  });

  it("403 without re sign raises expired", async () => {
    // python: test_403_without_re_sign_raises_expired
    const { client, signCalls } = mockApiClient();
    const service = new ReplaysService(client, {
      fetchImpl: cdnFetch(makeCdnHandler({ files403: new Set([0]) })),
    });

    let caught: unknown;
    try {
      await service.fetchFiles(signedFixture(), {
        retentionDays: 30,
        maxFiles: 500,
        concurrency: 50,
        reSignOnExpiry: false,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SignedURLExpiredError);
    const exc = caught as SignedURLExpiredError;
    expect(exc.details["replay_id"]).toBe("r-1");
    expect(Object.hasOwn(exc.details, "signed_at")).toBe(true);
    expect(Object.hasOwn(exc.details, "expired_at")).toBe(true);
    expect(signCalls).toHaveLength(0);
  });
});

describe("credential redaction on transport errors", () => {
  // python: TestFetchFilesCredentialRedaction
  it("transport error redacts signed credential", async () => {
    // python: test_transport_error_redacts_signed_credential
    const signed = signedFixture();
    const { client } = mockApiClient();
    const service = new ReplaysService(client, {
      // A fetch rejection is the `httpx.ConnectError` analog (the client
      // normalizes it to MixpanelHttpError); the message embeds the
      // credentialed URL exactly as httpx's does.
      fetchImpl: (input: string | URL | Request): Promise<Response> => {
        const url = input instanceof Request ? input.url : String(input);
        return Promise.reject(new TypeError(`connection failed for ${url}`));
      },
    });

    let caught: unknown;
    try {
      await service.fetchFiles(signed, {
        retentionDays: 30,
        maxFiles: 500,
        concurrency: 50,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MixpanelHeadlessError);
    const message = (caught as MixpanelHeadlessError).message;
    expect(message).not.toContain(signed.query_string);
    expect(message).toContain("<redacted>");
  });
});

// =============================================================================
// Mobile-replay detection
// =============================================================================

describe("mobile-replay detection", () => {
  // python: TestMobileReplayDetection
  it("non rrweb first event raises unsupported format", async () => {
    // python: test_non_rrweb_first_event_raises_unsupported_format
    const fileContents = new Map<
      number,
      ReadonlyArray<Record<string, unknown>> | null
    >([
      [0, [{ mobile_event: "tap", ts: 1716810000 }]],
      [1, null],
    ]);
    const { client } = mockApiClient();
    const service = new ReplaysService(client, {
      fetchImpl: cdnFetch(makeCdnHandler({ fileContents })),
    });

    let caught: unknown;
    try {
      await service.fetchFiles(signedFixture(), {
        retentionDays: 30,
        maxFiles: 500,
        concurrency: 50,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnsupportedReplayFormatError);
    const exc = caught as UnsupportedReplayFormatError;
    expect(exc.message).toContain("mobile session");
    expect(exc.details["replay_id"]).toBe(signedFixture().replay_id);
    expect(exc.details["format"]).toBe("non-rrweb");
  });
});

// =============================================================================
// discover() — no query_fn
// =============================================================================

describe("discover without query_fn", () => {
  // python: TestDiscoverNoQueryFn
  it("raises without query fn", async () => {
    // python: test_raises_without_query_fn
    const { client } = mockApiClient();
    const service = new ReplaysService(client); // no queryFn
    let caught: unknown;
    try {
      await service.discover({
        distinctId: "u-1",
        fromDate: "2026-05-20",
        toDate: "2026-05-27",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MixpanelHeadlessError);
    expect((caught as MixpanelHeadlessError).code).toBe(
      "REPLAYS_QUERY_FN_REQUIRED",
    );
    expect((caught as MixpanelHeadlessError).message).toContain("query_fn");
  });

  it("empty replay IDs returns empty", async () => {
    // python: test_empty_replay_ids_returns_empty
    const { client } = mockApiClient();
    const calls: unknown[] = [];
    const service = new ReplaysService(client, {
      queryFn: (events, options) => {
        calls.push([events, options]);
        return Promise.resolve({ series: {} });
      },
    });
    const result = await service.discover({ replayIds: [] });
    expect(result).toStrictEqual([]);
    expect(calls).toHaveLength(0);
  });
});

// =============================================================================
// discover() / events_for() parsing against the REAL Insights series
// =============================================================================

/** `_DISCOVERY_SERIES`. */
const DISCOVERY_SERIES: Record<string, unknown> = {
  "Session Recording Checkpoint [Minimum Time]": {
    $overall: { all: 1779319127 },
    "rid-aaa": {
      $overall: { all: 1779322882 },
      "30": { all: 1779322882 },
    },
    "rid-bbb": {
      $overall: { all: 1779332317 },
      "7": { all: 1779332317 },
    },
  },
};

/** `_DISCOVERY_SERIES_NO_RETENTION`. */
const DISCOVERY_SERIES_NO_RETENTION: Record<string, unknown> = {
  "Session Recording Checkpoint [Minimum Time]": {
    $overall: { all: 1779319127 },
    "rid-old": { $overall: { all: 1779319127 } },
  },
};

/** `_EVENTS_SERIES`. */
const EVENTS_SERIES: Record<string, unknown> = {
  "All Events [Total Events]": {
    $overall: { all: 13 },
    "2026-05-21T16:31:31": {
      $overall: { all: 1 },
      $mp_dead_click: {
        $overall: { all: 1 },
        "rid-bab": { all: 1 },
      },
    },
    "2026-05-21T16:31:25": {
      $overall: { all: 12 },
      "Browser API fetch": {
        $overall: { all: 12 },
        "rid-bab": { all: 12 },
      },
    },
  },
};

/** `_EVENTS_SERIES_WITH_PROP`. */
const EVENTS_SERIES_WITH_PROP: Record<string, unknown> = {
  "All Events [Total Events]": {
    $overall: { all: 1 },
    "2026-05-21T16:31:25": {
      $overall: { all: 1 },
      "Browser API fetch": {
        $overall: { all: 1 },
        "rid-bab": {
          $overall: { all: 1 },
          Chrome: { all: 1 },
        },
      },
    },
  },
};

/** One recorded `queryFn` invocation. */
interface QueryCall {
  readonly events: string;
  readonly options: Readonly<Record<string, unknown>>;
}

/**
 * Build a service whose `queryFn` returns a canned series
 * (`_series_result`, `test_replays_service.py`).
 *
 * @param series - The `result.series` payload.
 * @param options - `projectId` and the optional warning sink.
 * @returns The service plus the query-call log.
 */
function serviceWithSeries(
  series: Record<string, unknown>,
  options: { projectId?: string; warn?: WarningSink } = {},
): { service: ReplaysService; calls: QueryCall[] } {
  const { client } = mockApiClient(
    options.projectId === undefined ? {} : { projectId: options.projectId },
  );
  const calls: QueryCall[] = [];
  const service = new ReplaysService(client, {
    queryFn: (events, queryOptions) => {
      calls.push({ events, options: queryOptions });
      return Promise.resolve({ series });
    },
    ...(options.warn === undefined ? {} : { warn: options.warn }),
  });
  return { service, calls };
}

describe("discover parses the min-time series", () => {
  // python: TestDiscoverParsing
  it("one summary per replay", async () => {
    // python: test_one_summary_per_replay
    const { service } = serviceWithSeries(DISCOVERY_SERIES, {
      projectId: "3",
    });
    const out = await service.discover({
      distinctId: "u-1",
      fromDate: "2026-05-20",
      toDate: "2026-05-27",
    });
    const byId = new Map(out.map((s) => [s.replay_id, s]));
    expect(new Set(byId.keys())).toStrictEqual(new Set(["rid-aaa", "rid-bbb"]));
    expect(byId.get("rid-aaa")?.retention_days).toBe(30);
    expect(byId.get("rid-bbb")?.retention_days).toBe(7);
    // Leaf is unix seconds; start_time is unix ms.
    expect(byId.get("rid-aaa")?.start_time).toBe(1779322882 * 1000);
    expect(byId.get("rid-aaa")?.distinct_id).toBe("u-1");
    expect(byId.get("rid-aaa")?.project_id).toBe(3);
  });

  it("query uses min time aggregation", async () => {
    // python: test_query_uses_min_time_aggregation
    const { service, calls } = serviceWithSeries(DISCOVERY_SERIES);
    await service.discover({
      distinctId: "u-1",
      fromDate: "2026-05-20",
      toDate: "2026-05-27",
    });
    const kwargs = calls[0]?.options ?? {};
    expect(kwargs["math"]).toBe("min");
    expect(kwargs["math_property"]).toBe("$time");
    expect(kwargs["group_by"]).toStrictEqual([
      "$mp_replay_id",
      "$mp_replay_retention_period",
    ]);
  });

  it("missing retention defaults 30 with warning", async () => {
    // python: test_missing_retention_defaults_30_with_warning
    const warnings: string[] = [];
    const { service } = serviceWithSeries(DISCOVERY_SERIES_NO_RETENTION, {
      warn: (message) => {
        warnings.push(message);
      },
    });
    const out = await service.discover({
      distinctId: "u-1",
      fromDate: "2026-05-20",
      toDate: "2026-05-27",
    });
    expect(
      warnings.some((w) => w.includes("$mp_replay_retention_period")),
    ).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0]?.retention_days).toBe(30);
    expect(out[0]?.start_time).toBe(1779319127 * 1000);
  });

  it("empty series returns empty", async () => {
    // python: test_empty_series_returns_empty
    const { service } = serviceWithSeries({});
    await expect(
      service.discover({
        distinctId: "u-1",
        fromDate: "2026-05-20",
        toDate: "2026-05-27",
      }),
    ).resolves.toStrictEqual([]);
  });

  it("nonstandard retention defaults 30 with warning", async () => {
    // python: test_nonstandard_retention_defaults_30_with_warning
    const warnings: string[] = [];
    const series: Record<string, unknown> = {
      "Session Recording Checkpoint [Minimum Time]": {
        $overall: { all: 1779319127 },
        "rid-weird": {
          $overall: { all: 1779322882 },
          "15": { all: 1779322882 },
        },
      },
    };
    const { service } = serviceWithSeries(series, {
      warn: (message) => {
        warnings.push(message);
      },
    });
    const out = await service.discover({
      distinctId: "u-1",
      fromDate: "2026-05-20",
      toDate: "2026-05-27",
    });
    expect(
      warnings.some((w) => w.includes("$mp_replay_retention_period")),
    ).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0]?.retention_days).toBe(30);
    expect(out[0]?.start_time).toBe(1779322882 * 1000);
  });

  it("limit caps summaries", async () => {
    // python: test_limit_caps_summaries
    const { service } = serviceWithSeries(DISCOVERY_SERIES);
    const out = await service.discover({
      distinctId: "u-1",
      fromDate: "2026-05-20",
      toDate: "2026-05-27",
      limit: 1,
    });
    expect(out).toHaveLength(1);
  });

  it("default window is 90 day lookback", async () => {
    // python: test_default_window_is_90_day_lookback
    const { service, calls } = serviceWithSeries({});
    await service.discover({ replayIds: ["rid-aaa"] });
    const kwargs = calls[0]?.options ?? {};
    expect(kwargs["last"]).toBe(90);
    expect(Object.hasOwn(kwargs, "from_date")).toBe(false);
    expect(Object.hasOwn(kwargs, "to_date")).toBe(false);
  });

  it("explicit window overrides lookback", async () => {
    // python: test_explicit_window_overrides_lookback
    const { service, calls } = serviceWithSeries(DISCOVERY_SERIES);
    await service.discover({
      distinctId: "u-1",
      fromDate: "2026-05-20",
      toDate: "2026-05-27",
    });
    const kwargs = calls[0]?.options ?? {};
    expect(kwargs["from_date"]).toBe("2026-05-20");
    expect(kwargs["to_date"]).toBe("2026-05-27");
    expect(Object.hasOwn(kwargs, "last")).toBe(false);
  });

  it("missing retention warning has no doubled prefix", async () => {
    // python: test_missing_retention_warning_has_no_doubled_prefix
    const warnings: string[] = [];
    const { service } = serviceWithSeries(DISCOVERY_SERIES_NO_RETENTION, {
      warn: (text) => {
        warnings.push(text);
      },
    });
    await service.discover({
      distinctId: "u-1",
      fromDate: "2026-05-20",
      toDate: "2026-05-27",
    });
    const message = warnings[0] ?? "";
    expect(message.startsWith("UserWarning:")).toBe(false);
    expect(message.startsWith("replay ")).toBe(true);
  });
});

describe("events_for parses the $all_events series", () => {
  // python: TestEventsForParsing
  it("returns time sorted events per replay", async () => {
    // python: test_returns_time_sorted_events_per_replay
    const { service } = serviceWithSeries(EVENTS_SERIES);
    const out = await service.eventsFor(["rid-bab"]);
    expect(new Set(out.keys())).toStrictEqual(new Set(["rid-bab"]));
    const events = out.get("rid-bab") ?? [];
    expect(events.map((e) => e.event_name)).toStrictEqual([
      "Browser API fetch",
      "$mp_dead_click",
    ]);
    expect(events[0]?.event_time).toBeLessThan(events[1]?.event_time ?? 0);
  });

  it("event properties surface", async () => {
    // python: test_event_properties_surface
    const { service } = serviceWithSeries(EVENTS_SERIES_WITH_PROP);
    const out = await service.eventsFor(["rid-bab"], {
      eventProperties: ["$browser"],
    });
    expect(out.get("rid-bab")?.[0]?.properties).toStrictEqual({
      $browser: "Chrome",
    });
  });

  it("issues all events query shape", async () => {
    // python: test_issues_all_events_query_shape
    const { service, calls } = serviceWithSeries(EVENTS_SERIES);
    await service.eventsFor(["rid-bab"]);
    expect(calls[0]?.events).toBe("$all_events");
    expect(
      (calls[0]?.options["group_by"] as readonly string[]).slice(0, 3),
    ).toStrictEqual(["$time", "$event_name", "$mp_replay_id"]);
  });

  it("empty series returns empty dict", async () => {
    // python: test_empty_series_returns_empty_dict
    const { service } = serviceWithSeries({});
    expect((await service.eventsFor(["rid-bab"])).size).toBe(0);
  });

  it("default window is 90 day lookback", async () => {
    // python: test_default_window_is_90_day_lookback
    const { service, calls } = serviceWithSeries({});
    await service.eventsFor(["rid-bab"]);
    const kwargs = calls[0]?.options ?? {};
    expect(kwargs["last"]).toBe(90);
    expect(Object.hasOwn(kwargs, "from_date")).toBe(false);
    expect(Object.hasOwn(kwargs, "to_date")).toBe(false);
  });

  it("explicit window overrides lookback", async () => {
    // python: test_explicit_window_overrides_lookback
    const { service, calls } = serviceWithSeries({});
    await service.eventsFor(["rid-bab"], {
      fromDate: "2026-05-20",
      toDate: "2026-05-21",
    });
    const kwargs = calls[0]?.options ?? {};
    expect(kwargs["from_date"]).toBe("2026-05-20");
    expect(kwargs["to_date"]).toBe("2026-05-21");
    expect(Object.hasOwn(kwargs, "last")).toBe(false);
  });
});

// =============================================================================
// Additive (no Python twin): the walker's per-file sort key is Python
// `int(e.get("timestamp", 0))` — an ABSENT
// key defaults to 0, an explicit `null` raises `TypeError` (CPython
// probe), and `sorted(key=...)` computes the key even for single-element
// files, where a bare JS comparator would never run.
// =============================================================================

describe("walker per-file sort key: null vs absent timestamps", () => {
  it("an explicit null timestamp in a single-event file raises TypeError", async () => {
    const fileContents = new Map<
      number,
      ReadonlyArray<Record<string, unknown>> | null
    >([
      [0, [{ type: 3, data: {}, timestamp: null }]],
      [1, null],
    ]);
    const { client } = mockApiClient();
    const service = new ReplaysService(client, {
      fetchImpl: cdnFetch(makeCdnHandler({ fileContents })),
    });

    await expect(
      service.fetchFiles(signedFixture(), {
        retentionDays: 30,
        maxFiles: 500,
        concurrency: 50,
      }),
    ).rejects.toThrow(
      /int\(\) argument must be a string, a bytes-like object or a real number, not 'NoneType'/,
    );
  });

  it("an absent timestamp key defaults to 0 and sorts first", async () => {
    const fileContents = new Map<
      number,
      ReadonlyArray<Record<string, unknown>> | null
    >([
      [0, [rrwebEvent(20), { type: 3, data: {} }]],
      [1, null],
    ]);
    const { client } = mockApiClient();
    const service = new ReplaysService(client, {
      fetchImpl: cdnFetch(makeCdnHandler({ fileContents })),
    });

    const events = await service.fetchFiles(signedFixture(), {
      retentionDays: 30,
      maxFiles: 500,
      concurrency: 50,
    });
    expect(events.map((e) => e["timestamp"])).toStrictEqual([undefined, 20]);
  });
});
