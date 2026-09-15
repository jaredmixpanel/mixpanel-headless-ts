/**
 * Annotation CRUD + tag wire methods (App API) — Phase-3 packet B4-C4
 * port of the `MixpanelAPIClient` annotations range
 * (`api_client.py:5674-5914`).
 *
 * All methods route through B0 `appRequest` over `maybe_scoped_path`
 * (R10.8). List filters spell camelCase wire params (`fromDate`,
 * `toDate`) from snake_case kwargs and `,`-join integer tag IDs.
 * Results are returned verbatim after the source's isinstance guard
 * (Caution #11).
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import type { JsonValue } from "../../client/json-value.js";
import { maybeScopedPath } from "../../client/scope.js";
import {
  expectListResult,
  expectRecordResult,
  joinIds,
  paramsOrNone,
  truthyList,
  truthyStr,
} from "./shared.js";

/** Options bag of {@link AnnotationMethods.listAnnotations}. */
export interface ListAnnotationsOptions {
  /** Start date filter (ISO format) — wire param `fromDate`. */
  readonly from_date?: string | null | undefined;
  /** End date filter (ISO format) — wire param `toDate`. */
  readonly to_date?: string | null | undefined;
  /** Tag IDs to filter by (`,`-joined on the wire). */
  readonly tags?: readonly number[] | null | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** The C4 annotation method surface (mixed into `MixpanelClient`). */
export interface AnnotationMethods {
  /**
   * List timeline annotations (`list_annotations`,
   * `api_client.py:5674-5720` — GET `annotations/`).
   *
   * @param options - from_date/to_date/tags filters + signal.
   * @returns The annotation list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   * @throws AuthenticationError | RateLimitError | QueryError |
   *   ServerError - Per the B0 `appRequest` contract.
   */
  listAnnotations: (options?: ListAnnotationsOptions) => Promise<JsonValue[]>;

  /**
   * Create an annotation (`create_annotation`, `:5722-5755` — POST
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
   * Get an annotation by ID (`get_annotation`, `:5757-5788`).
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
   * Update an annotation (`update_annotation`, `:5790-5824` — PATCH).
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
   * Delete an annotation (`delete_annotation`, `:5826-5851`).
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
   * List annotation tags (`list_annotation_tags`, `:5853-5881` — GET
   * `annotations/tags/`).
   *
   * @param signal - Optional cancellation signal.
   * @returns The tag list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  listAnnotationTags: (signal?: AbortSignal) => Promise<JsonValue[]>;

  /**
   * Create an annotation tag (`create_annotation_tag`, `:5883-5914` —
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
 * Build the C4 annotation methods over the C1 core seam.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 */
export function createAnnotationMethods(core: ClientCore): AnnotationMethods {
  /** `self.maybe_scoped_path(...)` over the CURRENT pin (call-time). */
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
