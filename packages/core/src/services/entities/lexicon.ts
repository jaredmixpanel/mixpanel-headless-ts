/**
 * Lexicon data-definition wire methods (App API) — Phase-3 packet
 * B4-C5 port of the `MixpanelAPIClient` lexicon range
 * (`api_client.py:6480-7177`): event/property definitions (with the
 * `_event_definitions`/`_property_definitions` private shared cores —
 * plain `appRequest` GETs with `name[]` filters + bare-list shape
 * validation; measured, NO `paginate_all` involvement), tags, tracking
 * metadata, history, and export.
 *
 * All methods route through B0 `appRequest` over `maybe_scoped_path`
 * (R10.8). Results are returned verbatim after the source's isinstance
 * guards (Caution #11).
 */

import { appRequest } from "../../client/app-request.js";
import type { ClientCore } from "../../client/client.js";
import type { JsonValue } from "../../client/json-value.js";
import { isPlainRecord } from "../../client/internals.js";
import { MixpanelHeadlessError } from "../../errors.js";
import { maybeScopedPath } from "../../client/scope.js";
import { pythonJsonDumps } from "../../compat/index.js";
import {
  expectListResult,
  expectRecordResult,
  pythonQuote,
  pythonTypeNameOf,
} from "./shared.js";

/**
 * `_RESOURCE_TYPE_CANONICAL` (`api_client.py:257-263`): the App API
 * honors only the camelCase `resourceType` param with a capitalized
 * value; lowercase 400s and snake_case is silently ignored (verified
 * live upstream). Unknown spellings pass through.
 */
const RESOURCE_TYPE_CANONICAL: Readonly<Record<string, string>> = {
  event: "Event",
  events: "Event",
  user: "User",
  users: "User",
  people: "User",
};

/**
 * Normalize a caller's resource-type spelling to the App API's
 * canonical value (`_canonical_resource_type`, `api_client.py:266-284`).
 *
 * @param resourceType - A caller-supplied filter ("event", "People", ...).
 * @returns `"Event"` / `"User"` for known spellings; the input
 *   unchanged otherwise.
 */
export function canonicalResourceType(resourceType: string): string {
  return RESOURCE_TYPE_CANONICAL[resourceType.toLowerCase()] ?? resourceType;
}

/** Options bag of {@link LexiconMethods.listPropertyDefinitions}
 * (Python kw-only params with their source defaults). */
export interface ListPropertyDefinitionsOptions {
  /** Property family — "Event" or "User" (default "Event"). */
  readonly resource_type?: string | undefined;
  /** Attach the events each property appears on (default false). */
  readonly include_events?: boolean | undefined;
  /** Request property-level density (default false). */
  readonly include_density?: boolean | undefined;
  /** Include custom (computed) properties (default true). */
  readonly include_custom?: boolean | undefined;
  /** Include properties with no recorded data (default true). */
  readonly include_zero_counts?: boolean | undefined;
  /** Optional cancellation signal (R6.7). */
  readonly signal?: AbortSignal | undefined;
}

/** The private `_property_definitions` kwargs (`:6669-6678`). */
interface PropertyDefinitionsArgs {
  readonly names?: readonly string[] | null;
  readonly resourceType?: string | null;
  readonly includeEvents?: boolean;
  readonly includeDensity?: boolean;
  readonly includeCustom?: boolean | null;
  readonly includeZeroCounts?: boolean | null;
  readonly signal?: AbortSignal | undefined;
}

/** The C5 lexicon method surface (mixed into `MixpanelClient`). */
export interface LexiconMethods {
  /**
   * Get event definitions by name (`get_event_definitions`,
   * `api_client.py:6515-6539` — GET `data-definitions/events/` with a
   * `name[]` filter via the `_event_definitions` shared core).
   *
   * @param names - Event names to look up.
   * @param signal - Optional cancellation signal.
   * @returns The definition list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  getEventDefinitions(
    names: readonly string[],
    signal?: AbortSignal,
  ): Promise<JsonValue[]>;

  /**
   * List ALL event definitions (`list_event_definitions`,
   * `:6541-6563` — the shared core without a `name[]` filter).
   *
   * @param signal - Optional cancellation signal.
   * @returns The definition list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  listEventDefinitions(signal?: AbortSignal): Promise<JsonValue[]>;

  /**
   * Update an event definition (`update_event_definition`,
   * `:6565-6602` — PATCH `data-definitions/events/` with
   * `{**body, name}`).
   *
   * @param name - Event name to update.
   * @param body - Fields to update.
   * @param signal - Optional cancellation signal.
   * @returns The updated definition dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  updateEventDefinition(
    name: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, JsonValue>>;

  /**
   * Delete an event definition (`delete_event_definition`,
   * `:6604-6626` — DELETE with JSON body `{name}`).
   *
   * @param name - Event name to delete.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  deleteEventDefinition(name: string, signal?: AbortSignal): Promise<void>;

  /**
   * Bulk-update event definitions (`bulk_update_event_definitions`,
   * `:6628-6667` — PATCH with the caller's `{events: [...]}` body).
   *
   * @param body - Bulk update payload.
   * @param signal - Optional cancellation signal.
   * @returns The updated definition list.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  bulkUpdateEventDefinitions(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<JsonValue[]>;

  /**
   * Get property definitions by name (`get_property_definitions`,
   * `:6738-6768` — the `_property_definitions` shared core with a
   * `name[]` filter and optional normalized `resourceType`).
   *
   * @param names - Property names to look up.
   * @param resourceType - Optional resource-type filter (normalized).
   * @param signal - Optional cancellation signal.
   * @returns The definition list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  getPropertyDefinitions(
    names: readonly string[],
    resourceType?: string | null,
    signal?: AbortSignal,
  ): Promise<JsonValue[]>;

  /**
   * List all property definitions (`list_property_definitions`,
   * `:6770-6819` — the shared core, whole-project enumerate; defaults
   * `resource_type="Event"`, `include_custom=True`,
   * `include_zero_counts=True`).
   *
   * @param options - Optional kw-only toggles + signal.
   * @returns The definition list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  listPropertyDefinitions(
    options?: ListPropertyDefinitionsOptions,
  ): Promise<JsonValue[]>;

  /**
   * Update a property definition (`update_property_definition`,
   * `:6821-6858` — PATCH `data-definitions/properties/` with
   * `{**body, name}`).
   *
   * @param name - Property name to update.
   * @param body - Fields to update.
   * @param signal - Optional cancellation signal.
   * @returns The updated definition dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  updatePropertyDefinition(
    name: string,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, JsonValue>>;

  /**
   * Bulk-update property definitions
   * (`bulk_update_property_definitions`, `:6860-6899` — PATCH with the
   * caller's `{properties: [...]}` body).
   *
   * @param body - Bulk update payload.
   * @param signal - Optional cancellation signal.
   * @returns The updated definition list.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  bulkUpdatePropertyDefinitions(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<JsonValue[]>;

  /**
   * List Lexicon tags (`list_lexicon_tags`, `:6901-6929` — GET
   * `data-definitions/tags/`).
   *
   * @param signal - Optional cancellation signal.
   * @returns The tag list verbatim.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  listLexiconTags(signal?: AbortSignal): Promise<JsonValue[]>;

  /**
   * Create a Lexicon tag (`create_lexicon_tag`, `:6931-6962` — POST
   * `data-definitions/tags/`).
   *
   * @param body - Tag creation parameters (name).
   * @param signal - Optional cancellation signal.
   * @returns The created tag dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  createLexiconTag(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, JsonValue>>;

  /**
   * Update a Lexicon tag (`update_lexicon_tag`, `:6964-6996` — PATCH
   * `data-definitions/tags/{tag_id}/`; INT id, R3-family).
   *
   * @param tagId - Tag ID (integer).
   * @param body - Fields to update (name).
   * @param signal - Optional cancellation signal.
   * @returns The updated tag dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  updateLexiconTag(
    tagId: number,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, JsonValue>>;

  /**
   * Delete a Lexicon tag BY NAME (`delete_lexicon_tag`, `:6998-7020`
   * — POST `data-definitions/tags/` with `{delete: True, name}`; the
   * API uses POST, not DELETE, for tag removal).
   *
   * @param name - Name of the tag to delete.
   * @param signal - Optional cancellation signal.
   * @returns Nothing.
   */
  deleteLexiconTag(name: string, signal?: AbortSignal): Promise<void>;

  /**
   * Get tracking metadata for an event (`get_tracking_metadata`,
   * `:7022-7053` — GET `.../events/tracking-metadata/` with the
   * `event_name` query param).
   *
   * @param eventName - Name of the event.
   * @param signal - Optional cancellation signal.
   * @returns The metadata dict.
   * @throws MixpanelHeadlessError - Non-dict response.
   */
  getTrackingMetadata(
    eventName: string,
    signal?: AbortSignal,
  ): Promise<Record<string, JsonValue>>;

  /**
   * Get event definition change history (`get_event_history`,
   * `:7055-7088` — GET `.../events/{quoted name}/history/`).
   *
   * @param eventName - Name of the event.
   * @param signal - Optional cancellation signal.
   * @returns The history entry list.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  getEventHistory(
    eventName: string,
    signal?: AbortSignal,
  ): Promise<JsonValue[]>;

  /**
   * Get property definition change history (`get_property_history`,
   * `:7090-7126` — GET `.../properties/{quoted name}/history/` with
   * the `entity_type` query param).
   *
   * @param propertyName - Name of the property.
   * @param entityType - Entity type ("event", "user", ...).
   * @param signal - Optional cancellation signal.
   * @returns The history entry list.
   * @throws MixpanelHeadlessError - Non-list response.
   */
  getPropertyHistory(
    propertyName: string,
    entityType: string,
    signal?: AbortSignal,
  ): Promise<JsonValue[]>;

  /**
   * Export Lexicon data definitions (`export_lexicon`, `:7128-7172` —
   * GET `data-definitions/export/` with the JSON-encoded
   * `export_type` param; a plain-string result wraps into
   * `{status: "pending", message}`).
   *
   * @param exportTypes - Optional export-type list (defaults to the
   *   source's two-entry list).
   * @param signal - Optional cancellation signal.
   * @returns The export dict (or the pending wrapper).
   * @throws MixpanelHeadlessError - Non-dict, non-string response.
   */
  exportLexicon(
    exportTypes?: readonly string[] | null,
    signal?: AbortSignal,
  ): Promise<Record<string, JsonValue>>;
}

/**
 * Build the C5 lexicon methods over the C1 core seam.
 *
 * @param core - The shared client internals seam.
 * @returns The method bag.
 */
export function createLexiconMethods(core: ClientCore): LexiconMethods {
  /** `self.maybe_scoped_path(...)` over the CURRENT pin (call-time). */
  const scopedPath = (domainPath: string): string =>
    maybeScopedPath(domainPath, {
      projectId: core.projectId(),
      workspaceId: core.workspaceId(),
    });

  /**
   * `_event_definitions` (`api_client.py:6480-6513`): the shared core
   * behind the by-name lookup and the bulk enumerate.
   *
   * @param names - Optional `name[]` filter values.
   * @param signal - Optional cancellation signal.
   * @returns The definition list.
   * @throws MixpanelHeadlessError - Non-list response (the core's own
   *   message spelling, "event definitions").
   */
  const eventDefinitions = async (
    names?: readonly string[] | null,
    signal?: AbortSignal,
  ): Promise<JsonValue[]> => {
    const path = scopedPath("data-definitions/events/");
    const params: Record<string, string | readonly string[]> = {};
    if (names !== undefined && names !== null) {
      params["name[]"] = names;
    }
    const result = await appRequest(core.appDeps(signal), "GET", path, {
      // Python threads the list through a `dict[str, str]` annotation
      // with `# type: ignore[arg-type]` (`:6507`); the transport's
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
  };

  /**
   * `_property_definitions` (`:6669-6736`): the shared core behind the
   * property lookup/enumerate pair — owns the `resourceType` contract
   * and the `include*` toggle wire format.
   *
   * @param args - The Python kwargs, faithfully optional.
   * @returns The definition list.
   * @throws MixpanelHeadlessError - Non-list response ("property
   *   definitions" message spelling).
   */
  const propertyDefinitions = async (
    args: PropertyDefinitionsArgs,
  ): Promise<JsonValue[]> => {
    const path = scopedPath("data-definitions/properties/");
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
    if (
      args.includeZeroCounts !== undefined &&
      args.includeZeroCounts !== null
    ) {
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
  };

  return {
    getEventDefinitions: (
      names: readonly string[],
      signal?: AbortSignal,
    ): Promise<JsonValue[]> => eventDefinitions(names, signal),

    listEventDefinitions: (signal?: AbortSignal): Promise<JsonValue[]> =>
      eventDefinitions(undefined, signal),

    updateEventDefinition: async (
      name: string,
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("data-definitions/events/");
      const payload = { ...body, name };
      const result = await appRequest(core.appDeps(signal), "PATCH", path, {
        jsonBody: payload,
      });
      return expectRecordResult(result, "update_event_definition");
    },

    deleteEventDefinition: async (
      name: string,
      signal?: AbortSignal,
    ): Promise<void> => {
      const path = scopedPath("data-definitions/events/");
      await appRequest(core.appDeps(signal), "DELETE", path, {
        jsonBody: { name },
      });
    },

    bulkUpdateEventDefinitions: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<JsonValue[]> => {
      const path = scopedPath("data-definitions/events/");
      const result = await appRequest(core.appDeps(signal), "PATCH", path, {
        jsonBody: body,
      });
      return expectListResult(result, "bulk_update_event_definitions");
    },

    getPropertyDefinitions: (
      names: readonly string[],
      resourceType?: string | null,
      signal?: AbortSignal,
    ): Promise<JsonValue[]> =>
      propertyDefinitions({
        names,
        resourceType: resourceType ?? null,
        ...(signal !== undefined ? { signal } : {}),
      }),

    listPropertyDefinitions: (
      options: ListPropertyDefinitionsOptions = {},
    ): Promise<JsonValue[]> =>
      propertyDefinitions({
        resourceType: options.resource_type ?? "Event",
        includeEvents: options.include_events ?? false,
        includeDensity: options.include_density ?? false,
        includeCustom: options.include_custom ?? true,
        includeZeroCounts: options.include_zero_counts ?? true,
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      }),

    updatePropertyDefinition: async (
      name: string,
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("data-definitions/properties/");
      const payload = { ...body, name };
      const result = await appRequest(core.appDeps(signal), "PATCH", path, {
        jsonBody: payload,
      });
      return expectRecordResult(result, "update_property_definition");
    },

    bulkUpdatePropertyDefinitions: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<JsonValue[]> => {
      const path = scopedPath("data-definitions/properties/");
      const result = await appRequest(core.appDeps(signal), "PATCH", path, {
        jsonBody: body,
      });
      return expectListResult(result, "bulk_update_property_definitions");
    },

    listLexiconTags: async (signal?: AbortSignal): Promise<JsonValue[]> => {
      const path = scopedPath("data-definitions/tags/");
      const result = await appRequest(core.appDeps(signal), "GET", path);
      return expectListResult(result, "list_lexicon_tags");
    },

    createLexiconTag: async (
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("data-definitions/tags/");
      const result = await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "create_lexicon_tag");
    },

    updateLexiconTag: async (
      tagId: number,
      body: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath(`data-definitions/tags/${tagId}/`);
      const result = await appRequest(core.appDeps(signal), "PATCH", path, {
        jsonBody: body,
      });
      return expectRecordResult(result, "update_lexicon_tag");
    },

    deleteLexiconTag: async (
      name: string,
      signal?: AbortSignal,
    ): Promise<void> => {
      const path = scopedPath("data-definitions/tags/");
      await appRequest(core.appDeps(signal), "POST", path, {
        jsonBody: { delete: true, name },
      });
    },

    getTrackingMetadata: async (
      eventName: string,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("data-definitions/events/tracking-metadata/");
      const result = await appRequest(core.appDeps(signal), "GET", path, {
        params: { event_name: eventName },
      });
      return expectRecordResult(result, "get_tracking_metadata");
    },

    getEventHistory: async (
      eventName: string,
      signal?: AbortSignal,
    ): Promise<JsonValue[]> => {
      const path = scopedPath(
        `data-definitions/events/${pythonQuote(eventName)}/history/`,
      );
      const result = await appRequest(core.appDeps(signal), "GET", path);
      return expectListResult(result, "get_event_history");
    },

    getPropertyHistory: async (
      propertyName: string,
      entityType: string,
      signal?: AbortSignal,
    ): Promise<JsonValue[]> => {
      const path = scopedPath(
        `data-definitions/properties/${pythonQuote(propertyName)}/history/`,
      );
      const result = await appRequest(core.appDeps(signal), "GET", path, {
        params: { entity_type: entityType },
      });
      return expectListResult(result, "get_property_history");
    },

    exportLexicon: async (
      exportTypes?: readonly string[] | null,
      signal?: AbortSignal,
    ): Promise<Record<string, JsonValue>> => {
      const path = scopedPath("data-definitions/export/");
      const defaultTypes = [
        "All Events and Properties",
        "All User Profile Properties",
      ];
      const typesToExport =
        exportTypes !== undefined && exportTypes !== null
          ? exportTypes
          : defaultTypes;
      const params = { export_type: pythonJsonDumps([...typesToExport]) };
      const result = await appRequest(core.appDeps(signal), "GET", path, {
        params,
      });
      if (typeof result === "string") {
        // Async export — returns status message (`:7164-7166`).
        return { status: "pending", message: result };
      }
      if (!isPlainRecord(result)) {
        throw new MixpanelHeadlessError(
          `Unexpected response from export_lexicon: ` +
            `expected dict, got ${pythonTypeNameOf(result)}`,
        );
      }
      return result;
    },
  };
}
