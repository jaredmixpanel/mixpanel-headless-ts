// Layer-3 translation — Phase-3 packet B4-C5 sign_replays METHOD locks.
// Source: tests/unit/_internal/test_api_client_sign_replays.py,
// TestSignReplaysRequest ONLY (:51-142). Header exclusion (packet C5
// §Layer-3 scope): TestSensitiveDataMapping (:150),
// TestSensitiveData403BodyShapes (FIX-2, bug (c)), and
// TestOtherHttpErrors lock the B0 `handleResponse` 403 branch
// and were translated at B0 against `client/internals.ts` — see
// `context/phase3/design/b0-review-assertions.md`; the C5 R10.9
// harness re-exercises that matrix through the REAL method.
import { describe, expect, it } from "vitest";

import type { Session } from "../../src/auth/session.js";
import { toNativeJson } from "../../src/client/json-value.js";
import {
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** The `us_credentials` fixture twin (:29-37 — service account, US). */
function usCredentials(): Session {
  return makeSession({
    username: "test_user",
    secret: "test_secret",
    projectId: "12345",
    region: "us",
  });
}

/** Parse a captured JSON request body (json.loads(request.content)). */
function parseBody(bodyText: string): unknown {
  return JSON.parse(bodyText) as unknown;
}

describe("TestSignReplaysRequest", () => {
  it("test_posts_to_bulk_endpoint", async () => {
    const captured: { method?: string; url?: string } = {};
    const { client } = createMockClient(usCredentials(), (request) => {
      captured.method = request.method;
      captured.url = request.url;
      return { status: 200, json: { results: [] } };
    });
    await client.signReplays(["r-1"], "prod");
    expect(captured.method).toBe("POST");
    expect(captured.url).toContain(
      "https://mixpanel.com/api/app/projects/12345/replays/sign/bulk",
    );
  });

  it("test_request_body_shape", async () => {
    const captured: { body?: unknown } = {};
    const { client } = createMockClient(usCredentials(), (request) => {
      captured.body = parseBody(request.bodyText);
      return { status: 200, json: { results: [] } };
    });
    await client.signReplays(["r-1", "r-2"], "prod");
    expect(captured.body).toEqual({
      replays: [
        { replay_id: "r-1", replay_env: "prod" },
        { replay_id: "r-2", replay_env: "prod" },
      ],
    });
  });

  it("test_request_body_propagates_env_dev", async () => {
    const captured: { body?: Record<string, Array<Record<string, unknown>>> } =
      {};
    const { client } = createMockClient(usCredentials(), (request) => {
      captured.body = parseBody(request.bodyText) as Record<
        string,
        Array<Record<string, unknown>>
      >;
      return { status: 200, json: { results: [] } };
    });
    await client.signReplays(["r-1"], "dev");
    expect(captured.body?.["replays"]?.[0]?.["replay_env"]).toBe("dev");
  });

  it("test_returns_raw_results_list", async () => {
    const responseResults = [
      {
        replay_id: "r-1",
        url: "https://cdn.mxpnl.com/srr-us/sha-12345/",
        query_string: "URLPrefix=A&Expires=1&KeyName=K&Signature=S",
      },
      {
        replay_id: "r-2",
        url: "https://cdn.mxpnl.com/srr-us/sha2-12345/",
        query_string: "URLPrefix=B&Expires=2&KeyName=K&Signature=S",
      },
    ];
    const { client } = createMockClient(usCredentials(), () => ({
      status: 200,
      json: { results: responseResults },
    }));
    const result = toNativeJson(
      await client.signReplays(["r-1", "r-2"], "prod"),
    );
    expect(result).toEqual(responseResults);
  });

  it("test_default_env_is_prod", async () => {
    const captured: { body?: Record<string, Array<Record<string, unknown>>> } =
      {};
    const { client } = createMockClient(usCredentials(), (request) => {
      captured.body = parseBody(request.bodyText) as Record<
        string,
        Array<Record<string, unknown>>
      >;
      return { status: 200, json: { results: [] } };
    });
    await client.signReplays(["r-1"]);
    expect(captured.body?.["replays"]?.[0]?.["replay_env"]).toBe("prod");
  });
});
