/**
 * Annotation CRUD and tag wire methods on the App API (`annotations/`,
 * workspace-scoped through `maybe_scoped_path`). List filters spell the
 * camelCase wire params (`fromDate`, `toDate`) from snake_case options
 * and `,`-join integer tag ids; results come back verbatim after
 * Python's isinstance guard.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_annotations
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import type { JsonValue } from "../../client/json-value.js";
import { maybeScopedPath } from "../../client/scope.js";
import { truthyList, truthyStr } from "../shared.js";
import {
  expectListResult,
  expectRecordResult,
  joinIds,
  paramsOrNone,
} from "./shared.js";

/** Options bag of {@link AnnotationMethods.listAnnotations}. */
export interface ListAnnotationsOptions {
  /** Start date filter (ISO format) — wire param `fromDate`. */
  readonly from_date?: string | null | undefined;
  /** End date filter (ISO format) — wire param `toDate`. */
  readonly to_date?: string | null | undefined;
  /** Tag IDs to filter by (`,`-joined on the wire). */
  readonly tags?: readonly number[] | null | undefined;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal | undefined;
}

/** Annotation methods mixed into `MixpanelClient`. */
export interface AnnotationMethods {
  /**
   * List timeline annotations. Sends GET `annotations/`.
   *
   * @param options - from_date/to_date/tags filters + signal.
   * @returns The annotation list verbatim.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @throws {@link AuthenticationError} - Invalid or expired credentials (401).
   * @throws {@link RateLimitError} - Rate limit still exceeded after the retries
   *   (429).
   * @throws {@link QueryError} - Other 4xx responses (400/403/404/422).
   * @throws {@link ServerError} - Server-side errors (5xx).
   * @internal
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_annotations
   */
  listAnnotations: (options?: ListAnnotationsOptions) => Promise<JsonValue[]>;

  /**
   * Create an annotation. Sends POST `annotations/`.
   *
   * @param body - Annotation data (date, description, ...).
   * @param signal - Optional cancellation signal.
   * @returns The created annotation dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.create_annotation
   */
  createAnnotation: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Get an annotation by ID.
   *
   * @param annotationId - Annotation ID.
   * @param signal - Optional cancellation signal.
   * @returns The annotation dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_annotation
   */
  getAnnotation: (
    annotationId: number,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Update an annotation. Sends a PATCH.
   *
   * @param annotationId - Annotation ID.
   * @param body - Fields to update.
   * @param signal - Optional cancellation signal.
   * @returns The updated annotation dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.update_annotation
   */
  updateAnnotation: (
    annotationId: number,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Delete an annotation.
   *
   * @param annotationId - Annotation ID.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.delete_annotation
   */
  deleteAnnotation: (
    annotationId: number,
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * List annotation tags. Sends GET `annotations/tags/`.
   *
   * @param signal - Optional cancellation signal.
   * @returns The tag list verbatim.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_annotation_tags
   */
  listAnnotationTags: (signal?: AbortSignal) => Promise<JsonValue[]>;

  /**
   * Create an annotation tag. Sends POST `annotations/tags/`.
   *
   * @param body - Tag data (name).
   * @param signal - Optional cancellation signal.
   * @returns The created tag dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.create_annotation_tag
   */
  createAnnotationTag: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;
}

/**
 * Build the annotation methods over the shared client core.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 * @example
 * ```typescript
 * const annotations = createAnnotationMethods(core);
 * await annotations.createAnnotation({ date: "2026-01-15", description: "Launch" });
 * // { id: 7, date: "2026-01-15", description: "Launch", ... }
 * ```
 */
export function createAnnotationMethods(core: ClientCore): AnnotationMethods {
  /**
   * Scope a domain path to the project and the workspace pinned at call
   * time.
   *
   * @param domainPath - Path relative to the domain root.
   * @returns The `/projects/{pid}[/workspaces/{wid}]/{domainPath}` path.
   */
  const scopedPath = (domainPath: string): string =>
    maybeScopedPath(domainPath, {
      projectId: core.projectId(),
      workspaceId: core.workspaceId(),
    });

  return {
    listAnnotations: async (
      options: ListAnnotationsOptions = {},
    ): Promise<JsonValue[]> => {
      const path = scopedPath("annotations/");
      const params: Record<string, string> = {};
      if (truthyStr(options.from_date)) {
        params["fromDate"] = options.from_date;
      }
      if (truthyStr(options.to_date)) {
        params["toDate"] = options.to_date;
      }
      if (truthyList(options.tags)) {
        params["tags"] = joinIds(options.tags as readonly number[]);
      }
      const result = await appRequest(
        core.appDeps(options.signal),
        "GET",
        path,
        { params: paramsOrNone(params) },
      );
      return expectListResult(result, "list_annotations");
    },

    createAnnotation: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("annotations/");
      const result = await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "create_annotation");
    },

    getAnnotation: async (
      annotationId: number,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath(`annotations/${annotationId}/`);
      const result = await appRequest(core.appDeps(signal), "GET", path);
      return expectRecordResult(result, "get_annotation");
    },

    updateAnnotation: async (
      annotationId: number,
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath(`annotations/${annotationId}/`);
      const result = await appRequest(core.appDeps(signal), "PATCH", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "update_annotation");
    },

    deleteAnnotation: async (
      annotationId: number,
      signal?: AbortSignal,
    ): Promise<void> => {
      const path = scopedPath(`annotations/${annotationId}/`);
      await appRequest(core.appDeps(signal), "DELETE", path);
    },

    listAnnotationTags: async (signal?: AbortSignal): Promise<JsonValue[]> => {
      const path = scopedPath("annotations/tags/");
      const result = await appRequest(core.appDeps(signal), "GET", path);
      return expectListResult(result, "list_annotation_tags");
    },

    createAnnotationTag: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("annotations/tags/");
      const result = await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "create_annotation_tag");
    },
  };
}
