/**
 * Session, Project, WorkspaceRef, and ActiveSession value types — TS port
 * of `mixpanel_headless/_internal/auth/session.py` (phase2-design C4).
 *
 * A {@link Session} is the in-memory "who am I and what am I working on"
 * tuple — an {@link Account} plus a {@link Project} and an optional
 * {@link WorkspaceRef}. All shapes are compile-time `readonly` interfaces
 * (no runtime `Object.freeze`, R4.6 [ST]); switching axes uses
 * {@link sessionReplace}.
 *
 * Naming: `WorkspaceRef` is the data type held inside a Session, while the
 * public `Workspace` facade class (Phase 3 B6) is the operational surface —
 * the rename avoids the collision, exactly as in Python.
 *
 * Parse-factory extra-key behavior mirrors each Pydantic `model_config`:
 * `Project`/`WorkspaceRef`/`Session` are `frozen=True` WITHOUT
 * `extra='forbid'` (unknown keys are IGNORED, the Pydantic default);
 * `ActiveSession` is `extra='forbid'` and rejects unknown keys — including
 * `project`, which deliberately does not exist on it (project lives on
 * `Account.default_project`; switching accounts implicitly switches
 * projects).
 */

import { coerceInt, coerceStr } from "../coerce.js";
import {
  ParamTypeError,
  ParamValidationError,
  ResponseValidationError,
} from "../errors.js";
import {
  type Account,
  accountAuthHeader,
  type AccountAuthHeaderOptions,
  type AccountName,
  forbidExtraKeys,
  parseAccount,
  type ParseAccountOptions,
  type ProjectId,
  requireRecord,
  type WorkspaceId,
} from "./account.js";

/**
 * Mixpanel project reference (Python `Project`).
 *
 * Project IDs come from the Mixpanel API as numeric strings; `name`,
 * `organization_id`, and `timezone` are populated when the resolver has
 * access to a `/me` response.
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
 * Mixpanel workspace reference (Python `WorkspaceRef`; cohort/dashboard
 * scoping unit).
 *
 * The optional `project_id` lets {@link parseSession} cross-check that the
 * workspace actually belongs to the bound project; left `null`/absent when
 * the workspace was constructed from a bare ID (e.g. `MP_WORKSPACE_ID=N`),
 * in which case the check degrades to "trust the caller".
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
 * Immutable in-memory tuple of (Account, Project, optional WorkspaceRef)
 * (Python `Session`).
 *
 * `workspace === null` (or absent) lazy-resolves on the first
 * workspace-scoped API call (FR-025). `headers` is REQUIRED — Python
 * declares `headers: Mapping[str, str] = Field(default_factory=dict)`
 * (session.py:145), never `None`; {@link parseSession} fills an empty map
 * when the key is absent.
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
   * `[settings].custom_header` and/or `bridge.headers`). `ReadonlyMap`
   * per R4.8 — membership via `.has()`, never prototype-unsafe object
   * lookups. Compile-time read-only only (no freeze, R4.6).
   */
  readonly headers: ReadonlyMap<string, string>;
}

/**
 * Persisted shape of the `[active]` block in `~/.mp/config.toml`
 * (Python `ActiveSession`).
 *
 * Only `account` and `workspace` live in `[active]` — there is NO
 * `project` field: project lives on the account itself as
 * `Account.default_project`, so switching accounts implicitly switches
 * projects. {@link parseActiveSession} rejects unknown keys (including
 * `project`) per `extra='forbid'`.
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
 * Throw the boundary-appropriate parse error (shared with account.ts via
 * the coerce module's convention).
 *
 * @param message - Human-readable description (out of contract, R5.4).
 * @param options - Parse options carrying the boundary kind.
 * @param details - Optional structured error data.
 * @returns Never returns.
 * @throws ParamValidationError | ResponseValidationError - Always.
 */
function parseFail(
  message: string,
  options: ParseAccountOptions,
  details?: Readonly<Record<string, unknown>>,
): never {
  if (options.boundary === "param") {
    throw new ParamValidationError(message, "VALIDATION_ERROR", details);
  }
  throw new ResponseValidationError(
    message,
    "RESPONSE_VALIDATION_ERROR",
    details,
  );
}

/**
 * Read an optional string-or-null field, preserving absent-vs-null
 * (R3.9/R4.10).
 *
 * @param payload - The raw payload record.
 * @param field - Field name.
 * @param options - Parse options carrying the boundary kind.
 * @returns The string, `null`, or `undefined` when absent.
 * @throws ParamValidationError | ResponseValidationError - When present
 *   but not a string.
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

/** `Project.id` constraint: Python `pattern=r"^\d+$"` (Rust-regex `\d`). */
const PROJECT_ID_PATTERN = /^\p{Nd}+$/u;

/**
 * Construct a {@link Project} from a raw payload (Pydantic parity:
 * `frozen=True`, extras IGNORED, `id` digits-only + non-empty).
 *
 * @param raw - The raw payload.
 * @param options - Error-boundary selection (defaults to `'response'`).
 * @returns The parsed project; unknown keys are dropped.
 * @throws ParamValidationError | ResponseValidationError - On a missing /
 *   malformed `id` or wrongly typed optional field.
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
 * `frozen=True`, extras IGNORED, `id` a positive integer via lax
 * coercion — `Field(gt=0)`).
 *
 * @param raw - The raw payload.
 * @param options - Error-boundary selection (defaults to `'response'`).
 * @returns The parsed workspace reference; unknown keys are dropped.
 * @throws ParamValidationError | ResponseValidationError - On a missing /
 *   non-positive `id` or wrongly typed optional field.
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
 * a `project_id` MUST belong to the bound project.
 *
 * @param session - The candidate (account, project, workspace) tuple.
 * @param options - Error-boundary selection.
 * @throws ParamValidationError | ResponseValidationError - When
 *   `workspace.project_id` is set and differs from `project.id`.
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
 * `frozen=True`, extras IGNORED; nested payloads parse through
 * {@link parseAccount} / {@link parseProject} / {@link parseWorkspaceRef};
 * the workspace-project coupling validator runs; an ABSENT `headers` key
 * fills an empty map (`default_factory=dict` fires on absent only —
 * explicit `null` is a validation error, R4.12).
 *
 * Already-parsed nested values (an {@link Account} object, a
 * `ReadonlyMap` for headers) pass through unchanged so Phase-3 callers
 * can assemble sessions from parts.
 *
 * @param raw - The raw payload.
 * @param options - Error-boundary selection (defaults to `'response'`).
 * @returns The parsed session.
 * @throws ParamValidationError | ResponseValidationError - On any nested
 *   parse failure, a `null` `headers`, or a workspace-project mismatch.
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
 * Return the `Authorization` header for a session (port of Python
 * `Session.auth_header`).
 *
 * @param session - The session whose account authenticates the call.
 * @param options - Carries the `TokenResolver` (required for OAuth
 *   accounts, ignored for `service_account` — exactly Python's rule).
 * @returns The header value (`Basic ...` or `Bearer ...`).
 * @throws ParamTypeError - When the account is an OAuth variant and no
 *   resolver was provided (Python raises `TypeError`).
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
   * Replacement workspace. Passing `null` CLEARS the workspace
   * (re-triggering lazy resolution); OMITTING the key preserves the
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
 * Return a new {@link Session} with the supplied axes swapped in (port of
 * Python `Session.replace`).
 *
 * Fidelity note: Python implements this via `model_copy(update=...)`,
 * which does NOT re-run model validators — so, exactly like Python, this
 * function performs NO re-validation (a replace that introduces a
 * mismatched `workspace.project_id` does not raise; the API surfaces the
 * mismatch at request time).
 *
 * @param session - The source session (never mutated).
 * @param update - The axes to replace (sentinel semantics via key
 *   presence for `workspace`/`headers`, `!= null` for
 *   `account`/`project` — mirroring Python's `is not None` checks).
 * @returns A new session instance.
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
 * Pydantic parity: `extra='forbid'` — unknown keys are REJECTED,
 * explicitly including `project` (Python's docstring rationale, ported:
 * project lives on `Account.default_project`; switching accounts
 * implicitly switches projects, so `[active]` has no project axis).
 *
 * @param raw - The raw payload.
 * @param options - Error-boundary selection (defaults to `'response'`).
 * @returns The parsed active-session block.
 * @throws ParamValidationError | ResponseValidationError - On unknown
 *   keys (including `project`) or wrongly typed fields.
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
