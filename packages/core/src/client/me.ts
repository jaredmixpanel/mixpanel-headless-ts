/**
 * `/me` response models and workspace-selection logic: the response
 * models, {@link WorkspaceView}, `selectWorkspaceId` and the
 * {@link WorkspaceResolver} interface the client consumes. The `MeCache`
 * and `MeService` halves of the Python module are ported elsewhere
 * (`services/me.ts`, the platform cache stores). The models reuse the
 * {@link EntityModel} machinery: lax scalar coercion, `extra='allow'`
 * spillover, `fromDict` alias handling and `toJSON` field walks.
 *
 * @see mixpanel_headless._internal.me
 */

import { pythonInt } from "../compat/index.js";
import { isPythonDict } from "../compat/python-dict.js";
import { MixpanelHeadlessError } from "../errors.js";
import type { PublicWorkspace } from "../types/entities/common.js";
import {
  type EntityFieldSpecs,
  EntityModel,
  prepareInit,
} from "../types/entities/model-base.js";
import { JsonNumber } from "./json-value.js";

/**
 * The global "see everything" data view Mixpanel provisions for every
 * workspace-enabled project. Preferred during
 * auto-resolution because it is the only view guaranteed to see all of
 * the project's data.
 */
const GLOBAL_WORKSPACE_NAME = "All Project Data";

/**
 * Constructor input for {@link MeOrgInfo} — absent keys take the Python
 * defaults; `undefined` counts as absent.
 */
export interface MeOrgInfoInit {
  /** Organization ID. */
  readonly id: number;
  /** Organization display name. */
  readonly name: string;
  /** User's role in this organization. */
  readonly role?: string | null | undefined;
  /** User's permissions in this organization. */
  readonly permissions?: readonly string[] | null | undefined;
}

/**
 * Organization information within a `/me` response.
 *
 * @remarks
 * Python `model_config`: `extra='allow'`, `frozen=True` — unknown keys
 * are kept under {@link MeOrgInfo.modelExtra}; instances are read-only at
 * the type level.
 * @example
 * ```typescript
 * const org = MeOrgInfo.fromDict({ id: 100, name: "Acme Corp", role: "admin" });
 * org.permissions; // null
 * ```
 * @see mixpanel_headless._internal.me.MeOrgInfo
 */
export class MeOrgInfo extends EntityModel<MeOrgInfoInit> {
  /** The Python model name. */
  static readonly modelName = "MeOrgInfo";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /**
   * Declared fields in Python `model_fields` order.
   *
   * @internal
   */
  static readonly fieldSpecs: EntityFieldSpecs<MeOrgInfoInit> = [
    { name: "id", required: true, kind: "int" },
    { name: "name", required: true, kind: "str" },
    { name: "role", kind: "str", nullable: true },
    { name: "permissions", nullable: true },
  ];

  /** Organization ID. */
  declare readonly id: number;
  /** Organization display name. */
  declare readonly name: string;
  /** User's role in this organization. */
  declare readonly role: string | null;
  /** User's permissions in this organization. */
  declare readonly permissions: readonly string[] | null;

  /**
   * Construct a validated MeOrgInfo (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields.
   */
  constructor(fields: MeOrgInfoInit) {
    super(MeOrgInfo, fields);
  }

  /**
   * Pydantic `model_extra` mirror: unknown input keys preserved under
   * `extra='allow'` (forward compatibility).
   *
   * @returns The extra-field bag (empty when none were supplied).
   */
  get modelExtra(): Readonly<Record<string, unknown>> {
    return this.__extras;
  }

  /**
   * Strict decode from a raw mapping.
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): MeOrgInfo {
    return new MeOrgInfo(prepareInit(MeOrgInfo, raw));
  }
}

/**
 * Constructor input for {@link MeProjectInfo} — absent keys take the
 * Python defaults; `undefined` counts as absent.
 */
export interface MeProjectInfoInit {
  /** Project display name. */
  readonly name: string;
  /** Owning organization ID. */
  readonly organization_id: number;
  /** Project timezone. */
  readonly timezone?: string | null | undefined;
  /** Whether project uses workspaces. */
  readonly has_workspaces?: boolean | null | undefined;
  /** Mixpanel domain for the project's cluster. */
  readonly domain?: string | null | undefined;
  /** Project type (e.g. `"PROJECT"`, `"ROLLUP"`, or an integer code). */
  readonly type?: string | number | null | undefined;
}

/**
 * Project information within a `/me` response.
 *
 * @remarks
 * Python `model_config`: `extra='allow'`, `frozen=True` (see
 * {@link MeOrgInfo}).
 * @example
 * ```typescript
 * const project = MeProjectInfo.fromDict({
 *   name: "Web",
 *   organization_id: 100,
 *   has_workspaces: true,
 * });
 * project.timezone; // null
 * ```
 * @see mixpanel_headless._internal.me.MeProjectInfo
 */
export class MeProjectInfo extends EntityModel<MeProjectInfoInit> {
  /** The Python model name. */
  static readonly modelName = "MeProjectInfo";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /**
   * Declared fields in Python `model_fields` order. `type` is
   * a `str | int | None` union — no single lax-coercion kind applies,
   * so it passes through unvalidated exactly like Pydantic's
   * left-to-right union would accept both member types.
   *
   * @internal
   */
  static readonly fieldSpecs: EntityFieldSpecs<MeProjectInfoInit> = [
    { name: "name", required: true, kind: "str" },
    { name: "organization_id", required: true, kind: "int" },
    { name: "timezone", kind: "str", nullable: true },
    { name: "has_workspaces", kind: "bool", nullable: true },
    { name: "domain", kind: "str", nullable: true },
    { name: "type", nullable: true },
  ];

  /** Project display name. */
  declare readonly name: string;
  /** Owning organization ID. */
  declare readonly organization_id: number;
  /** Project timezone. */
  declare readonly timezone: string | null;
  /** Whether project uses workspaces. */
  declare readonly has_workspaces: boolean | null;
  /** Mixpanel domain for the project's cluster. */
  declare readonly domain: string | null;
  /** Project type (string or integer code). */
  declare readonly type: string | number | null;

  /**
   * Construct a validated MeProjectInfo (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields.
   */
  constructor(fields: MeProjectInfoInit) {
    super(MeProjectInfo, fields);
  }

  /**
   * Pydantic `model_extra` mirror (see {@link MeOrgInfo.modelExtra}).
   *
   * @returns The extra-field bag.
   */
  get modelExtra(): Readonly<Record<string, unknown>> {
    return this.__extras;
  }

  /**
   * Strict decode from a raw mapping.
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): MeProjectInfo {
    return new MeProjectInfo(prepareInit(MeProjectInfo, raw));
  }
}

/**
 * Constructor input for {@link MeWorkspaceInfo} — absent keys take the
 * Python defaults; `undefined` counts as absent.
 */
export interface MeWorkspaceInfoInit {
  /** Workspace ID. */
  readonly id: number;
  /** Workspace display name. */
  readonly name: string;
  /** Parent project ID. */
  readonly project_id: number;
  /** Whether this is the project's default workspace. */
  readonly is_default?: boolean | null | undefined;
  /** Whether this is a global workspace. */
  readonly is_global?: boolean | null | undefined;
  /** Whether access is restricted. */
  readonly is_restricted?: boolean | null | undefined;
  /** Whether workspace is visible. */
  readonly is_visible?: boolean | null | undefined;
  /** Workspace description. */
  readonly description?: string | null | undefined;
  /** Who created the workspace. */
  readonly creator_name?: string | null | undefined;
}

/**
 * Workspace information within a `/me` response.
 *
 * @remarks
 * Python `model_config`: `extra='allow'`, `frozen=True` (see
 * {@link MeOrgInfo}).
 * @example
 * ```typescript
 * const ws = MeWorkspaceInfo.fromDict({
 *   id: 7,
 *   name: "All Project Data",
 *   project_id: 12345,
 *   is_global: true,
 * });
 * workspaceViewFromMeWorkspace(ws).is_global; // true
 * ```
 * @see mixpanel_headless._internal.me.MeWorkspaceInfo
 */
export class MeWorkspaceInfo extends EntityModel<MeWorkspaceInfoInit> {
  /** The Python model name. */
  static readonly modelName = "MeWorkspaceInfo";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /**
   * Declared fields in Python `model_fields` order.
   *
   * @internal
   */
  static readonly fieldSpecs: EntityFieldSpecs<MeWorkspaceInfoInit> = [
    { name: "id", required: true, kind: "int" },
    { name: "name", required: true, kind: "str" },
    { name: "project_id", required: true, kind: "int" },
    { name: "is_default", kind: "bool", nullable: true },
    { name: "is_global", kind: "bool", nullable: true },
    { name: "is_restricted", kind: "bool", nullable: true },
    { name: "is_visible", kind: "bool", nullable: true },
    { name: "description", kind: "str", nullable: true },
    { name: "creator_name", kind: "str", nullable: true },
  ];

  /** Workspace ID. */
  declare readonly id: number;
  /** Workspace display name. */
  declare readonly name: string;
  /** Parent project ID. */
  declare readonly project_id: number;
  /** Whether this is the project's default workspace. */
  declare readonly is_default: boolean | null;
  /** Whether this is a global workspace. */
  declare readonly is_global: boolean | null;
  /** Whether access is restricted. */
  declare readonly is_restricted: boolean | null;
  /** Whether workspace is visible. */
  declare readonly is_visible: boolean | null;
  /** Workspace description. */
  declare readonly description: string | null;
  /** Who created the workspace. */
  declare readonly creator_name: string | null;

  /**
   * Construct a validated MeWorkspaceInfo (Pydantic-construction
   * mirror).
   *
   * @param fields - Field values keyed by Python attribute name.
   * @throws {@link ResponseValidationError} - On missing/invalid fields.
   */
  constructor(fields: MeWorkspaceInfoInit) {
    super(MeWorkspaceInfo, fields);
  }

  /**
   * Pydantic `model_extra` mirror (see {@link MeOrgInfo.modelExtra}).
   *
   * @returns The extra-field bag.
   */
  get modelExtra(): Readonly<Record<string, unknown>> {
    return this.__extras;
  }

  /**
   * Strict decode from a raw mapping.
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): MeWorkspaceInfo {
    return new MeWorkspaceInfo(prepareInit(MeWorkspaceInfo, raw));
  }
}

/**
 * Constructor input for {@link MeResponse} — every field optional for
 * forward-compatible deserialization (Python `MeResponse`).
 */
export interface MeResponseInit {
  /** Authenticated user's ID. */
  readonly user_id?: number | null | undefined;
  /** User's email. */
  readonly user_email?: string | null | undefined;
  /** User's display name. */
  readonly user_name?: string | null | undefined;
  /**
   * Accessible organizations, keyed by org ID. A `ReadonlyMap` input
   * preserves caller-supplied insertion order exactly (the Python dict
   * mirror); a plain record is accepted for convenience but JS hoists
   * its integer-like keys ascending, so order-sensitive callers must
   * pass a Map.
   */
  readonly organizations?:
    | Readonly<Record<string, MeOrgInfo | Readonly<Record<string, unknown>>>>
    | ReadonlyMap<string, MeOrgInfo | Readonly<Record<string, unknown>>>
    | undefined;
  /** Accessible projects, keyed by project ID (ordering as above). */
  readonly projects?:
    | Readonly<
        Record<string, MeProjectInfo | Readonly<Record<string, unknown>>>
      >
    | ReadonlyMap<string, MeProjectInfo | Readonly<Record<string, unknown>>>
    | undefined;
  /** Accessible workspaces, keyed by workspace ID (ordering as above). */
  readonly workspaces?:
    | Readonly<
        Record<string, MeWorkspaceInfo | Readonly<Record<string, unknown>>>
      >
    | ReadonlyMap<string, MeWorkspaceInfo | Readonly<Record<string, unknown>>>
    | undefined;
  /** Unix timestamp when this response was cached. */
  readonly cached_at?: number | null | undefined;
  /** Which region this cache is for. */
  readonly cached_region?: string | null | undefined;
}

/**
 * Model of the Mixpanel `/me` API response. All fields are optional; the
 * three container maps default to empty, insertion-ordered maps.
 *
 * @remarks
 * Python `model_config`: `extra='allow'`, `frozen=True` (see
 * {@link MeOrgInfo}). Pass `ReadonlyMap`s for the containers when
 * organization order matters — a plain record hoists integer-like keys.
 * @example
 * ```typescript
 * const me = MeResponse.fromDict(toNativeJson(payload));
 * me.projects.get("12345")?.name; // "Web"
 * [...me.organizations.keys()]; // in `/me` source order
 * ```
 * @see mixpanel_headless._internal.me.MeResponse
 */
export class MeResponse extends EntityModel<MeResponseInit> {
  /** The Python model name. */
  static readonly modelName = "MeResponse";

  /** Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /**
   * Declared fields in Python `model_fields` order.
   *
   * @internal
   */
  static readonly fieldSpecs: EntityFieldSpecs<MeResponseInit> = [
    { name: "user_id", kind: "int", nullable: true },
    { name: "user_email", kind: "str", nullable: true },
    { name: "user_name", kind: "str", nullable: true },
    // The three container maps are `ordered-dict` fields: Python's
    // `dict[str, …]` preserves `/me` source order, which drives the
    // result-affecting `defaultAccountName` first-org pick and the
    // `resolveWorkspace` tie-breaks — a plain Record cannot hold
    // out-of-order integer-like keys, a ReadonlyMap can.
    {
      name: "organizations",
      nested: () => MeOrgInfo,
      container: "ordered-dict",
      default: () => new Map<string, MeOrgInfo>(),
    },
    {
      name: "projects",
      nested: () => MeProjectInfo,
      container: "ordered-dict",
      default: () => new Map<string, MeProjectInfo>(),
    },
    {
      name: "workspaces",
      nested: () => MeWorkspaceInfo,
      container: "ordered-dict",
      default: () => new Map<string, MeWorkspaceInfo>(),
    },
    { name: "cached_at", kind: "float", nullable: true },
    { name: "cached_region", kind: "str", nullable: true },
  ];

  /** Authenticated user's ID. */
  declare readonly user_id: number | null;
  /** User's email. */
  declare readonly user_email: string | null;
  /** User's display name. */
  declare readonly user_name: string | null;
  /**
   * Accessible organizations, keyed by org ID — insertion-ordered
   * exactly like the Python `dict`.
   */
  declare readonly organizations: ReadonlyMap<string, MeOrgInfo>;
  /** Accessible projects, keyed by project ID (insertion-ordered). */
  declare readonly projects: ReadonlyMap<string, MeProjectInfo>;
  /** Accessible workspaces, keyed by workspace ID (insertion-ordered). */
  declare readonly workspaces: ReadonlyMap<string, MeWorkspaceInfo>;
  /** Unix timestamp when this response was cached. */
  declare readonly cached_at: number | null;
  /** Which region this cache is for. */
  declare readonly cached_region: string | null;

  /**
   * Construct a validated MeResponse (Pydantic-construction mirror).
   *
   * @param fields - Field values keyed by Python attribute name
   *   (defaults to the all-optional empty response).
   * @throws {@link ResponseValidationError} - On invalid fields.
   */
  constructor(fields: MeResponseInit = {}) {
    super(MeResponse, fields);
  }

  /**
   * Pydantic `model_extra` mirror (see {@link MeOrgInfo.modelExtra}).
   *
   * @returns The extra-field bag.
   */
  get modelExtra(): Readonly<Record<string, unknown>> {
    return this.__extras;
  }

  /**
   * Strict decode from a raw mapping.
   *
   * @param raw - The raw payload.
   * @returns The reconstructed instance.
   * @throws {@link ResponseValidationError} - On shape violations.
   */
  static fromDict(raw: unknown): MeResponse {
    return new MeResponse(prepareInit(MeResponse, raw));
  }
}

/**
 * The workspace fields used to pick a project's default data view.
 *
 * @remarks
 * A normalized view over the differently-shaped sources a workspace can
 * be resolved from (the cached `/me` response, `/workspaces/public`, and
 * the projects metadata index) so they all share one selection rule
 * (`selectWorkspaceId`).
 * @see mixpanel_headless._internal.me.WorkspaceView
 */
export interface WorkspaceView {
  /** Workspace ID. */
  readonly id: number;
  /** Workspace display name. */
  readonly name: string | null;
  /** Whether this is a global ("see everything") view. */
  readonly is_global: boolean | null;
  /** Whether this is the project's default view. */
  readonly is_default: boolean | null;
  /** Whether the view is visible. */
  readonly is_visible: boolean | null;
}

/**
 * Build a view from a cached `/me` workspace entry.
 *
 * @param ws - A workspace from the per-account `/me` response.
 * @returns The normalized {@link WorkspaceView}.
 * @example
 * ```typescript
 * const views = [...me.workspaces.values()].map(workspaceViewFromMeWorkspace);
 * selectWorkspaceId(views); // 7
 * ```
 * @see mixpanel_headless._internal.me.WorkspaceView.from_me_workspace
 */
export function workspaceViewFromMeWorkspace(
  ws: MeWorkspaceInfo,
): WorkspaceView {
  return {
    id: ws.id,
    name: ws.name,
    is_global: ws.is_global,
    is_default: ws.is_default,
    is_visible: ws.is_visible,
  };
}

/**
 * Build a view from a `/workspaces/public` workspace.
 *
 * @param ws - A workspace returned by
 *   `GET /projects/{pid}/workspaces/public`.
 * @returns The normalized {@link WorkspaceView}.
 * @example
 * ```typescript
 * const workspaces = await client.listWorkspaces();
 * selectWorkspaceId(workspaces.map(workspaceViewFromPublic));
 * ```
 * @see mixpanel_headless._internal.me.WorkspaceView.from_public
 */
export function workspaceViewFromPublic(ws: PublicWorkspace): WorkspaceView {
  return {
    id: ws.id,
    name: ws.name,
    is_global: ws.is_global,
    is_default: ws.is_default,
    is_visible: ws.is_visible,
  };
}

/**
 * Narrow a loosely-typed metadata value to the tri-state flag domain.
 *
 * @remarks
 * Python stores the raw value and later tests it with `is True` /
 * `is False` only, so any non-bool value behaves exactly like `None` in
 * the selection ladder — this narrowing is selection-equivalent.
 * @param value - A raw metadata-entry member.
 * @returns `true` / `false` for booleans, else `null`.
 */
function triStateFlag(value: unknown): boolean | null {
  if (value === true) {
    return true;
  }
  if (value === false) {
    return false;
  }
  return null;
}

/**
 * Extract a usable integer workspace id from a raw metadata value —
 * the TS twin of Python's `isinstance(wid, (int, str))` + `int(wid)`.
 *
 * @remarks
 * Python subtleties preserved: `bool` is an `int` subclass
 * (`True → 1`); string ids parse with the CPython `int(str)` grammar
 * (`pythonInt`); floats (native or float-token) are neither `int` nor
 * `str` and yield no id. Wire bodies arrive as lossless
 * {@link JsonNumber} tokens — an integer token is Python's `int`, a
 * fraction/exponent token is Python's `float`. Divergence: integer
 * tokens beyond 2^53−1 read as unusable (`null`); Python returns the
 * exact big int. No real workspace id reaches that range.
 * @param wid - The raw `id` member.
 * @returns The integer id, or `null` when unusable.
 * @throws Any non-`MixpanelHeadlessError` raised by `pythonInt`, unchanged
 *   (a programming error, never an id value).
 */
function metadataWorkspaceId(wid: unknown): number | null {
  if (typeof wid === "boolean") {
    return wid ? 1 : 0;
  }
  if (wid instanceof JsonNumber) {
    if (!wid.isIntegerToken() || wid.isUnsafeInteger()) {
      return null;
    }
    return wid.toNumber();
  }
  if (typeof wid === "number") {
    return Number.isInteger(wid) ? wid : null;
  }
  if (typeof wid === "string") {
    try {
      return pythonInt(wid);
    } catch (error) {
      // Python catches (TypeError, ValueError) around `int(wid)`; the
      // coded pythonInt failures are the ValueError analogs.
      if (error instanceof MixpanelHeadlessError) {
        return null;
      }
      throw error;
    }
  }
  return null;
}

/**
 * Build a view from a projects-metadata-index workspace entry.
 *
 * @remarks
 * The metadata index is a raw, loosely-typed payload, so this is the
 * one construction path that defends against shape: a non-mapping
 * entry, or an id that is neither an int nor an int-coercible string,
 * yields `null` (the caller skips it).
 * @param raw - A single workspace value from a metadata-index
 *   `workspaces` block (expected to be a mapping, but not trusted).
 * @returns The normalized {@link WorkspaceView}, or `null` when `raw`
 *   is not a mapping or carries no usable integer id.
 * @example
 * ```typescript
 * workspaceViewFromMetadataEntry({ id: "7", name: "Console", is_default: true });
 * // { id: 7, name: "Console", is_global: null, is_default: true, is_visible: null }
 * workspaceViewFromMetadataEntry("not a mapping"); // null
 * ```
 * @see mixpanel_headless._internal.me.WorkspaceView.from_metadata_entry
 */
export function workspaceViewFromMetadataEntry(
  raw: unknown,
): WorkspaceView | null {
  // Python `isinstance(raw, dict)` — prototype-based dict discrimination;
  // parsed wire bodies are plain records.
  if (!isPythonDict(raw)) {
    return null;
  }
  const entry = raw as Readonly<Record<string, unknown>>;
  const id = metadataWorkspaceId(
    Object.hasOwn(entry, "id") ? entry["id"] : undefined,
  );
  if (id === null) {
    return null;
  }
  const name = entry["name"];
  return {
    id,
    // Non-string names never equal the "All Project Data" constant in
    // Python either — the narrowing is selection-equivalent.
    name: typeof name === "string" ? name : null,
    is_global: triStateFlag(entry["is_global"]),
    is_default: triStateFlag(entry["is_default"]),
    is_visible: triStateFlag(entry["is_visible"]),
  };
}

/**
 * Pick the best workspace id for auto-resolution from a project's views.
 *
 * @remarks
 * Preference order: the global "see everything" view wins, then the
 * conventionally-named "All Project Data" view, then the project
 * default, then the first non-hidden view, then the first. Shared by
 * every resolution path so a project resolves to the same view
 * regardless of which source answered.
 * @param views - Candidate views, already filtered to one project.
 * @returns The selected workspace id, or `null` when `views` is empty.
 * @example
 * ```typescript
 * selectWorkspaceId([
 *   { id: 1, name: "Console", is_global: null, is_default: true, is_visible: null },
 *   { id: 2, name: "All Project Data", is_global: true, is_default: null, is_visible: null },
 * ]);
 * // 2 — the global view beats the default
 * ```
 * @see mixpanel_headless._internal.me.select_workspace_id
 */
export function selectWorkspaceId(
  views: readonly WorkspaceView[],
): number | null {
  if (views.length === 0) {
    return null;
  }
  for (const v of views) {
    if (v.is_global === true) {
      return v.id;
    }
  }
  for (const v of views) {
    if (v.name === GLOBAL_WORKSPACE_NAME) {
      return v.id;
    }
  }
  for (const v of views) {
    if (v.is_default === true) {
      return v.id;
    }
  }
  for (const v of views) {
    // `is not False` is deliberate: an unknown (`null`)
    // visibility counts as visible. Do not "simplify" to `=== true` —
    // that would skip views the source simply didn't flag and fall
    // through to `views[0]`.
    if (v.is_visible !== false) {
      return v.id;
    }
  }
  return (views[0] as WorkspaceView).id;
}

/**
 * Resolve a project's best workspace id from a warm, in-process cache.
 *
 * @remarks
 * The contract the client relies on: the input is a project id as a
 * numeric string; the return is a workspace id, or `null` meaning
 * "can't answer right now" (for example, a cold cache) — not an error.
 * Implementations must be cheap and side-effect-free (no network I/O);
 * a returned `null` is what makes the client fall back to
 * `/workspaces/public`. The TS signature admits a promise because
 * cache-store reads may be asynchronous.
 * @see mixpanel_headless._internal.me.WorkspaceResolver
 */
export type WorkspaceResolver = (
  projectId: string,
) => number | null | Promise<number | null>;
