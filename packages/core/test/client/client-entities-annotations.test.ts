// Layer-3 translation — Phase-3 packet B4-C4 annotation locks.
// Source: tests/unit/test_api_client_annotations.py (ALL classes —
// annotation CRUD + annotation tags list/create).
import { describe, expect, it } from "vitest";

import type { Session } from "../../src/auth/session.js";
import { toNativeJson } from "../../src/client/json-value.js";
import {
  createMockClient,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** The `oauth_credentials` fixture twin (test_api_client_annotations.py:27-30). */
function oauthCredentials(): Session {
  return makeSession({
    projectId: "12345",
    region: "us",
    oauthToken: "test-oauth-token",
  });
}

/** The `_annotation_result` helper twin (:54-73). */
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

/** The `_tag_result` helper twin (:76-89). */
function tagResult(id = 1, name = "releases"): Record<string, unknown> {
  return { id, name };
}

/** Parse a captured JSON request body (json.loads(request.content)). */
function parseBody(bodyText: string): unknown {
  return JSON.parse(bodyText) as unknown;
}

describe("TestListAnnotations", () => {
  it("test_returns_annotation_list", async () => {
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

  it("test_uses_maybe_scoped_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listAnnotations();
    expect(capturedUrls[0]).toContain("/annotations/");
  });

  it("test_from_date_camel_case", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listAnnotations({ from_date: "2026-01-01" });
    expect(capturedUrls[0]).toContain("fromDate=2026-01-01");
  });

  it("test_to_date_camel_case", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listAnnotations({ to_date: "2026-03-31" });
    expect(capturedUrls[0]).toContain("toDate=2026-03-31");
  });

  it("test_tags_filter", async () => {
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

  it("test_empty_result", async () => {
    const { client } = createMockClient(oauthCredentials(), () => ({
      status: 200,
      json: { status: "ok", results: [] },
    }));
    const result = await client.listAnnotations();
    expect(result).toStrictEqual([]);
  });

  it("test_uses_get_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listAnnotations();
    expect(capturedMethods[0]).toBe("GET");
  });
});

describe("TestCreateAnnotation", () => {
  it("test_creates_annotation", async () => {
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

  it("test_url_path", async () => {
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

describe("TestGetAnnotation", () => {
  it("test_gets_annotation_by_id", async () => {
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

  it("test_uses_get_method", async () => {
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

describe("TestUpdateAnnotation", () => {
  it("test_updates_annotation", async () => {
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

  it("test_url_path", async () => {
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

describe("TestDeleteAnnotation", () => {
  it("test_deletes_annotation", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 204 };
    });
    await client.deleteAnnotation(42);
    expect(capturedMethods[0]).toBe("DELETE");
  });

  it("test_url_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 204 };
    });
    await client.deleteAnnotation(42);
    expect(capturedUrls[0]).toContain("/annotations/42/");
  });
});

describe("TestListAnnotationTags", () => {
  it("test_returns_tag_list", async () => {
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

  it("test_url_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listAnnotationTags();
    expect(capturedUrls[0]).toContain("/annotations/tags/");
  });

  it("test_uses_get_method", async () => {
    const capturedMethods: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedMethods.push(request.method);
      return { status: 200, json: { status: "ok", results: [] } };
    });
    await client.listAnnotationTags();
    expect(capturedMethods[0]).toBe("GET");
  });
});

describe("TestCreateAnnotationTag", () => {
  it("test_creates_tag", async () => {
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

  it("test_url_path", async () => {
    const capturedUrls: string[] = [];
    const { client } = createMockClient(oauthCredentials(), (request) => {
      capturedUrls.push(request.url);
      return { status: 200, json: { status: "ok", results: tagResult() } };
    });
    await client.createAnnotationTag({ name: "test" });
    expect(capturedUrls[0]).toContain("/annotations/tags/");
  });
});
