/**
 * Lifecycle members of the `Workspace` facade: the resolver seams
 * `use()` consumes, the target-exclusivity guard, the no-project error,
 * and the business-context members over the facade slice they read
 * ({@link BusinessContextHost}). Everything with a branch lives here;
 * everything below the facade (the wire client, the entity models, the
 * streaming helpers) is composed, never re-implemented.
 *
 * @see mixpanel_headless.workspace.Workspace
 */

import type { Account } from "../auth/account.js";
import type { Session } from "../auth/session.js";
import type { JsonValue } from "../client/json-value.js";
import { compareCodepoints, cpLength } from "../compat/codepoint.js";
import { pythonRepr } from "../compat/python-str.js";
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

// --- Resolver seams ---

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
 * The resolution surface `Workspace.use()` consumes.
 *
 * @remarks
 * Python's `use()` reaches straight into `ConfigManager` and the bridge
 * file; `@mixpanel-headless/core` is runtime-agnostic, so those reads are
 * injected as seams and `@mixpanel-headless/node` supplies them
 * (`resolverSeamsFromEffects` over its effect bag). A facade built
 * without seams still fails with the coded `UNPORTED_RESOLVER_SEAM`
 * rather than a `TypeError`. Python counterparts:
 * `mixpanel_headless._internal.auth.resolver.resolve_session` /
 * `resolve_project_axis` / `env_workspace_id`, `ConfigManager.get_account`
 * and `ConfigManager.apply_session`.
 * @see mixpanel_headless.workspace.Workspace.use
 */
export interface ResolverSeams {
  /**
   * Resolve a full session from a saved target (precedence
   * `env`, then `param`, then `target`, then `bridge`, then `config`).
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
   * transaction.
   *
   * @param session - The post-swap session.
   * @returns Nothing.
   * @see mixpanel_headless.workspace.Workspace._persist_active
   */
  persistActive: (session: Session) => void | Promise<void>;
}

/**
 * Build a seam that throws the coded placeholder error.
 *
 * @param name - The seam name (recorded in `details.seam`).
 * @returns A thunk that always throws.
 * @throws {@link MixpanelHeadlessError} - `UNPORTED_RESOLVER_SEAM`, from
 *   the returned thunk.
 */
function unportedSeam(name: string): () => never {
  return (): never => {
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
 * Build the default {@link ResolverSeams}, every member of which throws
 * `UNPORTED_RESOLVER_SEAM`.
 *
 * @returns The throwing defaults.
 * @example
 * ```typescript
 * const seams = { ...defaultResolverSeams(), getAccount: myLoader };
 * ```
 */
function defaultResolverSeams(): ResolverSeams {
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
 * @param overrides - Partial seam bag; absent members keep the throwing
 *   default.
 * @returns A complete seam bag.
 * @example
 * ```typescript
 * const seams = mergeResolverSeams({ getAccount: (name) => loadAccount(name) });
 * ```
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
 * Reject `target` combined with any of the three axis options. Runs
 * before any resolution side effect, as the Python guard does.
 *
 * @param options - The constructor / `use()` axes: `account` (named
 *   account), `project` (project id), `workspace` (workspace id) and
 *   `target` (a `[targets.NAME]` cursor that supplies all three).
 * @throws {@link ParamValidationError} - `WS1_TARGET_MUTUALLY_EXCLUSIVE`.
 * @example
 * ```typescript
 * guardTargetExclusivity({ target: "prod" });                   // ok
 * guardTargetExclusivity({ target: "prod", project: "123" }); // throws
 * ```
 * @see mixpanel_headless.workspace.Workspace.use
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
 * Build the `ConfigError` raised when an account swap resolves no
 * project (Python: `format_no_project_error`).
 *
 * @param account - The account being swapped to.
 * @returns The error to throw.
 * @example
 * ```typescript
 * throw noProjectError(account); // ConfigError, details.account_name set
 * ```
 * @see mixpanel_headless.workspace.Workspace.use
 */
export function noProjectError(account: Account): ConfigError {
  // Divergence: Python's message enumerates config-dependent fixes; the
  // class and code are the contract (PORTING.md).
  return new ConfigError(
    `No project could be resolved for account '${account.name}'. ` +
      `Set MP_PROJECT_ID, pass project=, or give the account a ` +
      `default_project.`,
    { account_name: account.name },
  );
}

// --- Business context ---

/** The two documented business-context scopes. */
export type BusinessContextLevel = "organization" | "project";

/**
 * Reject any `level` other than the two documented literals.
 *
 * @remarks
 * Python's `Literal[...]` is erased at runtime; TypeScript's is erased at
 * compile time — a value arriving from JS (or an `as` cast) needs the
 * same explicit check.
 * @param level - The caller's `level` value.
 * @throws {@link ParamValidationError} - `WS2_INVALID_LEVEL`.
 * @example
 * ```typescript
 * validateBusinessContextLevel("organization"); // ok
 * validateBusinessContextLevel("team");         // throws WS2_INVALID_LEVEL
 * ```
 * @see mixpanel_headless.workspace.Workspace._validate_level
 */
export function validateBusinessContextLevel(level: string): void {
  if (level !== "organization" && level !== "project") {
    throw new ParamValidationError(
      `level must be 'organization' or 'project', got ${pythonRepr(level)}`,
      "WS2_INVALID_LEVEL",
    );
  }
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
  /**
   * The lazily-created MeService (`self._me_svc`) — a thunk, so the
   * service is created only where Python touches the attribute.
   */
  readonly meService: () => MeService;
  /**
   * The MeService only if already created (`self._me_service`, which
   * `_cached_organization_id` reads without constructing one).
   */
  readonly meServiceIfCreated: () => MeService | null;
}

/** Keyword-only arguments of the scope-carrying business-context members. */
export interface BusinessContextScopeOptions {
  /**
   * The scope to read or write.
   *
   * @defaultValue `"project"`
   */
  readonly level?: BusinessContextLevel | undefined;
  /**
   * Explicit organization id; honoured only when `level` is
   * `"organization"`.
   *
   * @defaultValue `null` (auto-resolved from `/me`)
   */
  readonly organization_id?: number | null | undefined;
}

/**
 * Resolve the organization ID for org-scoped calls.
 *
 * @param host - The facade slice.
 * @param explicit - The explicit `organization_id`, when supplied.
 * @returns The organization ID.
 * @throws {@link ConfigError} - `/me` cannot be fetched.
 * @throws {@link WorkspaceScopeError} - `ORGANIZATION_AMBIGUOUS`.
 * @see mixpanel_headless.workspace.Workspace._resolve_organization_id
 */
async function resolveOrganizationId(
  host: BusinessContextHost,
  explicit: number | null,
): Promise<number> {
  if (explicit !== null) {
    return explicit;
  }
  const me = await host.meService().fetch();
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
      `${pythonRepr(host.projectId)}. Pass organization_id explicitly. ` +
      `Available organizations: [${available.map((org) => pythonRepr(org)).join(", ")}]`,
    "ORGANIZATION_AMBIGUOUS",
    {
      project_id: host.projectId,
      available_organizations: available,
    },
  );
}

/**
 * Return `organization_id` from the cached `/me`, never fetching.
 *
 * @param host - The facade slice.
 * @returns The cached organization ID, or `null` on a cold cache.
 * @see mixpanel_headless.workspace.Workspace._cached_organization_id
 */
async function cachedOrganizationId(
  host: BusinessContextHost,
): Promise<number | null> {
  const service = host.meServiceIfCreated();
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
 * Read a required string field from an App API response.
 *
 * @param raw - The unwrapped `results` mapping.
 * @param key - The field name.
 * @param method - Caller name, embedded in the message.
 * @returns The string value (empty string is valid).
 * @throws {@link MixpanelHeadlessError} - Key absent, or value not a string.
 * @see mixpanel_headless.workspace.Workspace._require_str_field
 */
function requireStrField(
  raw: Record<string, JsonValue>,
  key: string,
  method: string,
): string {
  if (!Object.hasOwn(raw, key)) {
    throw new MixpanelHeadlessError(
      `Unexpected response from ${method}: missing required field ${pythonRepr(key)}`,
      "UNKNOWN_ERROR",
      { missing_field: key, response: raw },
    );
  }
  const value = raw[key];
  if (typeof value !== "string") {
    throw new MixpanelHeadlessError(
      `Unexpected response from ${method}: field ${pythonRepr(key)} ` +
        `is ${pyTypeName(value)}, expected str`,
      "UNKNOWN_ERROR",
      { field: key, response: raw },
    );
  }
  return value;
}

/**
 * Spell a value's Python type name (`type(value).__name__`) for the
 * {@link requireStrField} message; the text is outside the contract, the
 * error shape is not.
 *
 * @param value - The offending value.
 * @returns The Python type name.
 * @throws {@link TypeError} - Never in practice: the terminal arm exists
 *   because TypeScript cannot subtract the listed `typeof` results from
 *   `unknown`.
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
      // than mislabel it as a dict.
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
 * Read business context at the given scope.
 *
 * @param host - The facade slice.
 * @param options - `level` / `organization_id`.
 * @returns The populated context.
 * @throws {@link ParamValidationError} - `WS2_INVALID_LEVEL`.
 * @throws {@link WorkspaceScopeError} - Org ID could not be auto-resolved.
 * @throws {@link MixpanelHeadlessError} - Response missing `content`.
 * @example
 * ```typescript
 * const ctx = await ws.getBusinessContext({ level: "organization" });
 * ctx.content;
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_business_context
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
 * Replace business context at the given scope.
 *
 * @param host - The facade slice.
 * @param content - The new markdown content (empty string clears).
 * @param options - `level` / `organization_id`.
 * @returns The context echoed by the server.
 * @throws {@link ParamValidationError} - `WS2_INVALID_LEVEL`.
 * @throws {@link BusinessContextValidationError} - Content over the limit
 *   (client-side, before any HTTP call).
 * @throws {@link WorkspaceScopeError} - Org ID could not be auto-resolved.
 * @throws {@link MixpanelHeadlessError} - Response missing `content`.
 * @example
 * ```typescript
 * await ws.setBusinessContext("# Acme\nB2B SaaS, EU data residency.");
 * ```
 * @see mixpanel_headless.workspace.Workspace.set_business_context
 */
export async function setBusinessContext(
  host: BusinessContextHost,
  content: string,
  options: BusinessContextScopeOptions = {},
): Promise<BusinessContext> {
  const level = options.level ?? "project";
  validateBusinessContextLevel(level);
  // Python's `len(content)` counts code points, not UTF-16 units.
  const length = cpLength(content);
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
 * Read both business-context scopes in one request.
 *
 * @remarks
 * `organization.organization_id` is enriched from the cached `/me` only
 * when free — a cold cache leaves it `null` rather than spending a
 * second round-trip.
 * @param host - The facade slice.
 * @returns Both contexts.
 * @throws {@link MixpanelHeadlessError} - Response missing either field.
 * @example
 * ```typescript
 * const chain = await ws.getBusinessContextChain();
 * chain.project.content;
 * ```
 * @see mixpanel_headless.workspace.Workspace.get_business_context_chain
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
