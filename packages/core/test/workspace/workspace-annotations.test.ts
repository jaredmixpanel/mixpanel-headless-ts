// B6-W5 Layer-3 translation (packet `b6-packets.md` §7) of the WHOLE
// of `tests/unit/test_workspace_annotations.py` (387 lines, 2 classes):
// `TestWorkspaceAnnotationCRUD` (:136) and
// `TestWorkspaceAnnotationTags` (:329).
//
// Python's `httpx.MockTransport` handler becomes the injected-fetch
// `fakeTransport` seam; `_make_workspace(temp_dir, handler)` (:65-82)
// becomes `makeWorkspace(handler)` — the client is built over the
// OAuth session (`_make_oauth_credentials`, :50) while the facade
// carries the service-account `_TEST_SESSION` (:35-43), exactly as
// Python does. `temp_dir` has no TS analog (no config file is ever
// touched) and is dropped.
//
// `annotation.model_extra` (:277) is the Phase-2 `__extras` spillover
// bag (`model-base.ts`, `extra='allow'`).
//
// Dates are STRINGS end-to-end (packet Caution #12 / watchlist #5):
// `from_date` / `to_date` / `CreateAnnotationParams.date` never become
// a `Date` anywhere in the request path.
//
// ADDITIVE sections (clearly headed, never substituting for a
// translated Python assertion — B5 Caution #13 / packet §0.2): the
// facade-local delegation contracts Python's wire suite cannot see —
// which client method each member calls, with which arguments, and the
// `model_dump(exclude_none=True)` body spelling (`workspace.py:6534`,
// `:6596`, `:6674`).

import { describe, expect, it } from "vitest";

import type { MixpanelClient } from "../../src/client/client.js";
import {
  Annotation,
  AnnotationTag,
  CreateAnnotationParams,
  CreateAnnotationTagParams,
  UpdateAnnotationParams,
} from "../../src/types/entities/annotations.js";
import { Workspace } from "../../src/workspace.js";
import {
  createAnnotation as createAnnotationMember,
  createAnnotationTag as createAnnotationTagMember,
  deleteAnnotation as deleteAnnotationMember,
  getAnnotation as getAnnotationMember,
  listAnnotations as listAnnotationsMember,
  listAnnotationTags as listAnnotationTagsMember,
  updateAnnotation as updateAnnotationMember,
} from "../../src/workspace-members/annotations-webhooks-alerts.js";
import {
  type CannedResponse,
  type CapturedFetchRequest,
  createMockClient,
  type FakeTransport,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** A canned-response handler (the `httpx.MockTransport` handler twin). */
type Handler = (request: CapturedFetchRequest) => CannedResponse;

/** The OAuth session the mock client is built over (`:50-56`). */
const CLIENT_SESSION = makeSession({
  projectId: "12345",
  region: "us",
  oauthToken: "test-token",
});

/** The canonical service-account facade session (`_TEST_SESSION`, :35-43). */
const FACADE_SESSION = makeSession({
  projectId: "12345",
  region: "us",
  username: "test_user",
  secret: "test_secret",
});

/**
 * Build a Workspace whose client routes through `handler`
 * (`_make_workspace`, :65-82).
 *
 * @param handler - The canned-response handler.
 * @returns The facade plus the transport capture log.
 */
function makeWorkspace(handler: Handler): {
  ws: Workspace;
  transport: FakeTransport;
} {
  const { client, transport } = createMockClient(CLIENT_SESSION, handler);
  return { ws: new Workspace({ session: FACADE_SESSION, client }), transport };
}

/**
 * A minimal annotation dict matching the API shape
 * (`_annotation_json`, :90-109).
 *
 * @param id - Annotation ID.
 * @param description - Annotation text.
 * @returns The payload record.
 */
function annotationJson(
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

/**
 * A minimal annotation-tag dict (`_tag_json`, :112-123).
 *
 * @param id - Tag ID.
 * @param name - Tag name.
 * @returns The payload record.
 */
function tagJson(id = 1, name = "releases"): Record<string, unknown> {
  return { id, name };
}

/**
 * A 200 App-API envelope wrapping `results`.
 *
 * @param results - The `results` payload.
 * @returns The canned response.
 */
function ok(results: unknown): CannedResponse {
  return { status: 200, json: { status: "ok", results } };
}

/**
 * A client stub whose single method returns `value` (the additive
 * delegation probes).
 *
 * @param method - The client method name to stub.
 * @param value - The value the stub resolves to.
 * @param calls - Optional log receiving each argument list.
 * @returns The stub cast to the client type.
 */
function stubClient(
  method: string,
  value: unknown,
  calls: unknown[][] = [],
): MixpanelClient {
  return {
    [method]: (...args: unknown[]): Promise<unknown> => {
      calls.push(args);
      return Promise.resolve(value);
    },
  } as unknown as MixpanelClient;
}

// =============================================================================
// TestWorkspaceAnnotationCRUD (:136)
// =============================================================================

describe("TestWorkspaceAnnotationCRUD", () => {
  it("list_annotations() returns list of Annotation objects", async () => {
    const { ws } = makeWorkspace(() =>
      ok([annotationJson(1, "First"), annotationJson(2, "Second")]),
    );
    const annotations = await ws.listAnnotations();

    expect(annotations).toHaveLength(2);
    expect(annotations[0]).toBeInstanceOf(Annotation);
    expect(annotations[0]?.id).toBe(1);
    expect(annotations[0]?.description).toBe("First");
    expect(annotations[1]?.id).toBe(2);
  });

  it("list_annotations() returns empty list when no annotations exist", async () => {
    const { ws } = makeWorkspace(() => ok([]));
    await expect(ws.listAnnotations()).resolves.toStrictEqual([]);
  });

  it("list_annotations() passes filter params to API", async () => {
    const { ws, transport } = makeWorkspace(() => ok([annotationJson()]));
    const annotations = await ws.listAnnotations({
      from_date: "2026-01-01",
      to_date: "2026-03-31",
    });

    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toBeInstanceOf(Annotation);
    expect(transport.captures).toHaveLength(1);
    expect(transport.captures[0]?.url).toContain("fromDate=2026-01-01");
    expect(transport.captures[0]?.url).toContain("toDate=2026-03-31");
  });

  it("create_annotation() returns the created Annotation", async () => {
    const { ws } = makeWorkspace(() =>
      ok(annotationJson(10, "New annotation")),
    );
    const params = new CreateAnnotationParams({
      date: "2026-03-31",
      description: "New annotation",
    });
    const annotation = await ws.createAnnotation(params);

    expect(annotation).toBeInstanceOf(Annotation);
    expect(annotation.id).toBe(10);
    expect(annotation.description).toBe("New annotation");
  });

  it("create_annotation() sends optional fields when provided", async () => {
    const { ws } = makeWorkspace(() => {
      const data = annotationJson(10, "Tagged");
      data["tags"] = [{ id: 1, name: "releases" }];
      return ok(data);
    });
    const params = new CreateAnnotationParams({
      date: "2026-03-31",
      description: "Tagged",
      tags: [1],
      user_id: 5,
    });
    const annotation = await ws.createAnnotation(params);

    expect(annotation.tags).toHaveLength(1);
    expect(annotation.tags[0]?.name).toBe("releases");
  });

  it("get_annotation() returns a single Annotation by ID", async () => {
    const { ws } = makeWorkspace(() => ok(annotationJson(42, "Found it")));
    const annotation = await ws.getAnnotation(42);

    expect(annotation).toBeInstanceOf(Annotation);
    expect(annotation.id).toBe(42);
    expect(annotation.description).toBe("Found it");
  });

  it("get_annotation() preserves extra fields from the API", async () => {
    const { ws } = makeWorkspace(() => {
      const data = annotationJson();
      data["custom_field"] = "extra_value";
      return ok(data);
    });
    const annotation = await ws.getAnnotation(1);

    expect(annotation.__extras["custom_field"]).toBe("extra_value");
  });

  it("update_annotation() returns the updated Annotation", async () => {
    const { ws } = makeWorkspace(() => ok(annotationJson(42, "Updated text")));
    const params = new UpdateAnnotationParams({ description: "Updated text" });
    const annotation = await ws.updateAnnotation(42, params);

    expect(annotation).toBeInstanceOf(Annotation);
    expect(annotation.description).toBe("Updated text");
  });

  it("delete_annotation() returns None on success", async () => {
    const { ws } = makeWorkspace(() => ({ status: 204 }));
    // Should not raise.
    await expect(ws.deleteAnnotation(42)).resolves.toBeUndefined();
  });

  it("delete_annotation() handles 200 response too", async () => {
    const { ws } = makeWorkspace(() => ok({}));
    // Should not raise.
    await expect(ws.deleteAnnotation(42)).resolves.toBeUndefined();
  });
});

// =============================================================================
// TestWorkspaceAnnotationTags (:329)
// =============================================================================

describe("TestWorkspaceAnnotationTags", () => {
  it("list_annotation_tags() returns list of AnnotationTag objects", async () => {
    const { ws } = makeWorkspace(() =>
      ok([tagJson(1, "releases"), tagJson(2, "deployments")]),
    );
    const tags = await ws.listAnnotationTags();

    expect(tags).toHaveLength(2);
    expect(tags[0]).toBeInstanceOf(AnnotationTag);
    expect(tags[0]?.name).toBe("releases");
    expect(tags[1]?.name).toBe("deployments");
  });

  it("list_annotation_tags() returns empty list when no tags exist", async () => {
    const { ws } = makeWorkspace(() => ok([]));
    await expect(ws.listAnnotationTags()).resolves.toStrictEqual([]);
  });

  it("create_annotation_tag() returns the created AnnotationTag", async () => {
    const { ws } = makeWorkspace(() => ok(tagJson(3, "new-tag")));
    const params = new CreateAnnotationTagParams({ name: "new-tag" });
    const tag = await ws.createAnnotationTag(params);

    expect(tag).toBeInstanceOf(AnnotationTag);
    expect(tag.id).toBe(3);
    expect(tag.name).toBe("new-tag");
  });
});

// =============================================================================
// ADDITIVE — delegation contracts (packet §0.2 / B5 Caution #13).
// NOT a substitute for any translated Python assertion: these lock the
// facade-to-client seam (argument spelling and the params-dump choice)
// that the wire suite above cannot observe.
// =============================================================================

describe("ADDITIVE: annotation member delegation contracts", () => {
  it("listAnnotations forwards from_date/to_date/tags verbatim, defaulting to null", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("listAnnotations", [], calls);

    await listAnnotationsMember(client);
    expect(calls[0]?.[0]).toStrictEqual({
      from_date: null,
      to_date: null,
      tags: null,
    });

    await listAnnotationsMember(client, {
      from_date: "2026-01-01",
      to_date: "2026-03-31",
      tags: [1, 2],
    });
    expect(calls[1]?.[0]).toStrictEqual({
      from_date: "2026-01-01",
      to_date: "2026-03-31",
      tags: [1, 2],
    });
  });

  it("createAnnotation sends the exclude_none dump (`workspace.py:6534`)", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("createAnnotation", annotationJson(), calls);
    await createAnnotationMember(
      client,
      new CreateAnnotationParams({ date: "2026-03-31", description: "x" }),
    );

    // `tags`/`user_id` are None and MUST be absent, not null (R3.5).
    expect(calls[0]?.[0]).toStrictEqual({
      date: "2026-03-31",
      description: "x",
    });
  });

  it("updateAnnotation forwards (annotation_id, exclude_none dump)", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("updateAnnotation", annotationJson(), calls);
    await updateAnnotationMember(
      client,
      42,
      new UpdateAnnotationParams({ description: "Updated" }),
    );

    expect(calls[0]?.[0]).toBe(42);
    expect(calls[0]?.[1]).toStrictEqual({ description: "Updated" });
  });

  it("createAnnotationTag sends the exclude_none dump (`workspace.py:6674`)", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("createAnnotationTag", tagJson(), calls);
    await createAnnotationTagMember(
      client,
      new CreateAnnotationTagParams({ name: "releases" }),
    );

    expect(calls[0]?.[0]).toStrictEqual({ name: "releases" });
  });

  it("getAnnotation / deleteAnnotation / listAnnotationTags forward positionally", async () => {
    const annotationGetCalls: unknown[][] = [];
    await getAnnotationMember(
      stubClient("getAnnotation", annotationJson(), annotationGetCalls),
      7,
    );
    expect(annotationGetCalls[0]?.[0]).toBe(7);

    const delCalls: unknown[][] = [];
    await deleteAnnotationMember(
      stubClient("deleteAnnotation", undefined, delCalls),
      9,
    );
    expect(delCalls[0]?.[0]).toBe(9);

    const listCalls: unknown[][] = [];
    await listAnnotationTagsMember(
      stubClient("listAnnotationTags", [], listCalls),
    );
    expect(listCalls[0]).toStrictEqual([]);
  });
});
