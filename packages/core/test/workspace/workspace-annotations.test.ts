// Workspace annotation and annotation-tag members over the injected fetch
// seam. Mirrors tests/unit/test_workspace_annotations.py (both classes).
// `model_extra` is the `__extras` spillover bag; dates stay strings end-to-end
// (never a `Date` in the request path). Additive: facade-to-client delegation
// contracts (argument spelling, exclude_none bodies) the wire suite cannot see.

import { describe, expect, it } from "vitest";

import {
  Annotation,
  AnnotationTag,
  CreateAnnotationParams,
  CreateAnnotationTagParams,
  UpdateAnnotationParams,
} from "../../src/types/entities/annotations.js";
import {
  createAnnotation as createAnnotationMember,
  createAnnotationTag as createAnnotationTagMember,
  deleteAnnotation as deleteAnnotationMember,
  getAnnotation as getAnnotationMember,
  listAnnotations as listAnnotationsMember,
  listAnnotationTags as listAnnotationTagsMember,
  updateAnnotation as updateAnnotationMember,
} from "../../src/workspace-members/annotations-webhooks-alerts.js";
import { ok } from "../../test-support/client-test-helpers.js";
import {
  makeFacadeWorkspace,
  stubClient,
} from "../../test-support/workspace-test-helpers.js";

/**
 * A minimal annotation dict matching the API shape
 * (`_annotation_json`).
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
 * A minimal annotation-tag dict (`_tag_json`).
 *
 * @param id - Tag ID.
 * @param name - Tag name.
 * @returns The payload record.
 */
function tagJson(id = 1, name = "releases"): Record<string, unknown> {
  return { id, name };
}

// --- Workspace annotation CRUD ---

describe("Workspace annotation CRUD", () => {
  // python: TestWorkspaceAnnotationCRUD
  it("listAnnotations() returns list of Annotation objects", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok([annotationJson(1, "First"), annotationJson(2, "Second")]),
    );
    const annotations = await ws.listAnnotations();

    expect(annotations).toHaveLength(2);
    expect(annotations[0]).toBeInstanceOf(Annotation);
    expect(annotations[0]?.id).toBe(1);
    expect(annotations[0]?.description).toBe("First");
    expect(annotations[1]?.id).toBe(2);
  });

  it("listAnnotations() returns empty list when no annotations exist", async () => {
    const { ws } = makeFacadeWorkspace(() => ok([]));
    await expect(ws.listAnnotations()).resolves.toStrictEqual([]);
  });

  it("listAnnotations() passes filter params to API", async () => {
    const { ws, transport } = makeFacadeWorkspace(() => ok([annotationJson()]));
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

  it("createAnnotation() returns the created Annotation", async () => {
    const { ws } = makeFacadeWorkspace(() =>
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

  it("createAnnotation() sends optional fields when provided", async () => {
    const { ws } = makeFacadeWorkspace(() => {
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

  it("getAnnotation() returns a single Annotation by ID", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok(annotationJson(42, "Found it")),
    );
    const annotation = await ws.getAnnotation(42);

    expect(annotation).toBeInstanceOf(Annotation);
    expect(annotation.id).toBe(42);
    expect(annotation.description).toBe("Found it");
  });

  it("getAnnotation() preserves extra fields from the API", async () => {
    const { ws } = makeFacadeWorkspace(() => {
      const data = annotationJson();
      data["custom_field"] = "extra_value";
      return ok(data);
    });
    const annotation = await ws.getAnnotation(1);

    expect(annotation.__extras["custom_field"]).toBe("extra_value");
  });

  it("updateAnnotation() returns the updated Annotation", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok(annotationJson(42, "Updated text")),
    );
    const params = new UpdateAnnotationParams({ description: "Updated text" });
    const annotation = await ws.updateAnnotation(42, params);

    expect(annotation).toBeInstanceOf(Annotation);
    expect(annotation.description).toBe("Updated text");
  });

  it("deleteAnnotation() resolves to undefined on success", async () => {
    const { ws } = makeFacadeWorkspace(() => ({ status: 204 }));
    // Should not raise.
    await expect(ws.deleteAnnotation(42)).resolves.toBeUndefined();
  });

  it("deleteAnnotation() handles 200 response too", async () => {
    const { ws } = makeFacadeWorkspace(() => ok({}));
    // Should not raise.
    await expect(ws.deleteAnnotation(42)).resolves.toBeUndefined();
  });
});

// --- Workspace annotation tags ---

describe("Workspace annotation tags", () => {
  // python: TestWorkspaceAnnotationTags
  it("listAnnotationTags() returns list of AnnotationTag objects", async () => {
    const { ws } = makeFacadeWorkspace(() =>
      ok([tagJson(1, "releases"), tagJson(2, "deployments")]),
    );
    const tags = await ws.listAnnotationTags();

    expect(tags).toHaveLength(2);
    expect(tags[0]).toBeInstanceOf(AnnotationTag);
    expect(tags[0]?.name).toBe("releases");
    expect(tags[1]?.name).toBe("deployments");
  });

  it("listAnnotationTags() returns empty list when no tags exist", async () => {
    const { ws } = makeFacadeWorkspace(() => ok([]));
    await expect(ws.listAnnotationTags()).resolves.toStrictEqual([]);
  });

  it("createAnnotationTag() returns the created AnnotationTag", async () => {
    const { ws } = makeFacadeWorkspace(() => ok(tagJson(3, "new-tag")));
    const params = new CreateAnnotationTagParams({ name: "new-tag" });
    const tag = await ws.createAnnotationTag(params);

    expect(tag).toBeInstanceOf(AnnotationTag);
    expect(tag.id).toBe(3);
    expect(tag.name).toBe("new-tag");
  });
});

// --- Additive: the facade-to-client seam (argument spelling and the
// params-dump choice) that the wire suite above cannot observe ---

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

  it("createAnnotation sends the exclude_none dump", async () => {
    const calls: unknown[][] = [];
    const client = stubClient("createAnnotation", annotationJson(), calls);
    await createAnnotationMember(
      client,
      new CreateAnnotationParams({ date: "2026-03-31", description: "x" }),
    );

    // `tags`/`user_id` are None and must be absent, not null.
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

  it("createAnnotationTag sends the exclude_none dump", async () => {
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
