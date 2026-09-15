/**
 * Data-governance members of the `Workspace` facade that are not Lexicon
 * definitions: drop filters, custom properties, lookup tables and custom
 * events. Each function is the body of one facade method — options-bag
 * mapping, the params dump, the like-named client call and result-model
 * validation with the endpoint name Python passes. The form-encoded
 * register call, the unauthenticated GCS PUT, the `data-group-id` /
 * `file-name` param spellings and the `UPDATE_TARGET_MISMATCH` /
 * `MISSING_URL` / `MISSING_FIELD` guards belong to the client, not here.
 *
 * @see mixpanel_headless.workspace.Workspace
 */

import type { MixpanelClient } from "../client/client.js";
import { isPlainRecord } from "../client/internals.js";
import { toNativeJson } from "../client/json-value.js";
import {
  validateResponseModel,
  validateResponseModels,
} from "../client/response-validation.js";
import {
  pythonFloatStr,
  pythonStr,
  type PythonValue,
} from "../compat/index.js";
import { MixpanelHeadlessError, QueryError } from "../errors.js";
import {
  type CreateCustomEventParams,
  type CreateCustomPropertyParams,
  type CreateDropFilterParams,
  CustomEvent,
  CustomProperty,
  DropFilter,
  DropFilterLimitsResponse,
  LookupTable,
  LookupTableUploadUrl,
  type MarkLookupTableReadyParams,
  type UpdateCustomPropertyParams,
  type UpdateDropFilterParams,
  type UpdateLookupTableParams,
  type UploadLookupTableParams,
} from "../types/entities/data-governance.js";
import {
  EventDefinition,
  type UpdateEventDefinitionParams,
} from "../types/entities/lexicon.js";

// --- Options bags (keys keep the Python keyword spelling) ---

/** Options bag of `Workspace.listLookupTables`. */
export interface WorkspaceListLookupTablesOptions {
  /**
   * Filter by data group id. A `bigint` carries an int64 id beyond 2^53
   * exactly.
   *
   * @defaultValue `null` (every table)
   */
  readonly data_group_id?: number | bigint | null | undefined;
}

/** Options bag of `Workspace.downloadLookupTable`. */
export interface WorkspaceDownloadLookupTableOptions {
  /**
   * File name filter.
   *
   * @defaultValue `null`
   */
  readonly file_name?: string | null | undefined;
  /**
   * Row limit.
   *
   * @defaultValue `null` (no limit)
   */
  readonly limit?: number | null | undefined;
}

/**
 * Options bag of `Workspace.uploadLookupTable`. Both members stay in
 * seconds under their Python names; the single seconds-to-milliseconds
 * conversion happens at the sleep call site.
 */
export interface WorkspaceUploadLookupTableOptions {
  /**
   * Seconds between status polls for asynchronous uploads.
   *
   * @defaultValue `2.0`
   */
  readonly poll_interval?: number | undefined;
  /**
   * Maximum seconds to wait for asynchronous processing.
   *
   * @defaultValue `300.0`
   */
  readonly max_poll_seconds?: number | undefined;
}

/**
 * The runtime seams {@link uploadLookupTable} needs. The facade supplies
 * them from `WorkspaceOptions` (`readFile`, `monotonic`) and the bound
 * client (`client.core.sleep`); tests and `packages/node` override them.
 *
 * @remarks
 * Python reads the CSV with `Path(file_path).read_bytes()` and times the
 * poll with `time.monotonic()`. The core package is runtime-agnostic (no
 * `node:fs`, no monotonic clock), so both are injected; the default
 * `monotonic` is `Date.now() / 1000`, a wall clock, so a system-clock
 * adjustment mid-poll shifts the deadline where CPython's monotonic
 * source would not. `packages/node` may inject a monotonic source.
 */
export interface LookupUploadSeams {
  /**
   * `Path(file_path).read_bytes()`.
   *
   * @param path - The local CSV path.
   * @returns The file bytes.
   */
  readFile: (path: string) => Promise<Uint8Array>;
  /**
   * `time.monotonic()`, in seconds.
   *
   * @returns Elapsed seconds from an arbitrary origin.
   */
  monotonic: () => number;
  /**
   * `time.sleep(poll_interval)`, in milliseconds; the caller converts.
   *
   * @param ms - Milliseconds to wait.
   * @returns Resolves when the wait elapses.
   */
  sleep: (ms: number) => Promise<void>;
}

/** The optional log sink of the upload orchestrator (`logging` twin). */
export interface LookupUploadLogger {
  /**
   * `logger.info(...)` — the asynchronous-processing notice.
   *
   * @param message - The formatted text (never vector-compared).
   */
  info?: (message: string) => void;
  /**
   * `logger.debug(...)` — the per-poll status trace.
   *
   * @param message - The formatted text (never vector-compared).
   */
  debug?: (message: string) => void;
}

/**
 * Reject the lookup-table upload with `UNPORTED_FILE_READ_SEAM` — the
 * default {@link LookupUploadSeams.readFile}. The real reader ships in
 * `packages/node` (`nodeReadFile`); this default stays so a facade
 * without a wired reader still throws the coded error.
 *
 * @returns Never resolves; always rejects.
 * @throws {@link MixpanelHeadlessError} - Code `UNPORTED_FILE_READ_SEAM`.
 * @example
 * ```typescript
 * const ws = new Workspace({ session, readFile: nodeReadFile }); // avoids it
 * ```
 */
export function unportedReadFile(): Promise<Uint8Array> {
  return Promise.reject(
    new MixpanelHeadlessError(
      "Workspace file-read seam 'readFile' has no implementation in " +
        "@mixpanel-headless/core alone — inject `readFile` " +
        "(packages/node: nodeReadFile)",
      "UNPORTED_FILE_READ_SEAM",
      { seam: "readFile" },
    ),
  );
}

/**
 * Read the wall clock in seconds — the default
 * {@link LookupUploadSeams.monotonic}.
 *
 * @returns Seconds since the Unix epoch.
 * @example
 * ```typescript
 * const deadline = defaultMonotonic() + 300;
 * ```
 */
export function defaultMonotonic(): number {
  return Date.now() / 1000;
}

// --- Drop filters ---

/**
 * List every drop filter.
 *
 * @param client - The wire client.
 * @returns The `DropFilter` models, in response order.
 * @throws {@link ResponseValidationError} - Malformed payload
 *   (`RESPONSE_VALIDATION_ERROR`).
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
 *   failures.
 * @example
 * ```typescript
 * const filters = await ws.listDropFilters();
 * ```
 * @see mixpanel_headless.workspace.Workspace.list_drop_filters
 */
export async function listDropFilters(
  client: MixpanelClient,
): Promise<DropFilter[]> {
  const rawList = await client.listDropFilters();
  return validateResponseModels(
    DropFilter,
    rawList.map((item) => toNativeJson(item)),
    {
      endpoint: "list_drop_filters",
    },
  );
}

/**
 * Create a drop filter.
 *
 * @param client - The wire client.
 * @param params - Drop filter creation parameters; dumped without
 *   `by_alias`, as Python spells it.
 * @returns The full post-creation list of `DropFilter` models.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const filters = await ws.createDropFilter(
 *   new CreateDropFilterParams({ event_name: "Debug Ping", filters: [] }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.create_drop_filter
 */
export async function createDropFilter(
  client: MixpanelClient,
  params: CreateDropFilterParams,
): Promise<DropFilter[]> {
  const rawList = await client.createDropFilter(params.modelDumpExcludeNone());
  return validateResponseModels(
    DropFilter,
    rawList.map((item) => toNativeJson(item)),
    {
      endpoint: "create_drop_filter",
    },
  );
}

/**
 * Update a drop filter.
 *
 * @param client - The wire client.
 * @param params - Update parameters, including the filter `id`; dumped
 *   without `by_alias`.
 * @returns The full post-update list of `DropFilter` models.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const filters = await ws.updateDropFilter(
 *   new UpdateDropFilterParams({ id: 7, active: false }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.update_drop_filter
 */
export async function updateDropFilter(
  client: MixpanelClient,
  params: UpdateDropFilterParams,
): Promise<DropFilter[]> {
  const rawList = await client.updateDropFilter(params.modelDumpExcludeNone());
  return validateResponseModels(
    DropFilter,
    rawList.map((item) => toNativeJson(item)),
    {
      endpoint: "update_drop_filter",
    },
  );
}

/**
 * Delete a drop filter.
 *
 * @param client - The wire client.
 * @param dropFilterId - Id of the drop filter to delete.
 * @returns The full post-delete list of the remaining `DropFilter` models.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const remaining = await ws.deleteDropFilter(7);
 * ```
 * @see mixpanel_headless.workspace.Workspace.delete_drop_filter
 */
export async function deleteDropFilter(
  client: MixpanelClient,
  dropFilterId: number,
): Promise<DropFilter[]> {
  const rawList = await client.deleteDropFilter(dropFilterId);
  return validateResponseModels(
    DropFilter,
    rawList.map((item) => toNativeJson(item)),
    {
      endpoint: "delete_drop_filter",
    },
  );
}

/**
 * Fetch the drop-filter usage limits.
 *
 * @param client - The wire client.
 * @returns The `DropFilterLimitsResponse`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const { filter_limit } = await ws.getDropFilterLimits();
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_drop_filter_limits
 */
export async function getDropFilterLimits(
  client: MixpanelClient,
): Promise<DropFilterLimitsResponse> {
  const raw = await client.getDropFilterLimits();
  return validateResponseModel(DropFilterLimitsResponse, toNativeJson(raw), {
    endpoint: "get_drop_filter_limits",
  });
}

// --- Custom properties ---

/**
 * List every custom property.
 *
 * @remarks
 * When the App API fails to serialize a project whose custom property
 * carries an invalid `displayFormula`, the 400 body says
 * `{"field": "displayFormula"}` and Python re-raises a new `QueryError`
 * with an actionable message plus the original HTTP context. Every
 * other `QueryError` propagates untouched.
 * @param client - The wire client.
 * @returns The `CustomProperty` models, in response order.
 * @throws {@link QueryError} - The re-raised corruption error, or the original.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const properties = await ws.listCustomProperties();
 * ```
 * @see mixpanel_headless.workspace.Workspace.list_custom_properties
 */
export async function listCustomProperties(
  client: MixpanelClient,
): Promise<CustomProperty[]> {
  let rawList: readonly unknown[];
  try {
    rawList = await client.listCustomProperties();
  } catch (error) {
    if (!(error instanceof QueryError)) {
      throw error;
    }
    // `details.get("response_body", {})` — the key is absent (not
    // `null`) when the body was `None`, so the `{}` default fires
    // exactly where Python's does; `isinstance(body, dict)` is
    // `isPlainRecord`, never a bare `typeof === "object"`.
    const details = error.details;
    const body = isPlainRecord(details) ? (details["response_body"] ?? {}) : {};
    if (isPlainRecord(body) && body["field"] === "displayFormula") {
      throw new QueryError(
        "list_custom_properties() failed: the project contains a " +
          "custom property with an invalid displayFormula " +
          "(server-side data corruption). Use " +
          "get_custom_property(id) to retrieve individual " +
          "properties, or contact Mixpanel support.",
        {
          statusCode: error.statusCode,
          responseBody: error.responseBody,
          requestMethod: error.requestMethod,
          requestUrl: error.requestUrl,
          requestParams: error.requestParams,
          cause: error,
        },
      );
    }
    throw error;
  }
  return validateResponseModels(
    CustomProperty,
    rawList.map((item) => toNativeJson(item)),
    {
      endpoint: "list_custom_properties",
    },
  );
}

/**
 * Create a custom property.
 *
 * @param client - The wire client.
 * @param params - Creation parameters, dumped with `by_alias`. Python
 *   also passes `mode="json"`, whose only effect there is to render the
 *   `resource_type` enum as its string; the port stores that enum as a
 *   plain string already, so the bodies are identical.
 * @returns The created `CustomProperty`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const property = await ws.createCustomProperty(
 *   new CreateCustomPropertyParams({ name: "Plan tier", display_formula: "…" }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.create_custom_property
 */
export async function createCustomProperty(
  client: MixpanelClient,
  params: CreateCustomPropertyParams,
): Promise<CustomProperty> {
  const raw = await client.createCustomProperty(
    params.modelDumpExcludeNone({ byAlias: true }),
  );
  return validateResponseModel(CustomProperty, toNativeJson(raw), {
    endpoint: "create_custom_property",
  });
}

/**
 * Fetch a custom property by id.
 *
 * @param client - The wire client.
 * @param propertyId - Custom property id.
 * @returns The `CustomProperty`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const property = await ws.getCustomProperty("cp-123");
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_custom_property
 */
export async function getCustomProperty(
  client: MixpanelClient,
  propertyId: string,
): Promise<CustomProperty> {
  const raw = await client.getCustomProperty(propertyId);
  return validateResponseModel(CustomProperty, toNativeJson(raw), {
    endpoint: "get_custom_property",
  });
}

/**
 * Update a custom property.
 *
 * @param client - The wire client.
 * @param propertyId - Custom property id.
 * @param params - Fields to update, dumped with `by_alias`.
 * @returns The updated `CustomProperty`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * await ws.updateCustomProperty(
 *   "cp-123",
 *   new UpdateCustomPropertyParams({ description: "Derived plan tier" }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.update_custom_property
 */
export async function updateCustomProperty(
  client: MixpanelClient,
  propertyId: string,
  params: UpdateCustomPropertyParams,
): Promise<CustomProperty> {
  const raw = await client.updateCustomProperty(
    propertyId,
    params.modelDumpExcludeNone({ byAlias: true }),
  );
  return validateResponseModel(CustomProperty, toNativeJson(raw), {
    endpoint: "update_custom_property",
  });
}

/**
 * Delete a custom property.
 *
 * @param client - The wire client.
 * @param propertyId - Custom property id.
 * @returns Nothing.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
 *   failures.
 * @example
 * ```typescript
 * await ws.deleteCustomProperty("cp-123");
 * ```
 * @see mixpanel_headless.workspace.Workspace.delete_custom_property
 */
export async function deleteCustomProperty(
  client: MixpanelClient,
  propertyId: string,
): Promise<void> {
  await client.deleteCustomProperty(propertyId);
}

/**
 * Validate a custom property definition without creating it. The result
 * is returned verbatim, unvalidated.
 *
 * @param client - The wire client.
 * @param params - Parameters to validate, dumped with `by_alias`.
 * @returns The raw validation result.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
 *   failures.
 * @example
 * ```typescript
 * const result = await ws.validateCustomProperty(params);
 * ```
 * @see mixpanel_headless.workspace.Workspace.validate_custom_property
 */
export async function validateCustomProperty(
  client: MixpanelClient,
  params: CreateCustomPropertyParams,
): Promise<Record<string, unknown>> {
  const raw = await client.validateCustomProperty(
    params.modelDumpExcludeNone({ byAlias: true }),
  );
  return toNativeJson(raw) as Record<string, unknown>;
}

// --- Lookup tables ---

/**
 * List the lookup tables.
 *
 * @param client - The wire client.
 * @param options - Optional `data_group_id` filter.
 * @returns The `LookupTable` models, in response order.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const tables = await ws.listLookupTables({ data_group_id: 42n });
 * ```
 * @see mixpanel_headless.workspace.Workspace.list_lookup_tables
 */
export async function listLookupTables(
  client: MixpanelClient,
  options: WorkspaceListLookupTablesOptions = {},
): Promise<LookupTable[]> {
  const rawList = await client.listLookupTables({
    data_group_id: options.data_group_id ?? null,
  });
  // `unsafeIntegers: "bigint"`: `LookupTable.id` is a signed int64 that
  // a double would round (e.g. `-8644926364725811123`).
  return validateResponseModels(
    LookupTable,
    rawList.map((item) => toNativeJson(item, { unsafeIntegers: "bigint" })),
    {
      endpoint: "list_lookup_tables",
    },
  );
}

/**
 * Poll until an asynchronous lookup-table upload completes.
 *
 * @param client - The wire client.
 * @param uploadId - The asynchronous upload task id.
 * @param pollInterval - Seconds between polls.
 * @param maxPollSeconds - Maximum total wait, in seconds.
 * @param seams - The clock and sleep seams.
 * @param logger - Optional debug sink.
 * @returns The result record of the completed upload.
 * @throws {@link MixpanelHeadlessError} - `INVALID_RESPONSE` (`SUCCESS`
 *   with a non-dict `result`), `UPLOAD_FAILED` (`FAILURE` / `REVOKED`),
 *   `UPLOAD_NOT_FOUND` (`NOTFOUND`) or `UPLOAD_TIMEOUT` (deadline
 *   passed).
 * @see mixpanel_headless.workspace.Workspace._poll_lookup_upload
 */
// eslint-disable-next-line max-params -- positional parameters mirror the Python signature 1:1
async function pollLookupUpload(
  client: MixpanelClient,
  uploadId: string,
  pollInterval: number,
  maxPollSeconds: number,
  seams: LookupUploadSeams,
  logger: LookupUploadLogger | undefined,
): Promise<Record<string, unknown>> {
  const deadline = seams.monotonic() + maxPollSeconds;

  while (seams.monotonic() < deadline) {
    // Seconds in the Python-named option, milliseconds at the single
    // conversion point.
    await seams.sleep(pollInterval * 1000);
    const status = toNativeJson(await client.getLookupUploadStatus(uploadId), {
      unsafeIntegers: "bigint",
    }) as Record<string, unknown>;
    // `status.get("uploadStatus", "UNKNOWN")` — the default fires on
    // absence only (an explicit `null` stays `null`).
    const uploadStatus = Object.hasOwn(status, "uploadStatus")
      ? status["uploadStatus"]
      : "UNKNOWN";

    if (uploadStatus === "SUCCESS") {
      const result = status["result"];
      if (isPlainRecord(result)) {
        return result;
      }
      throw new MixpanelHeadlessError(
        `Lookup table upload succeeded but returned ` +
          `unexpected result: ${pythonStr(status as PythonValue)}`,
        "INVALID_RESPONSE",
      );
    }

    if (uploadStatus === "FAILURE" || uploadStatus === "REVOKED") {
      throw new MixpanelHeadlessError(
        `Lookup table upload failed with status ` +
          `'${pythonStr(uploadStatus)}': ${pythonStr(status as PythonValue)}`,
        "UPLOAD_FAILED",
        { upload_id: uploadId, status },
      );
    }

    if (uploadStatus === "NOTFOUND") {
      throw new MixpanelHeadlessError(
        `Lookup table upload not found (uploadId=${uploadId}). ` +
          `The upload may have expired.`,
        "UPLOAD_NOT_FOUND",
        { upload_id: uploadId },
      );
    }

    logger?.debug?.(
      `Lookup table upload status: ${pythonStr(uploadStatus as PythonValue)} ` +
        `(uploadId=${uploadId})`,
    );
  }

  throw new MixpanelHeadlessError(
    // `f"{max_poll_seconds}s"` over a `float`-annotated value:
    // `pythonFloatStr` keeps CPython's `300.0` spelling.
    `Lookup table upload timed out after ${pythonFloatStr(maxPollSeconds)}s ` +
      `(uploadId=${uploadId}). Use get_lookup_upload_status() ` +
      `to check progress manually.`,
    "UPLOAD_TIMEOUT",
    { upload_id: uploadId },
  );
}

/**
 * Upload a CSV file as a new lookup table.
 *
 * @remarks
 * The orchestration is: signed URL, GCS PUT, register, and for payloads
 * of 5 MB or more a poll until the asynchronous task completes. Every
 * wire hop is a client method; this body owns only the sequencing, the
 * form-data assembly and the `name` back-fill.
 * @param client - The wire client.
 * @param params - Upload parameters (`name`, `file_path`, optional
 *   `data_group_id`).
 * @param options - `poll_interval` (default `2.0` s) and
 *   `max_poll_seconds` (default `300.0` s).
 * @param seams - The `readFile`, clock and sleep seams.
 * @param logger - Optional log sink.
 * @returns The created `LookupTable`.
 * @throws {@link MixpanelHeadlessError} - `UNPORTED_FILE_READ_SEAM` when
 *   no `readFile` seam was injected, or any poll-loop code
 *   (`INVALID_RESPONSE`, `UPLOAD_FAILED`, `UPLOAD_NOT_FOUND`,
 *   `UPLOAD_TIMEOUT`).
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const table = await ws.uploadLookupTable(
 *   new UploadLookupTableParams({ name: "countries", file_path: "./countries.csv" }),
 *   { max_poll_seconds: 600 },
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.upload_lookup_table
 */
export async function uploadLookupTable(
  client: MixpanelClient,
  params: UploadLookupTableParams,
  options: WorkspaceUploadLookupTableOptions | undefined = {},
  seams: LookupUploadSeams,
  logger?: LookupUploadLogger,
): Promise<LookupTable> {
  const pollInterval = options.poll_interval ?? 2.0;
  const maxPollSeconds = options.max_poll_seconds ?? 300.0;

  // Step 1: signed upload URL (the client already enforces the
  // url/path/key presence guard — `MISSING_FIELD`).
  const urlInfo = await client.getLookupUploadUrl();

  // Step 2: read the CSV and PUT it to the signed URL. The dict values
  // are `Any` in Python and reach `str`-annotated parameters unchecked.
  const csvBytes = await seams.readFile(params.file_path);
  await client.uploadToSignedUrl(urlInfo["url"] as string, csvBytes);

  // Step 3: register the lookup table.
  const formData: Record<string, string> = {
    name: params.name,
    path: urlInfo["path"] as string,
    key: urlInfo["key"] as string,
  };
  if (params.data_group_id !== null) {
    formData["data-group-id"] = pythonStr(params.data_group_id);
  }

  let raw: unknown = toNativeJson(await client.registerLookupTable(formData), {
    unsafeIntegers: "bigint",
  });

  // `{"uploadId": "..."}` marks asynchronous processing for files of
  // 5 MB or more. Python guards the read with `isinstance(raw, dict)`
  // (`isPlainRecord` here); on a non-dict payload the read is skipped,
  // and `raw.get("uploadId")` treats absent and `null` alike.
  const uploadId = isPlainRecord(raw) ? (raw["uploadId"] ?? null) : null;
  if (uploadId !== null) {
    logger?.info?.(
      `Lookup table upload is processing asynchronously ` +
        `(uploadId=${pythonStr(uploadId as PythonValue)}), polling for completion...`,
    );
    raw = await pollLookupUpload(
      client,
      uploadId as string,
      pollInterval,
      maxPollSeconds,
      seams,
      logger,
    );
  }

  // The upload response may carry only `{'id': ...}`; inject the name
  // from params so LookupTable validation succeeds. A non-dict payload
  // flows to validation untouched, as in Python.
  if (isPlainRecord(raw) && !Object.hasOwn(raw, "name")) {
    raw = { ...raw, name: params.name };
  }
  return validateResponseModel(LookupTable, raw, {
    endpoint: "upload_lookup_table",
  });
}

/**
 * Mark a lookup table as ready after upload. The form-data dict is
 * built by hand rather than dumped from the model, as Python does.
 *
 * @param client - The wire client.
 * @param params - Parameters (`name`, `key`, optional
 *   `data_group_id`).
 * @returns The updated `LookupTable`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const table = await ws.markLookupTableReady(
 *   new MarkLookupTableReadyParams({ name: "countries", key: uploadUrl.key }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.mark_lookup_table_ready
 */
export async function markLookupTableReady(
  client: MixpanelClient,
  params: MarkLookupTableReadyParams,
): Promise<LookupTable> {
  const formData: Record<string, string> = {
    name: params.name,
    key: params.key,
  };
  if (params.data_group_id !== null) {
    formData["data-group-id"] = pythonStr(params.data_group_id);
  }
  const raw = await client.markLookupTableReady(formData);
  return validateResponseModel(
    LookupTable,
    toNativeJson(raw, { unsafeIntegers: "bigint" }),
    {
      endpoint: "mark_lookup_table_ready",
    },
  );
}

/**
 * Fetch a signed URL for uploading lookup-table data.
 *
 * @param client - The wire client.
 * @param contentType - MIME type of the file to upload (positional in
 *   Python, default `"text/csv"`).
 * @returns The `LookupTableUploadUrl`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const uploadUrl = await ws.getLookupUploadUrl("text/csv");
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_lookup_upload_url
 */
export async function getLookupUploadUrl(
  client: MixpanelClient,
  contentType = "text/csv",
): Promise<LookupTableUploadUrl> {
  const raw = await client.getLookupUploadUrl(contentType);
  return validateResponseModel(LookupTableUploadUrl, toNativeJson(raw), {
    endpoint: "get_lookup_upload_url",
  });
}

/**
 * Fetch the processing status of a lookup-table upload, verbatim
 * (no model validation).
 *
 * @param client - The wire client.
 * @param uploadId - The upload id returned by the upload process.
 * @returns The raw status record.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
 *   failures.
 * @example
 * ```typescript
 * const status = await ws.getLookupUploadStatus("upl_abc123");
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_lookup_upload_status
 */
export async function getLookupUploadStatus(
  client: MixpanelClient,
  uploadId: string,
): Promise<Record<string, unknown>> {
  const raw = await client.getLookupUploadStatus(uploadId);
  return toNativeJson(raw) as Record<string, unknown>;
}

/**
 * Update a lookup table.
 *
 * @param client - The wire client.
 * @param dataGroupId - Data group id of the lookup table (signed int64;
 *   `bigint` beyond 2^53).
 * @param params - Fields to update, dumped without `by_alias`.
 * @returns The updated `LookupTable`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * await ws.updateLookupTable(
 *   -8644926364725811123n,
 *   new UpdateLookupTableParams({ name: "countries-v2" }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.update_lookup_table
 */
export async function updateLookupTable(
  client: MixpanelClient,
  dataGroupId: number | bigint,
  params: UpdateLookupTableParams,
): Promise<LookupTable> {
  const raw = await client.updateLookupTable(
    dataGroupId,
    params.modelDumpExcludeNone(),
  );
  return validateResponseModel(
    LookupTable,
    toNativeJson(raw, { unsafeIntegers: "bigint" }),
    {
      endpoint: "update_lookup_table",
    },
  );
}

/**
 * Delete one or more lookup tables.
 *
 * @param client - The wire client.
 * @param dataGroupIds - Data group ids to delete (signed int64s;
 *   `bigint` beyond 2^53).
 * @returns Nothing.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
 *   failures.
 * @example
 * ```typescript
 * await ws.deleteLookupTables([42n, -8644926364725811123n]);
 * ```
 * @see mixpanel_headless.workspace.Workspace.delete_lookup_tables
 */
export async function deleteLookupTables(
  client: MixpanelClient,
  dataGroupIds: ReadonlyArray<number | bigint>,
): Promise<void> {
  await client.deleteLookupTables(dataGroupIds);
}

/**
 * Download lookup-table data as raw CSV bytes.
 *
 * @param client - The wire client.
 * @param dataGroupId - Data group id of the lookup table (signed int64;
 *   `bigint` beyond 2^53).
 * @param options - Optional `file_name` / `limit`.
 * @returns The raw CSV bytes (Python `bytes`).
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
 *   failures.
 * @example
 * ```typescript
 * const csv = await ws.downloadLookupTable(42n, { limit: 100 });
 * ```
 * @see mixpanel_headless.workspace.Workspace.download_lookup_table
 */
export async function downloadLookupTable(
  client: MixpanelClient,
  dataGroupId: number | bigint,
  options: WorkspaceDownloadLookupTableOptions = {},
): Promise<Uint8Array> {
  return client.downloadLookupTable(dataGroupId, {
    file_name: options.file_name ?? null,
    limit: options.limit ?? null,
  });
}

/**
 * Fetch a signed download URL for a lookup table.
 *
 * @param client - The wire client.
 * @param dataGroupId - Data group id of the lookup table (signed int64;
 *   `bigint` beyond 2^53).
 * @returns The signed URL.
 * @throws {@link MixpanelHeadlessError} - `MISSING_URL`, raised by the
 *   client when the response carries no URL.
 * @example
 * ```typescript
 * const url = await ws.getLookupDownloadUrl(42n);
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_lookup_download_url
 */
export async function getLookupDownloadUrl(
  client: MixpanelClient,
  dataGroupId: number | bigint,
): Promise<string> {
  return client.getLookupDownloadUrl(dataGroupId);
}

// --- Custom events ---

/**
 * Create a custom event.
 *
 * @param client - The wire client.
 * @param params - Creation parameters, serialized by the model's own
 *   `toFormBody()` (the Python model owns that serializer, so the port's
 *   does too).
 * @returns The created `CustomEvent`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const event = await ws.createCustomEvent(
 *   new CreateCustomEventParams({ name: "Any Signup", alternatives: [{ event: "Signup" }] }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.create_custom_event
 */
export async function createCustomEvent(
  client: MixpanelClient,
  params: CreateCustomEventParams,
): Promise<CustomEvent> {
  const raw = await client.createCustomEvent(params.toFormBody());
  return validateResponseModel(CustomEvent, toNativeJson(raw), {
    endpoint: "create_custom_event",
  });
}

/**
 * List every custom event.
 *
 * @param client - The wire client.
 * @returns The `EventDefinition` models for custom events.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const events = await ws.listCustomEvents();
 * ```
 * @see mixpanel_headless.workspace.Workspace.list_custom_events
 */
export async function listCustomEvents(
  client: MixpanelClient,
): Promise<EventDefinition[]> {
  const rawList = await client.listCustomEvents();
  return validateResponseModels(
    EventDefinition,
    rawList.map((item) => toNativeJson(item)),
    {
      endpoint: "list_custom_events",
    },
  );
}

/**
 * Update a custom event's Lexicon entry.
 *
 * @remarks
 * The event is identified by `custom_event_id`, never by name: a
 * name-only PATCH makes the server fabricate an orphan Lexicon entry.
 * The `UPDATE_TARGET_MISMATCH` echo check lives in the client.
 * @param client - The wire client.
 * @param customEventId - Server-assigned custom event id.
 * @param params - Fields to update, dumped with `by_alias`.
 * @returns The updated `EventDefinition`.
 * @throws {@link MixpanelHeadlessError} - `UPDATE_TARGET_MISMATCH` when the
 *   server echoes a different `customEventId`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * await ws.updateCustomEvent(
 *   9001,
 *   new UpdateEventDefinitionParams({ description: "Any signup path" }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.update_custom_event
 */
export async function updateCustomEvent(
  client: MixpanelClient,
  customEventId: number,
  params: UpdateEventDefinitionParams,
): Promise<EventDefinition> {
  const raw = await client.updateCustomEvent(
    customEventId,
    params.modelDumpExcludeNone({ byAlias: true }),
  );
  return validateResponseModel(EventDefinition, toNativeJson(raw), {
    endpoint: "update_custom_event",
  });
}

/**
 * Delete a custom event.
 *
 * @param client - The wire client.
 * @param customEventId - Server-assigned custom event id.
 * @returns Nothing.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
 *   failures.
 * @example
 * ```typescript
 * await ws.deleteCustomEvent(9001);
 * ```
 * @see mixpanel_headless.workspace.Workspace.delete_custom_event
 */
export async function deleteCustomEvent(
  client: MixpanelClient,
  customEventId: number,
): Promise<void> {
  await client.deleteCustomEvent(customEventId);
}
