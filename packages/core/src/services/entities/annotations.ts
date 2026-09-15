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
   * List timeline annotations (`list_annotations` — GET `annotations/`).
   *
   * @param options - from_date/to_date/tags filters + signal.
   * @returns The annotation list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   * @throws AuthenticationError | RateLimitError | QueryError |
   *   ServerError - Per the `appRequest` contract.
   */
  listAnnotations: (options?: ListAnnotationsOptions) => Promise<JsonValue[]>;

  /**
   * Create an annotation (`create_annotation` — POST
   * `annotations/`).
   *
   * @param body - Annotation data (date, description, ...).
   * @param signal - Optional cancellation signal.
   * @returns The created annotation dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  createAnnotation: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Get an annotation by ID (`get_annotation`).
   *
   * @param annotationId - Annotation ID.
   * @param signal - Optional cancellation signal.
   * @returns The annotation dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  getAnnotation: (
    annotationId: number,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Update an annotation (`update_annotation` — PATCH).
   *
   * @param annotationId - Annotation ID.
   * @param body - Fields to update.
   * @param signal - Optional cancellation signal.
   * @returns The updated annotation dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  updateAnnotation: (
    annotationId: number,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Delete an annotation (`delete_annotation`).
   *
   * @param annotationId - Annotation ID.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  deleteAnnotation: (
    annotationId: number,
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * List annotation tags (`list_annotation_tags` — GET
   * `annotations/tags/`).
   *
   * @param signal - Optional cancellation signal.
   * @returns The tag list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  listAnnotationTags: (signal?: AbortSignal) => Promise<JsonValue[]>;

  /**
   * Create an annotation tag (`create_annotation_tag` —
   * POST `annotations/tags/`).
   *
   * @param body - Tag data (name).
   * @param signal - Optional cancellation signal.
   * @returns The created tag dict.
   * @throws MixpanelHeadlessError - Non-dict response.
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
 */
export function createAnnotationMethods(core: ClientCore): AnnotationMethods {
  /** `maybe_scoped_path` over the pin current at call time. */
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
