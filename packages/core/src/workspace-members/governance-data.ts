/**
 * B6-W7 member module — the `Workspace` data-governance members that
 * are NOT Lexicon definitions: drop filters (`workspace.py:7583-7737`),
 * custom properties (`:7739-7952`), lookup tables (`:7954-8361`) and
 * custom events (`:8363-8525`), all Phase 027.
 *
 * Packet contract (`b6-packets.md` §2/§9): the `workspace.ts` B6-W7
 * section holds ONE-LINE delegations into this module; every member
 * here is a THIN facade body — options-bag mapping (R3.3/R3.8), the
 * params dump (W1-D4 {@link EntityModel.modelDumpExcludeNone}), the
 * like-named B4-C5 client method
 * (`services/entities/{drop-filters,custom-properties,lookup-tables,custom-events}.ts`,
 * composed onto the client at `client.ts:1077+`) and result-model
 * construction via `validateResponseModel(s)` with the exact
 * `endpoint=` string Python passes. No request assembly, no header
 * merging, no URL building, no status branching (R10.8 — compose,
 * never re-implement). In particular the `data-group-id` /
 * `file-name` / `content-type` param spellings, the form-encoded
 * register POST, the GCS PUT (no auth header), the
 * `UPDATE_TARGET_MISMATCH` echo check and the `MISSING_URL` /
 * `MISSING_FIELD` guards all live in the B4 client and are NOT
 * re-derived here.
 *
 * Shard-wide observations from the Python re-read (all 24 bodies read
 * line-by-line at HEAD 2026-08-16):
 *
 * - **21 of 24 members are pure forwards.** The three exceptions are
 *   {@link listCustomProperties} (the `displayFormula` corruption
 *   re-raise, `:7766-7786`), {@link uploadLookupTable} (the five-step
 *   orchestrator + poll loop, `:8036-8075` + `_poll_lookup_upload`
 *   `:8077-8144`) and {@link markLookupTableReady} (which builds a
 *   form-data dict rather than dumping the model, `:8178-8184`).
 * - **Three dump spellings, deliberately different.**
 *   `create_drop_filter` / `update_drop_filter` (`:7642`, `:7676`) and
 *   `update_lookup_table` (`:8277`) use the PLAIN
 *   `model_dump(exclude_none=True)`; `update_custom_property`
 *   (`:7891`), `validate_custom_property` (`:7950`) and
 *   `update_custom_event` (`:8488`) add `by_alias=True`;
 *   `create_custom_property` (`:7825`) additionally passes
 *   `mode="json"` — see W7-D4 below. The facade mirrors each source
 *   spelling exactly rather than harmonizing them.
 * - **ZERO empty-response guards** (`if raw is None: raise …`) across
 *   all four ranges — verified by grep, matching the W5/W6 precedent.
 *   The shared `requireResponse` helper is therefore deliberately
 *   unused; adding it would invent a branch Python does not have.
 * - **Three opaque passthroughs** return the client payload verbatim
 *   under a `dict[str, Any]` annotation with no model validation:
 *   `validate_custom_property` (`:7951`), `get_lookup_upload_status`
 *   (`:8245`) — plus `download_lookup_table` (`bytes`, `:8333`) and
 *   `get_lookup_download_url` (`str`, `:8360`), which forward the
 *   client's already-typed return.
 * - **`create_custom_event` is the port's only `to_form_body()` call
 *   site** (`:8406`) — W7-D3 lands that method on the Phase-2 model.
 *
 * ## Arbiter-visible decisions
 *
 * - **W7-D1 (packet §9) — the `readFile` seam.** Python reads the CSV
 *   with `Path(params.file_path).read_bytes()` (`:8044`).
 *   `packages/core` is runtime-agnostic (no `node:fs`), so the byte
 *   source is injected via {@link LookupUploadSeams.readFile}
 *   (`WorkspaceOptions.readFile`); the default throws
 *   `UNPORTED_FILE_READ_SEAM`. The real reader ships in
 *   `packages/node` (`nodeReadFile`, fs-seams.ts — B8-N1); core stays
 *   runtime-agnostic (core-alone posture, b8-packets.md §4.4).
 * - **W7-D2 — the poll clock.** Python's `_poll_lookup_upload` mixes
 *   `time.monotonic()` (deadline) with `time.sleep()` (`:8099-8102`).
 *   The sleep rides the client's existing injected seam
 *   (`client.core.sleep`, R6.3) with the ONE seconds→ms conversion at
 *   the call site (R2.12); the deadline rides
 *   {@link LookupUploadSeams.monotonic} (SECONDS, Python spelling),
 *   whose default is `Date.now() / 1000`. Sanctioned micro-deviation:
 *   `Date.now()` is a wall clock, so a system-clock adjustment mid-poll
 *   would shift the deadline where CPython's monotonic source would
 *   not — no monotonic source exists in the runtime-agnostic core, and
 *   the seam lets `packages/node` inject one. `poll_interval` /
 *   `max_poll_seconds` keep their Python names AND their SECONDS unit
 *   in the options bag.
 * - **W7-D3 — `CreateCustomEventParams.toFormBody()`.** Python's model
 *   owns the serializer (`types.py:4929-4942`), so the twin lands on
 *   the Phase-2 model (`types/entities/data-governance.ts`) over
 *   {@link pythonJsonDumps} — CPython `json.dumps` defaults, i.e. a
 *   SPACE after every colon/comma and `ensure_ascii=True`. R10.8: the
 *   dumper is not re-derived here.
 * - **W7-D4 — `mode="json"` is a no-op in the TS twin.**
 *   `create_custom_property` (`:7825`) is the facade's ONLY
 *   `mode="json"` dump. For `CreateCustomPropertyParams` the flag has
 *   exactly one Python effect: `resource_type` is a `str`-`Enum`
 *   (`types.py:5333`) that mode="python" would leave as an Enum member.
 *   The TS port represents that enum as a plain string at runtime
 *   (`types/enums.ts:114-118`), and nested models
 *   (`ComposedPropertyValue`) recurse in BOTH pydantic modes, so the
 *   dumped body is identical either way. Recorded rather than modelled:
 *   no `modeJson` flag is added to
 *   {@link EntityModel.modelDumpExcludeNone}.
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

// ---------------------------------------------------------------------------
// Options bags (R3.3/R3.8 — keyword-only tails; keys keep the Python
// spelling since the recorder replays kwargs by name).
// ---------------------------------------------------------------------------

/** Options bag of `Workspace.listLookupTables` (`workspace.py:7957`). */
export interface WorkspaceListLookupTablesOptions {
  /**
   * Optional filter by data group ID (Python default `None`); a
   * `bigint` carries an int64 id beyond 2^53 exactly.
   */
  readonly data_group_id?: number | bigint | null | undefined;
}

/** Options bag of `Workspace.downloadLookupTable` (`workspace.py:8302`). */
export interface WorkspaceDownloadLookupTableOptions {
  /** Optional file name filter (Python default `None`). */
  readonly file_name?: string | null | undefined;
  /** Optional row limit (Python default `None`). */
  readonly limit?: number | null | undefined;
}

/**
 * Options bag of `Workspace.uploadLookupTable` (`workspace.py:7989-7995`).
 *
 * Both members stay in SECONDS under their Python names — the single
 * seconds→milliseconds conversion happens at the sleep call site
 * (R2.12).
 */
export interface WorkspaceUploadLookupTableOptions {
  /** Seconds between status polls for async uploads (default `2.0`). */
  readonly poll_interval?: number | undefined;
  /** Maximum seconds to wait for async processing (default `300.0`). */
  readonly max_poll_seconds?: number | undefined;
}

/**
 * The runtime seams {@link uploadLookupTable} needs — W7-D1/W7-D2.
 *
 * The facade supplies these from `WorkspaceOptions` (`readFile`,
 * `monotonic`) and the bound client (`client.core.sleep`); tests and
 * `packages/node` override them.
 */
export interface LookupUploadSeams {
  /**
   * `Path(file_path).read_bytes()` (`workspace.py:8044`).
   *
   * @param path - The local CSV path.
   * @returns The file bytes.
   */
  readFile: (path: string) => Promise<Uint8Array>;
  /**
   * `time.monotonic()` in SECONDS (`workspace.py:8099`, `:8101`).
   *
   * @returns Elapsed seconds from an arbitrary origin.
   */
  monotonic: () => number;
  /**
   * `time.sleep(poll_interval)` (`workspace.py:8102`) — MILLISECONDS
   * (R2.12); the caller converts.
   *
   * @param ms - Milliseconds to wait.
   * @returns Resolves when the wait elapses.
   */
  sleep: (ms: number) => Promise<void>;
}

/** The optional log sink of the upload orchestrator (`logging` twin). */
export interface LookupUploadLogger {
  /**
   * `logger.info(...)` — the async-processing notice
   * (`workspace.py:8062-8066`).
   *
   * @param message - The formatted text (never vector-compared).
   */
  info?: (message: string) => void;
  /**
   * `logger.debug(...)` — the per-poll status trace
   * (`workspace.py:8132-8136`).
   *
   * @param message - The formatted text (never vector-compared).
   */
  debug?: (message: string) => void;
}

/**
 * The default {@link LookupUploadSeams.readFile} — the real reader
 * ships in `packages/node` (`nodeReadFile`, fs-seams.ts — B8-N1); this
 * default stays so core without a wired reader still throws the coded
 * error (core-alone posture, b8-packets.md §4.4; marker retired at the
 * B8 pair-A arbiter, `b8-reviewA-resolution.md` ASR-F2).
 *
 * @returns Never; always throws.
 * @throws MixpanelHeadlessError - Code `UNPORTED_FILE_READ_SEAM`.
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
 * The default {@link LookupUploadSeams.monotonic} (W7-D2).
 *
 * @returns Seconds since the Unix epoch on the wall clock.
 */
export function defaultMonotonic(): number {
  return Date.now() / 1000;
}

// ---------------------------------------------------------------------------
// Drop filters (`workspace.py:7583-7737`)
// ---------------------------------------------------------------------------

/**
 * List all drop filters (`list_drop_filters`,
 * `workspace.py:7586-7611`).
 *
 * @param client - The wire client.
 * @returns The `DropFilter` models, in response order.
 * @throws ResponseValidationError - Malformed payload
 *   (`RESPONSE_VALIDATION_ERROR`).
 * @throws AuthenticationError | QueryError | ServerError - Wire
 *   failures per the B0 contract.
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
 * Create a new drop filter (`create_drop_filter`,
 * `workspace.py:7613-7646`).
 *
 * @param client - The wire client.
 * @param params - Drop filter creation parameters (dumped WITHOUT
 *   `by_alias`, `:7642`).
 * @returns The FULL post-creation list of `DropFilter` models.
 * @throws ResponseValidationError - Malformed payload.
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
 * Update a drop filter (`update_drop_filter`,
 * `workspace.py:7648-7680`).
 *
 * @param client - The wire client.
 * @param params - Update parameters (must include the filter ID);
 *   dumped WITHOUT `by_alias` (`:7676`).
 * @returns The FULL post-update list of `DropFilter` models.
 * @throws ResponseValidationError - Malformed payload.
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
 * Delete a drop filter (`delete_drop_filter`,
 * `workspace.py:7682-7709`).
 *
 * @param client - The wire client.
 * @param dropFilterId - Drop filter ID (integer).
 * @returns The FULL post-delete list of remaining `DropFilter` models.
 * @throws ResponseValidationError - Malformed payload.
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
 * Get drop filter usage limits (`get_drop_filter_limits`,
 * `workspace.py:7711-7736`).
 *
 * @param client - The wire client.
 * @returns The `DropFilterLimitsResponse`.
 * @throws ResponseValidationError - Malformed payload.
 */
export async function getDropFilterLimits(
  client: MixpanelClient,
): Promise<DropFilterLimitsResponse> {
  const raw = await client.getDropFilterLimits();
  return validateResponseModel(DropFilterLimitsResponse, toNativeJson(raw), {
    endpoint: "get_drop_filter_limits",
  });
}

// ---------------------------------------------------------------------------
// Custom properties (`workspace.py:7739-7952`)
// ---------------------------------------------------------------------------

/**
 * List all custom properties (`list_custom_properties`,
 * `workspace.py:7742-7789`).
 *
 * The shard's server-corruption branch: when the App API fails to
 * serialize a project whose custom property carries an invalid
 * `displayFormula`, the 400 body says `{"field": "displayFormula"}` and
 * Python re-raises a NEW `QueryError` carrying an actionable message
 * plus the original HTTP context (`:7766-7786`). Every other
 * `QueryError` propagates untouched.
 *
 * @param client - The wire client.
 * @returns The `CustomProperty` models, in response order.
 * @throws QueryError - The re-raised corruption error, or the original.
 * @throws ResponseValidationError - Malformed payload.
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
    // `details.get("response_body", {})` — the key is ABSENT (not
    // `null`) when the body was `None` (R4.11 detail-bag mirror), so
    // the `{}` default fires exactly where Python's does. Watchlist
    // #13: `isinstance(body, dict)` is `isPlainRecord`, never a bare
    // `typeof === "object"`.
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
 * Create a new custom property (`create_custom_property`,
 * `workspace.py:7791-7829`).
 *
 * @param client - The wire client.
 * @param params - Creation parameters; dumped with `by_alias=True`
 *   (and Python's `mode="json"`, a no-op in the TS twin — W7-D4).
 * @returns The created `CustomProperty`.
 * @throws ResponseValidationError - Malformed payload.
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
 * Get a custom property by ID (`get_custom_property`,
 * `workspace.py:7831-7859`).
 *
 * @param client - The wire client.
 * @param propertyId - Custom property ID (string).
 * @returns The `CustomProperty`.
 * @throws ResponseValidationError - Malformed payload.
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
 * Update a custom property (`update_custom_property`,
 * `workspace.py:7861-7895`).
 *
 * @param client - The wire client.
 * @param propertyId - Custom property ID (string).
 * @param params - Fields to update (dumped with `by_alias=True`,
 *   `:7891`).
 * @returns The updated `CustomProperty`.
 * @throws ResponseValidationError - Malformed payload.
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
 * Delete a custom property (`delete_custom_property`,
 * `workspace.py:7897-7916`).
 *
 * @param client - The wire client.
 * @param propertyId - Custom property ID (string).
 * @returns Nothing.
 * @throws AuthenticationError | QueryError | ServerError - Wire
 *   failures.
 */
export async function deleteCustomProperty(
  client: MixpanelClient,
  propertyId: string,
): Promise<void> {
  await client.deleteCustomProperty(propertyId);
}

/**
 * Validate a custom property definition without creating it
 * (`validate_custom_property`, `workspace.py:7918-7951`).
 *
 * Opaque passthrough: Python returns the client dict unvalidated.
 *
 * @param client - The wire client.
 * @param params - Parameters to validate (dumped with `by_alias=True`
 *   and NO `mode="json"`, `:7950`).
 * @returns The raw validation result.
 * @throws AuthenticationError | QueryError | ServerError - Wire
 *   failures.
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

// ---------------------------------------------------------------------------
// Lookup tables (`workspace.py:7954-8361`)
// ---------------------------------------------------------------------------

/**
 * List lookup tables (`list_lookup_tables`,
 * `workspace.py:7957-7987`).
 *
 * @param client - The wire client.
 * @param options - Optional `data_group_id` filter (keyword-only).
 * @returns The `LookupTable` models, in response order.
 * @throws ResponseValidationError - Malformed payload.
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
 * Poll for async lookup-table upload completion
 * (`_poll_lookup_upload`, `workspace.py:8077-8144`).
 *
 * @param client - The wire client.
 * @param uploadId - Async upload task ID.
 * @param pollInterval - Seconds between polls.
 * @param maxPollSeconds - Maximum total wait time in seconds.
 * @param seams - The clock/sleep seams (W7-D2).
 * @param logger - Optional debug sink.
 * @returns The result record of the completed upload.
 * @throws MixpanelHeadlessError - `INVALID_RESPONSE` (SUCCESS with a
 *   non-dict `result`), `UPLOAD_FAILED` (FAILURE/REVOKED),
 *   `UPLOAD_NOT_FOUND` (NOTFOUND) or `UPLOAD_TIMEOUT` (deadline).
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
    // R2.12: seconds in the Python-named option, milliseconds at the
    // ONE conversion point.
    await seams.sleep(pollInterval * 1000);
    const status = toNativeJson(await client.getLookupUploadStatus(uploadId), {
      unsafeIntegers: "bigint",
    }) as Record<string, unknown>;
    // `status.get("uploadStatus", "UNKNOWN")` — the default fires on
    // ABSENCE only (an explicit `null` stays `null`), R4.8.
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
    // `f"{max_poll_seconds}s"` over a `float`-annotated value —
    // `pythonFloatStr` keeps CPython's `300.0` spelling (R11.7; it also
    // sidesteps Discrepancy #12 at this site).
    `Lookup table upload timed out after ${pythonFloatStr(maxPollSeconds)}s ` +
      `(uploadId=${uploadId}). Use get_lookup_upload_status() ` +
      `to check progress manually.`,
    "UPLOAD_TIMEOUT",
    { upload_id: uploadId },
  );
}

/**
 * Upload a CSV file as a new lookup table (`upload_lookup_table`,
 * `workspace.py:7989-8075`).
 *
 * The shard's orchestrator: signed URL → GCS PUT → register → (for
 * payloads ≥ 5 MB) poll until the async task completes. Every wire hop
 * is a B4-C5 client method; this body owns only the sequencing, the
 * form-data assembly and the `name` back-fill.
 *
 * @param client - The wire client.
 * @param params - Upload parameters (`name`, `file_path`, optional
 *   `data_group_id`).
 * @param options - `poll_interval` (default `2.0` s) and
 *   `max_poll_seconds` (default `300.0` s), keyword-only in Python.
 * @param seams - The `readFile` / clock seams (W7-D1/W7-D2).
 * @param logger - Optional log sink.
 * @returns The created `LookupTable`.
 * @throws MixpanelHeadlessError - `UNPORTED_FILE_READ_SEAM` (default
 *   `readFile`), or any poll-loop code above.
 * @throws ResponseValidationError - Malformed payload.
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
  // are `Any` in Python and reach `str`-annotated parameters unchecked
  // (Discrepancy #8: out-of-annotation values are unspecified).
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

  // `{"uploadId": "..."}` marks async (Celery) processing for files
  // >= 5 MB. Python guards the read with `isinstance(raw, dict)`
  // (`:8060`) — watchlist #13 ports it as `isPlainRecord`; on a
  // non-dict payload the read is skipped and `raw.get("uploadId")`
  // treats absent and `null` alike (B6-ARB fidelity F2).
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
  // from params so LookupTable validation succeeds (`:8071-8074`).
  // Python's `isinstance(raw, dict)` half of the guard ports as
  // `isPlainRecord` — a non-dict payload flows to validation UNTOUCHED
  // (B6-ARB fidelity F2).
  if (isPlainRecord(raw) && !Object.hasOwn(raw, "name")) {
    raw = { ...raw, name: params.name };
  }
  return validateResponseModel(LookupTable, raw, {
    endpoint: "upload_lookup_table",
  });
}

/**
 * Mark a lookup table as ready after upload
 * (`mark_lookup_table_ready`, `workspace.py:8146-8188`).
 *
 * Builds the form-data dict by hand (no model dump) exactly as Python
 * does at `:8178-8184`.
 *
 * @param client - The wire client.
 * @param params - Parameters (`name`, `key`, optional
 *   `data_group_id`).
 * @returns The updated `LookupTable`.
 * @throws ResponseValidationError - Malformed payload.
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
 * Get a signed URL for uploading lookup table data
 * (`get_lookup_upload_url`, `workspace.py:8190-8220`).
 *
 * @param client - The wire client.
 * @param contentType - MIME type of the file to upload (Python
 *   POSITIONAL with default `"text/csv"`).
 * @returns The `LookupTableUploadUrl`.
 * @throws ResponseValidationError - Malformed payload.
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
 * Get the processing status of a lookup table upload
 * (`get_lookup_upload_status`, `workspace.py:8222-8245`).
 *
 * Opaque passthrough (no model validation).
 *
 * @param client - The wire client.
 * @param uploadId - Upload ID returned from the upload process.
 * @returns The raw status record.
 * @throws AuthenticationError | QueryError | ServerError - Wire
 *   failures.
 */
export async function getLookupUploadStatus(
  client: MixpanelClient,
  uploadId: string,
): Promise<Record<string, unknown>> {
  const raw = await client.getLookupUploadStatus(uploadId);
  return toNativeJson(raw) as Record<string, unknown>;
}

/**
 * Update a lookup table (`update_lookup_table`,
 * `workspace.py:8247-8279`).
 *
 * @param client - The wire client.
 * @param dataGroupId - Data group ID of the lookup table (signed int64;
 *   `bigint` beyond 2^53).
 * @param params - Fields to update (dumped WITHOUT `by_alias`,
 *   `:8277`).
 * @returns The updated `LookupTable`.
 * @throws ResponseValidationError - Malformed payload.
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
 * Delete one or more lookup tables (`delete_lookup_tables`,
 * `workspace.py:8281-8300`).
 *
 * @param client - The wire client.
 * @param dataGroupIds - Data group IDs to delete (signed int64s;
 *   `bigint` beyond 2^53).
 * @returns Nothing.
 * @throws AuthenticationError | QueryError | ServerError - Wire
 *   failures.
 */
export async function deleteLookupTables(
  client: MixpanelClient,
  dataGroupIds: ReadonlyArray<number | bigint>,
): Promise<void> {
  await client.deleteLookupTables(dataGroupIds);
}

/**
 * Download lookup table data as raw CSV bytes
 * (`download_lookup_table`, `workspace.py:8302-8335`).
 *
 * @param client - The wire client.
 * @param dataGroupId - Data group ID of the lookup table (signed int64;
 *   `bigint` beyond 2^53).
 * @param options - Optional `file_name` / `limit` (keyword-only).
 * @returns The raw CSV bytes (Python `bytes`).
 * @throws AuthenticationError | QueryError | ServerError - Wire
 *   failures.
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
 * Get a signed download URL for a lookup table
 * (`get_lookup_download_url`, `workspace.py:8337-8360`).
 *
 * @param client - The wire client.
 * @param dataGroupId - Data group ID of the lookup table (signed int64;
 *   `bigint` beyond 2^53).
 * @returns The signed URL string.
 * @throws MixpanelHeadlessError - `MISSING_URL` (raised by the B4
 *   client when the response carries no URL).
 */
export async function getLookupDownloadUrl(
  client: MixpanelClient,
  dataGroupId: number | bigint,
): Promise<string> {
  return client.getLookupDownloadUrl(dataGroupId);
}

// ---------------------------------------------------------------------------
// Custom events (`workspace.py:8363-8525`)
// ---------------------------------------------------------------------------

/**
 * Create a new custom event (`create_custom_event`,
 * `workspace.py:8366-8407`).
 *
 * @param client - The wire client.
 * @param params - Creation parameters, serialized by the model's own
 *   `to_form_body()` (W7-D3).
 * @returns The created `CustomEvent`.
 * @throws ResponseValidationError - Malformed payload.
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
 * List all custom events (`list_custom_events`,
 * `workspace.py:8409-8434`).
 *
 * @param client - The wire client.
 * @returns The `EventDefinition` models for custom events.
 * @throws ResponseValidationError - Malformed payload.
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
 * Update a custom event's Lexicon entry (`update_custom_event`,
 * `workspace.py:8436-8492`).
 *
 * Identified by `custom_event_id`, never by name — a name-only PATCH
 * makes the server fabricate an orphan lexicon entry. The
 * `UPDATE_TARGET_MISMATCH` echo check lives in the B4 client.
 *
 * @param client - The wire client.
 * @param customEventId - Server-assigned custom event ID.
 * @param params - Fields to update (dumped with `by_alias=True`,
 *   `:8488`).
 * @returns The updated `EventDefinition`.
 * @throws MixpanelHeadlessError - `UPDATE_TARGET_MISMATCH` when the
 *   server echoes a different `customEventId`.
 * @throws ResponseValidationError - Malformed payload.
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
 * Delete a custom event (`delete_custom_event`,
 * `workspace.py:8494-8524`).
 *
 * @param client - The wire client.
 * @param customEventId - Server-assigned custom event ID.
 * @returns Nothing.
 * @throws AuthenticationError | QueryError | ServerError - Wire
 *   failures.
 */
export async function deleteCustomEvent(
  client: MixpanelClient,
  customEventId: number,
): Promise<void> {
  await client.deleteCustomEvent(customEventId);
}
