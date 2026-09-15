/**
 * Discovery + lexicon result dataclasses (phase2-design C6-b, packet
 * P2-6) — TS ports of the corresponding frozen dataclasses in
 * `mixpanel_headless/types.py`.
 *
 * Same conventions as `live-query.ts` (exact Python field names,
 * `toRows()`/`rowColumns()` for `.df` classes, `toJSON()` only where
 * Python defines `to_dict()`, strict `@internal` `fromDict()`).
 */

import { pythonStrOf } from "../../compat/index.js";
import { setOwn } from "../../compat/python-dict.js";
import { defined } from "../../invariant.js";
import type { BookmarkType, CustomPropertyType } from "../literals.js";
import {
  decodeFail,
  expectBool,
  expectFloat,
  expectInt,
  expectNullCache,
  expectPayload,
  expectRecord,
  expectRecordArray,
  expectStr,
  expectStrArray,
  isPlainRecord,
  pyTruthy,
  rejectUnknownKeys,
  requirePresent,
  type Row,
} from "./result-base.js";

/**
 * Decode an optional string field that may be absent, string, or
 * `null`.
 *
 * @param raw - The payload.
 * @param field - Field name.
 * @param cls - Class name for error messages.
 * @returns The string or `null` (absent keys yield `null` here only
 *   when the Python default is `None`; callers spread conditionally).
 * @throws ResponseValidationError - On wrong JSON type.
 */
function strOrNull(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  cls: string,
): string | null {
  const value = raw[field];
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    decodeFail(cls, field, "string | null", value);
  }
  return value;
}

/**
 * Decode an optional integer field that may be `null`.
 *
 * @param raw - The payload.
 * @param field - Field name.
 * @param cls - Class name for error messages.
 * @returns The integer or `null`.
 * @throws ResponseValidationError - On wrong JSON type.
 */
function intOrNull(
  raw: Readonly<Record<string, unknown>>,
  field: string,
  cls: string,
): number | null {
  const value = raw[field];
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    decodeFail(cls, field, "integer | null", value);
  }
  return value;
}

// ---------------------------------------------------------------------------
// FunnelInfo / SavedCohort / BookmarkInfo / SubPropertyInfo / TopEvent
// ---------------------------------------------------------------------------

/** Declared fields of {@link FunnelInfo} (Python field order). */
export interface FunnelInfoFields {
  /** Unique identifier for funnel queries. */
  readonly funnel_id: number;
  /** Human-readable funnel name. */
  readonly name: string;
}

/** A saved funnel definition — TS port of `types.FunnelInfo`. */
export class FunnelInfo {
  /** Unique identifier for funnel queries. */
  readonly funnel_id: number;

  /** Human-readable funnel name. */
  readonly name: string;

  /**
   * Create a funnel info entry.
   *
   * @param fields - Declared fields (all required).
   */
  constructor(fields: FunnelInfoFields) {
    this.funnel_id = fields.funnel_id;
    this.name = fields.name;
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return { funnel_id: this.funnel_id, name: this.name };
  }

  /**
   * Strictly decode a recorded payload.
   *
   * @param raw - The payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @internal
   */
  static fromDict(raw: unknown): FunnelInfo {
    const cls = "FunnelInfo";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(payload, new Set(["funnel_id", "name"]), cls);
    return new FunnelInfo({
      funnel_id: expectInt(payload, "funnel_id", cls),
      name: expectStr(payload, "name", cls),
    });
  }
}

/** Declared fields of {@link SavedCohort} (Python field order). */
export interface SavedCohortFields {
  /** Cohort ID. */
  readonly id: number;
  /** Cohort display name. */
  readonly name: string;
  /** Number of users currently in the cohort. */
  readonly count: number;
  /** Cohort description. */
  readonly description: string;
  /** Creation timestamp text. */
  readonly created: string;
  /** Whether the cohort is visible in the UI. */
  readonly is_visible: boolean;
}

/** A saved cohort summary — TS port of `types.SavedCohort`. */
export class SavedCohort {
  /** Cohort ID. */
  readonly id: number;

  /** Cohort display name. */
  readonly name: string;

  /** Number of users currently in the cohort. */
  readonly count: number;

  /** Cohort description. */
  readonly description: string;

  /** Creation timestamp text. */
  readonly created: string;

  /** Whether the cohort is visible in the UI. */
  readonly is_visible: boolean;

  /**
   * Create a saved-cohort summary.
   *
   * @param fields - Declared fields (all required).
   */
  constructor(fields: SavedCohortFields) {
    this.id = fields.id;
    this.name = fields.name;
    this.count = fields.count;
    this.description = fields.description;
    this.created = fields.created;
    this.is_visible = fields.is_visible;
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      count: this.count,
      description: this.description,
      created: this.created,
      is_visible: this.is_visible,
    };
  }

  /**
   * Strictly decode a recorded payload.
   *
   * @param raw - The payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @internal
   */
  static fromDict(raw: unknown): SavedCohort {
    const cls = "SavedCohort";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set(["id", "name", "count", "description", "created", "is_visible"]),
      cls,
    );
    return new SavedCohort({
      id: expectInt(payload, "id", cls),
      name: expectStr(payload, "name", cls),
      count: expectInt(payload, "count", cls),
      description: expectStr(payload, "description", cls),
      created: expectStr(payload, "created", cls),
      is_visible: expectBool(payload, "is_visible", cls),
    });
  }
}

/** Declared fields of {@link BookmarkInfo} (Python field order). */
export interface BookmarkInfoFields {
  /** Bookmark ID. */
  readonly id: number;
  /** Bookmark display name. */
  readonly name: string;
  /** Report type. */
  readonly type: BookmarkType;
  /** Owning project ID. */
  readonly project_id: number;
  /** Creation timestamp text. */
  readonly created: string;
  /** Last-modified timestamp text. */
  readonly modified: string;
  /** Owning workspace ID. Default: `null`. */
  readonly workspace_id?: number | null;
  /** Containing dashboard ID. Default: `null`. */
  readonly dashboard_id?: number | null;
  /** Bookmark description. Default: `null`. */
  readonly description?: string | null;
  /** Creator user ID. Default: `null`. */
  readonly creator_id?: number | null;
  /** Creator display name. Default: `null`. */
  readonly creator_name?: string | null;
}

/** A saved report (bookmark) summary — TS port of `types.BookmarkInfo`. */
export class BookmarkInfo {
  /** Bookmark ID. */
  readonly id: number;

  /** Bookmark display name. */
  readonly name: string;

  /** Report type. */
  readonly type: BookmarkType;

  /** Owning project ID. */
  readonly project_id: number;

  /** Creation timestamp text. */
  readonly created: string;

  /** Last-modified timestamp text. */
  readonly modified: string;

  /** Owning workspace ID. */
  readonly workspace_id: number | null;

  /** Containing dashboard ID. */
  readonly dashboard_id: number | null;

  /** Bookmark description. */
  readonly description: string | null;

  /** Creator user ID. */
  readonly creator_id: number | null;

  /** Creator display name. */
  readonly creator_name: string | null;

  /**
   * Create a bookmark summary.
   *
   * @param fields - Declared fields; absent optionals default to
   *   `null`.
   */
  constructor(fields: BookmarkInfoFields) {
    this.id = fields.id;
    this.name = fields.name;
    this.type = fields.type;
    this.project_id = fields.project_id;
    this.created = fields.created;
    this.modified = fields.modified;
    this.workspace_id = fields.workspace_id ?? null;
    this.dashboard_id = fields.dashboard_id ?? null;
    this.description = fields.description ?? null;
    this.creator_id = fields.creator_id ?? null;
    this.creator_name = fields.creator_name ?? null;
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`:
   * every optional field is emitted ONLY when non-`null`, in Python's
   * conditional order.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {
      id: this.id,
      name: this.name,
      type: this.type,
      project_id: this.project_id,
      created: this.created,
      modified: this.modified,
    };
    if (this.workspace_id !== null) {
      result["workspace_id"] = this.workspace_id;
    }
    if (this.dashboard_id !== null) {
      result["dashboard_id"] = this.dashboard_id;
    }
    if (this.description !== null) {
      result["description"] = this.description;
    }
    if (this.creator_id !== null) {
      result["creator_id"] = this.creator_id;
    }
    if (this.creator_name !== null) {
      result["creator_name"] = this.creator_name;
    }
    return result;
  }

  /**
   * Strictly decode a recorded payload.
   *
   * @param raw - The payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @internal
   */
  static fromDict(raw: unknown): BookmarkInfo {
    const cls = "BookmarkInfo";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "id",
        "name",
        "type",
        "project_id",
        "created",
        "modified",
        "workspace_id",
        "dashboard_id",
        "description",
        "creator_id",
        "creator_name",
      ]),
      cls,
    );
    return new BookmarkInfo({
      id: expectInt(payload, "id", cls),
      name: expectStr(payload, "name", cls),
      type: expectStr(payload, "type", cls) as BookmarkType,
      project_id: expectInt(payload, "project_id", cls),
      created: expectStr(payload, "created", cls),
      modified: expectStr(payload, "modified", cls),
      ...(Object.hasOwn(payload, "workspace_id")
        ? { workspace_id: intOrNull(payload, "workspace_id", cls) }
        : {}),
      ...(Object.hasOwn(payload, "dashboard_id")
        ? { dashboard_id: intOrNull(payload, "dashboard_id", cls) }
        : {}),
      ...(Object.hasOwn(payload, "description")
        ? { description: strOrNull(payload, "description", cls) }
        : {}),
      ...(Object.hasOwn(payload, "creator_id")
        ? { creator_id: intOrNull(payload, "creator_id", cls) }
        : {}),
      ...(Object.hasOwn(payload, "creator_name")
        ? { creator_name: strOrNull(payload, "creator_name", cls) }
        : {}),
    });
  }
}

/** Declared fields of {@link SubPropertyInfo} (Python field order). */
export interface SubPropertyInfoFields {
  /** Sub-property key. */
  readonly name: string;
  /** Inferred value type. */
  readonly type: CustomPropertyType;
  /** Sample values observed for this key. */
  readonly sample_values: ReadonlyArray<string | number | boolean>;
}

/**
 * One discovered sub-property of an object-valued property — TS port
 * of `types.SubPropertyInfo` (the Python `sample_values` tuple becomes
 * a `ReadonlyArray`, R4.7).
 */
export class SubPropertyInfo {
  /** Sub-property key. */
  readonly name: string;

  /** Inferred value type. */
  readonly type: CustomPropertyType;

  /** Sample values observed for this key. */
  readonly sample_values: ReadonlyArray<string | number | boolean>;

  /**
   * Create a sub-property info entry.
   *
   * @param fields - Declared fields (all required).
   */
  constructor(fields: SubPropertyInfoFields) {
    this.name = fields.name;
    this.type = fields.type;
    this.sample_values = fields.sample_values;
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`
   * (`sample_values` tuple → JSON array).
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      type: this.type,
      sample_values: [...this.sample_values],
    };
  }

  /**
   * Strictly decode a recorded payload.
   *
   * @param raw - The payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @internal
   */
  static fromDict(raw: unknown): SubPropertyInfo {
    const cls = "SubPropertyInfo";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(payload, new Set(["name", "type", "sample_values"]), cls);
    requirePresent(payload, "sample_values", cls);
    const samples = payload["sample_values"];
    if (!Array.isArray(samples)) {
      decodeFail(cls, "sample_values", "array", samples);
    }
    for (const [index, item] of samples.entries()) {
      if (
        typeof item !== "string" &&
        typeof item !== "number" &&
        typeof item !== "boolean"
      ) {
        decodeFail(
          cls,
          `sample_values[${String(index)}]`,
          "string | number | boolean",
          item,
        );
      }
    }
    return new SubPropertyInfo({
      name: expectStr(payload, "name", cls),
      type: expectStr(payload, "type", cls) as CustomPropertyType,
      sample_values: samples as ReadonlyArray<string | number | boolean>,
    });
  }
}

/** Declared fields of {@link TopEvent} (Python field order). */
export interface TopEventFields {
  /** Event name. */
  readonly event: string;
  /** Event count for the period. */
  readonly count: number;
  /** Percent change vs the prior period. */
  readonly percent_change: number;
}

/** A top event with its recent volume — TS port of `types.TopEvent`. */
export class TopEvent {
  /** Event name. */
  readonly event: string;

  /** Event count for the period. */
  readonly count: number;

  /** Percent change vs the prior period. */
  readonly percent_change: number;

  /**
   * Create a top-event entry.
   *
   * @param fields - Declared fields (all required).
   */
  constructor(fields: TopEventFields) {
    this.event = fields.event;
    this.count = fields.count;
    this.percent_change = fields.percent_change;
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      event: this.event,
      count: this.count,
      percent_change: this.percent_change,
    };
  }

  /**
   * Strictly decode a recorded payload.
   *
   * @param raw - The payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @internal
   */
  static fromDict(raw: unknown): TopEvent {
    const cls = "TopEvent";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set(["event", "count", "percent_change"]),
      cls,
    );
    return new TopEvent({
      event: expectStr(payload, "event", cls),
      count: expectInt(payload, "count", cls),
      percent_change: expectFloat(payload, "percent_change", cls),
    });
  }
}

// ---------------------------------------------------------------------------
// Lexicon dataclasses
// ---------------------------------------------------------------------------

/** Declared fields of {@link LexiconMetadata} (Python field order). */
export interface LexiconMetadataFields {
  /** Definition source system. */
  readonly source: string | null;
  /** Display name override. */
  readonly display_name: string | null;
  /** Assigned tags. */
  readonly tags: readonly string[];
  /** Whether the entity is hidden. */
  readonly hidden: boolean;
  /** Whether the entity is dropped. */
  readonly dropped: boolean;
  /** Contact emails. */
  readonly contacts: readonly string[];
  /** Team contact identifiers. */
  readonly team_contacts: readonly string[];
}

/** Lexicon entity metadata — TS port of `types.LexiconMetadata`. */
export class LexiconMetadata {
  /** Definition source system. */
  readonly source: string | null;

  /** Display name override. */
  readonly display_name: string | null;

  /** Assigned tags. */
  readonly tags: readonly string[];

  /** Whether the entity is hidden. */
  readonly hidden: boolean;

  /** Whether the entity is dropped. */
  readonly dropped: boolean;

  /** Contact emails. */
  readonly contacts: readonly string[];

  /** Team contact identifiers. */
  readonly team_contacts: readonly string[];

  /**
   * Create lexicon metadata.
   *
   * @param fields - Declared fields (all required).
   */
  constructor(fields: LexiconMetadataFields) {
    this.source = fields.source;
    this.display_name = fields.display_name;
    this.tags = fields.tags;
    this.hidden = fields.hidden;
    this.dropped = fields.dropped;
    this.contacts = fields.contacts;
    this.team_contacts = fields.team_contacts;
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      source: this.source,
      display_name: this.display_name,
      tags: this.tags,
      hidden: this.hidden,
      dropped: this.dropped,
      contacts: this.contacts,
      team_contacts: this.team_contacts,
    };
  }

  /**
   * Strictly decode a recorded payload.
   *
   * @param raw - The payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @internal
   */
  static fromDict(raw: unknown): LexiconMetadata {
    const cls = "LexiconMetadata";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "source",
        "display_name",
        "tags",
        "hidden",
        "dropped",
        "contacts",
        "team_contacts",
      ]),
      cls,
    );
    requirePresent(payload, "source", cls);
    requirePresent(payload, "display_name", cls);
    return new LexiconMetadata({
      source: strOrNull(payload, "source", cls),
      display_name: strOrNull(payload, "display_name", cls),
      tags: expectStrArray(payload, "tags", cls),
      hidden: expectBool(payload, "hidden", cls),
      dropped: expectBool(payload, "dropped", cls),
      contacts: expectStrArray(payload, "contacts", cls),
      team_contacts: expectStrArray(payload, "team_contacts", cls),
    });
  }
}

/** Declared fields of {@link LexiconProperty} (Python field order). */
export interface LexiconPropertyFields {
  /** JSON-schema type of the property. */
  readonly type: string;
  /** Property description. */
  readonly description: string | null;
  /** Property-level metadata. */
  readonly metadata: LexiconMetadata | null;
}

/** One property in a lexicon schema — TS port of `types.LexiconProperty`. */
export class LexiconProperty {
  /** JSON-schema type of the property. */
  readonly type: string;

  /** Property description. */
  readonly description: string | null;

  /** Property-level metadata. */
  readonly metadata: LexiconMetadata | null;

  /**
   * Create a lexicon property.
   *
   * @param fields - Declared fields (all required).
   */
  constructor(fields: LexiconPropertyFields) {
    this.type = fields.type;
    this.description = fields.description;
    this.metadata = fields.metadata;
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`:
   * `description`/`metadata` emitted ONLY when non-`null`.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = { type: this.type };
    if (this.description !== null) {
      result["description"] = this.description;
    }
    if (this.metadata !== null) {
      result["metadata"] = this.metadata.toJSON();
    }
    return result;
  }

  /**
   * Strictly decode a recorded payload.
   *
   * @param raw - The payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @internal
   */
  static fromDict(raw: unknown): LexiconProperty {
    const cls = "LexiconProperty";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set(["type", "description", "metadata"]),
      cls,
    );
    requirePresent(payload, "description", cls);
    requirePresent(payload, "metadata", cls);
    const metadata = payload["metadata"];
    return new LexiconProperty({
      type: expectStr(payload, "type", cls),
      description: strOrNull(payload, "description", cls),
      metadata: metadata === null ? null : LexiconMetadata.fromDict(metadata),
    });
  }
}

/** Declared fields of {@link LexiconDefinition} (Python field order). */
export interface LexiconDefinitionFields {
  /** Entity description. */
  readonly description: string | null;
  /** Property definitions keyed by property name. */
  readonly properties: Readonly<Record<string, LexiconProperty>>;
  /** Entity-level metadata. */
  readonly metadata: LexiconMetadata | null;
}

/** A lexicon schema definition — TS port of `types.LexiconDefinition`. */
export class LexiconDefinition {
  /** Entity description. */
  readonly description: string | null;

  /** Property definitions keyed by property name. */
  readonly properties: Readonly<Record<string, LexiconProperty>>;

  /** Entity-level metadata. */
  readonly metadata: LexiconMetadata | null;

  /**
   * Create a lexicon definition.
   *
   * @param fields - Declared fields (all required).
   */
  constructor(fields: LexiconDefinitionFields) {
    this.description = fields.description;
    this.properties = fields.properties;
    this.metadata = fields.metadata;
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`:
   * `properties` first, then conditional `description`/`metadata`.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    const result: Record<string, unknown> = {
      properties: Object.fromEntries(
        Object.entries(this.properties).map(([key, value]) => [
          key,
          value.toJSON(),
        ]),
      ),
    };
    if (this.description !== null) {
      result["description"] = this.description;
    }
    if (this.metadata !== null) {
      result["metadata"] = this.metadata.toJSON();
    }
    return result;
  }

  /**
   * Strictly decode a recorded payload.
   *
   * @param raw - The payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @internal
   */
  static fromDict(raw: unknown): LexiconDefinition {
    const cls = "LexiconDefinition";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set(["description", "properties", "metadata"]),
      cls,
    );
    requirePresent(payload, "description", cls);
    requirePresent(payload, "metadata", cls);
    const properties = expectRecord(payload, "properties", cls);
    const metadata = payload["metadata"];
    return new LexiconDefinition({
      description: strOrNull(payload, "description", cls),
      properties: Object.fromEntries(
        Object.entries(properties).map(([key, value]) => [
          key,
          LexiconProperty.fromDict(value),
        ]),
      ),
      metadata: metadata === null ? null : LexiconMetadata.fromDict(metadata),
    });
  }
}

/** Declared fields of {@link LexiconSchema} (Python field order). */
export interface LexiconSchemaFields {
  /** Entity type (`"event"`, `"profile"`, ...). */
  readonly entity_type: string;
  /** Entity name. */
  readonly name: string;
  /** The schema definition. */
  readonly schema_json: LexiconDefinition;
}

/** One lexicon schema entry — TS port of `types.LexiconSchema`. */
export class LexiconSchema {
  /** Entity type (`"event"`, `"profile"`, ...). */
  readonly entity_type: string;

  /** Entity name. */
  readonly name: string;

  /** The schema definition. */
  readonly schema_json: LexiconDefinition;

  /**
   * Create a lexicon schema entry.
   *
   * @param fields - Declared fields (all required).
   */
  constructor(fields: LexiconSchemaFields) {
    this.entity_type = fields.entity_type;
    this.name = fields.name;
    this.schema_json = fields.schema_json;
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      entity_type: this.entity_type,
      name: this.name,
      schema_json: this.schema_json.toJSON(),
    };
  }

  /**
   * Strictly decode a recorded payload.
   *
   * @param raw - The payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @internal
   */
  static fromDict(raw: unknown): LexiconSchema {
    const cls = "LexiconSchema";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set(["entity_type", "name", "schema_json"]),
      cls,
    );
    requirePresent(payload, "schema_json", cls);
    return new LexiconSchema({
      entity_type: expectStr(payload, "entity_type", cls),
      name: expectStr(payload, "name", cls),
      schema_json: LexiconDefinition.fromDict(payload["schema_json"]),
    });
  }
}

// ---------------------------------------------------------------------------
// ProfilePageResult
// ---------------------------------------------------------------------------

/** Declared fields of {@link ProfilePageResult} (Python field order). */
export interface ProfilePageResultFields {
  /** Profile dicts on this page. */
  readonly profiles: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Engage pagination session ID. */
  readonly session_id: string | null;
  /** Zero-based page number. */
  readonly page: number;
  /** Whether more pages exist. */
  readonly has_more: boolean;
  /** Total matching profiles. */
  readonly total: number;
  /** Page size used by the API. */
  readonly page_size: number;
}

/**
 * One page of an engage profile export — TS port of
 * `types.ProfilePageResult`.
 */
export class ProfilePageResult {
  /** Profile dicts on this page. */
  readonly profiles: ReadonlyArray<Readonly<Record<string, unknown>>>;

  /** Engage pagination session ID. */
  readonly session_id: string | null;

  /** Zero-based page number. */
  readonly page: number;

  /** Whether more pages exist. */
  readonly has_more: boolean;

  /** Total matching profiles. */
  readonly total: number;

  /** Page size used by the API. */
  readonly page_size: number;

  /**
   * Create a profile page result.
   *
   * @param fields - Declared fields (all required).
   */
  constructor(fields: ProfilePageResultFields) {
    this.profiles = fields.profiles;
    this.session_id = fields.session_id;
    this.page = fields.page;
    this.has_more = fields.has_more;
    this.total = fields.total;
    this.page_size = fields.page_size;
  }

  /**
   * Total page count, exactly as Python's `num_pages` property
   * (`0` when `total == 0`, else `ceil(total / page_size)`).
   *
   * @returns The page count.
   */
  get num_pages(): number {
    if (this.total === 0) {
      return 0;
    }
    return Math.ceil(this.total / this.page_size);
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`
   * (including the derived `profile_count` and `num_pages`).
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      profiles: this.profiles,
      session_id: this.session_id,
      page: this.page,
      has_more: this.has_more,
      profile_count: this.profiles.length,
      total: this.total,
      page_size: this.page_size,
      num_pages: this.num_pages,
    };
  }

  /**
   * Re-encode the full declared field walk for golden diffs (plain
   * dataclass — no `_df_cache` slot, no derived keys).
   *
   * @returns The recorded-payload shape.
   * @internal
   */
  toVectorPayload(): Record<string, unknown> {
    return {
      profiles: this.profiles,
      session_id: this.session_id,
      page: this.page,
      has_more: this.has_more,
      total: this.total,
      page_size: this.page_size,
    };
  }

  /**
   * Strictly decode a recorded field-walk payload.
   *
   * @param raw - The payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @internal
   */
  static fromDict(raw: unknown): ProfilePageResult {
    const cls = "ProfilePageResult";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "profiles",
        "session_id",
        "page",
        "has_more",
        "total",
        "page_size",
      ]),
      cls,
    );
    requirePresent(payload, "session_id", cls);
    return new ProfilePageResult({
      profiles: expectRecordArray(payload, "profiles", cls),
      session_id: strOrNull(payload, "session_id", cls),
      page: expectInt(payload, "page", cls),
      has_more: expectBool(payload, "has_more", cls),
      total: expectInt(payload, "total", cls),
      page_size: expectInt(payload, "page_size", cls),
    });
  }
}

// ---------------------------------------------------------------------------
// SchemaGraphResult
// ---------------------------------------------------------------------------

/** Node kinds of the {@link SchemaGraph} adjacency object. */
export type SchemaGraphNodeKind = "event" | "property";

/** One node of the {@link SchemaGraph} (a `networkx` node + attrs). */
export interface SchemaGraphNode {
  /** The bare entity name (Python `str(name)`). */
  readonly name: string;
  /** Whether the name denotes an event or a property. */
  readonly kind: SchemaGraphNodeKind;
}

/** One directed event→property edge of the {@link SchemaGraph}. */
export interface SchemaGraphEdge {
  /** The event name the edge starts at. */
  readonly source: string;
  /** The property name the edge points to. */
  readonly target: string;
  /** The property's `densityLocal`, repeated onto each of its edges. */
  readonly density_local: unknown;
}

/**
 * The plain-object twin of the `networkx.DiGraph`
 * {@link SchemaGraphResult.toGraph} builds — node and edge lists in
 * insertion order.
 */
export interface SchemaGraph {
  /** One entry per unique name, in first-insertion order. */
  readonly nodes: readonly SchemaGraphNode[];
  /** One entry per unique `(source, target)`, in insertion order. */
  readonly edges: readonly SchemaGraphEdge[];
}

/** Declared constructor fields of {@link SchemaGraphResult}. */
export interface SchemaGraphResultFields {
  /** When the graph was computed (ISO text). */
  readonly computed_at: string;
  /** Raw lexicon event dicts. Default: `[]`. */
  readonly events?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Raw lexicon event-property dicts. Default: `[]`. */
  readonly properties?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Raw lexicon user-property dicts. Default: `[]`. */
  readonly user_properties?: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Whether local densities were requested. Default: `false`. */
  readonly include_density?: boolean;
  /** Request parameters used to build the graph. Default: `{}`. */
  readonly params?: Readonly<Record<string, unknown>>;
}

/**
 * Result of a schema-graph discovery call — TS port of
 * `types.SchemaGraphResult`.
 *
 * The event↔property adjacency comes from the query API's per-event
 * properties gather (`data_definitions/events?
 * fetch_per_event_properties=true`, inverted client-side onto each
 * property by the discovery service — Python PR #215), so for any
 * event you can list the properties that travel with it.
 *
 * A multi-DataFrame surface (phase2-design C6): `events_df` /
 * `properties_df` / `relationships_df` become `toEventsRows()` /
 * `toPropertiesRows()` / `toRelationshipsRows()`; the main `.df`
 * delegates to the relationships frame. The derived
 * `event_to_properties` / `property_to_events` / `meta` fields are
 * computed in the constructor exactly as Python's `__post_init__`.
 *
 * `to_graph()` lands at B5-S1 as {@link SchemaGraphResult.toGraph} — a
 * plain adjacency object (node list + edge list) carrying exactly the
 * sets Python hands `networkx`. The codec-visible `_graph_cache` slot
 * stays `null` (Python caches the graph object; the TS twin rebuilds it
 * deterministically, the Phase-2 frame-cache convention).
 */
export class SchemaGraphResult {
  /** Codec-visible DataFrame cache slot (`@internal`) — always `null`. */
  readonly _df_cache: null = null;

  /** When the graph was computed (ISO text). */
  readonly computed_at: string;

  /** Raw lexicon event dicts. */
  readonly events: ReadonlyArray<Readonly<Record<string, unknown>>>;

  /** Raw lexicon event-property dicts. */
  readonly properties: ReadonlyArray<Readonly<Record<string, unknown>>>;

  /** Raw lexicon user-property dicts. */
  readonly user_properties: ReadonlyArray<Readonly<Record<string, unknown>>>;

  /** Derived event → attached property names (Python `init=False`). */
  readonly event_to_properties: Readonly<Record<string, readonly string[]>>;

  /** Derived property → attached event names (Python `init=False`). */
  readonly property_to_events: Readonly<Record<string, readonly string[]>>;

  /** Whether local densities were requested. */
  readonly include_density: boolean;

  /** Derived graph statistics (Python `init=False`). */
  readonly meta: Readonly<Record<string, unknown>>;

  /** Request parameters used to build the graph. */
  readonly params: Readonly<Record<string, unknown>>;

  /** Codec-visible events-frame cache slot (`@internal`) — always `null`. */
  readonly _events_df_cache: null = null;

  /** Codec-visible properties-frame cache slot (`@internal`) — always `null`. */
  readonly _properties_df_cache: null = null;

  /** Codec-visible relationships-frame cache slot (`@internal`) — always `null`. */
  readonly _relationships_df_cache: null = null;

  /** Codec-visible graph cache slot (`@internal`) — always `null`. */
  readonly _graph_cache: null = null;

  /**
   * Create a schema-graph result and compute the derived indexes,
   * exactly as Python's `__post_init__` (same skip rules for nameless
   * events/properties and non-dict property-event entries).
   *
   * @param fields - Declared constructor fields; Python defaults apply
   *   to absent optionals.
   */
  constructor(fields: SchemaGraphResultFields) {
    this.computed_at = fields.computed_at;
    this.events = fields.events ?? [];
    this.properties = fields.properties ?? [];
    this.user_properties = fields.user_properties ?? [];
    this.include_density = fields.include_density ?? false;
    this.params = fields.params ?? {};

    const eventToProperties: Record<string, string[]> = {};
    let eventsWithoutName = 0;
    for (const event of this.events) {
      const name = event["name"];
      if (pyTruthy(name)) {
        setOwn(eventToProperties, pythonStrOf(name), []);
      } else {
        eventsWithoutName += 1;
      }
    }
    const propertyToEvents: Record<string, string[]> = {};
    let propertiesWithoutName = 0;
    let propertyEventEntriesDropped = 0;
    let relationshipEdges = 0;
    for (const prop of this.properties) {
      const propName = prop["name"];
      if (!pyTruthy(propName)) {
        propertiesWithoutName += 1;
        continue;
      }
      const rawEntriesValue = prop["events"];
      const rawEntries: readonly unknown[] = pyTruthy(rawEntriesValue)
        ? (rawEntriesValue as readonly unknown[])
        : [];
      const attached: string[] = [];
      for (const entry of rawEntries) {
        if (isPlainRecord(entry) && pyTruthy(entry["name"])) {
          attached.push(pythonStrOf(entry["name"]));
        }
      }
      propertyEventEntriesDropped += rawEntries.length - attached.length;
      setOwn(propertyToEvents, pythonStrOf(propName), attached);
      relationshipEdges += attached.length;
      // Python `setdefault(event_name, []).append(...)`; `setOwn` keeps a
      // `"__proto__"`-named event from resolving to `Object.prototype`.
      for (const eventName of attached) {
        if (!Object.hasOwn(eventToProperties, eventName)) {
          setOwn(eventToProperties, eventName, []);
        }
        defined(eventToProperties[eventName], "eventToProperties entry").push(
          pythonStrOf(propName),
        );
      }
    }
    // TODO(port): these two plain objects hold Python DICTS whose
    // insertion order is contract for anything that iterates them —
    // and JS hoists integer-like keys ("1", "0") to the front, so an
    // event or property named with digits changes `Object.keys()`
    // order (watchlist #10). No vector sees it (the conformance
    // canonicalizer sorts object keys, `canonical.ts:13`) and
    // `toGraph()` now rebuilds the order it needs from `events` /
    // `properties` directly (B5-S1 R10.9 finding 3), but a `Map`-valued
    // surface would be the complete fix. Phase-2 field-shape decision —
    // escalated in `B5-S1-notes.md` §3, not changed unilaterally here.
    this.event_to_properties = eventToProperties;
    this.property_to_events = propertyToEvents;
    this.meta = {
      event_count: this.events.length,
      event_property_count: this.properties.length,
      user_property_count: this.user_properties.length,
      events_without_name: eventsWithoutName,
      properties_without_name: propertiesWithoutName,
      property_event_entries_dropped: propertyEventEntriesDropped,
      relationship_edges: relationshipEdges,
    };
  }

  /**
   * Pre-pandas rows of the Python `events_df` body: one row per raw
   * event with the seven projected columns (missing attributes are
   * `null`, mirroring `e.get(...)`).
   *
   * @returns The rows list.
   */
  toEventsRows(): readonly Row[] {
    return this.events.map((event) => ({
      name: event["name"] ?? null,
      display_name: event["displayName"] ?? null,
      description: event["description"] ?? null,
      hidden: event["hidden"] ?? null,
      dropped: event["dropped"] ?? null,
      verified: event["verified"] ?? null,
      count: event["count"] ?? null,
    }));
  }

  /**
   * Column contract of the `events_df` frame (Python passes an
   * explicit `columns=cols` list — constant for empty AND non-empty).
   *
   * @returns The column list.
   */
  eventsRowColumns(): readonly string[] {
    return [
      "name",
      "display_name",
      "description",
      "hidden",
      "dropped",
      "verified",
      "count",
    ];
  }

  /**
   * Pre-pandas rows of the Python `properties_df` body: event
   * properties (default resource `"event"`) followed by user
   * properties (default resource `"user"`).
   *
   * @returns The rows list.
   */
  toPropertiesRows(): readonly Row[] {
    return [
      ...this.properties.map((prop) => propertyRow(prop, "event")),
      ...this.user_properties.map((prop) => propertyRow(prop, "user")),
    ];
  }

  /**
   * Column contract of the `properties_df` frame (explicit
   * `columns=cols` in Python).
   *
   * @returns The column list.
   */
  propertiesRowColumns(): readonly string[] {
    return [
      "name",
      "resource_type",
      "display_name",
      "description",
      "example_value",
      "type",
      "hidden",
      "count",
    ];
  }

  /**
   * Pre-pandas rows of the Python `relationships_df` body: one
   * `{event, property, density_local}` edge per (property, attached
   * event) pair, skipping nameless properties/entries.
   *
   * @returns The rows list.
   */
  toRelationshipsRows(): readonly Row[] {
    const rows: Row[] = [];
    for (const prop of this.properties) {
      const name = prop["name"];
      if (!pyTruthy(name)) {
        continue;
      }
      const density = prop["densityLocal"] ?? null;
      const entriesValue = prop["events"];
      const entries: readonly unknown[] = pyTruthy(entriesValue)
        ? (entriesValue as readonly unknown[])
        : [];
      for (const entry of entries) {
        const eventName = isPlainRecord(entry) ? entry["name"] : null;
        if (!pyTruthy(eventName)) {
          continue;
        }
        rows.push({
          event: pythonStrOf(eventName),
          property: pythonStrOf(name),
          density_local: density,
        });
      }
    }
    return rows;
  }

  /**
   * Column contract of the `relationships_df` frame (explicit
   * `columns=cols` in Python).
   *
   * @returns The column list.
   */
  relationshipsRowColumns(): readonly string[] {
    return ["event", "property", "density_local"];
  }

  /**
   * The main `.df` contract — Python's `df` property returns
   * `relationships_df`.
   *
   * @returns.
   */
  toRows(): readonly Row[] {
    return this.toRelationshipsRows();
  }

  /**
   * Column contract of the main `.df` frame.
   *
   * @returns.
   */
  rowColumns(): readonly string[] {
    return this.relationshipsRowColumns();
  }

  /**
   * Property names attached to an event.
   *
   * @param event - Event name.
   * @returns A fresh list (Python returns `list(...)`).
   */
  propertiesForEvent(event: string): readonly string[] {
    return [...(this.event_to_properties[event] ?? [])];
  }

  /**
   * Event names a property is attached to.
   *
   * @param prop - Property name.
   * @returns A fresh list (Python returns `list(...)`).
   */
  eventsForProperty(prop: string): readonly string[] {
    return [...(this.property_to_events[prop] ?? [])];
  }

  /**
   * Named properties attached to no event, in `properties` order.
   *
   * @returns The orphan property names.
   */
  orphanProperties(): readonly string[] {
    const orphans: string[] = [];
    for (const prop of this.properties) {
      const name = prop["name"];
      if (
        pyTruthy(name) &&
        !pyTruthy(this.property_to_events[pythonStrOf(name)])
      ) {
        orphans.push(pythonStrOf(name));
      }
    }
    return orphans;
  }

  /**
   * Build the directed event→property relationship graph
   * (`types.SchemaGraphResult.to_graph`, `types.py:11801-11853`).
   *
   * Event names become nodes with `kind: "event"`, property names nodes
   * with `kind: "property"`, and a directed edge runs from each event to
   * every property that appears on it, carrying the property's
   * `density_local` (`null` unless `include_density` was requested).
   * Nodes are keyed by bare name, so an event and a property sharing a
   * name collapse to ONE node — and, exactly like `networkx`'s
   * `add_node`, a later write updates that node's `kind` while keeping
   * its original position.
   *
   * The `networkx.DiGraph` return has no vendored TS twin, so the port
   * hands back the plain adjacency object the graph is built from:
   * `nodes` in insertion order and `edges` in insertion order, one entry
   * per unique `(source, target)` pair (a repeated `add_edge` updates
   * the attributes in place, as `networkx` does). Successors of `u` are
   * `edges.filter((e) => e.source === u)`, and `number_of_nodes()` is
   * `nodes.length`.
   *
   * Python caches the graph on `_graph_cache`; the TS build is pure and
   * deterministic, so repeated calls are deep-equal and the codec slot
   * stays `null`.
   *
   * @returns The adjacency object. Empty when there are no events or
   *   properties.
   * @example
   * ```typescript
   * const graph = (await ws.schemaGraph()).toGraph();
   * graph.nodes.find((n) => n.name === "Purchase")?.kind; // "event"
   * ```
   */
  toGraph(): SchemaGraph {
    const nodeIndex = new Map<string, number>();
    const nodes: Array<{ name: string; kind: SchemaGraphNodeKind }> = [];
    const addNode = (name: string, kind: SchemaGraphNodeKind): void => {
      const existing = nodeIndex.get(name);
      if (existing === undefined) {
        nodeIndex.set(name, nodes.length);
        nodes.push({ name, kind });
        return;
      }
      // networkx `add_node` on an existing node UPDATES the attributes
      // and leaves the insertion position alone.
      (nodes[existing] as { name: string; kind: SchemaGraphNodeKind }).kind =
        kind;
    };
    // `networkx` stores edges in a per-source adjacency dict, so
    // `G.edges` yields them grouped by SOURCE NODE in node-insertion
    // order, then by adjacency-insertion order inside each source —
    // not in global edge-insertion order (R10.9 differential finding 2,
    // 88/500 cases). The same two-level Map reproduces that iteration.
    const adjacency = new Map<string, Map<string, unknown>>();
    const addEdge = (
      source: string,
      target: string,
      densityLocal: unknown,
    ): void => {
      let targets = adjacency.get(source);
      if (targets === undefined) {
        targets = new Map<string, unknown>();
        adjacency.set(source, targets);
      }
      // A repeated `add_edge` updates the attributes in place and keeps
      // the original adjacency position (`Map.set` does the same).
      targets.set(target, densityLocal);
    };

    // Python's first loop walks `self.event_to_properties`, whose key
    // order is: seeded event names (in `events` order) followed by
    // attached event names (in property/entry order). `Object.keys()`
    // CANNOT reproduce that — JS hoists integer-like keys ("1") to the
    // front (watchlist #10; R10.9 differential finding 3) — so the same
    // sequence is rebuilt from the two sources directly.
    for (const event of this.events) {
      const seeded = event["name"];
      if (pyTruthy(seeded)) {
        addNode(pythonStrOf(seeded), "event");
      }
    }
    for (const prop of this.properties) {
      if (!pyTruthy(prop["name"])) {
        continue;
      }
      const seededEntries = prop["events"];
      for (const entry of pyTruthy(seededEntries)
        ? (seededEntries as readonly unknown[])
        : []) {
        if (isPlainRecord(entry) && pyTruthy(entry["name"])) {
          addNode(pythonStrOf(entry["name"]), "event");
        }
      }
    }
    for (const event of this.events) {
      const name = event["name"];
      if (pyTruthy(name)) {
        addNode(pythonStrOf(name), "event");
      }
    }
    for (const prop of this.properties) {
      const propName = prop["name"];
      if (!pyTruthy(propName)) {
        continue;
      }
      addNode(pythonStrOf(propName), "property");
      const density = Object.hasOwn(prop, "densityLocal")
        ? prop["densityLocal"]
        : null;
      const entriesValue = prop["events"];
      const entries: readonly unknown[] = pyTruthy(entriesValue)
        ? (entriesValue as readonly unknown[])
        : [];
      for (const entry of entries) {
        if (!isPlainRecord(entry) || !pyTruthy(entry["name"])) {
          continue;
        }
        addNode(pythonStrOf(entry["name"]), "event");
        addEdge(pythonStrOf(entry["name"]), pythonStrOf(propName), density);
      }
    }
    const edges: SchemaGraphEdge[] = [];
    for (const node of nodes) {
      for (const [target, densityLocal] of adjacency.get(node.name) ??
        new Map<string, unknown>()) {
        edges.push({ source: node.name, target, density_local: densityLocal });
      }
    }
    return { nodes, edges };
  }

  /**
   * Serialize for JSON output — byte-shape of Python `to_dict()`.
   *
   * @returns The plain dict shape.
   */
  toJSON(): Record<string, unknown> {
    return {
      computed_at: this.computed_at,
      events: this.events,
      properties: this.properties,
      user_properties: this.user_properties,
      event_to_properties: this.event_to_properties,
      property_to_events: this.property_to_events,
      include_density: this.include_density,
      meta: this.meta,
      params: this.params,
    };
  }

  /**
   * Strictly decode a recorded field-walk payload. The Python
   * `init=False` fields (`event_to_properties`, `property_to_events`,
   * `meta`) may appear in payloads; they are accepted and RECOMPUTED
   * by the constructor (exactly as Python reconstruction would).
   *
   * @param raw - The payload.
   * @returns The reconstructed instance.
   * @throws ResponseValidationError - On unknown keys or wrong types.
   * @internal
   */
  static fromDict(raw: unknown): SchemaGraphResult {
    const cls = "SchemaGraphResult";
    const payload = expectPayload(raw, cls);
    rejectUnknownKeys(
      payload,
      new Set([
        "computed_at",
        "events",
        "properties",
        "user_properties",
        "event_to_properties",
        "property_to_events",
        "include_density",
        "meta",
        "params",
        "_df_cache",
        "_events_df_cache",
        "_properties_df_cache",
        "_relationships_df_cache",
        "_graph_cache",
      ]),
      cls,
    );
    for (const cache of [
      "_df_cache",
      "_events_df_cache",
      "_properties_df_cache",
      "_relationships_df_cache",
      "_graph_cache",
    ]) {
      expectNullCache(payload, cache, cls);
    }
    return new SchemaGraphResult({
      computed_at: expectStr(payload, "computed_at", cls),
      ...(Object.hasOwn(payload, "events")
        ? { events: expectRecordArray(payload, "events", cls) }
        : {}),
      ...(Object.hasOwn(payload, "properties")
        ? { properties: expectRecordArray(payload, "properties", cls) }
        : {}),
      ...(Object.hasOwn(payload, "user_properties")
        ? {
            user_properties: expectRecordArray(payload, "user_properties", cls),
          }
        : {}),
      ...(Object.hasOwn(payload, "include_density")
        ? { include_density: expectBool(payload, "include_density", cls) }
        : {}),
      ...(Object.hasOwn(payload, "params")
        ? { params: expectRecord(payload, "params", cls) }
        : {}),
    });
  }
}

/**
 * Project one raw lexicon property dict into the `properties_df` row
 * shape — mirror of Python `SchemaGraphResult._property_row`.
 *
 * @param prop - Raw property dict.
 * @param defaultResource - Resource fallback when `resourceType` is
 *   falsy.
 * @returns The row.
 */
function propertyRow(
  prop: Readonly<Record<string, unknown>>,
  defaultResource: string,
): Row {
  const resource = prop["resourceType"];
  const resourceType = pyTruthy(resource)
    ? pythonStrOf(resource).toLowerCase()
    : defaultResource;
  return {
    name: prop["name"] ?? null,
    resource_type: resourceType,
    display_name: prop["displayName"] ?? null,
    description: prop["description"] ?? null,
    example_value: prop["exampleValue"] ?? null,
    type: prop["type"] ?? null,
    hidden: prop["hidden"] ?? null,
    count: prop["count"] ?? null,
  };
}
