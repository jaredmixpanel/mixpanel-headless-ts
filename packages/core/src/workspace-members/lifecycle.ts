/**
 * B6-W1 member module — the logic behind the `Workspace` lifecycle,
 * workspace-management, `/me` and business-context members
 * (`workspace.py:528-1034` + `:10254-10674`).
 *
 * Packet contract (`b6-packets.md` §2): the `workspace.ts` sections
 * hold ONE-LINE delegations; everything with a branch lives here, and
 * everything below the facade (the wire client, the entity models, the
 * B4-C2 streaming helpers) is COMPOSED, never re-implemented (R10.8).
 *
 * This is the first module of `workspace-members/`; W2–W8 add siblings.
 */

import type { Account } from "../auth/account.js";
import type { Session } from "../auth/session.js";
import type { JsonValue } from "../client/json-value.js";
import { compareCodepoints } from "../compat/codepoint.js";
import {
  BusinessContextValidationError,
  ConfigError,
  MixpanelHeadlessError,
  ParamValidationError,
  WorkspaceScopeError,
} from "../errors.js";
import type { MeService } from "../services/me.js";
import {
  BUSINESS_CONTEXT_MAX_CHARS,
  BusinessContext,
  BusinessContextChain,
} from "../types/entities/business-context.js";
import { codepointLength } from "../types/entities/model-base.js";

// ---------------------------------------------------------------------------
// W1-D1 — the resolver seams (B7 replaces the defaults).
// ---------------------------------------------------------------------------

/** Arguments of the {@link ResolverSeams.resolveSession} seam. */
export interface ResolveSessionArgs {
  /** The `[targets.NAME]` cursor to apply (all three axes). */
  readonly target: string;
}

/** Arguments of the {@link ResolverSeams.resolveProjectAxis} seam. */
export interface ResolveProjectAxisArgs {
  /** The explicit `project=` kwarg, when supplied. */
  readonly explicit: string | null;
  /** The target's project, when the call came from a target. */
  readonly target_project: string | null;
  /** The account the project axis re-resolves against. */
  readonly account: Account;
}

/**
 * The resolution surface `Workspace.use()` consumes — batch B7 owns the
 * implementations (playbook B7 row: "`Workspace.use(...)` (B6, already
 * built) consumes `resolve_session`"), B8 owns the config/bridge I/O
 * underneath them. W1 fixes the SHAPE and ships defaults that throw
 * `UNPORTED_RESOLVER_SEAM`.
 *
 * Python counterparts: `_resolve_session` + `_load_bridge`
 * (`workspace.py:618-630`), `ConfigManager.get_account` /
 * `_resolve_project_axis` / `_env_workspace_id` (:631-668) and
 * `ConfigManager.apply_session` (:696-722).
 */
export interface ResolverSeams {
  /**
   * Resolve a full session from a saved target (env > param > target >
   * bridge > config).
   *
   * @param args - The target name.
   * @returns The resolved session.
   */
  resolveSession: (args: ResolveSessionArgs) => Promise<Session>;

  /**
   * Load a named account from configuration.
   *
   * @param name - The account name.
   * @returns The account record.
   */
  getAccount: (name: string) => Promise<Account>;

  /**
   * Re-resolve the project axis for an account swap.
   *
   * @param args - Explicit / target / account inputs.
   * @returns The project ID, or `null` when nothing resolves.
   */
  resolveProjectAxis: (args: ResolveProjectAxisArgs) => Promise<string | null>;

  /**
   * Read and validate `MP_WORKSPACE_ID`.
   *
   * @returns The workspace ID, or `null` when unset.
   */
  envWorkspaceId: () => number | null | Promise<number | null>;

  /**
   * Persist the session's axes to the `[active]` block in one
   * transaction (`_persist_active`).
   *
   * @param session - The post-swap session.
   * @returns Nothing.
   */
  persistActive: (session: Session) => void | Promise<void>;
}

/**
 * Build a seam that throws the W1 placeholder error.
 *
 * @param name - The seam name (recorded in `details.seam`).
 * @returns A thunk that always throws.
 * @internal
 */
function unportedSeam(name: string): () => never {
  return (): never => {
    // Core-alone posture (b8-packets.md §4.4): the real seams ship via
    // `resolverSeamsFromEffects(...)` (B7) over the node effect bag
    // (B8, `createNodeAuthEffects()`); this default stays so a facade
    // built without seams still throws the coded error. Marker retired
    // at the B8 pair-A arbiter (`b8-reviewA-resolution.md` ASR-F2).
    throw new MixpanelHeadlessError(
      `Workspace resolver seam '${name}' has no implementation in ` +
        "@mixpanel-headless/core alone — pass `seams` " +
        "(resolverSeamsFromEffects over a wired effect bag)",
      "UNPORTED_RESOLVER_SEAM",
      { seam: name },
    );
  };
}

/**
 * The default {@link ResolverSeams} — every member throws
 * `UNPORTED_RESOLVER_SEAM` (B7 outbound deferral, `b6-packets.md` §13).
 *
 * @returns The throwing defaults.
 * @example
 * ```typescript
 * const seams = { ...defaultResolverSeams(), getAccount: myLoader };
 * ```
 */
export function defaultResolverSeams(): ResolverSeams {
  return {
    resolveSession: unportedSeam("resolveSession"),
    getAccount: unportedSeam("getAccount"),
    resolveProjectAxis: unportedSeam("resolveProjectAxis"),
    envWorkspaceId: unportedSeam("envWorkspaceId"),
    persistActive: unportedSeam("persistActive"),
  };
}

/**
 * Merge caller-supplied seam overrides over the throwing defaults.
 *
 * @param overrides - Partial seam bag (B7 will supply a full one).
 * @returns A complete seam bag.
 */
export function mergeResolverSeams(
  overrides: Partial<ResolverSeams> | undefined,
): ResolverSeams {
  const defaults = defaultResolverSeams();
  if (overrides === undefined) {
    return defaults;
  }
  return {
    resolveSession: overrides.resolveSession ?? defaults.resolveSession,
    getAccount: overrides.getAccount ?? defaults.getAccount,
    resolveProjectAxis:
      overrides.resolveProjectAxis ?? defaults.resolveProjectAxis,
    envWorkspaceId: overrides.envWorkspaceId ?? defaults.envWorkspaceId,
    persistActive: overrides.persistActive ?? defaults.persistActive,
  };
}

/**
 * The WS1 guard (`workspace.py:605-611`) — `target=` is mutually
 * exclusive with the three axis kwargs, and it fires BEFORE any
 * resolution side effect (packet §14 Caution 4).
 *
 * @param options - The `use()` axes.
 * @throws ParamValidationError - `WS1_TARGET_MUTUALLY_EXCLUSIVE`.
 */
export function guardTargetExclusivity(options: {
  readonly account?: string | null | undefined;
  readonly project?: string | null | undefined;
  readonly workspace?: number | null | undefined;
  readonly target?: string | null | undefined;
}): void {
  const target = options.target ?? null;
  if (
    target !== null &&
    ((options.account ?? null) !== null ||
      (options.project ?? null) !== null ||
      (options.workspace ?? null) !== null)
  ) {
    throw new ParamValidationError(
      "`target=` is mutually exclusive with `account=`/`project=`/`workspace=`.",
      "WS1_TARGET_MUTUALLY_EXCLUSIVE",
    );
  }
}

/**
 * The `ConfigError` Python raises when an account swap resolves no
 * project (`workspace.py:653-654`, `_format_no_project_error`).
 *
 * @param account - The account being swapped to.
 * @returns The error to throw.
 */
export function noProjectError(account: Account): ConfigError {
  // TODO(port): the four-paths-to-fix message body lives in
  // `_format_no_project_error` (`workspace.py`), which reads config
  // state — B7 owns the wording; the CLASS is the contract here (R5.4).
  return new ConfigError(
    `No project could be resolved for account '${account.name}'. ` +
      `Set MP_PROJECT_ID, pass project=, or give the account a ` +
      `default_project.`,
    { account_name: account.name },
  );
}

// ---------------------------------------------------------------------------
// Business context (`workspace.py:10265-10674`).
// ---------------------------------------------------------------------------

/** The two documented business-context scopes. */
export type BusinessContextLevel = "organization" | "project";

/**
 * Reject any `level` other than the two documented literals
 * (`_validate_level`, `workspace.py:10265-10287`).
 *
 * Python's `Literal[...]` is erased at runtime; TypeScript's is erased
 * at compile time — a value arriving from JS (or an `as` cast) needs
 * the same explicit check.
 *
 * @param level - The caller's `level` value.
 * @throws ParamValidationError - `WS2_INVALID_LEVEL`.
 */
export function validateBusinessContextLevel(level: string): void {
  if (level !== "organization" && level !== "project") {
    throw new ParamValidationError(
      `level must be 'organization' or 'project', got ${pyRepr(level)}`,
      "WS2_INVALID_LEVEL",
    );
  }
}

/**
 * Python's `repr()` of a plain string, for the WS2 message.
 *
 * @param value - The string.
 * @returns The single-quoted spelling.
 * @internal
 */
function pyRepr(value: string): string {
  return `'${value}'`;
}

/** The facade slice the business-context members read. */
export interface BusinessContextHost {
  /** The bound wire client's business-context methods. */
  readonly client: {
    getBusinessContext: (options?: {
      readonly organization_id?: number | null | undefined;
    }) => Promise<Record<string, JsonValue>>;
    setBusinessContext: (
      content: string,
      options?: { readonly organization_id?: number | null | undefined },
    ) => Promise<Record<string, JsonValue>>;
    getBusinessContextChain: () => Promise<Record<string, JsonValue>>;
  };
  /** The session's project id (`self._session.project.id`). */
  readonly projectId: string;
  /** The lazily-created MeService (`self._me_svc`). */
  readonly meService: MeService;
  /**
   * The MeService ONLY IF already created (`self._me_service`, which
   * `_cached_organization_id` reads without constructing one).
   */
  readonly meServiceIfCreated: MeService | null;
}

/** Keyword-only arguments of the scope-carrying business-context members. */
export interface BusinessContextScopeOptions {
  /** `"project"` (default) or `"organization"`. */
  readonly level?: BusinessContextLevel | undefined;
  /** Explicit org ID; only honored when `level="organization"`. */
  readonly organization_id?: number | null | undefined;
}

/**
 * Resolve the organization ID for org-scoped calls
 * (`_resolve_organization_id`, `workspace.py:10289-10337`).
 *
 * @param host - The facade slice.
 * @param explicit - The explicit `organization_id`, when supplied.
 * @returns The organization ID.
 * @throws ConfigError - `/me` cannot be fetched.
 * @throws WorkspaceScopeError - `ORGANIZATION_AMBIGUOUS`.
 */
export async function resolveOrganizationId(
  host: BusinessContextHost,
  explicit: number | null,
): Promise<number> {
  if (explicit !== null) {
    return explicit;
  }
  const me = await host.meService.fetch();
  const projectInfo = me.projects.get(host.projectId);
  if (projectInfo !== undefined) {
    return projectInfo.organization_id;
  }
  if (me.organizations.size === 1) {
    const sole = me.organizations.values().next().value as { id: number };
    return sole.id;
  }
  const available = [...me.organizations.keys()].sort(compareCodepoints);
  throw new WorkspaceScopeError(
    `Cannot auto-resolve organization for project ` +
      `${pyRepr(host.projectId)}. Pass organization_id explicitly. ` +
      `Available organizations: [${available.map((org) => pyRepr(org)).join(", ")}]`,
    "ORGANIZATION_AMBIGUOUS",
    {
      project_id: host.projectId,
      available_organizations: available,
    },
  );
}

/**
 * Return `organization_id` from the cached `/me`, never fetching
 * (`_cached_organization_id`, `workspace.py:10339-10370`).
 *
 * @param host - The facade slice.
 * @returns The cached organization ID, or `null` on a cold cache.
 */
export async function cachedOrganizationId(
  host: BusinessContextHost,
): Promise<number | null> {
  const service = host.meServiceIfCreated;
  if (service === null) {
    return null;
  }
  const me = await service.peek();
  if (me === null) {
    return null;
  }
  const projectInfo = me.projects.get(host.projectId);
  if (projectInfo !== undefined) {
    return projectInfo.organization_id;
  }
  if (me.organizations.size === 1) {
    const sole = me.organizations.values().next().value as { id: number };
    return sole.id;
  }
  return null;
}

/**
 * Read a required string field from an App API response
 * (`_require_str_field`, `workspace.py:10372-10403`).
 *
 * @param raw - The unwrapped `results` mapping.
 * @param key - The field name.
 * @param method - Caller name, embedded in the message.
 * @returns The string value (empty string is valid).
 * @throws MixpanelHeadlessError - Key absent, or value not a string.
 */
export function requireStrField(
  raw: Record<string, JsonValue>,
  key: string,
  method: string,
): string {
  if (!Object.hasOwn(raw, key)) {
    throw new MixpanelHeadlessError(
      `Unexpected response from ${method}: missing required field ${pyRepr(key)}`,
      "UNKNOWN_ERROR",
      { missing_field: key, response: raw },
    );
  }
  const value = raw[key];
  if (typeof value !== "string") {
    throw new MixpanelHeadlessError(
      `Unexpected response from ${method}: field ${pyRepr(key)} ` +
        `is ${pyTypeName(value)}, expected str`,
      "UNKNOWN_ERROR",
      { field: key, response: raw },
    );
  }
  return value;
}

/**
 * Python's `type(value).__name__` for the {@link requireStrField}
 * message (message text is out of contract, R5.4 — the shape is not).
 *
 * @param value - The offending value.
 * @returns The Python type name.
 * @internal
 */
function pyTypeName(value: unknown): string {
  if (value === null) {
    return "NoneType";
  }
  if (Array.isArray(value)) {
    return "list";
  }
  switch (typeof value) {
    case "boolean": {
      return "bool";
    }
    case "number": {
      return Number.isInteger(value) ? "int" : "float";
    }
    case "string": {
      return "str";
    }
    case "object": {
      return "dict";
    }
    case "bigint":
    case "function":
    case "symbol":
    case "undefined": {
      // Not producible from a JSON response body; name the JS type rather
      // than mislabel it as a dict (CLEANUP-PLAN.md §12 row 8.9).
      return typeof value;
    }
    default: {
      // Every `typeof` result is listed; TS cannot subtract them from
      // `unknown`, so it still wants a terminal arm.
      throw new TypeError(`unexpected typeof result: ${typeof value}`);
    }
  }
}

/**
 * Read business context at the given scope (`get_business_context`,
 * `workspace.py:10405-10479`).
 *
 * @param host - The facade slice.
 * @param options - `level` / `organization_id`.
 * @returns The populated context.
 * @throws ParamValidationError - `WS2_INVALID_LEVEL`.
 * @throws WorkspaceScopeError - Org ID could not be auto-resolved.
 * @throws MixpanelHeadlessError - Response missing `content`.
 */
export async function getBusinessContext(
  host: BusinessContextHost,
  options: BusinessContextScopeOptions = {},
): Promise<BusinessContext> {
  const level = options.level ?? "project";
  validateBusinessContextLevel(level);
  if (level === "organization") {
    const orgId = await resolveOrganizationId(
      host,
      options.organization_id ?? null,
    );
    const orgRaw = await host.client.getBusinessContext({
      organization_id: orgId,
    });
    return new BusinessContext({
      level: "organization",
      content: requireStrField(orgRaw, "content", "get_business_context"),
      organization_id: orgId,
    });
  }
  const raw = await host.client.getBusinessContext();
  return new BusinessContext({
    level: "project",
    content: requireStrField(raw, "content", "get_business_context"),
    project_id: host.projectId,
  });
}

/**
 * Replace business context at the given scope (`set_business_context`,
 * `workspace.py:10481-10566`).
 *
 * @param host - The facade slice.
 * @param content - The new markdown content (empty string clears).
 * @param options - `level` / `organization_id`.
 * @returns The context echoed by the server.
 * @throws ParamValidationError - `WS2_INVALID_LEVEL`.
 * @throws BusinessContextValidationError - Content over the limit
 *   (client-side, before any HTTP call).
 * @throws WorkspaceScopeError - Org ID could not be auto-resolved.
 * @throws MixpanelHeadlessError - Response missing `content`.
 */
export async function setBusinessContext(
  host: BusinessContextHost,
  content: string,
  options: BusinessContextScopeOptions = {},
): Promise<BusinessContext> {
  const level = options.level ?? "project";
  validateBusinessContextLevel(level);
  // `len(content)` counts CODEPOINTS in Python (R11.7 family).
  const length = codepointLength(content);
  if (length > BUSINESS_CONTEXT_MAX_CHARS) {
    throw new BusinessContextValidationError(
      `content exceeds maximum length of ` +
        `${String(BUSINESS_CONTEXT_MAX_CHARS)} characters (got ${String(length)})`,
      { length, max: BUSINESS_CONTEXT_MAX_CHARS },
    );
  }
  if (level === "organization") {
    const orgId = await resolveOrganizationId(
      host,
      options.organization_id ?? null,
    );
    const orgRaw = await host.client.setBusinessContext(content, {
      organization_id: orgId,
    });
    return new BusinessContext({
      level: "organization",
      content: requireStrField(orgRaw, "content", "set_business_context"),
      organization_id: orgId,
    });
  }
  const raw = await host.client.setBusinessContext(content);
  return new BusinessContext({
    level: "project",
    content: requireStrField(raw, "content", "set_business_context"),
    project_id: host.projectId,
  });
}

/**
 * Read both scopes in ONE request (`get_business_context_chain`,
 * `workspace.py:10612-10674`).
 *
 * `organization.organization_id` is enriched from the cached `/me`
 * only when free — a cold cache leaves it `null` rather than spending
 * a second round-trip.
 *
 * @param host - The facade slice.
 * @returns Both contexts.
 * @throws MixpanelHeadlessError - Response missing either field.
 */
export async function getBusinessContextChain(
  host: BusinessContextHost,
): Promise<BusinessContextChain> {
  const raw = await host.client.getBusinessContextChain();
  const orgContent = requireStrField(
    raw,
    "org_context",
    "get_business_context_chain",
  );
  const projectContent = requireStrField(
    raw,
    "project_context",
    "get_business_context_chain",
  );
  const orgId = await cachedOrganizationId(host);
  return new BusinessContextChain({
    organization: new BusinessContext({
      level: "organization",
      content: orgContent,
      organization_id: orgId,
    }),
    project: new BusinessContext({
      level: "project",
      content: projectContent,
      project_id: host.projectId,
    }),
  });
}
