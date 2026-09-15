/**
 * Lexicon data-definition wire methods on the App API: event and property
 * definitions (through the private `_event_definitions` /
 * `_property_definitions` cores — plain GETs with `name[]` filters and
 * bare-list shape checks, no `paginate_all`), tags, tracking metadata,
 * history and export. All ride `appRequest` over `maybe_scoped_path`
 * except `listPerEventProperties`, a query-host request (Python PR #215
 * moved the schema-graph edge gather off the App API's deadline-bound
 * `includeEvents` join).
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_event_definitions
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/core.js";
import { bindFirst, isPlainRecord } from "../../client/internals.js";
import type { JsonValue } from "../../client/json-value.js";
import { pythonJsonDumps } from "../../compat/index.js";
import { MixpanelHeadlessError } from "../../errors.js";
import { pythonTypeNameOf, scopedPath } from "../shared.js";
import { expectListResult, expectRecordResult, pythonQuote } from "./shared.js";

/**
 * Canonical spellings of the `resourceType` param: the App API honors only
 * the camelCase param with a capitalized value; lowercase returns 400 and
 * snake_case is silently ignored. Unknown spellings pass through.
 */
const RESOURCE_TYPE_CANONICAL: Readonly<Record<string, string>> = {
  event: "Event",
  events: "Event",
  user: "User",
  users: "User",
  people: "User",
};

/**
 * Normalize a caller's resource-type spelling to the App API's canonical value.
 *
 * @param resourceType - A caller-supplied filter ("event", "People", ...).
 * @returns `"Event"` / `"User"` for known spellings; the input
 *   unchanged otherwise.
 * @example
 * ```typescript
 * canonicalResourceType("people"); // "User"
 * canonicalResourceType("Custom"); // "Custom" (unknown spellings pass through)
 * ```
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient._canonical_resource_type
 */
export function canonicalResourceType(resourceType: string): string {
  return RESOURCE_TYPE_CANONICAL[resourceType.toLowerCase()] ?? resourceType;
}

/**
 * Options bag of {@link LexiconMethods.listPropertyDefinitions}
 * (Python kw-only params with their source defaults).
 */
export interface ListPropertyDefinitionsOptions {
  /**
   * Property family, `"Event"` or `"User"` (any spelling
   * {@link canonicalResourceType} accepts).
   *
   * @defaultValue `"Event"`
   */
  readonly resource_type?: string | undefined;
  /**
   * Attach the events each property appears on.
   *
   * @defaultValue `false`
   */
  readonly include_events?: boolean | undefined;
  /**
   * Request property-level density.
   *
   * @defaultValue `false`
   */
  readonly include_density?: boolean | undefined;
  /**
   * Include custom (computed) properties.
   *
   * @defaultValue `true`
   */
  readonly include_custom?: boolean | undefined;
  /**
   * Include properties with no recorded data.
   *
   * @defaultValue `true`
   */
  readonly include_zero_counts?: boolean | undefined;
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal | undefined;
}

/** The private `_property_definitions` kwargs. */
interface PropertyDefinitionsArgs {
  readonly names?: readonly string[] | null;
  readonly resourceType?: string | null;
  readonly includeEvents?: boolean;
  readonly includeDensity?: boolean;
  readonly includeCustom?: boolean | null;
  readonly includeZeroCounts?: boolean | null;
  readonly signal?: AbortSignal | undefined;
}

/** Lexicon methods mixed into `MixpanelClient`. */
export interface LexiconMethods {
  /**
   * Get event definitions by name. Sends GET `data-definitions/events/` with a
   * `name[]` filter via the `_event_definitions` shared core.
   *
   * @param names - Event names to look up.
   * @param signal - Optional cancellation signal.
   * @returns The definition list verbatim.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_event_definitions
   */
  getEventDefinitions: (
    names: readonly string[],
    signal?: AbortSignal,
  ) => Promise<JsonValue[]>;

  /**
   * List all event definitions. Same request as
   * {@link LexiconMethods.getEventDefinitions} without the `name[]` filter.
   *
   * @param signal - Optional cancellation signal.
   * @returns The definition list verbatim.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_event_definitions
   */
  listEventDefinitions: (signal?: AbortSignal) => Promise<JsonValue[]>;

  /**
   * Update an event definition. Sends PATCH `data-definitions/events/` with
   * `{**body, name}`.
   *
   * @param name - Event name to update.
   * @param body - Fields to update.
   * @param signal - Optional cancellation signal.
   * @returns The updated definition dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.update_event_definition
   */
  updateEventDefinition: (
    name: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Delete an event definition. Sends DELETE with JSON body `{name}`.
   *
   * @param name - Event name to delete.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.delete_event_definition
   */
  deleteEventDefinition: (name: string, signal?: AbortSignal) => Promise<void>;

  /**
   * Bulk-update event definitions. Sends PATCH with the caller's `{events: [...]}`
   * body.
   *
   * @param body - Bulk update payload.
   * @param signal - Optional cancellation signal.
   * @returns The updated definition list.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.bulk_update_event_definitions
   */
  bulkUpdateEventDefinitions: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<JsonValue[]>;

  /**
   * Get property definitions by name. Sends GET `data-definitions/properties/`
   * with a `name[]` filter and, when given, the normalized `resourceType`.
   *
   * @param names - Property names to look up.
   * @param resourceType - Optional resource-type filter (normalized).
   * @param signal - Optional cancellation signal.
   * @returns The definition list verbatim.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_property_definitions
   */
  getPropertyDefinitions: (
    names: readonly string[],
    resourceType?: string | null,
    signal?: AbortSignal,
  ) => Promise<JsonValue[]>;

  /**
   * List all property definitions for the project. Sends GET
   * `data-definitions/properties/` with the `include*` toggles.
   *
   * @param options - Optional kw-only toggles + signal.
   * @returns The definition list verbatim.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @internal
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_property_definitions
   */
  listPropertyDefinitions: (
    options?: ListPropertyDefinitionsOptions,
  ) => Promise<JsonValue[]>;

  /**
   * List every event with the properties observed on it. Sends GET
   * `{query}/data_definitions/events` with `fetch_per_event_properties=true`
   * and unwraps the `results` envelope.
   *
   * @remarks
   * This is the relationship source for the schema graph. The App API's
   * `includeEvents=true` bulk call computes the same event↔property join
   * behind a ~120 s gateway deadline it cannot meet on large projects; the
   * query-API route (the one the Lexicon UI itself uses) permits longer
   * runs, so this request is sent with the export timeout. A pinned
   * workspace is injected as `workspace_id` and the server applies its
   * event-name filters.
   * @param signal - Optional cancellation signal.
   * @returns List of event dicts; each carries a `properties` list of
   *   property definition dicts (at minimum `{name: ...}`-shaped).
   * @throws {@link MixpanelHeadlessError} - Non-list `results` payload (plus the
   *   wire-contract errors of the query-host path).
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_per_event_properties
   */
  listPerEventProperties: (signal?: AbortSignal) => Promise<JsonValue[]>;

  /**
   * Update a property definition. Sends PATCH `data-definitions/properties/` with
   * `{**body, name}`.
   *
   * @param name - Property name to update.
   * @param body - Fields to update.
   * @param signal - Optional cancellation signal.
   * @returns The updated definition dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.update_property_definition
   */
  updatePropertyDefinition: (
    name: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Bulk-update property definitions. Sends PATCH with the caller's
   * `{properties: [...]}` body.
   *
   * @param body - Bulk update payload.
   * @param signal - Optional cancellation signal.
   * @returns The updated definition list.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.bulk_update_property_definitions
   */
  bulkUpdatePropertyDefinitions: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<JsonValue[]>;

  /**
   * List Lexicon tags. Sends GET `data-definitions/tags/`.
   *
   * @param signal - Optional cancellation signal.
   * @returns The tag list verbatim.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.list_lexicon_tags
   */
  listLexiconTags: (signal?: AbortSignal) => Promise<JsonValue[]>;

  /**
   * Create a Lexicon tag. Sends POST `data-definitions/tags/`.
   *
   * @param body - Tag creation parameters (name).
   * @param signal - Optional cancellation signal.
   * @returns The created tag dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.create_lexicon_tag
   */
  createLexiconTag: (
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Update a Lexicon tag. Sends PATCH `data-definitions/tags/{tag_id}/`; integer
   * id.
   *
   * @param tagId - Tag ID (integer).
   * @param body - Fields to update (name).
   * @param signal - Optional cancellation signal.
   * @returns The updated tag dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.update_lexicon_tag
   */
  updateLexiconTag: (
    tagId: number,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Delete a Lexicon tag by name. Sends POST `data-definitions/tags/` with
   * `{delete: True, name}`.
   *
   * @remarks
   * The API uses POST, not DELETE, for tag removal.
   * @param name - Name of the tag to delete.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.delete_lexicon_tag
   */
  deleteLexiconTag: (name: string, signal?: AbortSignal) => Promise<void>;

  /**
   * Get tracking metadata for an event. Sends GET `.../events/tracking-metadata/`
   * with the `event_name` query param.
   *
   * @param eventName - Name of the event.
   * @param signal - Optional cancellation signal.
   * @returns The metadata dict.
   * @throws {@link MixpanelHeadlessError} - Non-dict response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_tracking_metadata
   */
  getTrackingMetadata: (
    eventName: string,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;

  /**
   * Get event definition change history. Sends GET
   * `.../events/{quoted name}/history/`.
   *
   * @param eventName - Name of the event.
   * @param signal - Optional cancellation signal.
   * @returns The history entry list.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_event_history
   */
  getEventHistory: (
    eventName: string,
    signal?: AbortSignal,
  ) => Promise<JsonValue[]>;

  /**
   * Get property definition change history. Sends GET
   * `.../properties/{quoted name}/history/` with the `entity_type` query param.
   *
   * @param propertyName - Name of the property.
   * @param entityType - Entity type ("event", "user", ...).
   * @param signal - Optional cancellation signal.
   * @returns The history entry list.
   * @throws {@link MixpanelHeadlessError} - Non-list response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.get_property_history
   */
  getPropertyHistory: (
    propertyName: string,
    entityType: string,
    signal?: AbortSignal,
  ) => Promise<JsonValue[]>;

  /**
   * Export Lexicon data definitions. Sends GET `data-definitions/export/` with the
   * JSON-encoded `export_type` param; a plain-string result wraps into
   * `{status: "pending", message}`.
   *
   * @param exportTypes - Optional export-type list (defaults to the
   *   source's two-entry list).
   * @param signal - Optional cancellation signal.
   * @returns The export dict (or the pending wrapper).
   * @throws {@link MixpanelHeadlessError} - Non-dict, non-string response.
   * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.export_lexicon
   */
  exportLexicon: (
    exportTypes?: readonly string[] | null,
    signal?: AbortSignal,
  ) => Promise<Record<string, JsonValue>>;
}
/**
 * `_event_definitions`: the shared core
 * behind the by-name lookup and the bulk enumerate.
 *
 * @param core - The shared client internals seam.
 * @param names - Optional `name[]` filter values.
 * @param signal - Optional cancellation signal.
 * @returns The definition list.
 * @throws {@link MixpanelHeadlessError} - Non-list response (the core's own
 *   message spelling, "event definitions").
 */
async function eventDefinitions(
  core: ClientCore,
  names?: readonly string[] | null,
  signal?: AbortSignal,
): Promise<JsonValue[]> {
  const path = scopedPath(core, "data-definitions/events/");
  const params: Record<string, string | readonly string[]> = {};
  if (names !== undefined && names !== null) {
    params["name[]"] = names;
  }
  const result = await appRequest(core.appDeps(signal), "GET", path, {
    // Python threads the list through a `dict[str, str]` annotation
    // with `# type: ignore[arg-type]`; the transport's
    // urlencode(doseq=True) twin serializes list values as repeated
    // keys — the cast is that type-ignore's twin.
    params: params as Record<string, string>,
  });
  if (!Array.isArray(result)) {
    throw new MixpanelHeadlessError(
      `Unexpected response from event definitions: ` +
        `expected list, got ${pythonTypeNameOf(result)}`,
    );
  }
  return result;
}

/**
 * `_property_definitions`: the shared core behind the
 * property lookup/enumerate pair — owns the `resourceType` contract
 * and the `include*` toggle wire format.
 *
 * @param core - The shared client internals seam.
 * @param args - The Python kwargs, faithfully optional.
 * @returns The definition list.
 * @throws {@link MixpanelHeadlessError} - Non-list response ("property
 *   definitions" message spelling).
 */
async function propertyDefinitions(
  core: ClientCore,
  args: PropertyDefinitionsArgs,
): Promise<JsonValue[]> {
  const path = scopedPath(core, "data-definitions/properties/");
  const params: Record<string, string | readonly string[]> = {};
  if (args.names !== undefined && args.names !== null) {
    params["name[]"] = args.names;
  }
  if (args.resourceType !== undefined && args.resourceType !== null) {
    params["resourceType"] = canonicalResourceType(args.resourceType);
  }
  if (args.includeEvents === true) {
    params["includeEvents"] = "true";
  }
  if (args.includeDensity === true) {
    params["includeDensity"] = "true";
  }
  if (args.includeCustom !== undefined && args.includeCustom !== null) {
    params["includeCustom"] = args.includeCustom ? "true" : "false";
  }
  if (args.includeZeroCounts !== undefined && args.includeZeroCounts !== null) {
    params["includeZeroCounts"] = args.includeZeroCounts ? "true" : "false";
  }
  const result = await appRequest(core.appDeps(args.signal), "GET", path, {
    params: params as Record<string, string>,
  });
  if (!Array.isArray(result)) {
    throw new MixpanelHeadlessError(
      `Unexpected response from property definitions: ` +
        `expected list, got ${pythonTypeNameOf(result)}`,
    );
  }
  return result;
}

function getEventDefinitions(
  core: ClientCore,
  names: readonly string[],
  signal?: AbortSignal,
): Promise<JsonValue[]> {
  return eventDefinitions(core, names, signal);
}

function listEventDefinitions(
  core: ClientCore,
  signal?: AbortSignal,
): Promise<JsonValue[]> {
  return eventDefinitions(core, undefined, signal);
}

async function updateEventDefinition(
  core: ClientCore,
  name: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, JsonValue>> {
  const path = scopedPath(core, "data-definitions/events/");
  const payload = { ...body, name };
  const result = await appRequest(core.appDeps(signal), "PATCH", path, {
    jsonBody: payload,
  });
  return expectRecordResult(result, "update_event_definition");
}

async function deleteEventDefinition(
  core: ClientCore,
  name: string,
  signal?: AbortSignal,
): Promise<void> {
  const path = scopedPath(core, "data-definitions/events/");
  await appRequest(core.appDeps(signal), "DELETE", path, {
    jsonBody: { name },
  });
}

async function bulkUpdateEventDefinitions(
  core: ClientCore,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<JsonValue[]> {
  const path = scopedPath(core, "data-definitions/events/");
  const result = await appRequest(core.appDeps(signal), "PATCH", path, {
    jsonBody: body,
  });
  return expectListResult(result, "bulk_update_event_definitions");
}

function getPropertyDefinitions(
  core: ClientCore,
  names: readonly string[],
  resourceType?: string | null,
  signal?: AbortSignal,
): Promise<JsonValue[]> {
  return propertyDefinitions(core, {
    names,
    resourceType: resourceType ?? null,
    ...(signal === undefined ? {} : { signal }),
  });
}

function listPropertyDefinitions(
  core: ClientCore,
  options: ListPropertyDefinitionsOptions = {},
): Promise<JsonValue[]> {
  return propertyDefinitions(core, {
    resourceType: options.resource_type ?? "Event",
    includeEvents: options.include_events ?? false,
    includeDensity: options.include_density ?? false,
    includeCustom: options.include_custom ?? true,
    includeZeroCounts: options.include_zero_counts ?? true,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
}

async function listPerEventProperties(
  core: ClientCore,
  signal?: AbortSignal,
): Promise<JsonValue[]> {
  const url = core.buildUrl("query", "/data_definitions/events");
  const result = await core.requestQueryHost("GET", url, {
    params: { fetch_per_event_properties: "true" },
    timeoutSeconds: core.exportTimeoutSeconds,
    ...(signal === undefined ? {} : { signal }),
  });
  // Python `result.get("results") if isinstance(result, dict) else
  // result` — a missing key reads as None (`.get` default).
  let rows: JsonValue | null = result;
  if (isPlainRecord(result)) {
    // noUncheckedIndexedAccess: hasOwn guarantees presence and the
    // lossless JSON model carries no undefined members.
    rows = Object.hasOwn(result, "results")
      ? (result["results"] ?? null)
      : null;
  }
  if (!Array.isArray(rows)) {
    throw new MixpanelHeadlessError(
      `Unexpected response from per-event properties: ` +
        `expected list, got ${pythonTypeNameOf(rows)}`,
    );
  }
  return rows;
}

async function updatePropertyDefinition(
  core: ClientCore,
  name: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, JsonValue>> {
  const path = scopedPath(core, "data-definitions/properties/");
  const payload = { ...body, name };
  const result = await appRequest(core.appDeps(signal), "PATCH", path, {
    jsonBody: payload,
  });
  return expectRecordResult(result, "update_property_definition");
}

async function bulkUpdatePropertyDefinitions(
  core: ClientCore,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<JsonValue[]> {
  const path = scopedPath(core, "data-definitions/properties/");
  const result = await appRequest(core.appDeps(signal), "PATCH", path, {
    jsonBody: body,
  });
  return expectListResult(result, "bulk_update_property_definitions");
}

async function listLexiconTags(
  core: ClientCore,
  signal?: AbortSignal,
): Promise<JsonValue[]> {
  const path = scopedPath(core, "data-definitions/tags/");
  const result = await appRequest(core.appDeps(signal), "GET", path);
  return expectListResult(result, "list_lexicon_tags");
}

async function createLexiconTag(
  core: ClientCore,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, JsonValue>> {
  const path = scopedPath(core, "data-definitions/tags/");
  const result = await appRequest(core.appDeps(signal), "POST", path, {
    jsonBody: body,
  });
  return expectRecordResult(result, "create_lexicon_tag");
}

async function updateLexiconTag(
  core: ClientCore,
  tagId: number,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, JsonValue>> {
  const path = scopedPath(core, `data-definitions/tags/${tagId}/`);
  const result = await appRequest(core.appDeps(signal), "PATCH", path, {
    jsonBody: body,
  });
  return expectRecordResult(result, "update_lexicon_tag");
}

async function deleteLexiconTag(
  core: ClientCore,
  name: string,
  signal?: AbortSignal,
): Promise<void> {
  const path = scopedPath(core, "data-definitions/tags/");
  await appRequest(core.appDeps(signal), "POST", path, {
    jsonBody: { delete: true, name },
  });
}

async function getTrackingMetadata(
  core: ClientCore,
  eventName: string,
  signal?: AbortSignal,
): Promise<Record<string, JsonValue>> {
  const path = scopedPath(core, "data-definitions/events/tracking-metadata/");
  const result = await appRequest(core.appDeps(signal), "GET", path, {
    params: { event_name: eventName },
  });
  return expectRecordResult(result, "get_tracking_metadata");
}

async function getEventHistory(
  core: ClientCore,
  eventName: string,
  signal?: AbortSignal,
): Promise<JsonValue[]> {
  const path = scopedPath(
    core,
    `data-definitions/events/${pythonQuote(eventName)}/history/`,
  );
  const result = await appRequest(core.appDeps(signal), "GET", path);
  return expectListResult(result, "get_event_history");
}

async function getPropertyHistory(
  core: ClientCore,
  propertyName: string,
  entityType: string,
  signal?: AbortSignal,
): Promise<JsonValue[]> {
  const path = scopedPath(
    core,
    `data-definitions/properties/${pythonQuote(propertyName)}/history/`,
  );
  const result = await appRequest(core.appDeps(signal), "GET", path, {
    params: { entity_type: entityType },
  });
  return expectListResult(result, "get_property_history");
}

async function exportLexicon(
  core: ClientCore,
  exportTypes?: readonly string[] | null,
  signal?: AbortSignal,
): Promise<Record<string, JsonValue>> {
  const path = scopedPath(core, "data-definitions/export/");
  const defaultTypes = [
    "All Events and Properties",
    "All User Profile Properties",
  ];
  const typesToExport = exportTypes ?? defaultTypes;
  const params = { export_type: pythonJsonDumps([...typesToExport]) };
  const result = await appRequest(core.appDeps(signal), "GET", path, {
    params,
  });
  if (typeof result === "string") {
    // Async export — the server answers with a status message.
    return { status: "pending", message: result };
  }
  if (!isPlainRecord(result)) {
    throw new MixpanelHeadlessError(
      `Unexpected response from export_lexicon: ` +
        `expected dict, got ${pythonTypeNameOf(result)}`,
    );
  }
  return result;
}

/**
 * Build the lexicon methods over the shared client core.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 * @example
 * ```typescript
 * const lexicon = createLexiconMethods(core);
 * const defs = await lexicon.getEventDefinitions(["Signup", "Purchase"]);
 * // [{ name: "Signup", description: "...", ... }, { name: "Purchase", ... }]
 * ```
 */
export function createLexiconMethods(core: ClientCore): LexiconMethods {
  return {
    getEventDefinitions: bindFirst(core, getEventDefinitions),
    listEventDefinitions: bindFirst(core, listEventDefinitions),
    updateEventDefinition: bindFirst(core, updateEventDefinition),
    deleteEventDefinition: bindFirst(core, deleteEventDefinition),
    bulkUpdateEventDefinitions: bindFirst(core, bulkUpdateEventDefinitions),
    getPropertyDefinitions: bindFirst(core, getPropertyDefinitions),
    listPropertyDefinitions: bindFirst(core, listPropertyDefinitions),
    listPerEventProperties: bindFirst(core, listPerEventProperties),
    updatePropertyDefinition: bindFirst(core, updatePropertyDefinition),
    bulkUpdatePropertyDefinitions: bindFirst(
      core,
      bulkUpdatePropertyDefinitions,
    ),
    listLexiconTags: bindFirst(core, listLexiconTags),
    createLexiconTag: bindFirst(core, createLexiconTag),
    updateLexiconTag: bindFirst(core, updateLexiconTag),
    deleteLexiconTag: bindFirst(core, deleteLexiconTag),
    getTrackingMetadata: bindFirst(core, getTrackingMetadata),
    getEventHistory: bindFirst(core, getEventHistory),
    getPropertyHistory: bindFirst(core, getPropertyHistory),
    exportLexicon: bindFirst(core, exportLexicon),
  };
}
