// Layer-3 translation — 045-report-links (Python PR #223). Source:
// tests/unit/test_api_client_bookmark_urls.py (ALL classes):
// TestCreateBookmarkUrl, TestCreateBookmarkUrlErrors, TestGetBookmarkUrl,
// TestResolveShortLink. The methods under lock are the
// `services/entities/bookmark-urls.ts` members mixed into
// `createMixpanelClient`.
//
// Translation notes:
// - `httpx.MockTransport(handler)` → the injected-fetch `createMockClient`
//   analog (`client-test-helpers.ts`); `_short_link_client` (max_retries=0)
//   → `createMockClient(..., { maxRetries: 0 })`.
// - `patch("...time.sleep")` → the zero-delay `sleep` seam the helper
//   installs; `sleep.assert_called_once_with(2.0)` becomes an assertion on
//   the recorded ms sleeps (`[2000]`, R2.12 seconds→ms at the one seam).
// - Error MESSAGE text is out of contract: `str(exc) == ...` and
//   `"..." in str(exc)` asserts become class / `.code` / `.statusCode` /
//   `.details` / `.responseBody` asserts on the same inputs.
// - `httpx.ConnectError` → a fetch that rejects with a `TypeError`.
// - `caplog` → an injected `logger` (`MixpanelClientOptions.logger`)
//   capturing every warning line.
import { describe, expect, it } from "vitest";

import type { Session } from "../../src/auth/session.js";
import {
  APIError,
  AuthenticationError,
  MixpanelHeadlessError,
  QueryError,
  RateLimitError,
  ReportLinkNotFoundError,
  ServerError,
  ShortLinkResolutionError,
} from "../../src/errors.js";
import {
  type CannedResponse,
  type CapturedFetchRequest,
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

const SLUG = "EBrV5bW2u9Mw";
const PARAMS = {
  sections: { show: [] },
  displayOptions: { chartType: "line" },
};

/** The `test_credentials` fixture (US, project 12345). */
function testCredentials(): Session {
  return makeSession({
    username: "test_user",
    secret: "test_secret",
    projectId: "12345",
    region: "us",
  });
}

/** The `eu_credentials` fixture (EU, project 12345). */
function euCredentials(): Session {
  return makeSession({
    username: "test_user",
    secret: "test_secret",
    projectId: "12345",
    region: "eu",
  });
}

/**
 * Build a server slug record (`_record`).
 *
 * @param extra - Extra keys merged into the record.
 * @returns A dict shaped like a `bookmark-urls` result.
 */
function record(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: SLUG,
    type: "insights",
    params: PARAMS,
    project_id: 12345,
    created_at: "2026-09-02T10:00:00",
    ...extra,
  };
}

/** `URL.pathname` of a captured request (`request.url.path`). */
function pathOf(request: CapturedFetchRequest): string {
  return new URL(request.url).pathname;
}

describe("TestCreateBookmarkUrl", () => {
  it("test_posts_to_project_scoped_endpoint", async () => {
    const seen: CapturedFetchRequest[] = [];
    const { client } = createMockClient(testCredentials(), (request) => {
      seen.push(request);
      return { status: 200, json: { results: record() } };
    });
    await client.createBookmarkUrl({
      slug: SLUG,
      type: "insights",
      params: PARAMS,
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe("POST");
    expect(pathOf(seen[0]!)).toBe("/api/app/projects/12345/bookmark-urls/");
  });

  it("test_body_carries_required_and_optional_keys", async () => {
    const bodies: unknown[] = [];
    const { client } = createMockClient(testCredentials(), (request) => {
      bodies.push(JSON.parse(request.bodyText));
      return { status: 200, json: { results: record() } };
    });
    await client.createBookmarkUrl({
      slug: SLUG,
      type: "funnels",
      params: PARAMS,
      name: "Logins",
      description: "last 7 days",
      bookmark_id: 9,
    });

    expect(bodies).toStrictEqual([
      {
        slug: SLUG,
        type: "funnels",
        params: PARAMS,
        name: "Logins",
        description: "last 7 days",
        bookmark_id: 9,
      },
    ]);
  });

  it("test_body_never_contains_workspace_id", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const { client } = createMockClient(testCredentials(), (request) => {
      bodies.push(JSON.parse(request.bodyText) as Record<string, unknown>);
      return { status: 200, json: { results: record() } };
    });
    await client.createBookmarkUrl({
      slug: SLUG,
      type: "insights",
      params: {},
      workspace_id: 75,
    });

    expect(Object.hasOwn(bodies[0] ?? {}, "workspace_id")).toBe(false);
    expect(bodies[0]?.["slug"]).toBe(SLUG);
  });

  it("test_stays_project_scoped_with_pinned_workspace", async () => {
    const seen: string[] = [];
    const { client } = createMockClient(testCredentials(), (request) => {
      seen.push(pathOf(request));
      return { status: 200, json: { results: record() } };
    });
    client.setWorkspaceId(789);
    await client.createBookmarkUrl({
      slug: SLUG,
      type: "insights",
      params: {},
    });

    expect(seen).toStrictEqual(["/api/app/projects/12345/bookmark-urls/"]);
  });

  it("test_unwraps_results_envelope", async () => {
    const { client } = createMockClient(testCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: record() },
    }));
    const result = await client.createBookmarkUrl({
      slug: SLUG,
      type: "insights",
      params: {},
    });

    expect(result["slug"]).toBe(SLUG);
    expect(result["created_at"]).toBe("2026-09-02T10:00:00");
    expect(Object.hasOwn(result, "results")).toBe(false);
  });

  it("test_non_dict_result_raises", async () => {
    const { client } = createMockClient(testCredentials(), () => ({
      status: 200,
      json: { results: [1, 2] },
    }));
    const thrown = await client
      .createBookmarkUrl({ slug: SLUG, type: "insights", params: {} })
      .then(
        () => null,
        (error: unknown) => error,
      );
    // `match="create_bookmark_url"` is message text — the lock is
    // the class: a plain MixpanelHeadlessError, not an APIError.
    expect(thrown).toBeInstanceOf(MixpanelHeadlessError);
    expect(thrown).not.toBeInstanceOf(APIError);
  });
});

describe("TestCreateBookmarkUrlErrors", () => {
  it("test_400_duplicate_slug_is_query_error", async () => {
    const { client } = createMockClient(testCredentials(), () => ({
      status: 400,
      json: { error: "slug already exists" },
    }));
    const thrown = await client
      .createBookmarkUrl({ slug: SLUG, type: "insights", params: PARAMS })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(thrown).toBeInstanceOf(QueryError);
    const exc = thrown as QueryError;
    expect(exc.statusCode).toBe(400);
    // `"slug already exists" in str(exc)` → the server body is kept.
    expect(exc.responseBody).toStrictEqual({ error: "slug already exists" });
  });

  it("test_401_is_authentication_error", async () => {
    const { client } = createMockClient(testCredentials(), () => ({
      status: 401,
      json: { error: "nope" },
    }));
    await expect(
      client.createBookmarkUrl({
        slug: SLUG,
        type: "insights",
        params: PARAMS,
      }),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("test_429_after_retries_is_rate_limit_error", async () => {
    const seen: CapturedFetchRequest[] = [];
    const { client } = createMockClient(testCredentials(), (request) => {
      seen.push(request);
      return { status: 429, headers: { "Retry-After": "1" } };
    });
    await expect(
      client.createBookmarkUrl({
        slug: SLUG,
        type: "insights",
        params: PARAMS,
      }),
    ).rejects.toBeInstanceOf(RateLimitError);

    expect(seen).toHaveLength(client.core.maxRetries + 1);
  });
});

describe("TestGetBookmarkUrl", () => {
  it("test_gets_project_scoped_endpoint", async () => {
    const seen: CapturedFetchRequest[] = [];
    const { client } = createMockClient(testCredentials(), (request) => {
      seen.push(request);
      return { status: 200, json: { results: record() } };
    });
    const result = await client.getBookmarkUrl(SLUG);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe("GET");
    expect(pathOf(seen[0]!)).toBe(
      `/api/app/projects/12345/bookmark-urls/${SLUG}/`,
    );
    expect(result["slug"]).toBe(SLUG);
    expect(result["params"]).toStrictEqual(PARAMS);
  });

  it("test_stays_project_scoped_with_pinned_workspace", async () => {
    const seen: string[] = [];
    const { client } = createMockClient(testCredentials(), (request) => {
      seen.push(pathOf(request));
      return { status: 200, json: { results: record() } };
    });
    client.setWorkspaceId(789);
    await client.getBookmarkUrl(SLUG);

    expect(seen).toStrictEqual([
      `/api/app/projects/12345/bookmark-urls/${SLUG}/`,
    ]);
  });

  it("test_404_maps_to_report_link_not_found", async () => {
    const { client } = createMockClient(testCredentials(), () => ({
      status: 404,
      json: { error: "Not found" },
    }));
    const thrown = await client.getBookmarkUrl(SLUG).then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(ReportLinkNotFoundError);
    const exc = thrown as ReportLinkNotFoundError;
    expect(exc.code).toBe("REPORT_LINK_SLUG_NOT_FOUND");
    expect(exc.details["slug"]).toBe(SLUG);
    expect(exc.details["project_id"]).toBe(12345);
    expect(exc.details["region"]).toBe("us");
    // `str(exc) == ...` is message text; the cause chain is kept.
    expect(exc.cause).toBeInstanceOf(QueryError);
  });

  it("test_500_passes_through_as_server_error", async () => {
    const { client } = createMockClient(
      testCredentials(),
      () => ({ status: 500, json: { error: "boom" } }),
      { maxRetries: 0 },
    );
    await expect(client.getBookmarkUrl(SLUG)).rejects.toBeInstanceOf(
      ServerError,
    );
  });

  it("test_403_passes_through_as_query_error", async () => {
    const { client } = createMockClient(testCredentials(), () => ({
      status: 403,
      json: { error: "Permission denied" },
    }));
    const thrown = await client.getBookmarkUrl(SLUG).then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(QueryError);
    expect((thrown as QueryError).statusCode).toBe(403);
  });

  it("test_non_dict_result_raises", async () => {
    const { client } = createMockClient(testCredentials(), () => ({
      status: 200,
      json: { results: [] },
    }));
    const thrown = await client.getBookmarkUrl(SLUG).then(
      () => null,
      (error: unknown) => error,
    );
    // `match="get_bookmark_url"` is message text — see above.
    expect(thrown).toBeInstanceOf(MixpanelHeadlessError);
    expect(thrown).not.toBeInstanceOf(APIError);
  });
});

const CODE = "AbC123";
const TARGET = `https://mixpanel.com/project/12345/view/75/app/insights#${SLUG}`;

/**
 * Create a client for shortlink tests with retries disabled
 * (`_short_link_client`).
 *
 * @param credentials - The session to bind.
 * @param handler - The mock transport handler.
 * @returns The client plus the recorded sleeps.
 */
function shortLinkClient(
  credentials: Session,
  handler: (request: CapturedFetchRequest) => CannedResponse,
): ReturnType<typeof createMockClient> {
  return createMockClient(credentials, handler, { maxRetries: 0 });
}

/**
 * Await a rejection and return the thrown value (`pytest.raises` twin).
 *
 * @param promise - The call under test.
 * @returns The thrown value, or `null` when it resolved.
 */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

describe("TestResolveShortLink", () => {
  it("test_single_request_redirects_not_followed", async () => {
    const seen: CapturedFetchRequest[] = [];
    const { client } = shortLinkClient(testCredentials(), (request) => {
      seen.push(request);
      return { status: 302, headers: { Location: TARGET } };
    });
    const target = await client.resolveShortLink(CODE);

    expect(target).toBe(TARGET);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe("GET");
    expect(seen[0]?.url).toBe(`https://mixpanel.com/s/${CODE}`);
  });

  it("test_request_carries_authorization", async () => {
    const seen: CapturedFetchRequest[] = [];
    const { client } = shortLinkClient(testCredentials(), (request) => {
      seen.push(request);
      return { status: 302, headers: { Location: TARGET } };
    });
    await client.resolveShortLink(CODE);

    expect(seen[0]?.headers["authorization"]?.startsWith("Basic ")).toBe(true);
    expect(Object.hasOwn(seen[0]?.headers ?? {}, "user-agent")).toBe(true);
  });

  it("test_relative_location_is_joined", async () => {
    const { client } = shortLinkClient(testCredentials(), () => ({
      status: 302,
      headers: { Location: `/project/12345/app/insights#${SLUG}` },
    }));
    const target = await client.resolveShortLink(CODE);

    expect(target).toBe(
      `https://mixpanel.com/project/12345/app/insights#${SLUG}`,
    );
  });

  it.each([301, 303, 307, 308])(
    "test_other_redirect_statuses[%i]",
    async (status) => {
      const { client } = shortLinkClient(testCredentials(), () => ({
        status,
        headers: { Location: TARGET },
      }));
      await expect(client.resolveShortLink(CODE)).resolves.toBe(TARGET);
    },
  );

  it("test_login_redirect_is_authentication_error", async () => {
    const { client } = shortLinkClient(testCredentials(), () => ({
      status: 302,
      headers: { Location: `/login?next=/s/${CODE}` },
    }));
    const thrown = await rejectionOf(client.resolveShortLink(CODE));
    // `str(exc) == ...` is message text; the class is the lock.
    expect(thrown).toBeInstanceOf(AuthenticationError);
  });

  it("test_200_html_with_location_script", async () => {
    const escaped = TARGET.replaceAll("/", String.raw`\/`);
    const body =
      "<html><head><script>\n" +
      `  window.location.href = "${escaped}";\n` +
      "</script></head></html>";
    const { client } = shortLinkClient(testCredentials(), () => ({
      status: 200,
      text: body,
      headers: { "Content-Type": "text/html" },
    }));
    await expect(client.resolveShortLink(CODE)).resolves.toBe(TARGET);
  });

  it("test_200_without_script_is_unexpected_response", async () => {
    const { client } = shortLinkClient(testCredentials(), () => ({
      status: 200,
      text: "<html>hello</html>",
    }));
    const thrown = await rejectionOf(client.resolveShortLink(CODE));
    expect(thrown).toBeInstanceOf(ShortLinkResolutionError);
    const exc = thrown as ShortLinkResolutionError;
    expect(exc.code).toBe("SHORT_LINK_UNEXPECTED_RESPONSE");
    expect(exc.details["hint"]).toBe(
      "Open the shortlink in a browser and copy the full URL.",
    );
    expect(exc.details["short_code"]).toBe(CODE);
  });

  it("test_3xx_without_location", async () => {
    const { client } = shortLinkClient(testCredentials(), () => ({
      status: 302,
    }));
    const thrown = await rejectionOf(client.resolveShortLink(CODE));
    expect(thrown).toBeInstanceOf(ShortLinkResolutionError);
    const exc = thrown as ShortLinkResolutionError;
    expect(exc.code).toBe("SHORT_LINK_NO_LOCATION");
    expect(exc.details["status"]).toBe(302);
  });

  it("test_401", async () => {
    const { client } = shortLinkClient(testCredentials(), () => ({
      status: 401,
      json: { error: "nope" },
    }));
    await expect(client.resolveShortLink(CODE)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("test_404", async () => {
    const { client } = shortLinkClient(testCredentials(), () => ({
      status: 404,
      text: "Not found",
    }));
    const thrown = await rejectionOf(client.resolveShortLink(CODE));
    expect(thrown).toBeInstanceOf(ReportLinkNotFoundError);
    const exc = thrown as ReportLinkNotFoundError;
    expect(exc.code).toBe("SHORT_LINK_NOT_FOUND");
    expect(exc.details["short_code"]).toBe(CODE);
    expect(exc.details["host"]).toBe("mixpanel.com");
  });

  it("test_429", async () => {
    const seen: CapturedFetchRequest[] = [];
    const { client, sleeps } = shortLinkClient(testCredentials(), (request) => {
      seen.push(request);
      return { status: 429, headers: { "Retry-After": "7" } };
    });
    const thrown = await rejectionOf(client.resolveShortLink(CODE));
    expect(thrown).toBeInstanceOf(RateLimitError);
    expect((thrown as RateLimitError).retryAfter).toBe(7);
    expect(seen).toHaveLength(client.core.maxRetries + 1);
    expect(sleeps).toHaveLength(client.core.maxRetries);
  });

  it("test_429_then_redirect_retries_and_returns_target", async () => {
    const responses: CannedResponse[] = [
      { status: 429, headers: { "Retry-After": "2" } },
      { status: 302, headers: { Location: TARGET } },
    ];
    const { client, sleeps } = createMockClient(testCredentials(), () =>
      responses.shift()!,
    );
    const target = await client.resolveShortLink(CODE);

    expect(target).toBe(TARGET);
    // `sleep.assert_called_once_with(2.0)` — seconds→ms at the seam.
    expect(sleeps).toStrictEqual([2000]);
  });

  it("test_403_is_query_error", async () => {
    const { client } = shortLinkClient(testCredentials(), () => ({
      status: 403,
      json: { error: "forbidden" },
    }));
    const thrown = await rejectionOf(client.resolveShortLink(CODE));
    expect(thrown).toBeInstanceOf(QueryError);
    const exc = thrown as QueryError;
    expect(exc.statusCode).toBe(403);
    // `"forbidden" in str(exc)` → the server body is kept.
    expect(exc.responseBody).toStrictEqual({ error: "forbidden" });
  });

  it.each([
    `/login?next=/s/${CODE}`,
    "/login",
    "/login/",
    "https://mixpanel.com/login/",
  ])("test_login_paths_are_authentication_errors[%s]", async (location) => {
    const { client } = shortLinkClient(testCredentials(), () => ({
      status: 302,
      headers: { Location: location },
    }));
    await expect(client.resolveShortLink(CODE)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("test_login_prefix_lookalike_is_a_target", async () => {
    const { client } = shortLinkClient(testCredentials(), () => ({
      status: 302,
      headers: { Location: "/loginfoo" },
    }));
    await expect(client.resolveShortLink(CODE)).resolves.toBe(
      "https://mixpanel.com/loginfoo",
    );
  });

  it("test_200_script_with_non_json_escape_is_unexpected_response", async () => {
    const body = String.raw`window.location.href = "https://mixpanel.com/project/3\x3f";`;
    const { client } = shortLinkClient(testCredentials(), () => ({
      status: 200,
      text: body,
    }));
    const thrown = await rejectionOf(client.resolveShortLink(CODE));
    expect(thrown).toBeInstanceOf(ShortLinkResolutionError);
    const exc = thrown as ShortLinkResolutionError;
    expect(exc.code).toBe("SHORT_LINK_UNEXPECTED_RESPONSE");
    expect(exc.details["status"]).toBe(200);
    expect(exc.details["hint"]).toBe(
      "Open the shortlink in a browser and copy the full URL.",
    );
  });

  it("test_200_script_with_empty_href_is_unexpected_response", async () => {
    const { client } = shortLinkClient(testCredentials(), () => ({
      status: 200,
      text: 'window.location.href = "";',
    }));
    const thrown = await rejectionOf(client.resolveShortLink(CODE));
    expect(thrown).toBeInstanceOf(ShortLinkResolutionError);
    expect((thrown as ShortLinkResolutionError).code).toBe(
      "SHORT_LINK_UNEXPECTED_RESPONSE",
    );
  });

  it("test_200_script_relative_target_is_joined", async () => {
    const body = `window.location.href = "/project/12345/app/insights#${SLUG}";`;
    const { client } = shortLinkClient(testCredentials(), () => ({
      status: 200,
      text: body,
    }));
    const target = await client.resolveShortLink(CODE);

    expect(target).toBe(
      `https://mixpanel.com/project/12345/app/insights#${SLUG}`,
    );
  });

  it("test_200_script_login_target_is_authentication_error", async () => {
    const { client } = shortLinkClient(testCredentials(), () => ({
      status: 200,
      text: `window.location.href = "/login?next=/s/${CODE}";`,
    }));
    await expect(client.resolveShortLink(CODE)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("test_503", async () => {
    const { client } = shortLinkClient(testCredentials(), () => ({
      status: 503,
      text: "down",
    }));
    const thrown = await rejectionOf(client.resolveShortLink(CODE));
    expect(thrown).toBeInstanceOf(ServerError);
    expect((thrown as ServerError).statusCode).toBe(503);
  });

  it("test_other_4xx_is_unexpected_response", async () => {
    const { client } = shortLinkClient(testCredentials(), () => ({
      status: 418,
      text: "teapot",
    }));
    const thrown = await rejectionOf(client.resolveShortLink(CODE));
    expect(thrown).toBeInstanceOf(ShortLinkResolutionError);
    const exc = thrown as ShortLinkResolutionError;
    expect(exc.code).toBe("SHORT_LINK_UNEXPECTED_RESPONSE");
    // `"HTTP 418" in str(exc)` → the status is carried in details.
    expect(exc.details["status"]).toBe(418);
  });

  it("test_connect_error", async () => {
    const { client } = shortLinkClient(testCredentials(), () => {
      throw new TypeError("boom");
    });
    const thrown = await rejectionOf(client.resolveShortLink(CODE));
    expect(thrown).toBeInstanceOf(MixpanelHeadlessError);
    expect((thrown as MixpanelHeadlessError).code).toBe("HTTP_ERROR");
  });

  it("test_eu_session_hits_eu_host", async () => {
    const seen: string[] = [];
    const { client } = shortLinkClient(euCredentials(), (request) => {
      seen.push(request.url);
      return { status: 302, headers: { Location: TARGET } };
    });
    await client.resolveShortLink(CODE);

    expect(seen).toStrictEqual([`https://eu.mixpanel.com/s/${CODE}`]);
  });

  it("test_no_log_record_contains_authorization", async () => {
    const seen: CapturedFetchRequest[] = [];
    const records: string[] = [];
    const { client } = createMockClient(
      testCredentials(),
      (request) => {
        seen.push(request);
        return { status: 302, headers: { Location: TARGET } };
      },
      {
        maxRetries: 0,
        logger: {
          warning: (message: string): void => {
            records.push(message);
          },
        },
      },
    );
    await client.resolveShortLink(CODE);

    const authValue = seen[0]!.headers["authorization"]!;
    const secret = authValue.split(" ", 2)[1]!;
    for (const text of records) {
      expect(text.includes(authValue)).toBe(false);
      expect(text.includes(secret)).toBe(false);
      expect(text.includes("Authorization")).toBe(false);
    }
  });
});
