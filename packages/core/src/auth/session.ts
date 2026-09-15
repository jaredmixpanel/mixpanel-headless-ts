/**
 * Session, Project, WorkspaceRef and ActiveSession value types with their
 * parse factories. A {@link Session} is the in-memory "who am I and what
 * am I working on" tuple — an {@link Account} plus a {@link Project} and
 * an optional {@link WorkspaceRef} — held as compile-time `readonly`
 * interfaces (no runtime `Object.freeze`); axes are swapped with
 * {@link sessionReplace}. `WorkspaceRef` is the data type; the public
 * `Workspace` facade class is the operational surface, as in Python.
 * Extra-key handling mirrors each Pydantic `model_config`: `Project` /
 * `WorkspaceRef` / `Session` ignore unknown keys, `ActiveSession` rejects
 * them.
 *
 * @see mixpanel_headless._internal.auth.session
 */

import { coerceInt, coerceStr } from "../coerce.js";
import { ParamTypeError } from "../errors.js";
import {
  type Account,
  accountAuthHeader,
  type AccountAuthHeaderOptions,
  type AccountName,
  forbidExtraKeys,
  parseAccount,
  type ProjectId,
  requireRecord,
  type WorkspaceId,
} from "./account.js";
import { type ParseAccountOptions, parseFail } from "./shared.js";

/**
 * Mixpanel project reference.
 *
 * Project IDs come from the Mixpanel API as numeric strings; `name`,
 * `organization_id`, and `timezone` are populated when the resolver has
 * access to a `/me` response.
 *
 * @see mixpanel_headless._internal.auth.session.Project
 */
export interface Project {
  /** Numeric project ID (Mixpanel's wire format is a digit string). */
  readonly id: ProjectId;
  /** Display name from `/me`, when known. */
  readonly name?: string | null | undefined;
  /** Owning organization ID from `/me`, when known. */
  readonly organization_id?: number | null | undefined;
  /** Project timezone (e.g. `"US/Pacific"`) from `/me`, when known. */
  readonly timezone?: string | null | undefined;
}

/**
 * Mixpanel workspace reference (the cohort/dashboard scoping unit).
 *
 * The optional `project_id` lets {@link parseSession} cross-check that the
 * workspace actually belongs to the bound project; left `null`/absent when
 * the workspace was constructed from a bare ID (e.g. `MP_WORKSPACE_ID=N`),
 * in which case the check degrades to "trust the caller".
 *
 * @see mixpanel_headless._internal.auth.session.WorkspaceRef
 */
export interface WorkspaceRef {
  /** Positive integer workspace ID assigned by Mixpanel. */
  readonly id: WorkspaceId;
  /** Display name from `/me` or `/projects/{pid}/workspaces/public`. */
  readonly name?: string | null | undefined;
  /** Whether this is the project's default workspace, when known. */
  readonly is_default?: boolean | null | undefined;
  /** Owning project ID, when known (populated by `/me` enumeration). */
  readonly project_id?: ProjectId | null | undefined;
}

/**
 * Immutable in-memory tuple of (Account, Project, optional WorkspaceRef).
 *
 * `workspace === null` (or absent) lazy-resolves on the first
 * workspace-scoped API call. `headers` is required — Python declares
 * `headers: Mapping[str, str] = Field(default_factory=dict)`, never
 * `None`; {@link parseSession} fills an empty map when the key is absent.
 *
 * @see mixpanel_headless._internal.auth.session.Session
 */
export interface Session {
  /** Resolved account (one of the three discriminated variants). */
  readonly account: Account;
  /** Resolved Mixpanel project. */
  readonly project: Project;
  /** Resolved workspace; `null`/absent triggers lazy resolution. */
  readonly workspace?: WorkspaceRef | null | undefined;
  /**
   * Custom HTTP headers attached at resolution time (from
   * `[settings].custom_header` and/or `bridge.headers`). A `ReadonlyMap`
   * so membership is `.has()`, never a prototype-unsafe object lookup.
   * Compile-time read-only only (no freeze).
   */
  readonly headers: ReadonlyMap<string, string>;
}

/**
 * Persisted shape of the `[active]` block in `~/.mp/config.toml`.
 *
 * Only `account` and `workspace` live in `[active]` — there is no
 * `project` field: project lives on the account itself as
 * `Account.default_project`, so switching accounts implicitly switches
 * projects. {@link parseActiveSession} rejects unknown keys (including
 * `project`) per `extra='forbid'`.
 *
 * @see mixpanel_headless._internal.auth.session.ActiveSession
 */
export interface ActiveSession {
  /** Local config name of the active account. */
  readonly account?: AccountName | null | undefined;
  /** Active workspace ID or `null` for lazy resolution. */
  readonly workspace?: WorkspaceId | null | undefined;
}

/**
 * Map a parse boundary onto the shared coerce-option shape.
 *
 * @param options - Parse options carrying the boundary kind.
 * @param field - Field name for the error `details` bag.
 * @returns Options for `coerceInt`/`coerceStr`.
 */
function coerceOptions(
  options: ParseAccountOptions,
  field: string,
): { kind: "param" | "response"; field: string } {
  return { kind: options.boundary ?? "response", field };
}

/**
 * Read an optional string-or-null field, preserving absent-vs-null.
 *
 * @param payload - The raw payload record.
 * @param field - Field name.
 * @param options - Parse options carrying the boundary kind.
 * @returns The string, `null`, or `undefined` when absent.
 * @throws {@link ParamValidationError} - When present
 *   but not a string.
 * @throws {@link ResponseValidationError} - The same condition at the
 *   default `'response'` boundary.
 */
function readOptionalString(
  payload: Readonly<Record<string, unknown>>,
  field: string,
  options: ParseAccountOptions,
): string | null | undefined {
  if (!Object.hasOwn(payload, field)) {
    return undefined;
  }
  const value = payload[field];
  if (value === null) {
    return null;
  }
  return coerceStr(value, coerceOptions(options, field));
}

/**
 * `Project.id` constraint: Python `pattern=r"^\d+$"`, which pydantic
 * compiles with the Rust `regex` crate, whose `\d` is Unicode-aware —
 * `\p{Nd}` is the faithful JS spelling.
 */
const PROJECT_ID_PATTERN = /^\p{Nd}+$/u;

/**
 * Construct a {@link Project} from a raw payload (Pydantic parity:
 * `frozen=True`, extras ignored, `id` digits-only + non-empty).
 *
 * @param raw - The raw payload.
 * @param options - Error-boundary selection (defaults to `'response'`).
 * @returns The parsed project; unknown keys are dropped.
 * @throws {@link ParamValidationError} - On a missing /
 *   malformed `id` or wrongly typed optional field.
 * @throws {@link ResponseValidationError} - The same condition at the
 *   default `'response'` boundary.
 * @example
 * ```typescript
 * parseProject({ id: "12345", name: "Demo", extra: true });
 * // { id: "12345", name: "Demo" } — unknown keys dropped
 * ```
 */
export function parseProject(
  raw: unknown,
  options: ParseAccountOptions = {},
): Project {
  const payload = requireRecord(raw, "Project", options);
  const id = payload["id"];
  if (typeof id !== "string" || !PROJECT_ID_PATTERN.test(id)) {
    parseFail("Project.id must be a digits-only string", options, {
      field: "id",
    });
  }
  const name = readOptionalString(payload, "name", options);
  const timezone = readOptionalString(payload, "timezone", options);
  let organizationId: number | null | undefined;
  if (Object.hasOwn(payload, "organization_id")) {
    const value = payload["organization_id"];
    organizationId =
      value === null
        ? null
        : coerceInt(value, coerceOptions(options, "organization_id"));
  }
  return {
    id,
    ...(name === undefined ? {} : { name }),
    ...(organizationId === undefined
      ? {}
      : { organization_id: organizationId }),
    ...(timezone === undefined ? {} : { timezone }),
  };
}

/**
 * Construct a {@link WorkspaceRef} from a raw payload (Pydantic parity:
 * `frozen=True`, extras ignored, `id` a positive integer via lax
 * coercion — `Field(gt=0)`).
 *
 * @param raw - The raw payload.
 * @param options - Error-boundary selection (defaults to `'response'`).
 * @returns The parsed workspace reference; unknown keys are dropped.
 * @throws {@link ParamValidationError} - On a missing /
 *   non-positive `id` or wrongly typed optional field.
 * @throws {@link ResponseValidationError} - The same condition at the
 *   default `'response'` boundary.
 * @example
 * ```typescript
 * parseWorkspaceRef({ id: 42, is_default: true });
 * // { id: 42, is_default: true }
 * ```
 */
export function parseWorkspaceRef(
  raw: unknown,
  options: ParseAccountOptions = {},
): WorkspaceRef {
  const payload = requireRecord(raw, "WorkspaceRef", options);
  const id = coerceInt(payload["id"], coerceOptions(options, "id"));
  if (id <= 0) {
    parseFail("WorkspaceRef.id must be a positive integer", options, {
      field: "id",
    });
  }
  const name = readOptionalString(payload, "name", options);
  const projectId = readOptionalString(payload, "project_id", options);
  let isDefault: boolean | null | undefined;
  if (Object.hasOwn(payload, "is_default")) {
    const value = payload["is_default"];
    if (value !== null && typeof value !== "boolean") {
      parseFail("WorkspaceRef.is_default must be a boolean", options, {
        field: "is_default",
      });
    }
    isDefault = value;
  }
  return {
    id,
    ...(name === undefined ? {} : { name }),
    ...(isDefault === undefined ? {} : { is_default: isDefault }),
    ...(projectId === undefined ? {} : { project_id: projectId }),
  };
}

/**
 * Enforce the Python session-level model validator: a workspace carrying
 * a `project_id` must belong to the bound project.
 *
 * @param session - The candidate (account, project, workspace) tuple.
 * @param options - Error-boundary selection.
 * @throws {@link ParamValidationError} - When
 *   `workspace.project_id` is set and differs from `project.id`.
 * @throws {@link ResponseValidationError} - The same condition at the
 *   default `'response'` boundary.
 */
function checkWorkspaceProjectCoupling(
  session: Pick<Session, "project" | "workspace">,
  options: ParseAccountOptions,
): void {
  const workspace = session.workspace ?? null;
  const workspaceProjectId = workspace?.project_id ?? null;
  if (
    workspace !== null &&
    workspaceProjectId !== null &&
    workspaceProjectId !== session.project.id
  ) {
    parseFail(
      `Workspace ${String(workspace.id)} belongs to project ` +
        `${JSON.stringify(workspaceProjectId)}, not ` +
        `${JSON.stringify(session.project.id)}. Re-resolve the workspace ` +
        "under the correct project.",
      options,
      {
        workspace_id: workspace.id,
        workspace_project_id: workspaceProjectId,
        project_id: session.project.id,
      },
    );
  }
}

/**
 * Construct a {@link Session} from a raw payload (Pydantic parity:
 * `frozen=True`, extras ignored; nested payloads parse through
 * {@link parseAccount} / {@link parseProject} / {@link parseWorkspaceRef};
 * the workspace-project coupling validator runs; an absent `headers` key
 * fills an empty map (`default_factory=dict` fires on absent only —
 * explicit `null` is a validation error).
 *
 * Already-parsed nested values (an {@link Account} object, a
 * `ReadonlyMap` for headers) pass through unchanged so callers can
 * assemble sessions from parts.
 *
 * @param raw - The raw payload.
 * @param options - Error-boundary selection (defaults to `'response'`).
 * @returns The parsed session.
 * @throws {@link ParamValidationError} - On any nested
 *   parse failure, a `null` `headers`, or a workspace-project mismatch.
 * @throws {@link ResponseValidationError} - The same condition at the
 *   default `'response'` boundary.
 * @example
 * ```typescript
 * const session = parseSession({
 *   account: { type: "oauth_browser", name: "team", region: "us" },
 *   project: { id: "12345" },
 * });
 * // session.workspace === undefined; session.headers.size === 0
 * ```
 */
export function parseSession(
  raw: unknown,
  options: ParseAccountOptions = {},
): Session {
  const payload = requireRecord(raw, "Session", options);
  const account = parseAccount(payload["account"], options);
  const project = parseProject(payload["project"], options);
  let workspace: WorkspaceRef | null | undefined;
  if (Object.hasOwn(payload, "workspace")) {
    const value = payload["workspace"];
    workspace = value === null ? null : parseWorkspaceRef(value, options);
  }
  let headers: ReadonlyMap<string, string>;
  if (Object.hasOwn(payload, "headers")) {
    const value = payload["headers"];
    if (value instanceof Map) {
      headers = value as ReadonlyMap<string, string>;
    } else {
      const record = requireRecord(value, "Session.headers", options);
      const entries = new Map<string, string>();
      for (const [key, item] of Object.entries(record)) {
        entries.set(key, coerceStr(item, coerceOptions(options, "headers")));
      }
      headers = entries;
    }
  } else {
    headers = new Map();
  }
  const session: Session = {
    account,
    project,
    ...(workspace === undefined ? {} : { workspace }),
    headers,
  };
  checkWorkspaceProjectCoupling(session, options);
  return session;
}

/**
 * Return the `Authorization` header for a session.
 *
 * @param session - The session whose account authenticates the call.
 * @param options - Carries the `TokenResolver` (required for OAuth
 *   accounts, ignored for `service_account` — exactly Python's rule).
 * @returns The header value (`Basic ...` or `Bearer ...`).
 * @throws {@link ParamTypeError} - When the account is an OAuth variant and no
 *   resolver was provided (Python raises `TypeError`).
 * @example
 * ```typescript
 * const header = await sessionAuthHeader(session, { tokenResolver });
 * // "Bearer …" for OAuth accounts, "Basic …" for service accounts
 * ```
 * @see mixpanel_headless._internal.auth.session.Session.auth_header
 */
export async function sessionAuthHeader(
  session: Session,
  options: AccountAuthHeaderOptions = {},
): Promise<string> {
  if (
    session.account.type !== "service_account" &&
    (options.tokenResolver === undefined || options.tokenResolver === null)
  ) {
    throw new ParamTypeError(
      "TokenResolver is required to compute auth_header for OAuth accounts",
    );
  }
  return accountAuthHeader(session.account, options);
}

/** Axis-replacement bag for {@link sessionReplace}. */
export interface SessionReplaceUpdate {
  /** Replacement account; omitted (or `null`) preserves the current one. */
  readonly account?: Account | null | undefined;
  /** Replacement project; omitted (or `null`) preserves the current one. */
  readonly project?: Project | null | undefined;
  /**
   * Replacement workspace. Passing `null` clears the workspace
   * (re-triggering lazy resolution); omitting the key preserves the
   * current value — Python's sentinel semantics, expressed via key
   * presence (`Object.hasOwn`).
   */
  readonly workspace?: WorkspaceRef | null | undefined;
  /**
   * Replacement headers map. An empty map clears all custom headers;
   * omitting the key preserves the current value.
   */
  readonly headers?: ReadonlyMap<string, string> | undefined;
}

/**
 * Return a new {@link Session} with the supplied axes swapped in.
 *
 * Python implements this via `model_copy(update=...)`, which does not
 * re-run model validators — so, exactly like Python, this function
 * performs no re-validation (a replace that introduces a mismatched
 * `workspace.project_id` does not raise; the API surfaces the mismatch
 * at request time).
 *
 * @param session - The source session (never mutated).
 * @param update - The axes to replace (sentinel semantics via key
 *   presence for `workspace`/`headers`, `!= null` for
 *   `account`/`project` — mirroring Python's `is not None` checks).
 * @returns A new session instance.
 * @example
 * ```typescript
 * const next = sessionReplace(session, { workspace: null });
 * // next.workspace === null (cleared); next.account === session.account
 * ```
 * @see mixpanel_headless._internal.auth.session.Session.replace
 */
export function sessionReplace(
  session: Session,
  update: SessionReplaceUpdate = {},
): Session {
  const account = update.account ?? session.account;
  const project = update.project ?? session.project;
  const workspace = Object.hasOwn(update, "workspace")
    ? (update.workspace ?? null)
    : session.workspace;
  const headers = Object.hasOwn(update, "headers")
    ? (update.headers ?? new Map<string, string>())
    : session.headers;
  return {
    account,
    project,
    ...(workspace === undefined ? {} : { workspace }),
    headers,
  };
}

/** Declared `ActiveSession` field names (`extra='forbid'`). */
const ACTIVE_SESSION_FIELDS: ReadonlySet<string> = new Set([
  "account",
  "workspace",
]);

/**
 * Construct an {@link ActiveSession} from a raw payload (the `[active]`
 * config block).
 *
 * Pydantic parity: `extra='forbid'` — unknown keys are rejected,
 * explicitly including `project` (project lives on
 * `Account.default_project`; switching accounts implicitly switches
 * projects, so `[active]` has no project axis).
 *
 * @param raw - The raw payload.
 * @param options - Error-boundary selection (defaults to `'response'`).
 * @returns The parsed active-session block.
 * @throws {@link ParamValidationError} - On unknown
 *   keys (including `project`) or wrongly typed fields.
 * @throws {@link ResponseValidationError} - The same condition at the
 *   default `'response'` boundary.
 * @example
 * ```typescript
 * parseActiveSession({ account: "team", workspace: 42 });
 * // { account: "team", workspace: 42 }
 * parseActiveSession({ project: "1" });
 * // throws ResponseValidationError — `[active]` has no project field
 * ```
 */
export function parseActiveSession(
  raw: unknown,
  options: ParseAccountOptions = {},
): ActiveSession {
  const payload = requireRecord(raw, "ActiveSession", options);
  forbidExtraKeys(payload, ACTIVE_SESSION_FIELDS, "ActiveSession", options);
  const account = readOptionalString(payload, "account", options);
  let workspace: WorkspaceId | null | undefined;
  if (Object.hasOwn(payload, "workspace")) {
    const value = payload["workspace"];
    workspace =
      value === null
        ? null
        : coerceInt(value, coerceOptions(options, "workspace"));
  }
  return {
    ...(account === undefined ? {} : { account }),
    ...(workspace === undefined ? {} : { workspace }),
  };
}
