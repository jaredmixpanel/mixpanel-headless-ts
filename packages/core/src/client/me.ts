/**
 * Mixpanel `/me` response models and workspace-selection logic — TS port
 * of the PURE half of `mixpanel_headless/_internal/me.py` (`:40-411`):
 * the response models, {@link WorkspaceView}, {@link selectWorkspaceId},
 * and the {@link WorkspaceResolver} interface (Phase-3 packet B4-C1;
 * playbook Discrepancy #5 splits the module — the on-disk `MeCache` and
 * `MeService` halves are B8-N2 and MUST NOT be ported or stubbed here
 * beyond the resolver interface the client consumes).
 *
 * The models reuse the Phase-2 {@link EntityModel} machinery (same
 * Pydantic-construction mirror the `types.py` entities use): lax scalar
 * coercion, `extra='allow'` spillover, `fromDict` alias handling, and
 * `toJSON` field walks.
 */

import { pythonInt } from "../compat/index.js";
import { MixpanelHeadlessError } from "../errors.js";
import { isPythonDict } from "../query/validation-shared.js";
import type { PublicWorkspace } from "../types/entities/common.js";
import {
  type EntityFieldSpec,
  EntityModel,
  prepareInit,
} from "../types/entities/model-base.js";
import { JsonNumber } from "./json-value.js";

/**
 * The global "see everything" data view Mixpanel provisions for every
 * workspace-enabled project (`me.py:230`). Preferred during
 * auto-resolution because it is the only view guaranteed to see all of
 * the project's data.
 */
const GLOBAL_WORKSPACE_NAME = "All Project Data";

/**
 * Constructor input for {@link MeOrgInfo} — absent keys take the Python
 * defaults; `undefined` counts as absent (R4.10).
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
 * Organization information within a `/me` response (Python `MeOrgInfo`,
 * `me.py:40-72`; model_config: `extra='allow'`, `frozen=True`).
 */
export class MeOrgInfo extends EntityModel {
  /** @internal The Python model name. */
  static readonly modelName = "MeOrgInfo";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
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
   * @throws ResponseValidationError - On missing/invalid fields.
   */
  constructor(fields: MeOrgInfoInit) {
    super(MeOrgInfo, fields as unknown as Readonly<Record<string, unknown>>);
  }

  /**
   * Pydantic `model_extra` mirror: unknown input keys preserved under
   * `extra='allow'` (forward compatibility, `me.py` module doc).
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
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): MeOrgInfo {
    return new MeOrgInfo(
      prepareInit(MeOrgInfo, raw) as unknown as MeOrgInfoInit,
    );
  }
}

/**
 * Constructor input for {@link MeProjectInfo} — absent keys take the
 * Python defaults; `undefined` counts as absent (R4.10).
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
 * Project information within a `/me` response (Python `MeProjectInfo`,
 * `me.py:73-116`; model_config: `extra='allow'`, `frozen=True`).
 */
export class MeProjectInfo extends EntityModel {
  /** @internal The Python model name. */
  static readonly modelName = "MeProjectInfo";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /**
   * @internal Declared fields in Python `model_fields` order. `type` is
   * a `str | int | None` union — no single lax-coercion kind applies,
   * so it passes through unvalidated exactly like Pydantic's
   * left-to-right union would accept both member types.
   */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
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
   * @throws ResponseValidationError - On missing/invalid fields.
   */
  constructor(fields: MeProjectInfoInit) {
    super(
      MeProjectInfo,
      fields as unknown as Readonly<Record<string, unknown>>,
    );
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
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): MeProjectInfo {
    return new MeProjectInfo(
      prepareInit(MeProjectInfo, raw) as unknown as MeProjectInfoInit,
    );
  }
}

/**
 * Constructor input for {@link MeWorkspaceInfo} — absent keys take the
 * Python defaults; `undefined` counts as absent (R4.10).
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
 * Workspace information within a `/me` response (Python
 * `MeWorkspaceInfo`, `me.py:117-170`; `extra='allow'`, `frozen=True`).
 */
export class MeWorkspaceInfo extends EntityModel {
  /** @internal The Python model name. */
  static readonly modelName = "MeWorkspaceInfo";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
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
   * @throws ResponseValidationError - On missing/invalid fields.
   */
  constructor(fields: MeWorkspaceInfoInit) {
    super(
      MeWorkspaceInfo,
      fields as unknown as Readonly<Record<string, unknown>>,
    );
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
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): MeWorkspaceInfo {
    return new MeWorkspaceInfo(
      prepareInit(MeWorkspaceInfo, raw) as unknown as MeWorkspaceInfoInit,
    );
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
   * mirror — user ratification `user-ratifications.md:14-22`); a plain
   * record is accepted for convenience but JS hoists its integer-like
   * keys ascending, so order-sensitive callers MUST pass a Map.
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
 * Model of the Mixpanel `/me` API response (Python `MeResponse`,
 * `me.py:171-233`; `extra='allow'`, `frozen=True`). All fields optional;
 * the three container maps default to `{}`.
 */
export class MeResponse extends EntityModel {
  /** @internal The Python model name. */
  static readonly modelName = "MeResponse";

  /** @internal Pydantic `model_config.extra` mirror. */
  static readonly extraPolicy = "allow" as const;

  /** @internal Declared fields in Python `model_fields` order. */
  static readonly fieldSpecs: readonly EntityFieldSpec[] = [
    { name: "user_id", kind: "int", nullable: true },
    { name: "user_email", kind: "str", nullable: true },
    { name: "user_name", kind: "str", nullable: true },
    // The three container maps are `ordered-dict` fields (B8-MAPFIX,
    // user ratification `user-ratifications.md:14-22`): Python's
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
   * exactly like the Python `dict` (R4.8 ReadonlyMap; user
   * ratification `user-ratifications.md:14-22`).
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
   * @throws ResponseValidationError - On invalid fields.
   */
  constructor(fields: MeResponseInit = {}) {
    super(MeResponse, fields as unknown as Readonly<Record<string, unknown>>);
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
   * @throws ResponseValidationError - On shape violations.
   */
  static fromDict(raw: unknown): MeResponse {
    return new MeResponse(
      prepareInit(MeResponse, raw) as unknown as MeResponseInit,
    );
  }
}

/**
 * The workspace fields used to pick a project's default data view —
 * TS port of the frozen dataclass `WorkspaceView` (`me.py:233-337`).
 *
 * A normalized view over the differently-shaped sources a workspace can
 * be resolved from (the cached `/me` response, `/workspaces/public`, and
 * the projects metadata index) so they all share one selection rule
 * ({@link selectWorkspaceId}).
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
 * Build a view from a cached `/me` workspace entry (Python
 * `WorkspaceView.from_me_workspace`, `me.py:265-281`).
 *
 * @param ws - A workspace from the per-account `/me` response.
 * @returns The normalized {@link WorkspaceView}.
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
 * Build a view from a `/workspaces/public` workspace (Python
 * `WorkspaceView.from_public`, `me.py:283-300`).
 *
 * @param ws - A workspace returned by
 *   `GET /projects/{pid}/workspaces/public`.
 * @returns The normalized {@link WorkspaceView}.
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
 * Python stores the raw value and later tests it with `is True` /
 * `is False` only, so any non-bool value behaves exactly like `None` in
 * the selection ladder — this narrowing is selection-equivalent.
 *
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
 * the TS twin of Python's `isinstance(wid, (int, str))` + `int(wid)`
 * (`me.py:323-329`).
 *
 * Python subtleties preserved: `bool` IS an `int` subclass
 * (`True → 1`); string ids parse with the CPython `int(str)` grammar
 * (`pythonInt`, R11.7); floats (native or float-token) are neither
 * `int` nor `str` and yield no id. Wire bodies arrive as lossless
 * {@link JsonNumber} tokens — an integer token is Python's `int`, a
 * fraction/exponent token is Python's `float`. Integer tokens beyond
 * 2^53−1 read as unusable under the R4.5 numbers policy (Python would
 * return the exact big int; no real workspace id reaches that range).
 *
 * @param wid - The raw `id` member.
 * @returns The integer id, or `null` when unusable.
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
 * Build a view from a projects-metadata-index workspace entry (Python
 * `WorkspaceView.from_metadata_entry`, `me.py:302-336`).
 *
 * The metadata index is a raw, loosely-typed payload, so this is the
 * one construction path that defends against shape: a non-mapping
 * entry, or an id that is neither an int nor an int-coercible string,
 * yields `null` (the caller skips it).
 *
 * @param raw - A single workspace value from a metadata-index
 *   `workspaces` block (expected to be a mapping, but not trusted).
 * @returns The normalized {@link WorkspaceView}, or `null` when `raw`
 *   is not a mapping or carries no usable integer id.
 */
export function workspaceViewFromMetadataEntry(
  raw: unknown,
): WorkspaceView | null {
  // Python `isinstance(raw, dict)` — prototype-based dict discrimination
  // (watchlist #13); parsed wire bodies are plain records.
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
 * Pick the best workspace id for auto-resolution from a project's views
 * — TS port of `select_workspace_id` (`me.py:339-382`).
 *
 * Preference order: the global "see everything" view wins, then the
 * conventionally-named "All Project Data" view, then the project
 * default, then the first non-hidden view, then the first. Shared by
 * every resolution path so a project resolves to the same view
 * regardless of which source answered.
 *
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
    // `is not False` is deliberate (me.py:377-380): an unknown (`null`)
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
 * Resolve a project's best workspace id from a warm, in-process cache —
 * TS port of the `WorkspaceResolver` Protocol (`me.py:385-411`; R6.5).
 *
 * The contract the client relies on: the input is a project id as a
 * numeric string; the return is a workspace id, or `null` meaning
 * "can't answer right now" (for example, a cold cache) — NOT an error.
 * Implementations must be cheap and side-effect-free (no network I/O);
 * a returned `null` is what makes the client fall back to
 * `/workspaces/public`. The TS signature admits a promise because B8's
 * MeCache reads may be asynchronous.
 */
export type WorkspaceResolver = (
  projectId: string,
) => number | null | Promise<number | null>;
