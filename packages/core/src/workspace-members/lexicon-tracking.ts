/**
 * Lexicon members of the `Workspace` facade: event and property
 * definitions, tags, tracking metadata, change history and the Lexicon
 * export. Each function is the body of one facade method — options-bag
 * mapping, the params dump, the like-named client call and result-model
 * validation with the endpoint name Python passes. Resource-type
 * canonicalization, the `name[]` filter spelling, history path quoting
 * and the `export_type` encoding all belong to the client, not here.
 *
 * @see mixpanel_headless.workspace.Workspace
 */

import type { MixpanelClient } from "../client/client.js";
import { toNativeJson } from "../client/json-value.js";
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

// --- Options bags (keys keep the Python keyword spelling) ---

/**
 * Options bag of `Workspace.getEventDefinitions`. Python's `names` is a
 * required keyword-only argument, so the bag itself is required.
 */
export interface WorkspaceGetEventDefinitionsOptions {
  /** Event names to look up. */
  readonly names: readonly string[];
}

/**
 * Options bag of `Workspace.getPropertyDefinitions`. Python's `names` is
 * a required keyword-only argument, so the bag itself is required.
 */
export interface WorkspaceGetPropertyDefinitionsOptions {
  /** Property names to look up. */
  readonly names: readonly string[];
  /**
   * Resource-type filter (`"event"`, `"user"`, `"groupprofile"`, …).
   * Canonicalization to the App API's capitalized spelling happens in
   * the client.
   *
   * @defaultValue `null` (no filter)
   */
  readonly resource_type?: string | null | undefined;
}

/** Options bag of `Workspace.exportLexicon` (keyword-only in Python). */
export interface WorkspaceExportLexiconOptions {
  /**
   * Export types to request.
   *
   * @defaultValue `null`, which lets the client apply its own two-entry
   *   default list
   */
  readonly export_types?: readonly string[] | null | undefined;
}

// --- Data definitions: events ---

/**
 * Fetch event definitions from Lexicon by name.
 *
 * @param client - The wire client.
 * @param options - The `names` to look up.
 * @returns The `EventDefinition` models, in response order.
 * @throws {@link ResponseValidationError} - Malformed payload
 *   (`RESPONSE_VALIDATION_ERROR`).
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
 *   failures.
 * @example
 * ```typescript
 * const [signup] = await ws.getEventDefinitions({ names: ["Signup"] });
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_event_definitions
 */
export async function getEventDefinitions(
  client: MixpanelClient,
  options: WorkspaceGetEventDefinitionsOptions,
): Promise<EventDefinition[]> {
  const raw = await client.getEventDefinitions(options.names);
  return validateResponseModels(
    EventDefinition,
    raw.map((item) => toNativeJson(item)),
    {
      endpoint: "get_event_definitions",
    },
  );
}

/**
 * Update an event definition in Lexicon.
 *
 * @remarks
 * The body is dumped with `by_alias`: the update models carry the
 * camelCase aliases the App API requires (`displayName`,
 * `exampleValue`, `resourceType`).
 * @param client - The wire client.
 * @param eventName - Name of the event to update.
 * @param params - Fields to update.
 * @returns The updated `EventDefinition`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * await ws.updateEventDefinition(
 *   "Signup",
 *   new UpdateEventDefinitionParams({ description: "Account created" }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.update_event_definition
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
  return validateResponseModel(EventDefinition, toNativeJson(raw), {
    endpoint: "update_event_definition",
  });
}

/**
 * Delete an event definition from Lexicon.
 *
 * @param client - The wire client.
 * @param eventName - Name of the event to delete.
 * @returns Nothing.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
 *   failures.
 * @example
 * ```typescript
 * await ws.deleteEventDefinition("Legacy Signup");
 * ```
 * @see mixpanel_headless.workspace.Workspace.delete_event_definition
 */
export async function deleteEventDefinition(
  client: MixpanelClient,
  eventName: string,
): Promise<void> {
  await client.deleteEventDefinition(eventName);
}

/**
 * Update several event definitions in Lexicon at once.
 *
 * @param client - The wire client.
 * @param params - The per-event updates, dumped with `by_alias`
 *   recursively into each entry.
 * @returns The updated `EventDefinition` models, in response order.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * await ws.bulkUpdateEventDefinitions(
 *   new BulkUpdateEventsParams({ events: [{ name: "Signup", hidden: true }] }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.bulk_update_event_definitions
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
    raw.map((item) => toNativeJson(item)),
    {
      endpoint: "bulk_update_event_definitions",
    },
  );
}

// --- Data definitions: properties ---

/**
 * Fetch property definitions from Lexicon by name.
 *
 * @param client - The wire client.
 * @param options - The `names` to look up and an optional
 *   `resource_type`, forwarded as-is (the client owns canonicalization
 *   and the null gate).
 * @returns The `PropertyDefinition` models, in response order.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const defs = await ws.getPropertyDefinitions({
 *   names: ["plan"],
 *   resource_type: "user",
 * });
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_property_definitions
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
    raw.map((item) => toNativeJson(item)),
    {
      endpoint: "get_property_definitions",
    },
  );
}

/**
 * Update a property definition in Lexicon.
 *
 * @param client - The wire client.
 * @param propertyName - Name of the property to update.
 * @param params - Fields to update, dumped with `by_alias`.
 * @returns The updated `PropertyDefinition`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * await ws.updatePropertyDefinition(
 *   "plan",
 *   new UpdatePropertyDefinitionParams({ display_name: "Plan tier" }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.update_property_definition
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
  return validateResponseModel(PropertyDefinition, toNativeJson(raw), {
    endpoint: "update_property_definition",
  });
}

/**
 * Update several property definitions in Lexicon at once.
 *
 * @param client - The wire client.
 * @param params - The per-property updates, dumped with `by_alias`
 *   recursively into each entry.
 * @returns The updated `PropertyDefinition` models, in response order.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * await ws.bulkUpdatePropertyDefinitions(
 *   new BulkUpdatePropertiesParams({
 *     properties: [{ name: "plan", resource_type: "user", hidden: true }],
 *   }),
 * );
 * ```
 * @see mixpanel_headless.workspace.Workspace.bulk_update_property_definitions
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
    raw.map((item) => toNativeJson(item)),
    {
      endpoint: "bulk_update_property_definitions",
    },
  );
}

// --- Tags ---

/**
 * List every Lexicon tag.
 *
 * @remarks
 * The list endpoint may return plain tag-name strings instead of
 * `{id, name}` objects; Python wraps those as
 * `LexiconTag(id=0, name=x)`, the documented `id=0` sentinel. Do not
 * feed that sentinel back to {@link updateLexiconTag}; use the
 * name-based {@link deleteLexiconTag} instead. The `isinstance(x, str)`
 * test ports as `typeof entry === "string"`: a JSON string token is a
 * JS string.
 * @param client - The wire client.
 * @returns The `LexiconTag` models, in response order.
 * @throws {@link ResponseValidationError} - Malformed non-string entry.
 * @example
 * ```typescript
 * const tags = await ws.listLexiconTags();
 * ```
 * @see mixpanel_headless.workspace.Workspace.list_lexicon_tags
 */
export async function listLexiconTags(
  client: MixpanelClient,
): Promise<LexiconTag[]> {
  const rawList = await client.listLexiconTags();
  const result: LexiconTag[] = [];
  for (const entry of rawList) {
    if (typeof entry === "string") {
      // The list endpoint returns plain tag names (no id); `id: 0` is
      // the sentinel described in the docblock above.
      result.push(new LexiconTag({ id: 0, name: entry }));
    } else {
      result.push(
        validateResponseModel(LexiconTag, toNativeJson(entry), {
          endpoint: "list_lexicon_tags",
        }),
      );
    }
  }
  return result;
}

/**
 * Create a Lexicon tag.
 *
 * @param client - The wire client.
 * @param params - The tag `name`. Dumped without `by_alias`, as Python
 *   spells it (the flag would be a no-op on the single field).
 * @returns The created `LexiconTag`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * const tag = await ws.createLexiconTag(new CreateTagParams({ name: "growth" }));
 * ```
 * @see mixpanel_headless.workspace.Workspace.create_lexicon_tag
 */
export async function createLexiconTag(
  client: MixpanelClient,
  params: CreateTagParams,
): Promise<LexiconTag> {
  const raw = await client.createLexiconTag(params.modelDumpExcludeNone());
  return validateResponseModel(LexiconTag, toNativeJson(raw), {
    endpoint: "create_lexicon_tag",
  });
}

/**
 * Rename a Lexicon tag by id.
 *
 * @param client - The wire client.
 * @param tagId - The tag id (never the `0` sentinel from
 *   {@link listLexiconTags}).
 * @param params - Fields to update; dumped without `by_alias`.
 * @returns The updated `LexiconTag`.
 * @throws {@link ResponseValidationError} - Malformed payload.
 * @example
 * ```typescript
 * await ws.updateLexiconTag(42, new UpdateTagParams({ name: "growth-2026" }));
 * ```
 * @see mixpanel_headless.workspace.Workspace.update_lexicon_tag
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
  return validateResponseModel(LexiconTag, toNativeJson(raw), {
    endpoint: "update_lexicon_tag",
  });
}

/**
 * Delete a Lexicon tag by name.
 *
 * @param client - The wire client.
 * @param tagName - Name of the tag to delete.
 * @returns Nothing.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
 *   failures.
 * @example
 * ```typescript
 * await ws.deleteLexiconTag("growth");
 * ```
 * @see mixpanel_headless.workspace.Workspace.delete_lexicon_tag
 */
export async function deleteLexiconTag(
  client: MixpanelClient,
  tagName: string,
): Promise<void> {
  await client.deleteLexiconTag(tagName);
}

// --- Tracking metadata, history and export ---

/**
 * Fetch the tracking metadata of an event, verbatim (Python performs no
 * model validation).
 *
 * @param client - The wire client.
 * @param eventName - Name of the event.
 * @returns The opaque metadata record.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
 *   failures.
 * @example
 * ```typescript
 * const meta = await ws.getTrackingMetadata("Signup");
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_tracking_metadata
 */
export async function getTrackingMetadata(
  client: MixpanelClient,
  eventName: string,
): Promise<Record<string, unknown>> {
  const raw = await client.getTrackingMetadata(eventName);
  return toNativeJson(raw) as Record<string, unknown>;
}

/**
 * Fetch the change history of an event definition, verbatim and
 * unvalidated.
 *
 * @param client - The wire client.
 * @param eventName - Name of the event.
 * @returns The opaque history entries, in response order.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
 *   failures.
 * @example
 * ```typescript
 * const history = await ws.getEventHistory("Signup");
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_event_history
 */
export async function getEventHistory(
  client: MixpanelClient,
  eventName: string,
): Promise<Array<Record<string, unknown>>> {
  const raw = await client.getEventHistory(eventName);
  return raw.map((item) => toNativeJson(item)) as Array<
    Record<string, unknown>
  >;
}

/**
 * Fetch the change history of a property definition, verbatim and
 * unvalidated.
 *
 * @param client - The wire client.
 * @param propertyName - Name of the property.
 * @param entityType - Entity type (`"event"`, `"user"`, `"group"`, …).
 * @returns The opaque history entries, in response order.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
 *   failures.
 * @example
 * ```typescript
 * const history = await ws.getPropertyHistory("plan", "user");
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_property_history
 */
export async function getPropertyHistory(
  client: MixpanelClient,
  propertyName: string,
  entityType: string,
): Promise<Array<Record<string, unknown>>> {
  const raw = await client.getPropertyHistory(propertyName, entityType);
  return raw.map((item) => toNativeJson(item)) as Array<
    Record<string, unknown>
  >;
}

/**
 * Export Lexicon data definitions, verbatim and unvalidated. The client
 * owns both the default type list and the `{status: "pending"}` wrapper
 * for the asynchronous (plain-string) response.
 *
 * @param client - The wire client.
 * @param options - Optional `export_types`; `null` is forwarded as-is.
 * @returns The opaque export record.
 * @throws {@link AuthenticationError} | {@link QueryError} | {@link ServerError} - Wire
 *   failures.
 * @example
 * ```typescript
 * const exported = await ws.exportLexicon({ export_types: ["events"] });
 * ```
 * @see mixpanel_headless.workspace.Workspace.export_lexicon
 */
export async function exportLexicon(
  client: MixpanelClient,
  options: WorkspaceExportLexiconOptions = {},
): Promise<Record<string, unknown>> {
  const raw = await client.exportLexicon(options.export_types ?? null);
  return toNativeJson(raw) as Record<string, unknown>;
}
