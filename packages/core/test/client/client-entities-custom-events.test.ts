// Layer-3 translation — Phase-3 packet B4-C5 data-governance locks.
// Source: tests/unit/test_api_client_data_governance.py (ALL classes —
// lexicon definitions/tags/metadata/history/export, custom properties,
// drop filters, lookup tables incl. upload/download wiring, custom
// events incl. the form-body + envelope-peeling + echo-mismatch
// branches, and the error-path classes).
import { describe, expect, it } from "vitest";

import type { Session } from "../../src/auth/session.js";
import { toNativeJson } from "../../src/client/json-value.js";
import { MixpanelHeadlessError, QueryError } from "../../src/errors.js";
import {
  createMockClient,
  makeSession,
  parseBody,
} from "../../test-support/client-test-helpers.js";

/** The `oauth_credentials` fixture twin. */
function oauthCredentials(): Session {
  return makeSession({
    projectId: "12345",
    region: "us",
    oauthToken: "test-oauth-token",
  });
}

/** `urllib.parse.parse_qs` analog over a form-encoded body. */
function parseQs(bodyText: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, value] of new URLSearchParams(bodyText)) {
    (out[key] ??= []).push(value);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Custom Events — create / update / delete
// ---------------------------------------------------------------------------

describe("Create custom event", () => {
  // python: TestCreateCustomEvent
  it("posts form encoded body", async () => {
    // python: test_posts_form_encoded_body
    const captured: Array<{
      method: string;
      url: string;
      contentType: string;
      bodyText: string;
    }> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push({
        method: request.method,
        url: request.url,
        contentType: request.headers["content-type"] ?? "",
        bodyText: request.bodyText,
      });
      return {
        status: 200,
        json: {
          custom_event: {
            id: 99,
            name: "Page View",
            alternatives: [{ event: "Home" }],
          },
        },
      };
    });
    const result = toNativeJson(
      await client.createCustomEvent({
        name: "Page View",
        alternatives: '[{"event": "Home"}]',
      }),
    ) as Record<string, unknown>;
    const req = captured[0];
    expect(req?.method).toBe("POST");
    expect(req?.url.split("?", 1)[0]?.endsWith("/custom_events/")).toBe(true);
    expect(
      req?.contentType.startsWith("application/x-www-form-urlencoded"),
    ).toBe(true);
    const body = parseQs(req?.bodyText ?? "");
    expect(body["name"]).toStrictEqual(["Page View"]);
    expect(JSON.parse(body["alternatives"]?.[0] ?? "")).toStrictEqual([
      { event: "Home" },
    ]);
    expect(result["id"]).toBe(99);
    expect(result["name"]).toBe("Page View");
  });

  it("unwraps custom event envelope", async () => {
    // python: test_unwraps_custom_event_envelope
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { custom_event: { id: 1, name: "X", alternatives: [] } },
    }));
    const result = toNativeJson(
      await client.createCustomEvent({ name: "X", alternatives: "[]" }),
    );
    expect(result).toStrictEqual({ id: 1, name: "X", alternatives: [] });
  });

  it("unwraps results then custom event envelope", async () => {
    // python: test_unwraps_results_then_custom_event_envelope
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        results: { custom_event: { id: 2, name: "Y", alternatives: [] } },
      },
    }));
    const result = toNativeJson(
      await client.createCustomEvent({ name: "Y", alternatives: "[]" }),
    ) as Record<string, unknown>;
    expect(result["id"]).toBe(2);
    expect(result["name"]).toBe("Y");
  });

  it("uses maybe scoped path project default", async () => {
    // python: test_uses_maybe_scoped_path_project_default
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { custom_event: { id: 1, name: "X", alternatives: [] } },
      };
    });
    await client.createCustomEvent({ name: "X", alternatives: "[]" });
    expect(capturedUrls[0]).toContain("/projects/12345/custom_events/");
  });

  it("workspace scoped path when workspace ID set", async () => {
    // python: test_workspace_scoped_path_when_workspace_id_set
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { custom_event: { id: 1, name: "X", alternatives: [] } },
      };
    });
    client.setWorkspaceId(77);
    await client.createCustomEvent({ name: "X", alternatives: "[]" });
    expect(capturedUrls[0]).toContain("/workspaces/77/custom_events/");
  });

  it("400 raises query error", async () => {
    // python: test_400_raises_query_error
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 400,
      json: { error: "duplicate name" },
    }));
    await expect(
      client.createCustomEvent({ name: "X", alternatives: "[]" }),
    ).rejects.toBeInstanceOf(QueryError);
  });

  it("422 raises query error with form body in context", async () => {
    // python: test_422_raises_query_error_with_form_body_in_context
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 422,
      json: { error: "alternative not found" },
    }));
    let caught: unknown;
    try {
      await client.createCustomEvent({
        name: "X",
        alternatives: '[{"event": "Unknown"}]',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(QueryError);
    // Form-body callers should still get the form payload echoed in
    // the exception so debugging the rejected request is possible.
    expect((caught as QueryError).details["request_body"]).toStrictEqual({
      name: "X",
      alternatives: '[{"event": "Unknown"}]',
    });
  });

  it("non dict response raises mixpanel headless error", async () => {
    // python: test_non_dict_response_raises_mixpanel_headless_error
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: [1, 2, 3],
    }));
    await expect(
      client.createCustomEvent({ name: "X", alternatives: "[]" }),
    ).rejects.toBeInstanceOf(MixpanelHeadlessError);
  });

  it("non JSON response raises mixpanel headless error", async () => {
    // python: test_non_json_response_raises_mixpanel_headless_error
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      text: "not json at all",
    }));
    let caught: unknown;
    try {
      await client.createCustomEvent({ name: "X", alternatives: "[]" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MixpanelHeadlessError);
    expect((caught as MixpanelHeadlessError).code).toBe("INVALID_RESPONSE");
    const message = (caught as MixpanelHeadlessError).message;
    expect(message).toContain("POST");
    expect(message).toContain("/custom_events/");
  });

  it("retries on 429", async () => {
    // python: test_retries_on_429
    const attempts: number[] = [];
    const { client } = createMockClient(oauthCredentials(), () => {
      attempts.push(1);
      if (attempts.length === 1) {
        return {
          status: 429,
          headers: { "Retry-After": "0" },
          json: { error: "rate limited" },
        };
      }
      return {
        status: 200,
        json: { custom_event: { id: 1, name: "X", alternatives: [] } },
      };
    });
    const result = toNativeJson(
      await client.createCustomEvent({ name: "X", alternatives: "[]" }),
    ) as Record<string, unknown>;
    expect(attempts).toHaveLength(2); // one retry then success
    expect(result["id"]).toBe(1);
  });

  it("wraps httpx transport error", async () => {
    // python: test_wraps_httpx_transport_error
    const { client } = createMockClient(oauthCredentials(), () => {
      throw new TypeError("connection refused");
    });
    await expect(
      client.createCustomEvent({ name: "X", alternatives: "[]" }),
    ).rejects.toBeInstanceOf(MixpanelHeadlessError);
  });
});

describe("Update custom event", () => {
  // python: TestUpdateCustomEvent
  it("patch body uses custom event ID not name", async () => {
    // python: test_patch_body_uses_custom_event_id_not_name
    const capturedBodies: Array<Record<string, unknown>> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedBodies.push(
        parseBody(request.bodyText) as Record<string, unknown>,
      );
      return {
        status: 200,
        json: { status: "ok", results: { id: 1, name: "X" } },
      };
    });
    await client.updateCustomEvent(2044168, { description: "Updated" });
    expect(capturedBodies[0]?.["customEventId"]).toBe(2044168);
    expect(Object.keys(capturedBodies[0] ?? {})).not.toContain("name");
  });

  it("422 raises query error", async () => {
    // python: test_422_raises_query_error
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 422,
      json: { error: "unknown customEventId" },
    }));
    await expect(
      client.updateCustomEvent(999999999, { description: "X" }),
    ).rejects.toBeInstanceOf(QueryError);
  });

  it("returns target mismatch when response ID differs", async () => {
    // python: test_returns_target_mismatch_when_response_id_differs
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: { id: 1, name: "X", customEventId: 99999 },
      },
    }));
    let caught: unknown;
    try {
      await client.updateCustomEvent(2044168, { description: "X" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MixpanelHeadlessError);
    expect((caught as MixpanelHeadlessError).code).toBe(
      "UPDATE_TARGET_MISMATCH",
    );
    expect((caught as MixpanelHeadlessError).message).toContain("99999");
    expect((caught as MixpanelHeadlessError).message).toContain("2044168");
  });

  it("returns dict when response ID matches", async () => {
    // python: test_returns_dict_when_response_id_matches
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: { id: 1, name: "X", customEventId: 2044168 },
      },
    }));
    const result = toNativeJson(
      await client.updateCustomEvent(2044168, { description: "X" }),
    ) as Record<string, unknown>;
    expect(result["customEventId"]).toBe(2044168);
  });
});

describe("Delete custom event", () => {
  // python: TestDeleteCustomEvent
  it("body uses custom event ID not name", async () => {
    // python: test_body_uses_custom_event_id_not_name
    const captured: Array<[string, Record<string, unknown>]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([
        request.method,
        parseBody(request.bodyText) as Record<string, unknown>,
      ]);
      return { status: 200, json: { status: "ok" } };
    });
    await client.deleteCustomEvent(2044168);
    expect(captured[0]?.[0]).toBe("DELETE");
    expect(captured[0]?.[1]["customEventId"]).toBe(2044168);
    expect(Object.keys(captured[0]?.[1] ?? {})).not.toContain("name");
  });

  it("uses maybe scoped path project default", async () => {
    // python: test_uses_maybe_scoped_path_project_default
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok" } };
    });
    await client.deleteCustomEvent(42);
    expect(capturedUrls[0]).toContain(
      "/projects/12345/data-definitions/events/",
    );
  });

  it("workspace scoped path when workspace ID set", async () => {
    // python: test_workspace_scoped_path_when_workspace_id_set
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok" } };
    });
    client.setWorkspaceId(77);
    await client.deleteCustomEvent(42);
    expect(capturedUrls[0]).toContain(
      "/workspaces/77/data-definitions/events/",
    );
  });

  it("404 raises query error", async () => {
    // python: test_404_raises_query_error
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 404,
      json: { error: "not found" },
    }));
    await expect(client.deleteCustomEvent(999999999)).rejects.toBeInstanceOf(
      QueryError,
    );
  });
});
