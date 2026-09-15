/**
 * B6-W6 member module — the `Workspace` Lexicon data-definition and
 * tracking/history members (`workspace.py:7197-7581` "Data Governance
 * — Data Definitions / Lexicon" and `workspace.py:8526-8648` "Data
 * Governance — Tracking & History", both Phase 027).
 *
 * Packet contract (`b6-packets.md` §2/§8): the `workspace.ts` B6-W6
 * section holds ONE-LINE delegations into this module; every member
 * here is a THIN facade body — options-bag mapping (R3.3/R3.8), the
 * params dump (W1-D4 {@link EntityModel.modelDumpExcludeNone}), the
 * like-named B4-C5 client method (`services/entities/lexicon.ts`,
 * composed onto the client at `client.ts:1077+`) and result-model
 * construction via `validateResponseModel(s)` with the exact
 * `endpoint=` string Python passes. No request assembly, no header
 * merging, no URL building, no status branching (R10.8 — compose,
 * never re-implement). In particular the `resourceType`
 * canonicalization, the `name[]` filter spelling, the
 * `pythonQuote`d history paths and the `export_type` JSON encoding all
 * live in the B4 client and are NOT re-derived here.
 *
 * Shard-wide observations from the Python re-read (all 15 bodies read
 * line-by-line at HEAD 2026-08-16):
 *
 * - **14 of 15 members are pure forwards.** The single exception is
 *   {@link listLexiconTags} (`:7488-7500`), which loops the raw list
 *   and branches on `isinstance(x, str)`: a plain tag-name STRING
 *   becomes `LexiconTag(id=0, name=x)` — the documented id=0 sentinel
 *   (`workspace.py:7481-7486` docstring Note) — while every other
 *   entry goes through `validate_response_model`. That `isinstance`
 *   is a STRING discrimination, not watchlist #13's
 *   `isinstance(x, dict)`, so `isPlainRecord` has no site here; the
 *   twin is a plain `typeof x === "string"` over the raw (lossless)
 *   entry, which is a JS string for any JSON string token.
 * - **Two dump spellings, deliberately different.** The four
 *   definition writers use `model_dump(exclude_none=True,
 *   by_alias=True)` (`:7266`, `:7325`, `:7406`, `:7452`) because
 *   `UpdateEventDefinitionParams` / `UpdatePropertyDefinitionParams` /
 *   `BulkEventUpdate` / `BulkPropertyUpdate` carry `to_camel` aliases
 *   the App API requires (`displayName`, `exampleValue`,
 *   `resourceType`). The two TAG writers use a PLAIN
 *   `model_dump(exclude_none=True)` (`:7526`, `:7557`) — `by_alias`
 *   would be a no-op on their single `name` field, but the facade
 *   mirrors the source spelling exactly rather than harmonizing it.
 * - **ZERO empty-response guards** (`if raw is None: raise …`) in
 *   either range — verified by grep, matching the W5 precedent. The
 *   shared `requireResponse` helper is therefore deliberately unused;
 *   adding it would invent a branch Python does not have.
 * - **Four opaque passthroughs**: `get_tracking_metadata`,
 *   `get_event_history`, `get_property_history` and `export_lexicon`
 *   return the client's payload verbatim under `dict[str, Any]` /
 *   `list[dict[str, Any]]` annotations with no model validation
 *   (`:8556`, `:8583`, `:8614`, `:8648`) — the W4
 *   `list_erf_experiments` / W5 `test_alert` precedent.
 * - **No `int(str)`, no `.strip()`, no truthiness guard, no date
 *   construction** anywhere in the two ranges, so R11.7 / watchlist
 *   #5 / watchlist #6 have no site to bite in this shard.
 *
 * The two keyword-only members ({@link getEventDefinitions} and
 * {@link getPropertyDefinitions}) plus {@link exportLexicon} pass
 * their `None` defaults straight through (`:7370`, `:8648`); the
 * client owns the `is not None` gating, so the facade forwards
 * `?? null` rather than dropping absent keys (R3.9 — never re-derive
 * the gate).
 */

import type { MixpanelClient } from "../client/client.js";
import {
  validateResponseModel,
  validateResponseModels,
} from "../client/response-validation.js";
import {
  type BulkUpdateEventsParams,
  type BulkUpdatePropertiesParams,
  type CreateTagParams,
  EventDefinition,
  LexiconTag,
  PropertyDefinition,
  type UpdateEventDefinitionParams,
  type UpdatePropertyDefinitionParams,
  type UpdateTagParams,
} from "../types/entities/lexicon.js";
import { native } from "./shared.js";

// ---------------------------------------------------------------------------
// Options bags (R3.3/R3.8 — keyword-only tails; keys keep the Python
// spelling per packet Caution #6, since the recorder replays kwargs by
// name).
// ---------------------------------------------------------------------------

/**
 * Options bag of `Workspace.getEventDefinitions` — Python's `names` is
 * a REQUIRED keyword-only argument (`workspace.py:7201`), so the bag
 * itself is required.
 */
export interface WorkspaceGetEventDefinitionsOptions {
  /** Event names to look up (keyword-only and required in Python). */
  readonly names: readonly string[];
}

/**
 * Options bag of `Workspace.getPropertyDefinitions` — `names` is a
 * REQUIRED keyword-only argument; `resource_type` defaults to `None`
 * (`workspace.py:7331-7336`).
 */
export interface WorkspaceGetPropertyDefinitionsOptions {
  /** Property names to look up (keyword-only and required in Python). */
  readonly names: readonly string[];
  /**
   * Optional resource-type filter ("event", "user", "groupprofile",
   * ...). Python default `None`; canonicalization to the App API's
   * capitalized spelling happens in the B4 client, not here.
   */
  readonly resource_type?: string | null | undefined;
}

/** Options bag of `Workspace.exportLexicon` (keyword-only in Python). */
export interface WorkspaceExportLexiconOptions {
  /**
   * Export types to request (Python default `None`, which lets the
   * client apply its own two-entry default list).
   */
  readonly export_types?: readonly string[] | null | undefined;
}

// ---------------------------------------------------------------------------
// Data Definitions — Events (`workspace.py:7201-7329`)
// ---------------------------------------------------------------------------

/**
 * Get event definitions from Lexicon by name
 * (`get_event_definitions`, `workspace.py:7201-7233`).
 *
 * @param client - The wire client.
 * @param options - `names` (keyword-only and required in Python).
 * @returns The `EventDefinition` models, in response order.
 * @throws ResponseValidationError - Malformed payload
 *   (`RESPONSE_VALIDATION_ERROR`).
 * @throws AuthenticationError | QueryError | ServerError - Wire
 *   failures per the B0 contract.
 */
export async function getEventDefinitions(
  client: MixpanelClient,
  options: WorkspaceGetEventDefinitionsOptions,
): Promise<EventDefinition[]> {
  const raw = await client.getEventDefinitions(options.names);
  return validateResponseModels(
    EventDefinition,
    raw.map((item) => native(item)),
    {
      endpoint: "get_event_definitions",
    },
  );
}

/**
 * Update an event definition in Lexicon (`update_event_definition`,
 * `workspace.py:7235-7270`).
 *
 * @param client - The wire client.
 * @param eventName - Name of the event to update.
 * @param params - Fields to update (dumped with `by_alias=True`,
 *   `:7266`).
 * @returns The updated `EventDefinition`.
 * @throws ResponseValidationError - Malformed payload.
 */
export async function updateEventDefinition(
  client: MixpanelClient,
  eventName: string,
  params: UpdateEventDefinitionParams,
): Promise<EventDefinition> {
  const raw = await client.updateEventDefinition(
    eventName,
    params.modelDumpExcludeNone({ byAlias: true }),
  );
  return validateResponseModel(EventDefinition, native(raw), {
    endpoint: "update_event_definition",
  });
}

/**
 * Delete an event definition from Lexicon
 * (`delete_event_definition`, `workspace.py:7272-7291`).
 *
 * @param client - The wire client.
 * @param eventName - Name of the event to delete.
 * @returns Nothing.
 * @throws AuthenticationError | QueryError | ServerError - Wire
 *   failures.
 */
export async function deleteEventDefinition(
  client: MixpanelClient,
  eventName: string,
): Promise<void> {
  await client.deleteEventDefinition(eventName);
}

/**
 * Bulk-update event definitions in Lexicon
 * (`bulk_update_event_definitions`, `workspace.py:7293-7329`).
 *
 * @param client - The wire client.
 * @param params - Bulk update parameters (dumped with
 *   `by_alias=True`, recursively into each `BulkEventUpdate`).
 * @returns The updated `EventDefinition` models, in response order.
 * @throws ResponseValidationError - Malformed payload.
 */
export async function bulkUpdateEventDefinitions(
  client: MixpanelClient,
  params: BulkUpdateEventsParams,
): Promise<EventDefinition[]> {
  const raw = await client.bulkUpdateEventDefinitions(
    params.modelDumpExcludeNone({ byAlias: true }),
  );
  return validateResponseModels(
    EventDefinition,
    raw.map((item) => native(item)),
    {
      endpoint: "bulk_update_event_definitions",
    },
  );
}

// ---------------------------------------------------------------------------
// Data Definitions — Properties (`workspace.py:7331-7456`)
// ---------------------------------------------------------------------------

/**
 * Get property definitions from Lexicon by name
 * (`get_property_definitions`, `workspace.py:7331-7373`).
 *
 * @param client - The wire client.
 * @param options - `names` (required) and `resource_type` (default
 *   `None`, forwarded as-is — the client owns canonicalization AND the
 *   `is not None` gate).
 * @returns The `PropertyDefinition` models, in response order.
 * @throws ResponseValidationError - Malformed payload.
 */
export async function getPropertyDefinitions(
  client: MixpanelClient,
  options: WorkspaceGetPropertyDefinitionsOptions,
): Promise<PropertyDefinition[]> {
  const raw = await client.getPropertyDefinitions(
    options.names,
    options.resource_type ?? null,
  );
  return validateResponseModels(
    PropertyDefinition,
    raw.map((item) => native(item)),
    {
      endpoint: "get_property_definitions",
    },
  );
}

/**
 * Update a property definition in Lexicon
 * (`update_property_definition`, `workspace.py:7375-7410`).
 *
 * @param client - The wire client.
 * @param propertyName - Name of the property to update.
 * @param params - Fields to update (dumped with `by_alias=True`,
 *   `:7406`).
 * @returns The updated `PropertyDefinition`.
 * @throws ResponseValidationError - Malformed payload.
 */
export async function updatePropertyDefinition(
  client: MixpanelClient,
  propertyName: string,
  params: UpdatePropertyDefinitionParams,
): Promise<PropertyDefinition> {
  const raw = await client.updatePropertyDefinition(
    propertyName,
    params.modelDumpExcludeNone({ byAlias: true }),
  );
  return validateResponseModel(PropertyDefinition, native(raw), {
    endpoint: "update_property_definition",
  });
}

/**
 * Bulk-update property definitions in Lexicon
 * (`bulk_update_property_definitions`, `workspace.py:7412-7456`).
 *
 * @param client - The wire client.
 * @param params - Bulk update parameters (dumped with
 *   `by_alias=True`, recursively into each `BulkPropertyUpdate`).
 * @returns The updated `PropertyDefinition` models, in response order.
 * @throws ResponseValidationError - Malformed payload.
 */
export async function bulkUpdatePropertyDefinitions(
  client: MixpanelClient,
  params: BulkUpdatePropertiesParams,
): Promise<PropertyDefinition[]> {
  const raw = await client.bulkUpdatePropertyDefinitions(
    params.modelDumpExcludeNone({ byAlias: true }),
  );
  return validateResponseModels(
    PropertyDefinition,
    raw.map((item) => native(item)),
    {
      endpoint: "bulk_update_property_definitions",
    },
  );
}

// ---------------------------------------------------------------------------
// Tags (`workspace.py:7458-7580`)
// ---------------------------------------------------------------------------

/**
 * List all Lexicon tags (`list_lexicon_tags`,
 * `workspace.py:7460-7500`).
 *
 * The shard's ONE non-forwarding body: the list endpoint may return
 * plain tag-name STRINGS instead of `{id, name}` objects, and Python
 * wraps those as `LexiconTag(id=0, name=x)` — the id=0 sentinel
 * documented at `:7481-7486`. Do not feed that sentinel back to
 * {@link updateLexiconTag}; use the name-based
 * {@link deleteLexiconTag} instead.
 *
 * @param client - The wire client.
 * @returns The `LexiconTag` models, in response order.
 * @throws ResponseValidationError - Malformed non-string entry.
 */
export async function listLexiconTags(
  client: MixpanelClient,
): Promise<LexiconTag[]> {
  const rawList = await client.listLexiconTags();
  const result: LexiconTag[] = [];
  for (const entry of rawList) {
    if (typeof entry === "string") {
      // List endpoint returns plain tag name strings (no id);
      // id=0 is a sentinel — see the docstring above.
      result.push(new LexiconTag({ id: 0, name: entry }));
    } else {
      result.push(
        validateResponseModel(LexiconTag, native(entry), {
          endpoint: "list_lexicon_tags",
        }),
      );
    }
  }
  return result;
}

/**
 * Create a new Lexicon tag (`create_lexicon_tag`,
 * `workspace.py:7502-7528`).
 *
 * @param client - The wire client.
 * @param params - Tag creation parameters (name required); dumped
 *   WITHOUT `by_alias` (`:7526`).
 * @returns The created `LexiconTag`.
 * @throws ResponseValidationError - Malformed payload.
 */
export async function createLexiconTag(
  client: MixpanelClient,
  params: CreateTagParams,
): Promise<LexiconTag> {
  const raw = await client.createLexiconTag(params.modelDumpExcludeNone());
  return validateResponseModel(LexiconTag, native(raw), {
    endpoint: "create_lexicon_tag",
  });
}

/**
 * Update a Lexicon tag (`update_lexicon_tag`,
 * `workspace.py:7530-7559`).
 *
 * @param client - The wire client.
 * @param tagId - Tag ID (integer).
 * @param params - Fields to update; dumped WITHOUT `by_alias`
 *   (`:7557`).
 * @returns The updated `LexiconTag`.
 * @throws ResponseValidationError - Malformed payload.
 */
export async function updateLexiconTag(
  client: MixpanelClient,
  tagId: number,
  params: UpdateTagParams,
): Promise<LexiconTag> {
  const raw = await client.updateLexiconTag(
    tagId,
    params.modelDumpExcludeNone(),
  );
  return validateResponseModel(LexiconTag, native(raw), {
    endpoint: "update_lexicon_tag",
  });
}

/**
 * Delete a Lexicon tag BY NAME (`delete_lexicon_tag`,
 * `workspace.py:7561-7580`).
 *
 * @param client - The wire client.
 * @param tagName - Name of the tag to delete.
 * @returns Nothing.
 * @throws AuthenticationError | QueryError | ServerError - Wire
 *   failures.
 */
export async function deleteLexiconTag(
  client: MixpanelClient,
  tagName: string,
): Promise<void> {
  await client.deleteLexiconTag(tagName);
}

// ---------------------------------------------------------------------------
// Tracking & History + Export (`workspace.py:8530-8648`)
// ---------------------------------------------------------------------------

/**
 * Get tracking metadata for an event (`get_tracking_metadata`,
 * `workspace.py:8530-8556`) — returned VERBATIM; Python performs no
 * model validation (`return client.get_tracking_metadata(...)`).
 *
 * @param client - The wire client.
 * @param eventName - Name of the event.
 * @returns The opaque metadata record.
 * @throws AuthenticationError | QueryError | ServerError - Wire
 *   failures.
 */
export async function getTrackingMetadata(
  client: MixpanelClient,
  eventName: string,
): Promise<Record<string, unknown>> {
  const raw = await client.getTrackingMetadata(eventName);
  return native(raw) as Record<string, unknown>;
}

/**
 * Get change history for an event definition (`get_event_history`,
 * `workspace.py:8558-8583`) — returned VERBATIM, unvalidated.
 *
 * @param client - The wire client.
 * @param eventName - Name of the event.
 * @returns The opaque history entries, in response order.
 * @throws AuthenticationError | QueryError | ServerError - Wire
 *   failures.
 */
export async function getEventHistory(
  client: MixpanelClient,
  eventName: string,
): Promise<Array<Record<string, unknown>>> {
  const raw = await client.getEventHistory(eventName);
  return raw.map((item) => native(item)) as Array<Record<string, unknown>>;
}

/**
 * Get change history for a property definition
 * (`get_property_history`, `workspace.py:8585-8614`) — returned
 * VERBATIM, unvalidated.
 *
 * @param client - The wire client.
 * @param propertyName - Name of the property.
 * @param entityType - Entity type ("event", "user", "group", ...).
 * @returns The opaque history entries, in response order.
 * @throws AuthenticationError | QueryError | ServerError - Wire
 *   failures.
 */
export async function getPropertyHistory(
  client: MixpanelClient,
  propertyName: string,
  entityType: string,
): Promise<Array<Record<string, unknown>>> {
  const raw = await client.getPropertyHistory(propertyName, entityType);
  return raw.map((item) => native(item)) as Array<Record<string, unknown>>;
}

/**
 * Export Lexicon data definitions (`export_lexicon`,
 * `workspace.py:8618-8648`) — returned VERBATIM, unvalidated. The
 * client owns both the default type list and the `{status: "pending"}`
 * wrapper for the async (plain-string) response.
 *
 * @param client - The wire client.
 * @param options - `export_types` (keyword-only in Python; `None`
 *   default forwarded as-is).
 * @returns The opaque export record.
 * @throws AuthenticationError | QueryError | ServerError - Wire
 *   failures.
 */
export async function exportLexicon(
  client: MixpanelClient,
  options: WorkspaceExportLexiconOptions = {},
): Promise<Record<string, unknown>> {
  const raw = await client.exportLexicon(options.export_types ?? null);
  return native(raw) as Record<string, unknown>;
}
