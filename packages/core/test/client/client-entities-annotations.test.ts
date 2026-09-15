// Layer-3 translation — Phase-3 packet B4-C4 annotation locks.
// Source: tests/unit/test_api_client_annotations.py (ALL classes —
// annotation CRUD + annotation tags list/create).
import { describe, expect, it } from "vitest";

import type { Session } from "../../src/auth/session.js";
import { toNativeJson } from "../../src/client/json-value.js";
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

/** The `_annotation_result` helper twin. */
function annotationResult(
  id = 1,
  description = "Test annotation",
): Record<string, unknown> {
  return {
    id,
    project_id: 12345,
    date: "2026-03-31",
    description,
    tags: [],
  };
}

/** The `_tag_result` helper twin. */
function tagResult(id = 1, name = "releases"): Record<string, unknown> {
  return { id, name };
}

describe("List annotations", () => {
  // python: TestListAnnotations
  it("returns annotation list", async () => {
    // python: test_returns_annotation_list
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [annotationResult(1, "First"), annotationResult(2, "Second")],
      },
    }));
    const result = toNativeJson(await client.listAnnotations()) as Array<
      Record<string, unknown>
    >;
    expect(result).toHaveLength(2);
    expect(result[0]?.["id"]).toBe(1);
    expect(result[1]?.["description"]).toBe("Second");
  });

  it("uses maybe scoped path", async () => {
    // python: test_uses_maybe_scoped_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listAnnotations();
    expect(capturedUrls[0]).toContain("/annotations/");
  });

  it("from date camel case", async () => {
    // python: test_from_date_camel_case
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listAnnotations({ from_date: "2026-01-01" });
    expect(capturedUrls[0]).toContain("fromDate=2026-01-01");
  });

  it("to date camel case", async () => {
    // python: test_to_date_camel_case
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listAnnotations({ to_date: "2026-03-31" });
    expect(capturedUrls[0]).toContain("toDate=2026-03-31");
  });

  it("tags filter", async () => {
    // python: test_tags_filter
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listAnnotations({ tags: [1, 2] });
    const url = capturedUrls[0] ?? "";
    expect(url).toContain("tags=");
    expect(url).toContain("1");
    expect(url).toContain("2");
  });

  it("empty result", async () => {
    // python: test_empty_result
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [] },
    }));
    const result = await client.listAnnotations();
    expect(result).toStrictEqual([]);
  });

  it("uses get method", async () => {
    // python: test_uses_get_method
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listAnnotations();
    expect(capturedMethods[0]).toBe("GET");
  });
});

describe("Create annotation", () => {
  // python: TestCreateAnnotation
  it("creates annotation", async () => {
    // python: test_creates_annotation
    const captured: Array<[string, Record<string, unknown>]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([
        request.method,
        parseBody(request.bodyText) as Record<string, unknown>,
      ]);
      return {
        status: 200,
        json: { status: "ok", results: annotationResult(1, "New annotation") },
      };
    });
    const result = toNativeJson(
      await client.createAnnotation({
        date: "2026-03-31",
        description: "New annotation",
      }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("POST");
    expect(captured[0]?.[1]["description"]).toBe("New annotation");
    expect(result["id"]).toBe(1);
  });

  it("URL path", async () => {
    // python: test_url_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: annotationResult() },
      };
    });
    await client.createAnnotation({ date: "2026-03-31", description: "X" });
    expect(capturedUrls[0]).toContain("/annotations/");
  });
});

describe("Get annotation", () => {
  // python: TestGetAnnotation
  it("gets annotation by ID", async () => {
    // python: test_gets_annotation_by_id
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: annotationResult(42, "Found") },
      };
    });
    const result = toNativeJson(await client.getAnnotation(42)) as Record<
      string,
      unknown
    >;
    expect(capturedUrls[0]).toContain("/annotations/42/");
    expect(result["id"]).toBe(42);
  });

  it("uses get method", async () => {
    // python: test_uses_get_method
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return {
        status: 200,
        json: { status: "ok", results: annotationResult() },
      };
    });
    await client.getAnnotation(1);
    expect(capturedMethods[0]).toBe("GET");
  });
});

describe("Update annotation", () => {
  // python: TestUpdateAnnotation
  it("updates annotation", async () => {
    // python: test_updates_annotation
    const captured: Array<[string, Record<string, unknown>]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([
        request.method,
        parseBody(request.bodyText) as Record<string, unknown>,
      ]);
      return {
        status: 200,
        json: { status: "ok", results: annotationResult(42, "Updated") },
      };
    });
    const result = toNativeJson(
      await client.updateAnnotation(42, { description: "Updated" }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("PATCH");
    expect(captured[0]?.[1]["description"]).toBe("Updated");
    expect(result["description"]).toBe("Updated");
  });

  it("URL path", async () => {
    // python: test_url_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return {
        status: 200,
        json: { status: "ok", results: annotationResult() },
      };
    });
    await client.updateAnnotation(42, { description: "X" });
    expect(capturedUrls[0]).toContain("/annotations/42/");
  });
});

describe("Delete annotation", () => {
  // python: TestDeleteAnnotation
  it("deletes annotation", async () => {
    // python: test_deletes_annotation
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 204 };
    });
    await client.deleteAnnotation(42);
    expect(capturedMethods[0]).toBe("DELETE");
  });

  it("URL path", async () => {
    // python: test_url_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 204 };
    });
    await client.deleteAnnotation(42);
    expect(capturedUrls[0]).toContain("/annotations/42/");
  });
});

describe("List annotation tags", () => {
  // python: TestListAnnotationTags
  it("returns tag list", async () => {
    // python: test_returns_tag_list
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: {
        status: "ok",
        results: [tagResult(1, "releases"), tagResult(2, "deployments")],
      },
    }));
    const result = toNativeJson(await client.listAnnotationTags()) as Array<
      Record<string, unknown>
    >;
    expect(result).toHaveLength(2);
    expect(result[0]?.["name"]).toBe("releases");
    expect(result[1]?.["name"]).toBe("deployments");
  });

  it("URL path", async () => {
    // python: test_url_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listAnnotationTags();
    expect(capturedUrls[0]).toContain("/annotations/tags/");
  });

  it("uses get method", async () => {
    // python: test_uses_get_method
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listAnnotationTags();
    expect(capturedMethods[0]).toBe("GET");
  });
});

describe("Create annotation tag", () => {
  // python: TestCreateAnnotationTag
  it("creates tag", async () => {
    // python: test_creates_tag
    const captured: Array<[string, Record<string, unknown>]> = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      captured.push([
        request.method,
        parseBody(request.bodyText) as Record<string, unknown>,
      ]);
      return {
        status: 200,
        json: { status: "ok", results: tagResult(3, "new-tag") },
      };
    });
    const result = toNativeJson(
      await client.createAnnotationTag({ name: "new-tag" }),
    ) as Record<string, unknown>;
    expect(captured[0]?.[0]).toBe("POST");
    expect(captured[0]?.[1]["name"]).toBe("new-tag");
    expect(result["id"]).toBe(3);
    expect(result["name"]).toBe("new-tag");
  });

  it("URL path", async () => {
    // python: test_url_path
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: tagResult() } };
    });
    await client.createAnnotationTag({ name: "test" });
    expect(capturedUrls[0]).toContain("/annotations/tags/");
  });
});
