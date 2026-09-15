/**
 * Lookup-table wire methods (App API + external GCS) — Phase-3 packet
 * B4-C5 port of the `MixpanelAPIClient` lookup-tables range
 * (`api_client.py`).
 *
 * Three wire paths coexist, ported verbatim:
 * - the JSON CRUD (list/upload-url/upload-status/update/delete/
 *   download-url) rides B0 `appRequest` over `maybe_scoped_path`;
 * - `register_lookup_table`/`mark_lookup_table_ready` (`:7683-7776`)
 *   and `download_lookup_table` (`:7874-7935`) are the B0 R10.8
 *   ownership call sites `:7720`/`:7923`: DIRECT transport requests
 *   that build headers via B0 `requestHeaders` with an explicit
 *   Authorization extra and route non-2xx through `handleResponse`
 *   manually, bypassing `_execute_with_retry` — no retry loop;
 * - `upload_to_signed_url` (`:7625-7681`) PUTs raw CSV bytes to an
 *   EXTERNAL signed URL with a fresh client: NO Mixpanel auth header,
 *   NO header merge (a merged custom header would break the GCS
 *   signature), its own `httpx.HTTPError → UPLOAD_ERROR` mapping.
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import {
  bindFirst,
  handleResponse,
  isPlainRecord,
  MixpanelHttpError,
} from "../../client/internals.js";
import { type JsonValue, toNativeJson } from "../../client/json-value.js";
import {
  LosslessJsonError,
  parseLossless,
} from "../../client/lossless-json.js";
import { cpSlice, pythonStr, pythonStrOf } from "../../compat/index.js";
import { MixpanelHeadlessError } from "../../errors.js";
import { exceptionMessage } from "../../invariant.js";
import { pythonTypeNameOf, scopedPath } from "../shared.js";
import {
  expectListResult,
  expectRecordResult,
  jsonTruthy,
  paramsOrNone,
} from "./shared.js";

/** Options bag of {@link LookupTableMethods.listLookupTables}. */
export interface ListLookupTablesOptions {
  /**
   * Optional data-group-ID filter (`data-group-id` on the wire). A
   * `bigint` carries an int64 id beyond 2^53 exactly (`pythonStr`
   * spells its digits).
   */
  readonly data_group_id?: number | bigint | null | undefined;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal | undefined;
}

/** Options bag of {@link LookupTableMethods.downloadLookupTable}. */
export interface DownloadLookupTableOptions {
  /** Optional file name filter (`file-name` on the wire). */
  readonly file_name?: string | null | undefined;
  /** Optional row limit. */
  readonly limit?: number | null | undefined;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal | undefined;
}

/** The C5 lookup-table method surface (mixed into `MixpanelClient`). */
export interface LookupTableMethods {
  /**
   * List lookup tables (`list_lookup_tables`,
   * `api_client.py` — GET `data-definitions/lookup-tables/`).
   *
   * @param options - Optional `data_group_id` filter + signal.
   * @returns The table list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  listLookupTables: (options?: ListLookupTablesOptions) => Promise<JsonValue[]>;

  /**
   * Get a signed upload URL (`get_lookup_upload_url`, `:7584-7623` —
   * GET `.../upload-url/` with the `content-type` param; validates the
   * `url`/`path`/`key` fields).
   *
   * @param contentType - Upload MIME type (default `"text/csv"`).
   * @param signal - Optional cancellation signal.
   * @returns Dict with `url`, `path`, and `key`.
   * @throws MixpanelHeadlessError - Non-dict response, or a required
   *   field missing (`MISSING_FIELD`).
   */
  getLookupUploadUrl: (
    contentType?: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * PUT CSV bytes to an external signed URL (`upload_to_signed_url`,
   * `:7625-7681` — no Mixpanel auth, no default headers, fresh
   * transport; transport failures and non-2xx map to `UPLOAD_ERROR`).
   *
   * @param url - The signed upload URL.
   * @param csvBytes - Raw CSV content.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @throws MixpanelHeadlessError - `UPLOAD_ERROR` on transport
   *   failure (`{url}` details) or status ≥ 300
   *   (`{status_code, url}` details).
   */
  uploadToSignedUrl: (
    url: string,
    csvBytes: Uint8Array,
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Register a lookup table (`register_lookup_table`, `:7683-7746` —
   * direct POST with a FORM body and the manual `handleResponse`
   * error route; no retry loop).
   *
   * @param formData - Form fields (name, path, key, ...).
   * @param signal - Optional cancellation signal.
   * @returns The registered table dict (after the manual
   *   `results`-unwrap).
   * @throws MixpanelHeadlessError - Non-JSON 200 body
   *   (`INVALID_RESPONSE`) or non-dict result; the `handleResponse`
   *   family on non-2xx.
   */
  registerLookupTable: (
    formData: Record<string, string>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Mark an upload ready (`mark_lookup_table_ready`, `:7748-7776` —
   * delegates to {@link registerLookupTable} verbatim).
   *
   * @param formData - Form fields including the ready flag.
   * @param signal - Optional cancellation signal.
   * @returns The table status dict.
   * @throws MixpanelHeadlessError - As {@link registerLookupTable}.
   */
  markLookupTableReady: (
    formData: Record<string, string>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Get upload status (`get_lookup_upload_status`, `:7778-7809` — GET
   * `.../upload-status/` with the `upload-id` param).
   *
   * @param uploadId - Upload ID.
   * @param signal - Optional cancellation signal.
   * @returns The status dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  getLookupUploadStatus: (
    uploadId: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Update table metadata (`update_lookup_table`, `:7811-7848` —
   * PATCH with `{**body, "data-group-id": id}`).
   *
   * @param dataGroupId - Data group ID (signed int64; a `bigint` beyond
   *   2^53 is emitted into the JSON body as its exact digits).
   * @param body - Fields to update.
   * @param signal - Optional cancellation signal.
   * @returns The updated table dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  updateLookupTable: (
    dataGroupId: number | bigint,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Delete lookup tables (`delete_lookup_tables`, `:7850-7872` —
   * DELETE with `{"data-group-ids": [...]}`).
   *
   * @param dataGroupIds - Data group IDs to delete (signed int64s; a
   *   `bigint` beyond 2^53 is emitted as its exact digits).
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  deleteLookupTables: (
    dataGroupIds: ReadonlyArray<number | bigint>,
    signal?: AbortSignal,
  ) => Promise<void>;

  /**
   * Download table data as CSV bytes (`download_lookup_table`,
   * `:7874-7935` — direct GET, `handleResponse` on ≥ 400, raw bytes
   * on success).
   *
   * @param dataGroupId - Data group ID (signed int64; a `bigint` beyond
   *   2^53 is spelled exactly into the `data-group-id` query param).
   * @param options - Optional `file_name`/`limit` + signal.
   * @returns Raw CSV bytes.
   * @throws AuthenticationError | QueryError | ServerError - Per the
   *   `handleResponse` mapping on non-2xx.
   */
  downloadLookupTable: (
    dataGroupId: number | bigint,
    options?: DownloadLookupTableOptions,
  ) => Promise<Uint8Array>;

  /**
   * Get a signed download URL (`get_lookup_download_url`,
   * `:7937-7982` — GET `.../download-url/`; extracts `url` or
   * `download_url` from a dict result, passes a string result
   * through).
   *
   * @param dataGroupId - Data group ID (signed int64; a `bigint` beyond
   *   2^53 is spelled exactly into the `data-group-id` query param).
   * @param signal - Optional cancellation signal.
   * @returns The signed URL string.
   * @throws MixpanelHeadlessError - No URL in a dict response
   *   (`MISSING_URL`), or a non-dict/non-string response.
   */
  getLookupDownloadUrl: (
    dataGroupId: number | bigint,
    signal?: AbortSignal,
  ) => Promise<string>;
}
async function registerLookupTable(
  core: ClientCore,
  formData: Record<string, string>,
  signal?: AbortSignal,
): Promise<Record<string, JsonValue>> {
  const path = scopedPath(core, "data-definitions/lookup-tables/");
  const url = core.buildUrl("app", path);
  const authHeader = await core.getAuthHeader();
  const { response, release } = await core.rawRequest(
    {
      method: "POST",
      url,
      params: {},
      jsonBody: null,
      formBody: formData,
      headers: core.requestHeaders({ Authorization: authHeader }),
      timeoutSeconds: core.defaultTimeoutSeconds(url),
    },
    signal,
  );
  let text: string;
  try {
    // Buffered read under the request-timeout clock (B4-ARB W-F2).
    text = await response.text();
  } finally {
    release();
  }
  if (response.status >= 400) {
    handleResponse(
      {
        status: response.status,
        text,
        header: (name) => response.headers.get(name),
      },
      {
        projectId: core.projectId(),
        requestMethod: "POST",
        requestUrl: url,
        requestParams: null,
        requestBody: formData,
      },
    );
  }
  let body: JsonValue;
  try {
    // Python `response.json()` — json.loads on wire data (GATE-R5).
    body = parseLossless(text, { pythonConstants: true });
  } catch (error) {
    if (!(error instanceof LosslessJsonError)) {
      throw error; // RangeError etc. propagates (B0-ARB F3).
    }
    throw new MixpanelHeadlessError(
      `register_lookup_table returned non-JSON response ` +
        `(status ${response.status}): ${cpSlice(text, 0, 500)}`,
      "INVALID_RESPONSE",
      null,
      { cause: error },
    );
  }
  let unwrapped: JsonValue = body;
  if (isPlainRecord(unwrapped) && Object.hasOwn(unwrapped, "results")) {
    unwrapped = unwrapped["results"] as JsonValue;
  }
  if (!isPlainRecord(unwrapped)) {
    throw new MixpanelHeadlessError(
      `Unexpected response from register_lookup_table: ` +
        `expected dict, got ${pythonTypeNameOf(unwrapped)}`,
    );
  }
  return unwrapped;
}

async function listLookupTables(
  core: ClientCore,
  options: ListLookupTablesOptions = {},
): Promise<JsonValue[]> {
  const path = scopedPath(core, "data-definitions/lookup-tables/");
  const params: Record<string, string> = {};
  if (options.data_group_id !== undefined && options.data_group_id !== null) {
    params["data-group-id"] = pythonStr(options.data_group_id);
  }
  const result = await appRequest(core.appDeps(options.signal), "GET", path, {
    params: paramsOrNone(params) ?? null,
  });
  return expectListResult(result, "list_lookup_tables");
}

async function getLookupUploadUrl(
  core: ClientCore,
  contentType = "text/csv",
  signal?: AbortSignal,
): Promise<Record<string, JsonValue>> {
  const path = scopedPath(core, "data-definitions/lookup-tables/upload-url/");
  const result = await appRequest(core.appDeps(signal), "GET", path, {
    params: { "content-type": contentType },
  });
  const record = expectRecordResult(result, "get_lookup_upload_url");
  for (const requiredKey of ["url", "path", "key"]) {
    if (!Object.hasOwn(record, requiredKey)) {
      throw new MixpanelHeadlessError(
        `get_lookup_upload_url response missing required ` +
          `field '${requiredKey}': ${pythonStrOf(toNativeJson(record))}`,
        "MISSING_FIELD",
      );
    }
  }
  return record;
}

async function uploadToSignedUrl(
  core: ClientCore,
  url: string,
  csvBytes: Uint8Array,
  signal?: AbortSignal,
): Promise<void> {
  // Fresh-request semantics (`:7647-7657`): the injected fetch IS
  // the transport analog, but the request carries ONLY the
  // Content-Type header — no auth, no 4-layer merge (a stray
  // header breaks GCS signature validation).
  const fetchImpl = core.http().fetchImpl;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "PUT",
      headers: { "Content-Type": "text/csv" },
      body: csvBytes as BodyInit,
      redirect: "manual",
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error; // R6.7 cancellation passthrough.
    }
    if (
      error instanceof MixpanelHttpError ||
      error instanceof TypeError ||
      error instanceof DOMException
    ) {
      // The `except httpx.HTTPError` arm (`:7664-7669`) — this
      // call site maps transport failures straight to
      // UPLOAD_ERROR (not the retry loop's HTTP_ERROR). The
      // classification set mirrors the R2.10 adapter guards; no
      // bare catch.
      throw new MixpanelHeadlessError(
        `Upload to signed URL failed: ${exceptionMessage(error)}`,
        "UPLOAD_ERROR",
        { url },
        { cause: error },
      );
    }
    throw error;
  }
  if (response.status >= 300) {
    const text = await response.text();
    throw new MixpanelHeadlessError(
      `Upload to signed URL failed with status ` +
        `${response.status}: ${cpSlice(text, 0, 500)}`,
      "UPLOAD_ERROR",
      { status_code: response.status, url },
    );
  }
}

function markLookupTableReady(
  core: ClientCore,
  formData: Record<string, string>,
  signal?: AbortSignal,
): Promise<Record<string, JsonValue>> {
  return registerLookupTable(core, formData, signal);
}

async function getLookupUploadStatus(
  core: ClientCore,
  uploadId: string,
  signal?: AbortSignal,
): Promise<Record<string, JsonValue>> {
  const path = scopedPath(
    core,
    "data-definitions/lookup-tables/upload-status/",
  );
  const result = await appRequest(core.appDeps(signal), "GET", path, {
    params: { "upload-id": uploadId },
  });
  return expectRecordResult(result, "get_lookup_upload_status");
}

async function updateLookupTable(
  core: ClientCore,
  dataGroupId: number | bigint,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, JsonValue>> {
  const path = scopedPath(core, "data-definitions/lookup-tables/");
  // A bigint id reaches the wire as an exact integer token via the
  // transport's bigint-aware body serializer (`stringifyJsonBody`).
  const payload = { ...body, "data-group-id": dataGroupId };
  const result = await appRequest(core.appDeps(signal), "PATCH", path, {
    jsonBody: payload,
  });
  return expectRecordResult(result, "update_lookup_table");
}

async function deleteLookupTables(
  core: ClientCore,
  dataGroupIds: ReadonlyArray<number | bigint>,
  signal?: AbortSignal,
): Promise<void> {
  const path = scopedPath(core, "data-definitions/lookup-tables/");
  await appRequest(core.appDeps(signal), "DELETE", path, {
    jsonBody: { "data-group-ids": dataGroupIds },
  });
}

async function downloadLookupTable(
  core: ClientCore,
  dataGroupId: number | bigint,
  options: DownloadLookupTableOptions = {},
): Promise<Uint8Array> {
  const path = scopedPath(core, "data-definitions/lookup-tables/download/");
  const url = core.buildUrl("app", path);
  const authHeader = await core.getAuthHeader();
  const params: Record<string, string> = {
    "data-group-id": pythonStr(dataGroupId),
  };
  if (options.file_name !== undefined && options.file_name !== null) {
    params["file-name"] = options.file_name;
  }
  if (options.limit !== undefined && options.limit !== null) {
    params["limit"] = pythonStr(options.limit);
  }
  const { response, release } = await core.rawRequest(
    {
      method: "GET",
      url,
      params,
      jsonBody: null,
      formBody: null,
      headers: core.requestHeaders({ Authorization: authHeader }),
      timeoutSeconds: core.defaultTimeoutSeconds(url),
    },
    options.signal,
  );
  try {
    // Buffered read under the request-timeout clock (B4-ARB W-F2).
    if (response.status >= 400) {
      const text = await response.text();
      // Delegate error handling (`:7926-7934`).
      handleResponse(
        {
          status: response.status,
          text,
          header: (name) => response.headers.get(name),
        },
        {
          projectId: core.projectId(),
          requestMethod: "GET",
          requestUrl: url,
          requestParams: params,
          requestBody: null,
        },
      );
    }
    return new Uint8Array(await response.arrayBuffer());
  } finally {
    release();
  }
}

async function getLookupDownloadUrl(
  core: ClientCore,
  dataGroupId: number | bigint,
  signal?: AbortSignal,
): Promise<string> {
  const path = scopedPath(core, "data-definitions/lookup-tables/download-url/");
  const result = await appRequest(core.appDeps(signal), "GET", path, {
    params: { "data-group-id": pythonStr(dataGroupId) },
  });
  if (isPlainRecord(result)) {
    const record = result;
    // `result.get("url") or result.get("download_url", "")` —
    // Python truthiness picks the fallback for None/""/0 members.
    const primary = Object.hasOwn(record, "url") ? record["url"] : undefined;
    const fallback = Object.hasOwn(record, "download_url")
      ? record["download_url"]
      : "";
    const urlValue = jsonTruthy(primary) ? primary : fallback;
    if (typeof urlValue === "string" && urlValue !== "") {
      return urlValue;
    }
    throw new MixpanelHeadlessError(
      "No download URL found in response",
      "MISSING_URL",
      { response: record },
    );
  }
  if (typeof result === "string") {
    return result;
  }
  throw new MixpanelHeadlessError(
    `Unexpected response from get_lookup_download_url: ` +
      `expected dict or str, got ${pythonTypeNameOf(result)}`,
  );
}

/**
 * Build the C5 lookup-table methods over the C1 core seam.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 */
export function createLookupTableMethods(core: ClientCore): LookupTableMethods {
  return {
    listLookupTables: bindFirst(core, listLookupTables),
    getLookupUploadUrl: bindFirst(core, getLookupUploadUrl),
    uploadToSignedUrl: bindFirst(core, uploadToSignedUrl),
    registerLookupTable: bindFirst(core, registerLookupTable),
    markLookupTableReady: bindFirst(core, markLookupTableReady),
    getLookupUploadStatus: bindFirst(core, getLookupUploadStatus),
    updateLookupTable: bindFirst(core, updateLookupTable),
    deleteLookupTables: bindFirst(core, deleteLookupTables),
    downloadLookupTable: bindFirst(core, downloadLookupTable),
    getLookupDownloadUrl: bindFirst(core, getLookupDownloadUrl),
  };
}
