// Layer-3 translation — Phase-3 packet B4-C4 experiment locks.
// Source: tests/unit/test_api_client_experiments.py (ALL classes —
// experiment CRUD, lifecycle launch/conclude/decide, management
// archive/restore/duplicate, ERF listing, 400/404 error paths).
import { describe, expect, it } from "vitest";

import type { Session } from "../../src/auth/session.js";
import { toNativeJson } from "../../src/client/json-value.js";
import { APIError } from "../../src/errors.js";
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

describe("List experiments", () => {
  // python: TestListExperiments
  it("returns experiment list", async () => {
    // python: test_returns_experiment_list
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [
          { id: "abc-123", name: "Experiment A" },
          { id: "def-456", name: "Experiment B" },
        ],
      },
    }));
    const result = toNativeJson(await client.listExperiments()) as Array<
      Record<string, unknown>
    >;
    expect(result).toHaveLength(2);
    expect(result[0]?.["id"]).toBe("abc-123");
    expect(result[1]?.["name"]).toBe("Experiment B");
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listExperiments();
    expect(capturedUrls[0]).toContain("/projects/12345/experiments");
  });

  it("empty result", async () => {
    // python: test_empty_result
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [] },
    }));
    const result = await client.listExperiments();
    expect(result).toStrictEqual([]);
  });

  it("include archived", async () => {
    // python: test_include_archived
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listExperiments({ include_archived: true });
    expect(capturedUrls[0]).toContain("include_archived=true");
  });
});

describe("Create experiment", () => {
  // python: TestCreateExperiment
  it("creates experiment", async () => {
    // python: test_creates_experiment
    const captured: Array<[string, string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, request.url, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: { id: "new-123", name: "New Experiment" },
        },
      };
    });
    const result = toNativeJson(
      await client.createExperiment({ name: "New Experiment" }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("POST");
    expect(captured[0]?.[2]).toStrictEqual({ name: "New Experiment" });
    expect(result["id"]).toBe("new-123");
  });

  it("uses trailing slash", async () => {
    // python: test_uses_trailing_slash
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { id: "new-123", name: "X" } },
      };
    });
    await client.createExperiment({ name: "X" });
    // The URL should end with experiments/ (trailing slash).
    const path = (capturedUrls[0] ?? "").split("?", 1)[0] ?? "";
    expect(path.endsWith("experiments/")).toBe(true);
  });
});

describe("Get experiment", () => {
  // python: TestGetExperiment
  it("gets experiment by ID", async () => {
    // python: test_gets_experiment_by_id
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { id: "xyz-456", name: "Test" } },
      };
    });
    const result = toNativeJson(
      await client.getExperiment("xyz-456"),
    ) as Record<string, unknown>;
    expect(capturedUrls[0]).toContain("/experiments/xyz-456");
    expect(result["id"]).toBe("xyz-456");
  });

  it("not found", async () => {
    // python: test_not_found
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 404,
      json: { status: "error", error: "Not found" },
    }));
    await expect(client.getExperiment("nonexistent-id")).rejects.toBeInstanceOf(
      APIError,
    );
  });
});

describe("Update experiment", () => {
  // python: TestUpdateExperiment
  it("updates experiment", async () => {
    // python: test_updates_experiment
    const captured: Array<[string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: { status: "ok", results: { id: "xyz-456", name: "Updated" } },
      };
    });
    const result = toNativeJson(
      await client.updateExperiment("xyz-456", { name: "Updated" }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("PATCH");
    expect(result["name"]).toBe("Updated");
  });

  it("URL contains experiment ID", async () => {
    // python: test_url_contains_experiment_id
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: { id: "xyz-456", name: "X" } },
      };
    });
    await client.updateExperiment("xyz-456", { name: "X" });
    expect(capturedUrls[0]).toContain("/experiments/xyz-456");
  });
});

describe("Delete experiment", () => {
  // python: TestDeleteExperiment
  it("deletes experiment", async () => {
    // python: test_deletes_experiment
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 204 };
    });
    await client.deleteExperiment("xyz-456");
    expect(capturedMethods[0]).toBe("DELETE");
  });

  it("URL contains experiment ID", async () => {
    // python: test_url_contains_experiment_id
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 204 };
    });
    await client.deleteExperiment("xyz-456");
    expect(capturedUrls[0]).toContain("/experiments/xyz-456");
  });
});

describe("Launch experiment", () => {
  // python: TestLaunchExperiment
  it("launches experiment", async () => {
    // python: test_launches_experiment
    const captured: Array<[string, string]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, request.url]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: { id: "xyz-456", name: "Test", status: "active" },
        },
      };
    });
    const result = toNativeJson(
      await client.launchExperiment("xyz-456"),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("PUT");
    expect(captured[0]?.[1]).toContain("/experiments/xyz-456/launch");
    expect(result["status"]).toBe("active");
  });

  it("launch non draft raises error", async () => {
    // python: test_launch_non_draft_raises_error
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 400,
      json: {
        status: "error",
        error: "Experiment must be in draft state to launch",
      },
    }));
    await expect(client.launchExperiment("xyz-456")).rejects.toBeInstanceOf(
      APIError,
    );
  });
});

describe("Conclude experiment", () => {
  // python: TestConcludeExperiment
  it("concludes experiment", async () => {
    // python: test_concludes_experiment
    const captured: Array<[string, string]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, request.url]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: { id: "xyz-456", name: "Test", status: "concluded" },
        },
      };
    });
    const result = toNativeJson(
      await client.concludeExperiment("xyz-456"),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("PUT");
    expect(captured[0]?.[1]).toContain("/experiments/xyz-456/force_conclude");
    expect(result["status"]).toBe("concluded");
  });

  it("concludes with params", async () => {
    // python: test_concludes_with_params
    const capturedBodies: unknown[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedBodies.push(parseBody(request.bodyText));
      return {
        status: 200,
        json: {
          status: "ok",
          results: { id: "xyz-456", name: "Test", status: "concluded" },
        },
      };
    });
    await client.concludeExperiment("xyz-456", { end_date: "2026-04-01" });
    expect(capturedBodies[0]).toStrictEqual({ end_date: "2026-04-01" });
  });

  it("concludes without params sends empty body", async () => {
    // python: test_concludes_without_params_sends_empty_body
    const capturedBodies: unknown[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedBodies.push(
        request.bodyText ? parseBody(request.bodyText) : null,
      );
      return {
        status: 200,
        json: {
          status: "ok",
          results: { id: "xyz-456", name: "Test", status: "concluded" },
        },
      };
    });
    await client.concludeExperiment("xyz-456");
    const body = capturedBodies[0];
    expect(
      (typeof body === "object" &&
        body !== null &&
        Object.keys(body).length === 0) ||
        body === null,
    ).toBe(true);
  });

  it("conclude non active raises error", async () => {
    // python: test_conclude_non_active_raises_error
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 400,
      json: {
        status: "error",
        error: "Experiment must be active to conclude",
      },
    }));
    await expect(client.concludeExperiment("xyz-456")).rejects.toBeInstanceOf(
      APIError,
    );
  });
});

describe("Decide experiment", () => {
  // python: TestDecideExperiment
  it("decides experiment", async () => {
    // python: test_decides_experiment
    const captured: Array<[string, string, Record<string, unknown>]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([
        request.method,
        request.url,
        parseBody(request.bodyText) as Record<string, unknown>,
      ]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: { id: "xyz-456", name: "Test", status: "success" },
        },
      };
    });
    const result = toNativeJson(
      await client.decideExperiment("xyz-456", {
        success: true,
        variant: "treatment",
      }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("PATCH");
    expect(captured[0]?.[1]).toContain("/experiments/xyz-456/decide");
    expect(captured[0]?.[2]["success"]).toBe(true);
    expect(result["status"]).toBe("success");
  });

  it("decide non concluded raises error", async () => {
    // python: test_decide_non_concluded_raises_error
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 400,
      json: {
        status: "error",
        error: "Experiment must be concluded to decide",
      },
    }));
    await expect(
      client.decideExperiment("xyz-456", { success: true }),
    ).rejects.toBeInstanceOf(APIError);
  });
});

describe("Archive experiment", () => {
  // python: TestArchiveExperiment
  it("archives experiment", async () => {
    // python: test_archives_experiment
    const captured: Array<[string, string]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, request.url]);
      return { status: 204 };
    });
    await client.archiveExperiment("xyz-456");
    expect(captured[0]?.[0]).toBe("POST");
    expect(captured[0]?.[1]).toContain("/experiments/xyz-456/archive");
  });
});

describe("Restore experiment", () => {
  // python: TestRestoreExperiment
  it("restores experiment", async () => {
    // python: test_restores_experiment
    const captured: Array<[string, string]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, request.url]);
      return {
        status: 200,
        json: { status: "ok", results: { id: "xyz-456", name: "Restored" } },
      };
    });
    const result = toNativeJson(
      await client.restoreExperiment("xyz-456"),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("DELETE");
    expect(captured[0]?.[1]).toContain("/experiments/xyz-456/archive");
    expect(result["id"]).toBe("xyz-456");
  });
});

describe("Duplicate experiment", () => {
  // python: TestDuplicateExperiment
  it("duplicates experiment", async () => {
    // python: test_duplicates_experiment
    const captured: Array<[string, string, unknown]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([request.method, request.url, parseBody(request.bodyText)]);
      return {
        status: 200,
        json: {
          status: "ok",
          results: { id: "dup-789", name: "Copy of Test" },
        },
      };
    });
    const result = toNativeJson(
      await client.duplicateExperiment("xyz-456", { name: "Copy of Test" }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("POST");
    expect(captured[0]?.[1]).toContain("/experiments/xyz-456/duplicate");
    expect(captured[0]?.[2]).toStrictEqual({ name: "Copy of Test" });
    expect(result["id"]).toBe("dup-789");
  });
});

describe("List erf experiments", () => {
  // python: TestListErfExperiments
  it("lists erf experiments", async () => {
    // python: test_lists_erf_experiments
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: {
          status: "ok",
          results: [{ id: "erf-1", name: "ERF Experiment" }],
        },
      };
    });
    const result = toNativeJson(await client.listErfExperiments()) as Array<
      Record<string, unknown>
    >;
    expect(capturedUrls[0]).toContain("/experiments/erf/");
    expect(result).toHaveLength(1);
    expect(result[0]?.["id"]).toBe("erf-1");
  });

  it("uses get method", async () => {
    // python: test_uses_get_method
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listErfExperiments();
    expect(capturedMethods[0]).toBe("GET");
  });
});
