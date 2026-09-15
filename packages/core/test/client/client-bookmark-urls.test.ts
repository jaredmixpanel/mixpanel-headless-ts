// Bookmark-URL client methods: `createBookmarkUrl`, `getBookmarkUrl`,
// `resolveShortLink` (paths, bodies, error mapping, redirect handling).
// Mirrors tests/unit/test_api_client_bookmark_urls.py. Error message text is
// out of contract, so `str(exc)` asserts become class / `.code` / `.details`
// asserts; `time.sleep` seconds become the recorded ms sleeps (`[2000]`).

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

describe("Create bookmark URL", () => {
  // python: TestCreateBookmarkUrl
  it("posts to project scoped endpoint", async () => {
    // python: test_posts_to_project_scoped_endpoint
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

  it("body carries required and optional keys", async () => {
    // python: test_body_carries_required_and_optional_keys
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

  it("body never contains workspace ID", async () => {
    // python: test_body_never_contains_workspace_id
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

  it("stays project scoped with pinned workspace", async () => {
    // python: test_stays_project_scoped_with_pinned_workspace
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

  it("unwraps results envelope", async () => {
    // python: test_unwraps_results_envelope
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

  it("non dict result raises", async () => {
    // python: test_non_dict_result_raises
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

describe("Create bookmark URL errors", () => {
  // python: TestCreateBookmarkUrlErrors
  it("400 duplicate slug is query error", async () => {
    // python: test_400_duplicate_slug_is_query_error
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

  it("401 is authentication error", async () => {
    // python: test_401_is_authentication_error
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

  it("429 after retries is rate limit error", async () => {
    // python: test_429_after_retries_is_rate_limit_error
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

describe("Get bookmark URL", () => {
  // python: TestGetBookmarkUrl
  it("gets project scoped endpoint", async () => {
    // python: test_gets_project_scoped_endpoint
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

  it("stays project scoped with pinned workspace", async () => {
    // python: test_stays_project_scoped_with_pinned_workspace
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

  it("404 maps to report link not found", async () => {
    // python: test_404_maps_to_report_link_not_found
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

  it("500 passes through as server error", async () => {
    // python: test_500_passes_through_as_server_error
    const { client } = createMockClient(
      testCredentials(),
      () => ({ status: 500, json: { error: "boom" } }),
      { maxRetries: 0 },
    );
    await expect(client.getBookmarkUrl(SLUG)).rejects.toBeInstanceOf(
      ServerError,
    );
  });

  it("403 passes through as query error", async () => {
    // python: test_403_passes_through_as_query_error
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

  it("non dict result raises", async () => {
    // python: test_non_dict_result_raises
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

describe("Resolve short link", () => {
  // python: TestResolveShortLink
  it("single request redirects not followed", async () => {
    // python: test_single_request_redirects_not_followed
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

  it("request carries authorization", async () => {
    // python: test_request_carries_authorization
    const seen: CapturedFetchRequest[] = [];
    const { client } = shortLinkClient(testCredentials(), (request) => {
      seen.push(request);
      return { status: 302, headers: { Location: TARGET } };
    });
    await client.resolveShortLink(CODE);

    expect(seen[0]?.headers["authorization"]?.startsWith("Basic ")).toBe(true);
    expect(Object.hasOwn(seen[0]?.headers ?? {}, "user-agent")).toBe(true);
  });

  it("relative location is joined", async () => {
    // python: test_relative_location_is_joined
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
    "other redirect statuses[%i]", // python: test_other_redirect_statuses
    async (status) => {
      const { client } = shortLinkClient(testCredentials(), () => ({
        status,
        headers: { Location: TARGET },
      }));
      await expect(client.resolveShortLink(CODE)).resolves.toBe(TARGET);
    },
  );

  it("login redirect is authentication error", async () => {
    // python: test_login_redirect_is_authentication_error
    const { client } = shortLinkClient(testCredentials(), () => ({
      status: 302,
      headers: { Location: `/login?next=/s/${CODE}` },
    }));
    const thrown = await rejectionOf(client.resolveShortLink(CODE));
    // `str(exc) == ...` is message text; the class is the lock.
    expect(thrown).toBeInstanceOf(AuthenticationError);
  });

  it("200 HTML with location script", async () => {
    // python: test_200_html_with_location_script
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

  it("200 without script is unexpected response", async () => {
    // python: test_200_without_script_is_unexpected_response
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

  it("3xx without location", async () => {
    // python: test_3xx_without_location
    const { client } = shortLinkClient(testCredentials(), () => ({
      status: 302,
    }));
    const thrown = await rejectionOf(client.resolveShortLink(CODE));
    expect(thrown).toBeInstanceOf(ShortLinkResolutionError);
    const exc = thrown as ShortLinkResolutionError;
    expect(exc.code).toBe("SHORT_LINK_NO_LOCATION");
    expect(exc.details["status"]).toBe(302);
  });

  it("401", async () => {
    // python: test_401
    const { client } = shortLinkClient(testCredentials(), () => ({
      status: 401,
      json: { error: "nope" },
    }));
    await expect(client.resolveShortLink(CODE)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("404", async () => {
    // python: test_404
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

  it("429", async () => {
    // python: test_429
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

  it("429 then redirect retries and returns target", async () => {
    // python: test_429_then_redirect_retries_and_returns_target
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

  it("403 is query error", async () => {
    // python: test_403_is_query_error
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
  ])("login paths are authentication errors[%s]", async (location) => {
    // python: test_login_paths_are_authentication_errors
    const { client } = shortLinkClient(testCredentials(), () => ({
      status: 302,
      headers: { Location: location },
    }));
    await expect(client.resolveShortLink(CODE)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("login prefix lookalike is a target", async () => {
    // python: test_login_prefix_lookalike_is_a_target
    const { client } = shortLinkClient(testCredentials(), () => ({
      status: 302,
      headers: { Location: "/loginfoo" },
    }));
    await expect(client.resolveShortLink(CODE)).resolves.toBe(
      "https://mixpanel.com/loginfoo",
    );
  });

  it("200 script with non JSON escape is unexpected response", async () => {
    // python: test_200_script_with_non_json_escape_is_unexpected_response
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

  it("200 script with empty href is unexpected response", async () => {
    // python: test_200_script_with_empty_href_is_unexpected_response
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

  it("200 script relative target is joined", async () => {
    // python: test_200_script_relative_target_is_joined
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

  it("200 script login target is authentication error", async () => {
    // python: test_200_script_login_target_is_authentication_error
    const { client } = shortLinkClient(testCredentials(), () => ({
      status: 200,
      text: `window.location.href = "/login?next=/s/${CODE}";`,
    }));
    await expect(client.resolveShortLink(CODE)).rejects.toBeInstanceOf(
      AuthenticationError,
    );
  });

  it("503", async () => {
    // python: test_503
    const { client } = shortLinkClient(testCredentials(), () => ({
      status: 503,
      text: "down",
    }));
    const thrown = await rejectionOf(client.resolveShortLink(CODE));
    expect(thrown).toBeInstanceOf(ServerError);
    expect((thrown as ServerError).statusCode).toBe(503);
  });

  it("other 4xx is unexpected response", async () => {
    // python: test_other_4xx_is_unexpected_response
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

  it("connect error", async () => {
    // python: test_connect_error
    const { client } = shortLinkClient(testCredentials(), () => {
      throw new TypeError("boom");
    });
    const thrown = await rejectionOf(client.resolveShortLink(CODE));
    expect(thrown).toBeInstanceOf(MixpanelHeadlessError);
    expect((thrown as MixpanelHeadlessError).code).toBe("HTTP_ERROR");
  });

  it("EU session hits EU host", async () => {
    // python: test_eu_session_hits_eu_host
    const seen: string[] = [];
    const { client } = shortLinkClient(euCredentials(), (request) => {
      seen.push(request.url);
      return { status: 302, headers: { Location: TARGET } };
    });
    await client.resolveShortLink(CODE);

    expect(seen).toStrictEqual([`https://eu.mixpanel.com/s/${CODE}`]);
  });

  it("no log record contains authorization", async () => {
    // python: test_no_log_record_contains_authorization
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
