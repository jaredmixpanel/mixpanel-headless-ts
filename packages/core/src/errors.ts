/**
 * Exception hierarchy of `@mixpanel-headless/core`: each Python exception
 * class ports as an `Error` subclass with the same name, parent edge and
 * machine `code`. Class name plus `code` is the conformance contract;
 * message text is copied from Python for fidelity but never asserted. The
 * registry constants are re-exported from the generated `errors-codes.gen.ts`.
 * The transport-tier `MixpanelHttpError` (an `httpx.HTTPError` twin) lives
 * outside this hierarchy, in `client/internals.ts`, next to the retry loops.
 *
 * @see mixpanel_headless.exceptions
 */

import type { Region } from "./types/literals.js";

export {
  CODED_GUARD_REGISTRY,
  CODED_GUARD_TWIN_CODES,
} from "./errors-codes.gen.js";

/** Serialized error shape produced by {@link MixpanelHeadlessError.toDict}. */
export interface ErrorDict {
  /** Machine-readable error code. */
  code: string;
  /** Human-readable message; not part of the contract. */
  message: string;
  /** Additional structured error data (snake_case keys — wire spelling). */
  details: Record<string, unknown>;
}

/**
 * Base exception for all mixpanel_headless errors.
 *
 * All library exceptions inherit from this class, allowing callers to
 * catch every library error with a single `instanceof` check, handle
 * specific subclasses, and serialize errors via {@link toDict}.
 *
 * @example
 * ```ts
 * try {
 *   await ws.listDashboards();
 * } catch (err) {
 *   if (err instanceof MixpanelHeadlessError) {
 *     console.error(err.code, err.toDict());
 *   }
 *   throw err;
 * }
 * ```
 * @see mixpanel_headless.exceptions.MixpanelHeadlessError
 */
export class MixpanelHeadlessError extends Error {
  /** Machine-readable error code — fixed at construction. */
  readonly #code: string;

  /**
   * Additional structured error data. Keys entering this bag keep their
   * Python snake_case spelling — it is serialized into `toDict()` output
   * and compared by the conformance canonicalizer.
   * Subclasses contribute their keys through the constructor chain
   * (see {@link APIErrorOptions.details}); nothing mutates the bag after
   * construction.
   */
  readonly #details: Record<string, unknown>;

  /**
   * Initialize the exception.
   *
   * @param message - Human-readable message; not part of the contract.
   * @param code - Machine-readable error code for programmatic handling.
   * @param details - Additional structured data about the error.
   * @param options - Standard `ErrorOptions` (`cause` threading).
   */
  constructor(
    message: string,
    code: string = "UNKNOWN_ERROR",
    details?: Readonly<Record<string, unknown>> | null,
    options?: ErrorOptions,
  ) {
    super(message, options);
    // Every subclass keeps its Python class name, so the runtime name is
    // the constructor's. A minifying bundler must therefore keep function
    // names (esbuild `keepNames`, as scripts/build-browser-bundle.mjs
    // does) or the corpus-checked `name` degrades to a single letter.
    this.name = this.constructor.name;
    this.#code = code;
    this.#details = { ...details };
  }

  /**
   * Machine-readable error code.
   *
   * @returns The code fixed at construction.
   */
  get code(): string {
    return this.#code;
  }

  /**
   * Additional structured error data (snake_case keys).
   *
   * @returns The structured data bag (snake_case keys), never mutated after construction.
   */
  get details(): Readonly<Record<string, unknown>> {
    return this.#details;
  }

  /**
   * Serialize the exception for logging/JSON output.
   *
   * Key set (`code`, `message`, `details`) matches Python's `to_dict()`
   * byte-for-byte.
   *
   * @returns Dictionary with keys `code`, `message`, `details`.
   */
  toDict(): ErrorDict {
    return {
      code: this.#code,
      message: this.message,
      details: this.#details,
    };
  }
}

// --- Coded guard errors ---

/**
 * A builder/facade argument guard rejected a value (registry-coded).
 *
 * Python dual-inherits `ValueError` so converted guard sites stay
 * catchable by `except ValueError`; in TS the conformance key is class
 * name + `code`, so plain `MixpanelHeadlessError` descent suffices.
 *
 * @example
 * ```ts
 * const err = new ParamValidationError(
 *   "quantity must be positive",
 *   "FD1_QUANTITY_NOT_POSITIVE",
 * );
 * err.code; // "FD1_QUANTITY_NOT_POSITIVE"
 * err instanceof MixpanelHeadlessError; // true
 * ```
 * @see mixpanel_headless.exceptions.ParamValidationError
 */
export class ParamValidationError extends MixpanelHeadlessError {
  /**
   * Initialize the coded guard error.
   *
   * @param message - Human-readable message; not part of the contract.
   * @param code - Machine-readable registry code for the violated rule.
   *   Defaults to the generic `VALIDATION_ERROR`.
   * @param details - Optional structured, deterministic, codec-encodable
   *   data about the error.
   * @param options - Standard `ErrorOptions` (`cause` threading).
   */
  constructor(
    message: string,
    code: string = "VALIDATION_ERROR",
    details?: Readonly<Record<string, unknown>> | null,
    options?: ErrorOptions,
  ) {
    super(message, code, details, options);
  }
}

/**
 * A builder/facade argument guard rejected a value's type (registry-coded).
 *
 * Python dual-inherits `TypeError`; see {@link ParamValidationError} for
 * why the TS port needs only `MixpanelHeadlessError` descent.
 *
 * @example
 * ```ts
 * const err = new ParamTypeError("name must be a string");
 * err.code; // "VALIDATION_ERROR"
 * ```
 * @see mixpanel_headless.exceptions.ParamTypeError
 */
export class ParamTypeError extends MixpanelHeadlessError {
  /**
   * Initialize the coded guard error.
   *
   * @param message - Human-readable message; not part of the contract.
   * @param code - Machine-readable registry code for the violated rule.
   *   Defaults to the generic `VALIDATION_ERROR`.
   * @param details - Optional structured, deterministic, codec-encodable
   *   data about the error.
   * @param options - Standard `ErrorOptions` (`cause` threading).
   */
  constructor(
    message: string,
    code: string = "VALIDATION_ERROR",
    details?: Readonly<Record<string, unknown>> | null,
    options?: ErrorOptions,
  ) {
    super(message, code, details, options);
  }
}

/**
 * An API response failed model validation.
 *
 * Raised at response-parsing seams when a Mixpanel API payload does not
 * match the expected response model. The original parse error is chained
 * via the standard `cause` option (Python: `raise ... from exc`).
 *
 * @example
 * ```ts
 * try {
 *   Dashboard.fromDict(payload);
 * } catch (cause) {
 *   throw new ResponseValidationError(
 *     "Dashboard payload failed validation",
 *     undefined,
 *     { model: "Dashboard" },
 *     { cause },
 *   );
 * }
 * ```
 * @see mixpanel_headless.exceptions.ResponseValidationError
 */
export class ResponseValidationError extends MixpanelHeadlessError {
  /**
   * Initialize the response validation error.
   *
   * @param message - Human-readable message; not part of the contract.
   * @param code - Machine-readable error code. Defaults to the generic
   *   `RESPONSE_VALIDATION_ERROR`.
   * @param details - Optional structured data — typically the response
   *   model name and the underlying error list.
   * @param options - Standard `ErrorOptions`; `cause` carries the
   *   underlying parse/validation failure.
   */
  constructor(
    message: string,
    code: string = "RESPONSE_VALIDATION_ERROR",
    details?: Readonly<Record<string, unknown>> | null,
    options?: ErrorOptions,
  ) {
    super(message, code, details, options);
  }
}

// --- API exceptions ---

/**
 * HTTP request/response context carried by every {@link APIError} option
 * bag. Bag keys are camelCase (a constructor argument bag); the derived
 * `details` dict keeps the Python snake_case spelling.
 */
export interface HttpErrorContext {
  /** Raw response body (any lossless-parsed JSON value, or raw text). */
  readonly responseBody?: unknown;
  /** HTTP method used (GET, POST). */
  readonly requestMethod?: string | null | undefined;
  /** Full request URL. */
  readonly requestUrl?: string | null | undefined;
  /** Query parameters sent. */
  readonly requestParams?: Readonly<Record<string, unknown>> | null | undefined;
  /** Request body sent (for POST requests). */
  readonly requestBody?: Readonly<Record<string, unknown>> | null | undefined;
  /** Underlying cause, threaded to `Error#cause`. */
  readonly cause?: unknown;
}

/** Keyword-only options bag for {@link APIError}. */
export interface APIErrorOptions extends HttpErrorContext {
  /** HTTP status code from the response. */
  readonly statusCode: number;
  /** Machine-readable error code. */
  readonly code?: string | undefined;
  /**
   * Subclass-specific keys appended to `details` after the HTTP-context
   * keys, in insertion order — the constructor-chain form of Python's
   * post-`super().__init__` `self._details[...] = ...` /
   * `self._details.update(details)`.
   */
  readonly details?: Readonly<Record<string, unknown>> | null | undefined;
}

/**
 * Options bag of the fixed-code {@link APIError} subclasses: the HTTP
 * context plus an optional `statusCode` that falls back to the
 * subclass's default status.
 */
export interface HttpErrorOptions extends HttpErrorContext {
  /** HTTP status code; defaults to the subclass's status. */
  readonly statusCode?: number | undefined;
}

/**
 * Base class for Mixpanel API HTTP errors.
 *
 * Exposes the HTTP request/response context through accessors and builds
 * `details` the way Python does: a key is present only when its value is
 * known, never set to `null` or `undefined`.
 *
 * @example
 * ```ts
 * const err = new APIError("Bad request", {
 *   statusCode: 400,
 *   requestMethod: "GET",
 *   requestUrl: "https://mixpanel.com/api/query/segmentation",
 * });
 * err.details;
 * // { status_code: 400, request_method: "GET", request_url: "https://…" }
 * ```
 * @see mixpanel_headless.exceptions.APIError
 */
export class APIError extends MixpanelHeadlessError {
  readonly #statusCode: number;
  readonly #responseBody: unknown;
  readonly #requestMethod: string | null;
  readonly #requestUrl: string | null;
  readonly #requestParams: Readonly<Record<string, unknown>> | null;
  readonly #requestBody: Readonly<Record<string, unknown>> | null;

  /**
   * Initialize APIError.
   *
   * @param message - Human-readable message; not part of the contract.
   * @param options - Keyword-only HTTP context bag; `statusCode` required,
   *   `code` defaults to `"API_ERROR"`.
   */
  constructor(message: string, options: APIErrorOptions) {
    const statusCode = options.statusCode;
    const responseBody = options.responseBody ?? null;
    const requestMethod = options.requestMethod ?? null;
    const requestUrl = options.requestUrl ?? null;
    const requestParams = options.requestParams ?? null;
    const requestBody = options.requestBody ?? null;

    // Mirror Python's sequential conditional inserts (`if x is not None:
    // details[k] = x`): a key is absent when the value is `null`.
    const details: Record<string, unknown> = { status_code: statusCode };
    if (responseBody !== null) {
      details["response_body"] = responseBody;
    }
    if (requestMethod !== null) {
      details["request_method"] = requestMethod;
    }
    if (requestUrl !== null) {
      details["request_url"] = requestUrl;
    }
    if (requestParams !== null) {
      details["request_params"] = requestParams;
    }
    if (requestBody !== null) {
      details["request_body"] = requestBody;
    }
    const extra = options.details ?? null;
    if (extra !== null) {
      Object.assign(details, extra);
    }

    super(
      message,
      options.code ?? "API_ERROR",
      details,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.#statusCode = statusCode;
    this.#responseBody = responseBody;
    this.#requestMethod = requestMethod;
    this.#requestUrl = requestUrl;
    this.#requestParams = requestParams;
    this.#requestBody = requestBody;
  }

  /**
   * HTTP status code from the response.
   *
   * @returns The HTTP status code of the failed response.
   */
  get statusCode(): number {
    return this.#statusCode;
  }

  /**
   * Raw response body (lossless-parsed JSON or raw text), or `null`.
   *
   * @returns The lossless-parsed JSON body or raw text, or `null` when absent.
   */
  get responseBody(): unknown {
    return this.#responseBody;
  }

  /**
   * HTTP method used (GET, POST), or `null`.
   *
   * @returns The HTTP method, or `null` when unknown.
   */
  get requestMethod(): string | null {
    return this.#requestMethod;
  }

  /**
   * Full request URL, or `null`.
   *
   * @returns The full request URL, or `null` when unknown.
   */
  get requestUrl(): string | null {
    return this.#requestUrl;
  }

  /**
   * Query parameters sent, or `null`.
   *
   * @returns The query parameters sent, or `null`.
   */
  get requestParams(): Readonly<Record<string, unknown>> | null {
    return this.#requestParams;
  }

  /**
   * Request body sent (for POST requests), or `null`.
   *
   * @returns The request body sent, or `null`.
   */
  get requestBody(): Readonly<Record<string, unknown>> | null {
    return this.#requestBody;
  }
}

// --- Configuration exceptions ---

/**
 * Base for configuration-related errors.
 *
 * Raised when there's a problem with configuration files, environment
 * variables, or credential resolution.
 *
 * @example
 * ```ts
 * const err = new ConfigError("MP_PROJECT_ID is not set", {
 *   variable: "MP_PROJECT_ID",
 * });
 * err.code; // "CONFIG_ERROR"
 * ```
 * @see mixpanel_headless.exceptions.ConfigError
 */
export class ConfigError extends MixpanelHeadlessError {
  /**
   * Initialize ConfigError.
   *
   * @param message - Human-readable message; not part of the contract.
   * @param details - Additional structured data.
   * @param options - Standard `ErrorOptions` (`cause` threading).
   * @param code - Machine-readable code; the subclasses pass their own,
   *   direct callers keep the `"CONFIG_ERROR"` default.
   */
  constructor(
    message: string,
    details?: Readonly<Record<string, unknown>> | null,
    options?: ErrorOptions,
    code: string = "CONFIG_ERROR",
  ) {
    super(message, code, details, options);
  }
}

/**
 * Named account does not exist in configuration.
 *
 * The {@link availableAccounts} accessor lists valid account names to
 * help users.
 *
 * @example
 * ```ts
 * const err = new AccountNotFoundError("staging", ["prod", "dev"]);
 * err.message; // "Account 'staging' not found. Available accounts: 'prod', 'dev'"
 * err.details; // { account_name: "staging", available_accounts: ["prod", "dev"] }
 * ```
 * @see mixpanel_headless.exceptions.AccountNotFoundError
 */
export class AccountNotFoundError extends ConfigError {
  readonly #accountName: string;
  readonly #availableAccounts: readonly string[];

  /**
   * Initialize AccountNotFoundError.
   *
   * @param accountName - The requested account name that wasn't found.
   * @param availableAccounts - List of valid account names for suggestions.
   */
  constructor(
    accountName: string,
    availableAccounts?: readonly string[] | null,
  ) {
    const available = [...(availableAccounts ?? [])];
    let message: string;
    if (available.length > 0) {
      const availableStr = available.map((a) => `'${a}'`).join(", ");
      message = `Account '${accountName}' not found. Available accounts: ${availableStr}`;
    } else {
      message = `Account '${accountName}' not found. No accounts configured.`;
    }
    super(
      message,
      { account_name: accountName, available_accounts: available },
      undefined,
      "ACCOUNT_NOT_FOUND",
    );
    this.#accountName = accountName;
    this.#availableAccounts = available;
  }

  /**
   * The requested account name that wasn't found.
   *
   * @returns The account name that was requested.
   */
  get accountName(): string {
    return this.#accountName;
  }

  /**
   * List of valid account names.
   *
   * @returns The configured account names, possibly empty.
   */
  get availableAccounts(): readonly string[] {
    return this.#availableAccounts;
  }
}

/**
 * Raised when a specified project is not accessible.
 *
 * Includes the requested project ID and optionally a list of accessible
 * project IDs to help the user correct their selection.
 *
 * @example
 * ```ts
 * const err = new ProjectNotFoundError("123", ["456", "789"]);
 * err.availableProjects; // ["456", "789"]
 * err.code; // "PROJECT_NOT_FOUND"
 * ```
 * @see mixpanel_headless.exceptions.ProjectNotFoundError
 */
export class ProjectNotFoundError extends ConfigError {
  readonly #projectId: string;
  readonly #availableProjects: readonly string[];

  /**
   * Initialize ProjectNotFoundError.
   *
   * @param projectId - The requested project ID that wasn't found.
   * @param availableProjects - List of accessible project IDs for suggestions.
   */
  constructor(projectId: string, availableProjects?: readonly string[] | null) {
    const available = [...(availableProjects ?? [])];
    let message: string;
    if (available.length > 0) {
      const availableStr = available.map((p) => `'${p}'`).join(", ");
      message = `Project '${projectId}' not found. Available projects: ${availableStr}`;
    } else {
      message = `Project '${projectId}' not found. No accessible projects discovered.`;
    }
    super(
      message,
      { project_id: projectId, available_projects: available },
      undefined,
      "PROJECT_NOT_FOUND",
    );
    this.#projectId = projectId;
    this.#availableProjects = available;
  }

  /**
   * The requested project ID that wasn't found.
   *
   * @returns The project id that was requested.
   */
  get projectId(): string {
    return this.#projectId;
  }

  /**
   * List of accessible project IDs.
   *
   * @returns The accessible project ids, possibly empty.
   */
  get availableProjects(): readonly string[] {
    return this.#availableProjects;
  }
}

/**
 * Account name already exists in configuration.
 *
 * Raised when attempting to add an account with a name that's already in
 * use.
 *
 * @example
 * ```ts
 * const err = new AccountExistsError("prod");
 * err.code; // "ACCOUNT_EXISTS"
 * err.details; // { account_name: "prod" }
 * ```
 * @see mixpanel_headless.exceptions.AccountExistsError
 */
export class AccountExistsError extends ConfigError {
  readonly #accountName: string;

  /**
   * Initialize AccountExistsError.
   *
   * @param accountName - The conflicting account name.
   */
  constructor(accountName: string) {
    super(
      `Account '${accountName}' already exists.`,
      { account_name: accountName },
      undefined,
      "ACCOUNT_EXISTS",
    );
    this.#accountName = accountName;
  }

  /**
   * The conflicting account name.
   *
   * @returns The conflicting account name.
   */
  get accountName(): string {
    return this.#accountName;
  }
}

/** The documented flag-combination violations. */
export type InvalidArgumentViolation =
  "mutually_exclusive" | "no_browser_misuse" | "secret_stdin_misuse";

/** Runtime mirror of {@link InvalidArgumentViolation} for the guard check. */
const VALID_VIOLATIONS: readonly string[] = [
  "mutually_exclusive",
  "no_browser_misuse",
  "secret_stdin_misuse",
];

/** Keyword-only options bag for {@link InvalidArgumentError}. */
export interface InvalidArgumentErrorOptions {
  /** Discriminator for the kind of misuse. */
  readonly violation: InvalidArgumentViolation;
  /**
   * The auth type the orchestrator resolved from the supplied flags/env.
   * `null`/absent only when the violation was caught before detection ran.
   */
  readonly detectedAuthType?: string | null | undefined;
}

/**
 * Raised when a public API call combines mutually incompatible arguments.
 *
 * Carries a `violation` discriminator and the resolved `detectedAuthType`
 * so JSON consumers can dispatch programmatically without parsing the
 * human message.
 *
 * @example
 * ```ts
 * const err = new InvalidArgumentError("--no-browser needs a service account", {
 *   violation: "no_browser_misuse",
 *   detectedAuthType: "oauth",
 * });
 * err.details; // { violation: "no_browser_misuse", detected_auth_type: "oauth" }
 * ```
 * @see mixpanel_headless.exceptions.InvalidArgumentError
 */
export class InvalidArgumentError extends ConfigError {
  readonly #violation: InvalidArgumentViolation;
  readonly #detectedAuthType: string | null;

  /**
   * Initialize InvalidArgumentError.
   *
   * @param message - Human-readable message; not part of the contract.
   * @param options - Keyword-only bag: `violation` (required) and
   *   `detectedAuthType`.
   * @throws {@link ParamValidationError} - when `violation` is not one of the
   *   three documented values.
   */
  constructor(message: string, options: InvalidArgumentErrorOptions) {
    const { violation } = options;
    const detectedAuthType = options.detectedAuthType ?? null;
    if (!VALID_VIOLATIONS.includes(violation)) {
      // Divergence: Python raises a bare ValueError here; the site has no
      // registry code, so the port uses the generic coded guard class.
      throw new ParamValidationError(
        `Invalid violation '${violation}'; must be one of ${VALID_VIOLATIONS.join(", ")}.`,
      );
    }
    // Mirror Python's conditional insert: key absent when None.
    const details: Record<string, unknown> = { violation };
    if (detectedAuthType !== null) {
      details["detected_auth_type"] = detectedAuthType;
    }
    super(message, details, undefined, "INVALID_ARGUMENT");
    this.#violation = violation;
    this.#detectedAuthType = detectedAuthType;
  }

  /**
   * The kind of misuse — see {@link InvalidArgumentViolation}.
   *
   * @returns The violation discriminator.
   */
  get violation(): InvalidArgumentViolation {
    return this.#violation;
  }

  /**
   * The auth type the orchestrator resolved, or `null` if pre-detection.
   *
   * @returns The resolved auth type, or `null` when detection had not run.
   */
  get detectedAuthType(): string | null {
    return this.#detectedAuthType;
  }
}

/**
 * Account is referenced by one or more targets and cannot be removed.
 *
 * The list of dependent target names is available in {@link referencedBy}
 * so callers can show a helpful error or force the removal and orphan the
 * targets.
 *
 * @example
 * ```ts
 * const err = new AccountInUseError("prod", ["default", "eu-target"]);
 * err.referencedBy; // ["default", "eu-target"]
 * err.code; // "ACCOUNT_IN_USE"
 * ```
 * @see mixpanel_headless.exceptions.AccountInUseError
 */
export class AccountInUseError extends ConfigError {
  readonly #accountName: string;
  readonly #referencedBy: readonly string[];

  /**
   * Initialize AccountInUseError.
   *
   * @param accountName - The account that callers tried to remove.
   * @param referencedBy - Names of targets that reference the account.
   */
  constructor(accountName: string, referencedBy?: readonly string[] | null) {
    const targets = [...(referencedBy ?? [])];
    let message: string;
    if (targets.length > 0) {
      const targetStr = targets.map((t) => `'${t}'`).join(", ");
      message =
        `Account '${accountName}' is referenced by target(s): ${targetStr}. ` +
        `Pass \`force=True\` to remove anyway.`;
    } else {
      message = `Account '${accountName}' is in use. Pass \`force=True\` to remove.`;
    }
    super(
      message,
      { account_name: accountName, referenced_by: targets },
      undefined,
      "ACCOUNT_IN_USE",
    );
    this.#accountName = accountName;
    this.#referencedBy = targets;
  }

  /**
   * The account name that callers tried to remove.
   *
   * @returns The account name that was to be removed.
   */
  get accountName(): string {
    return this.#accountName;
  }

  /**
   * Target names that reference the account.
   *
   * @returns The names of the targets that reference the account.
   */
  get referencedBy(): readonly string[] {
    return this.#referencedBy;
  }
}

// --- Authentication exceptions ---

/** Options bag for {@link AuthenticationError} (fixed code `AUTH_FAILED`). */
export type AuthenticationErrorOptions = HttpErrorOptions;

/**
 * Authentication with the Mixpanel API failed (HTTP 401).
 *
 * Raised when credentials are invalid, expired, or lack required
 * permissions. Inherits from {@link APIError} for full request/response
 * context.
 *
 * @example
 * ```ts
 * try {
 *   await ws.listDashboards();
 * } catch (err) {
 *   if (err instanceof AuthenticationError) {
 *     err.statusCode; // 401
 *     err.code; // "AUTH_FAILED"
 *   }
 * }
 * ```
 * @see mixpanel_headless.exceptions.AuthenticationError
 */
export class AuthenticationError extends APIError {
  /**
   * Initialize AuthenticationError.
   *
   * @param message - Human-readable error message (default
   *   `"Authentication failed"`; not part of the contract).
   * @param options - Keyword-only HTTP context bag; `statusCode`
   *   defaults to 401.
   */
  constructor(
    message: string = "Authentication failed",
    options: AuthenticationErrorOptions = {},
  ) {
    super(message, {
      ...options,
      statusCode: options.statusCode ?? 401,
      code: "AUTH_FAILED",
    });
  }
}

// --- Rate-limit exceptions ---

// Rate-limit lead-collection form. Short forms.gle links can't carry
// prefill query params, so the long-form URL is used whenever the
// project_id is known. (Strings copied from Python; never asserted.)
const RATE_LIMIT_FORM_SHORT_URL = "https://forms.gle/7Y9UcUHe69bh8EgC7";
const RATE_LIMIT_FORM_PREFILL_BASE =
  "https://docs.google.com/forms/d/e/" +
  "1FAIpQLSe8h0ZpB-V3zoK9qeUnUeh7vCs2lvP1IJ6IYMAiayHJ4g5LQA/viewform";
const RATE_LIMIT_FORM_PROJECT_FIELD = "entry.1636741534";

/**
 * Build the URL to the rate-limit-increase request form.
 *
 * When `projectId` is known, returns the long-form Google Form URL with
 * the project id prefilled; otherwise the short link.
 *
 * @param projectId - Active Mixpanel project id, or `null`/empty when
 *   unknown.
 * @returns The project-prefilled long-form URL when `projectId` is
 *   truthy, otherwise the short form link.
 */
function buildRateLimitFormUrl(projectId: string | null): string {
  if (projectId === null || projectId === "") {
    return RATE_LIMIT_FORM_SHORT_URL;
  }
  const query =
    `usp=${encodeURIComponent("pp_url")}` +
    `&${RATE_LIMIT_FORM_PROJECT_FIELD}=${encodeURIComponent(projectId)}`;
  return `${RATE_LIMIT_FORM_PREFILL_BASE}?${query}`;
}

/**
 * Options bag for {@link RateLimitError} — mirrors the Python signature,
 * which (unlike the other APIError subclasses) has no `request_body`
 * parameter.
 */
export interface RateLimitErrorOptions extends Omit<
  HttpErrorContext,
  "requestBody"
> {
  /** Seconds until retry is allowed (from the Retry-After header). */
  readonly retryAfter?: number | null | undefined;
  /** HTTP status code (default 429). */
  readonly statusCode?: number | undefined;
  /** Mixpanel project id active when the limit was hit, if known. */
  readonly projectId?: string | null | undefined;
}

/**
 * Mixpanel API rate limit exceeded (HTTP 429).
 *
 * The {@link retryAfter} accessor indicates when the request can be
 * retried; {@link rateLimitFormUrl} links the rate-limit-increase form.
 *
 * @example
 * ```ts
 * try {
 *   await ws.listDashboards();
 * } catch (err) {
 *   if (err instanceof RateLimitError) {
 *     console.warn(`Retry after ${err.retryAfter ?? "?"} s: ${err.rateLimitFormUrl}`);
 *   }
 * }
 * ```
 * @see mixpanel_headless.exceptions.RateLimitError
 */
export class RateLimitError extends APIError {
  readonly #retryAfter: number | null;
  readonly #projectId: string | null;

  /**
   * Initialize RateLimitError.
   *
   * @param message - Human-readable error message (default
   *   `"Rate limit exceeded"`; not part of the contract).
   * @param options - Keyword-only bag; `statusCode` defaults to 429.
   */
  constructor(
    message: string = "Rate limit exceeded",
    options: RateLimitErrorOptions = {},
  ) {
    const retryAfter = options.retryAfter ?? null;
    const projectId = options.projectId ?? null;
    let finalMessage = message;
    if (retryAfter !== null) {
      finalMessage = `${message}. Retry after ${retryAfter} seconds.`;
    }
    // Appended after the HTTP keys, exactly as Python's post-super
    // `self._details[...] = ...` writes land (absent when `null`).
    const extra: Record<string, unknown> = {};
    if (retryAfter !== null) {
      extra["retry_after"] = retryAfter;
    }
    if (projectId !== null) {
      extra["project_id"] = projectId;
    }
    super(finalMessage, {
      statusCode: options.statusCode ?? 429,
      responseBody: options.responseBody ?? null,
      requestMethod: options.requestMethod ?? null,
      requestUrl: options.requestUrl ?? null,
      requestParams: options.requestParams ?? null,
      code: "RATE_LIMITED",
      cause: options.cause,
      details: extra,
    });
    this.#retryAfter = retryAfter;
    this.#projectId = projectId;
  }

  /**
   * Seconds until retry is allowed, or `null` if unknown.
   *
   * @returns Seconds to wait, or `null` when the header was absent.
   */
  get retryAfter(): number | null {
    return this.#retryAfter;
  }

  /**
   * Mixpanel project id active when the rate limit was hit, if known.
   *
   * @returns The project id, or `null` when unknown.
   */
  get projectId(): string | null {
    return this.#projectId;
  }

  /**
   * URL to request a rate-limit increase.
   *
   * @returns The project-prefilled Google Form URL when the project id is
   *   known, otherwise the short form link.
   */
  get rateLimitFormUrl(): string {
    return buildRateLimitFormUrl(this.#projectId);
  }
}

// --- Query exceptions ---

/**
 * Event name not found in the Mixpanel project.
 *
 * Includes suggestions for similar event names to help users correct
 * typos or case mismatches.
 *
 * @example
 * ```ts
 * const err = new EventNotFoundError("Sign Up", ["Signup", "Sign-up"]);
 * err.message; // "Event 'Sign Up' not found. Did you mean: 'Signup', 'Sign-up'?"
 * err.similarEvents; // ["Signup", "Sign-up"]
 * ```
 * @see mixpanel_headless.exceptions.EventNotFoundError
 */
export class EventNotFoundError extends MixpanelHeadlessError {
  readonly #eventName: string;
  readonly #similarEvents: readonly string[];

  /**
   * Initialize EventNotFoundError.
   *
   * @param eventName - The event name that was not found.
   * @param similarEvents - List of similar event names to suggest.
   */
  constructor(eventName: string, similarEvents?: readonly string[] | null) {
    const similar = [...(similarEvents ?? [])];
    let message = `Event '${eventName}' not found.`;
    if (similar.length > 0) {
      const suggestions = similar
        .slice(0, 5)
        .map((e) => `'${e}'`)
        .join(", ");
      message += ` Did you mean: ${suggestions}?`;
    }
    super(message, "EVENT_NOT_FOUND", {
      event_name: eventName,
      similar_events: similar,
    });
    this.#eventName = eventName;
    this.#similarEvents = similar;
  }

  /**
   * The event name that was not found.
   *
   * @returns The event name that was looked up.
   */
  get eventName(): string {
    return this.#eventName;
  }

  /**
   * List of similar event names.
   *
   * @returns Similar event names, possibly empty.
   */
  get similarEvents(): readonly string[] {
    return this.#similarEvents;
  }
}

/** Options bag for {@link QueryError} (fixed code `QUERY_FAILED`). */
export type QueryErrorOptions = HttpErrorOptions;

/**
 * Query execution failed (HTTP 400 or query-specific error).
 *
 * Raised when an API query fails due to invalid parameters, syntax
 * errors, or other query-specific issues.
 *
 * @example
 * ```ts
 * try {
 *   await ws.listDashboards();
 * } catch (err) {
 *   if (err instanceof QueryError) {
 *     console.error(err.statusCode, err.responseBody);
 *   }
 * }
 * ```
 * @see mixpanel_headless.exceptions.QueryError
 */
export class QueryError extends APIError {
  /**
   * Initialize QueryError.
   *
   * @param message - Human-readable error message (default
   *   `"Query execution failed"`; not part of the contract).
   * @param options - Keyword-only HTTP context bag; `statusCode`
   *   defaults to 400.
   */
  constructor(
    message: string = "Query execution failed",
    options: QueryErrorOptions = {},
  ) {
    super(message, {
      ...options,
      statusCode: options.statusCode ?? 400,
      code: "QUERY_FAILED",
    });
  }
}

/** Options bag for {@link ServerError} (fixed code `SERVER_ERROR`). */
export type ServerErrorOptions = HttpErrorOptions;

/**
 * Mixpanel server error (HTTP 5xx).
 *
 * Typically transient; the {@link APIError.responseBody} often carries
 * actionable information.
 *
 * @example
 * ```ts
 * try {
 *   await ws.listDashboards();
 * } catch (err) {
 *   if (err instanceof ServerError) {
 *     console.error(err.statusCode); // 500, 502, 503, …
 *   }
 * }
 * ```
 * @see mixpanel_headless.exceptions.ServerError
 */
export class ServerError extends APIError {
  /**
   * Initialize ServerError.
   *
   * @param message - Human-readable error message (default
   *   `"Server error"`; not part of the contract).
   * @param options - Keyword-only HTTP context bag; `statusCode`
   *   defaults to 500.
   */
  constructor(
    message: string = "Server error",
    options: ServerErrorOptions = {},
  ) {
    super(message, {
      ...options,
      statusCode: options.statusCode ?? 500,
      code: "SERVER_ERROR",
    });
  }
}

// --- Validation exceptions ---

/**
 * Date range exceeds the maximum allowed by the Mixpanel API.
 *
 * The Mixpanel Export API limits requests to 100 days maximum; split
 * large date ranges into smaller chunks.
 *
 * @example
 * ```ts
 * const err = new DateRangeTooLargeError("2026-01-01", "2026-06-30", 181);
 * err.details;
 * // { from_date: "2026-01-01", to_date: "2026-06-30", days_requested: 181, max_days: 100 }
 * ```
 * @see mixpanel_headless.exceptions.DateRangeTooLargeError
 */
export class DateRangeTooLargeError extends MixpanelHeadlessError {
  readonly #fromDate: string;
  readonly #toDate: string;
  readonly #daysRequested: number;
  readonly #maxDays: number;

  /**
   * Initialize DateRangeTooLargeError.
   *
   * @param fromDate - Start date that was requested.
   * @param toDate - End date that was requested.
   * @param daysRequested - Number of days in the requested range.
   * @param maxDays - Maximum allowed days (default: 100).
   */
  constructor(
    fromDate: string,
    toDate: string,
    daysRequested: number,
    maxDays: number = 100,
  ) {
    super(
      `Date range from ${fromDate} to ${toDate} spans ${daysRequested} days, ` +
        `but maximum is ${maxDays} days. Split your request into smaller chunks.`,
      "DATE_RANGE_TOO_LARGE",
      {
        from_date: fromDate,
        to_date: toDate,
        days_requested: daysRequested,
        max_days: maxDays,
      },
    );
    this.#fromDate = fromDate;
    this.#toDate = toDate;
    this.#daysRequested = daysRequested;
    this.#maxDays = maxDays;
  }

  /**
   * Start date that was requested.
   *
   * @returns The requested start date.
   */
  get fromDate(): string {
    return this.#fromDate;
  }

  /**
   * End date that was requested.
   *
   * @returns The requested end date.
   */
  get toDate(): string {
    return this.#toDate;
  }

  /**
   * Number of days in the requested range.
   *
   * @returns The number of days in the requested range.
   */
  get daysRequested(): number {
    return this.#daysRequested;
  }

  /**
   * Maximum allowed days.
   *
   * @returns The maximum allowed number of days.
   */
  get maxDays(): number {
    return this.#maxDays;
  }
}

// --- OAuth exceptions ---

/**
 * OAuth authentication flow error.
 *
 * Raised for failures during the OAuth 2.0 PKCE flow, including token
 * exchange, token refresh, client registration, callback timeout, port
 * unavailability, and browser launch failures. Known codes:
 * `OAUTH_TOKEN_ERROR`, `OAUTH_REFRESH_ERROR`, `OAUTH_REGISTRATION_ERROR`,
 * `OAUTH_TIMEOUT`, `OAUTH_PORT_ERROR`, `OAUTH_BROWSER_ERROR`.
 *
 * @example
 * ```ts
 * const err = new OAuthError("No callback within 300 s", "OAUTH_TIMEOUT");
 * err.code; // "OAUTH_TIMEOUT"
 * ```
 * @see mixpanel_headless.exceptions.OAuthError
 */
export class OAuthError extends MixpanelHeadlessError {
  /**
   * Initialize OAuthError.
   *
   * @param message - Human-readable message; not part of the contract.
   * @param code - Machine-readable error code (default
   *   `"OAUTH_TOKEN_ERROR"`).
   * @param details - Additional structured data about the error.
   * @param options - Standard `ErrorOptions` (`cause` threading).
   */
  constructor(
    message: string,
    code: string = "OAUTH_TOKEN_ERROR",
    details?: Readonly<Record<string, unknown>> | null,
    options?: ErrorOptions,
  ) {
    super(message, code, details, options);
  }
}

/**
 * One region-probe attempt: `[region, statusCode, errorBody]`. A status
 * code of `0` indicates the request never reached the server (network
 * error).
 */
export type RegionProbeAttempt = readonly [Region, number, string];

/** Keyword-only options bag for {@link RegionProbeError}. */
export interface RegionProbeErrorOptions {
  /**
   * Ordered list of `(region, statusCode, errorBody)` tuples for every
   * probed region.
   */
  readonly attempts: readonly RegionProbeAttempt[];
  /** Machine-readable code (default `"OAUTH_REGION_PROBE_FAILED"`). */
  readonly code?: string | undefined;
}

/**
 * Raised when no region accepts the credential during region probing.
 *
 * Carries the full attempt list for diagnostic use. See
 * {@link RegionProbeNetworkError} for the all-network-error subclass.
 *
 * @example
 * ```ts
 * const err = new RegionProbeError("No region accepted the credential", {
 *   attempts: [
 *     ["us", 401, "invalid token"],
 *     ["eu", 401, "invalid token"],
 *   ],
 * });
 * err.toDict().attempts; // [["us", 401, "invalid token"], ["eu", 401, "invalid token"]]
 * ```
 * @see mixpanel_headless.exceptions.RegionProbeError
 */
export class RegionProbeError extends OAuthError {
  readonly #attempts: readonly RegionProbeAttempt[];

  /**
   * Initialize RegionProbeError.
   *
   * @param message - Human-readable message; not part of the contract.
   * @param options - Keyword-only bag: `attempts` (required) and `code`.
   */
  constructor(message: string, options: RegionProbeErrorOptions) {
    const attempts: readonly RegionProbeAttempt[] = options.attempts.map(
      (a) => [a[0], a[1], a[2]] as const,
    );
    super(message, options.code ?? "OAUTH_REGION_PROBE_FAILED", {
      attempts: attempts.map((a) => [...a]),
    });
    this.#attempts = attempts;
  }

  /**
   * Ordered list of `(region, statusCode, errorBody)` tuples (a copy).
   *
   * @returns A fresh copy of the attempt list.
   */
  get attempts(): readonly RegionProbeAttempt[] {
    return [...this.#attempts];
  }

  /**
   * Serialize the exception to a JSON-friendly dict.
   *
   * Includes `attempts` at the top level (each entry a 3-element array)
   * so consumers can inspect per-region outcomes without unpacking
   * `details` — exactly as Python's override does.
   *
   * @returns Dictionary with keys `code`, `message`, `details`, `attempts`.
   */
  override toDict(): ErrorDict & { attempts: Array<Array<string | number>> } {
    return {
      ...super.toDict(),
      attempts: this.#attempts.map((a) => [...a]),
    };
  }
}

/**
 * Raised when every region probe attempt failed at the network layer.
 *
 * Used when all recorded attempts have `statusCode === 0` — the
 * credential was never evaluated because no region was reachable. Carries
 * the same `attempts` shape as the parent.
 *
 * @example
 * ```ts
 * const err = new RegionProbeNetworkError("No region reachable", {
 *   attempts: [
 *     ["us", 0, "ECONNREFUSED"],
 *     ["eu", 0, "ECONNREFUSED"],
 *   ],
 * });
 * err.code; // "OAUTH_NETWORK_UNREACHABLE"
 * ```
 * @see mixpanel_headless.exceptions.RegionProbeNetworkError
 */
export class RegionProbeNetworkError extends RegionProbeError {
  /**
   * Initialize RegionProbeNetworkError.
   *
   * @param message - Human-readable message; not part of the contract.
   * @param options - Keyword-only bag whose `attempts` entries all have
   *   status `0` by construction; the probe loop only raises this subclass
   *   when that invariant holds.
   */
  constructor(
    message: string,
    options: { readonly attempts: readonly RegionProbeAttempt[] },
  ) {
    super(message, {
      attempts: options.attempts,
      code: "OAUTH_NETWORK_UNREACHABLE",
    });
  }
}

/**
 * Scope resolution error (workspace or organization).
 *
 * Raised when an auth-axis identifier cannot be resolved during App API
 * requests. Known codes: `NO_WORKSPACES`, `AMBIGUOUS_WORKSPACE`,
 * `WORKSPACE_NOT_FOUND`, `ORGANIZATION_AMBIGUOUS`.
 *
 * @example
 * ```ts
 * const err = new WorkspaceScopeError(
 *   "Project 123 has 3 workspaces; pass workspace_id",
 *   "AMBIGUOUS_WORKSPACE",
 *   { workspace_ids: [1, 2, 3] },
 * );
 * err.code; // "AMBIGUOUS_WORKSPACE"
 * ```
 * @see mixpanel_headless.exceptions.WorkspaceScopeError
 */
export class WorkspaceScopeError extends MixpanelHeadlessError {
  /**
   * Initialize WorkspaceScopeError.
   *
   * @param message - Human-readable message; not part of the contract.
   * @param code - Machine-readable error code (default `"NO_WORKSPACES"`).
   * @param details - Additional structured data about the error.
   * @param options - Standard `ErrorOptions` (`cause` threading).
   */
  constructor(
    message: string,
    code: string = "NO_WORKSPACES",
    details?: Readonly<Record<string, unknown>> | null,
    options?: ErrorOptions,
  ) {
    super(message, code, details, options);
  }
}

// --- Business-context validation ---

/**
 * Business-context content failed client-side validation.
 *
 * Raised when supplied content exceeds `BUSINESS_CONTEXT_MAX_CHARS`
 * (50,000 characters). The `details` dict carries `length` and `max`.
 *
 * @example
 * ```ts
 * const err = new BusinessContextValidationError(
 *   "Business context exceeds 50,000 characters",
 *   { length: 51234, max: 50000 },
 * );
 * err.code; // "BUSINESS_CONTEXT_TOO_LONG"
 * ```
 * @see mixpanel_headless.exceptions.BusinessContextValidationError
 */
export class BusinessContextValidationError extends MixpanelHeadlessError {
  /**
   * Initialize BusinessContextValidationError.
   *
   * @param message - Human-readable message; not part of the contract.
   * @param details - Additional structured data — typically `length` and
   *   `max`.
   * @param options - Standard `ErrorOptions` (`cause` threading).
   */
  constructor(
    message: string,
    details?: Readonly<Record<string, unknown>> | null,
    options?: ErrorOptions,
  ) {
    super(message, "BUSINESS_CONTEXT_TOO_LONG", details, options);
  }
}

// --- Bookmark validation ---

/** Severity of a {@link ValidationError} finding. */
export type ValidationSeverity = "error" | "warning";

/**
 * A single validation issue found in query arguments or bookmark params.
 *
 * Not an exception: Python defines it as a frozen dataclass and it ports as
 * a plain class. It rides inside {@link BookmarkValidationError.errors} and
 * oracle error payloads. There is no `field` attribute; the field list
 * mirrors the Python dataclass exactly.
 *
 * @example
 * ```ts
 * const finding = new ValidationError(
 *   "$.sections.show[0].math",
 *   "Unknown math type 'avg'",
 *   "B9_INVALID_MATH",
 *   "error",
 *   ["average"],
 * );
 * finding.toString();
 * // "[ERROR] $.sections.show[0].math: Unknown math type 'avg' Did you mean 'average'?"
 * finding.toDict();
 * // { path: "$.sections.show[0].math", message: "Unknown math type 'avg'",
 * //   code: "B9_INVALID_MATH", severity: "error", suggestion: ["average"] }
 * ```
 * @see mixpanel_headless.exceptions.ValidationError
 */
export class ValidationError {
  /** JSONPath-like location of the error. */
  readonly path: string;

  /** Human-readable description of the issue. */
  readonly message: string;

  /** Machine-readable error code for programmatic handling. */
  readonly code: string;

  /** `"error"` blocks execution; `"warning"` is informational. */
  readonly severity: ValidationSeverity;

  /** Fuzzy-matched valid alternatives, if applicable. */
  readonly suggestion: readonly string[] | null;

  /** JSON structure template to correct the error, if applicable. */
  readonly fix: Readonly<Record<string, unknown>> | null;

  /**
   * Initialize a validation finding (positional parameters mirror the
   * Python dataclass field order).
   *
   * @param path - JSONPath-like location of the error.
   * @param message - Human-readable description of the issue.
   * @param code - Machine-readable error code (default
   *   `"VALIDATION_ERROR"`).
   * @param severity - `"error"` (default) or `"warning"`.
   * @param suggestion - Fuzzy-matched valid alternatives (default `null`).
   * @param fix - JSON structure template to correct the error (default
   *   `null`).
   */
  // eslint-disable-next-line max-params -- positional parameters mirror the Python signature 1:1
  constructor(
    path: string,
    message: string,
    code: string = "VALIDATION_ERROR",
    severity: ValidationSeverity = "error",
    suggestion: readonly string[] | null = null,
    fix: Readonly<Record<string, unknown>> | null = null,
  ) {
    this.path = path;
    this.message = message;
    this.code = code;
    this.severity = severity;
    this.suggestion = suggestion;
    this.fix = fix;
  }

  /**
   * Serialize for JSON output.
   *
   * Always emits `path`, `message`, `code`, `severity`; adds `suggestion`
   * (tuple → JSON array) and `fix` only when non-null — byte-matching
   * Python's `to_dict`.
   *
   * @returns Dictionary with the non-null ValidationError fields.
   */
  toDict(): Record<string, unknown> {
    const result: Record<string, unknown> = {
      path: this.path,
      message: this.message,
      code: this.code,
      severity: this.severity,
    };
    if (this.suggestion !== null) {
      result["suggestion"] = [...this.suggestion];
    }
    if (this.fix !== null) {
      result["fix"] = this.fix;
    }
    return result;
  }

  /**
   * Return the formatted error string (Python `__str__`; display only,
   * not part of the contract).
   *
   * @returns Formatted string with severity prefix, path, and message.
   */
  toString(): string {
    const prefix = this.severity === "warning" ? "WARNING" : "ERROR";
    let s = `[${prefix}] ${this.path}: ${this.message}`;
    // Python truthiness: `if self.suggestion` is false for `None` and `()` alike.
    const first = this.suggestion?.[0];
    if (first !== undefined) {
      s += ` Did you mean '${first}'?`;
    }
    return s;
  }
}

/**
 * Bookmark params failed validation.
 *
 * Contains every validation error found, enabling callers to fix multiple
 * issues in a single pass.
 *
 * @example
 * ```ts
 * const err = new BookmarkValidationError([
 *   new ValidationError("$.sections", "Missing required field: sections", "B1_MISSING_SECTIONS"),
 * ]);
 * err.errorCount; // 1
 * err.warningCount; // 0
 * err.details["error_count"]; // 1
 * ```
 * @see mixpanel_headless.exceptions.BookmarkValidationError
 */
export class BookmarkValidationError extends MixpanelHeadlessError {
  readonly #errors: readonly ValidationError[];
  readonly #errorCount: number;
  readonly #warningCount: number;

  /**
   * Initialize BookmarkValidationError.
   *
   * @param errors - Sequence of validation errors found. Must contain at
   *   least one with severity `"error"`.
   */
  constructor(errors: readonly ValidationError[]) {
    const all = [...errors];
    const errorCount = all.filter((e) => e.severity === "error").length;
    const warningCount = all.filter((e) => e.severity === "warning").length;

    const parts: string[] = [];
    for (const err of all) {
      if (err.severity === "error") {
        parts.push(`  ${err.toString()}`);
      }
    }
    const summary = parts.join("\n");
    const message =
      `Bookmark validation failed with ${errorCount} error(s)` +
      ` and ${warningCount} warning(s):\n${summary}`;

    super(message, "BOOKMARK_VALIDATION_ERROR", {
      error_count: errorCount,
      warning_count: warningCount,
      errors: all.map((e) => e.toDict()),
    });
    this.#errors = all;
    this.#errorCount = errorCount;
    this.#warningCount = warningCount;
  }

  /**
   * All validation errors found (both errors and warnings).
   *
   * @returns Every finding, errors and warnings alike.
   */
  get errors(): readonly ValidationError[] {
    return this.#errors;
  }

  /**
   * Number of severity `"error"` items.
   *
   * @returns The number of findings with severity `"error"`.
   */
  get errorCount(): number {
    return this.#errorCount;
  }

  /**
   * Number of severity `"warning"` items.
   *
   * @returns The number of findings with severity `"warning"`.
   */
  get warningCount(): number {
    return this.#warningCount;
  }
}

// --- Session-replay exceptions ---

/**
 * Options bag for {@link SessionReplayError} and subclasses: the full
 * APIError context (all optional — status/code fall back to per-class
 * defaults) plus a replay-specific `details` dict merged on top.
 */
export interface SessionReplayErrorOptions extends HttpErrorContext {
  /** Replay-specific structured context (appended to `details`). */
  readonly details?: Readonly<Record<string, unknown>> | null | undefined;
  /** HTTP status; defaults to the subclass's default status. */
  readonly statusCode?: number | null | undefined;
  /** Machine-readable code; defaults to the subclass's default code. */
  readonly code?: string | null | undefined;
}

/**
 * Base class for session-replay-specific failures.
 *
 * Subclasses override the static default code/status pair, mirroring the
 * Python `_DEFAULT_CODE` / `_DEFAULT_STATUS` class attributes (read via
 * `new.target` so the most-derived class wins, exactly like Python's
 * `self._DEFAULT_CODE`). Because this is an {@link APIError}, generic
 * `instanceof APIError` handlers continue to catch these.
 *
 * @example
 * ```ts
 * const err = new SessionReplayError("CDN fetch failed", {
 *   statusCode: 502,
 *   details: { replay_id: "abc-123" },
 * });
 * err.details; // { status_code: 502, replay_id: "abc-123" }
 * ```
 * @see mixpanel_headless.exceptions.SessionReplayError
 */
export class SessionReplayError extends APIError {
  /** Default machine code when the constructor receives none. */
  protected static readonly defaultCode: string = "SESSION_REPLAY_ERROR";

  /** Default HTTP status when the constructor receives none. */
  protected static readonly defaultStatus: number = 500;

  /**
   * Initialize SessionReplayError.
   *
   * @param message - Human-readable message; not part of the contract.
   * @param options - Keyword-only bag; `statusCode`/`code` default to the
   *   most-derived class's static defaults; `details` is appended to the
   *   APIError details dict after the HTTP keys, exactly where Python's
   *   `self._details.update(details)` lands them.
   */
  constructor(message: string, options: SessionReplayErrorOptions = {}) {
    const ctor = new.target;
    super(message, {
      statusCode: options.statusCode ?? ctor.defaultStatus,
      responseBody: options.responseBody ?? null,
      requestMethod: options.requestMethod ?? null,
      requestUrl: options.requestUrl ?? null,
      requestParams: options.requestParams ?? null,
      requestBody: options.requestBody ?? null,
      code: options.code ?? ctor.defaultCode,
      cause: options.cause,
      details: options.details ?? null,
    });
  }
}

/**
 * Project has SESSION_RECORDING_SENSITIVE_DATA enabled and the caller
 * lacks access (bulk-sign endpoint 403).
 *
 * @example
 * ```ts
 * const err = new SessionReplayAccessError("Replay access denied");
 * err.code; // "SESSION_REPLAY_ACCESS_ERROR"
 * err.statusCode; // 403
 * ```
 * @see mixpanel_headless.exceptions.SessionReplayAccessError
 */
export class SessionReplayAccessError extends SessionReplayError {
  /** Error code this class reports by default. */
  protected static override readonly defaultCode: string =
    "SESSION_REPLAY_ACCESS_ERROR";

  /** HTTP status this class reports by default. */
  protected static override readonly defaultStatus: number = 403;
}

/**
 * Signed CDN URL passed to a fetch has expired (5-minute TTL).
 *
 * @example
 * ```ts
 * const err = new SignedURLExpiredError("Signed URL expired");
 * err.code; // "SIGNED_URL_EXPIRED"
 * err.statusCode; // 403
 * ```
 * @see mixpanel_headless.exceptions.SignedURLExpiredError
 */
export class SignedURLExpiredError extends SessionReplayError {
  /** Error code this class reports by default. */
  protected static override readonly defaultCode: string = "SIGNED_URL_EXPIRED";

  /** HTTP status this class reports by default. */
  protected static override readonly defaultStatus: number = 403;
}

/**
 * No CDN bytes found for a requested replay (404 on the first file).
 *
 * @example
 * ```ts
 * const err = new ReplayNotFoundError("No replay bytes for abc-123", {
 *   details: { replay_id: "abc-123" },
 * });
 * err.code; // "REPLAY_NOT_FOUND"
 * err.statusCode; // 404
 * ```
 * @see mixpanel_headless.exceptions.ReplayNotFoundError
 */
export class ReplayNotFoundError extends SessionReplayError {
  /** Error code this class reports by default. */
  protected static override readonly defaultCode: string = "REPLAY_NOT_FOUND";

  /** HTTP status this class reports by default. */
  protected static override readonly defaultStatus: number = 404;
}

/**
 * Replay bytes are not in rrweb format (mobile or other non-web
 * recording). Default status 501 (Not Implemented): no HTTP request
 * failed, the format simply isn't supported yet.
 *
 * @example
 * ```ts
 * const err = new UnsupportedReplayFormatError("Not an rrweb recording");
 * err.code; // "UNSUPPORTED_REPLAY_FORMAT"
 * err.statusCode; // 501
 * ```
 * @see mixpanel_headless.exceptions.UnsupportedReplayFormatError
 */
export class UnsupportedReplayFormatError extends SessionReplayError {
  /** Error code this class reports by default. */
  protected static override readonly defaultCode: string =
    "UNSUPPORTED_REPLAY_FORMAT";

  /** HTTP status this class reports by default. */
  protected static override readonly defaultStatus: number = 501;
}

// --- Report-link exceptions ---

/** Options bag shared by the {@link ReportLinkError} family (Python kw-only). */
export interface ReportLinkErrorOptions {
  /** Machine-readable code; defaults to the subclass's default code. */
  readonly code?: string | null | undefined;
  /**
   * Parsed link fields that are available (`kind`, `region`,
   * `project_id`, `workspace_id`, `slug`, `bookmark_id`, `short_code`)
   * plus `hint` when one exists. Snake_case keys (wire spelling).
   */
  readonly details?: Readonly<Record<string, unknown>> | null | undefined;
  /** Underlying cause, threaded to `Error#cause`. */
  readonly cause?: unknown;
}

/**
 * Base class for report-link failures.
 *
 * Report links are Mixpanel web URLs that open a report in the browser.
 * Most failures in this family are local — a link that does not parse,
 * a link that points at another project or region, or a link kind that
 * headless cannot resolve — so the base is {@link MixpanelHeadlessError}
 * rather than {@link APIError}. The HTTP-shaped failures,
 * {@link ReportLinkNotFoundError} and {@link ShortLinkResolutionError},
 * carry the parsed link fields in `details` instead of HTTP context.
 *
 * Not in this family: the pure URL builders and `createReportLink`
 * input guards throw {@link ParamValidationError} with the codes
 * `RL1_UNKNOWN_REPORT_TYPE`, `RL2_INVALID_SLUG`, `RL3_UNKNOWN_REGION`,
 * `RL4_REPORT_TYPE_CONFLICT`, `RL5_RESOLVED_REPORT_INCONSISTENT`, and
 * `RL6_INVALID_ID`. An `instanceof ReportLinkError` check does not catch
 * them. Every failure in this family carries a `hint` in `details`.
 *
 * Subclasses override the static default code, mirroring the Python
 * `_DEFAULT_CODE` class attribute (read via `new.target` so the
 * most-derived class wins).
 *
 * @example
 * ```ts
 * try {
 *   await ws.queryReportLink(url);
 * } catch (err) {
 *   if (err instanceof ReportLinkError) {
 *     console.error(err.code, err.details["hint"]);
 *   }
 * }
 * ```
 * @see mixpanel_headless.exceptions.ReportLinkError
 */
export class ReportLinkError extends MixpanelHeadlessError {
  /** Default machine code when the constructor receives none. */
  protected static readonly defaultCode: string = "REPORT_LINK_ERROR";

  /**
   * Initialize a report-link error.
   *
   * @param message - Human-readable message; not part of the contract.
   * @param options - Keyword-only bag; `code` defaults to the
   *   most-derived class's static default.
   */
  constructor(message: string, options: ReportLinkErrorOptions = {}) {
    const ctor = new.target;
    super(
      message,
      options.code ?? ctor.defaultCode,
      options.details ?? null,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
  }
}

/**
 * The input string is not a recognizable Mixpanel report link.
 *
 * Codes: `REPORT_LINK_UNPARSEABLE` (default),
 * `REPORT_LINK_NOT_MIXPANEL_HOST`, `REPORT_LINK_UNRECOGNIZED_PATH`,
 * `REPORT_LINK_UNRECOGNIZED_HASH`, `REPORT_LINK_EMPTY_HASH`. The parser
 * is total: this is the only exception it throws for any input string.
 *
 * @example
 * ```ts
 * const err = new ReportLinkParseError("Not a Mixpanel host", {
 *   code: "REPORT_LINK_NOT_MIXPANEL_HOST",
 *   details: { hint: "Expected mixpanel.com or eu.mixpanel.com" },
 * });
 * err.code; // "REPORT_LINK_NOT_MIXPANEL_HOST"
 * ```
 * @see mixpanel_headless.exceptions.ReportLinkParseError
 */
export class ReportLinkParseError extends ReportLinkError {
  /** Error code this class reports by default. */
  protected static override readonly defaultCode: string =
    "REPORT_LINK_UNPARSEABLE";
}

/**
 * The link was recognized but headless cannot resolve or run it.
 *
 * Codes: `UNSUPPORTED_REPORT_LINK` (default), `UNSUPPORTED_LEGACY_HASH`
 * (a `~(...)` JSURL hash), `UNSUPPORTED_DASHBOARD_LINK` (a board, not a
 * single report), `UNSUPPORTED_REPORT_TYPE` (for example
 * `launch-analysis` passed to `queryReportLink`).
 *
 * @example
 * ```ts
 * const err = new UnsupportedReportLinkError("Boards cannot be queried", {
 *   code: "UNSUPPORTED_DASHBOARD_LINK",
 *   details: { kind: "board", hint: "Open one of the board's reports instead" },
 * });
 * err.code; // "UNSUPPORTED_DASHBOARD_LINK"
 * ```
 * @see mixpanel_headless.exceptions.UnsupportedReportLinkError
 */
export class UnsupportedReportLinkError extends ReportLinkError {
  /** Error code this class reports by default. */
  protected static override readonly defaultCode: string =
    "UNSUPPORTED_REPORT_LINK";
}

/**
 * The slug, saved report, or shortlink does not exist in scope.
 *
 * Codes: `REPORT_LINK_NOT_FOUND` (default), `REPORT_LINK_SLUG_NOT_FOUND`,
 * `REPORT_LINK_BOOKMARK_NOT_FOUND`, `SHORT_LINK_NOT_FOUND`. A slug is
 * readable only in the project and region that created it, so a 404 on
 * a slug often means the caller is on the wrong project.
 *
 * @example
 * ```ts
 * const err = new ReportLinkNotFoundError("Slug not found", {
 *   code: "REPORT_LINK_SLUG_NOT_FOUND",
 *   details: { slug: "abc123", project_id: 123, hint: "Check the project" },
 * });
 * err.code; // "REPORT_LINK_SLUG_NOT_FOUND"
 * ```
 * @see mixpanel_headless.exceptions.ReportLinkNotFoundError
 */
export class ReportLinkNotFoundError extends ReportLinkError {
  /** Error code this class reports by default. */
  protected static override readonly defaultCode: string =
    "REPORT_LINK_NOT_FOUND";
}

/**
 * The link names a project or region other than the active session.
 *
 * Codes: `REPORT_LINK_SCOPE_MISMATCH` (default),
 * `REPORT_LINK_PROJECT_MISMATCH`, `REPORT_LINK_REGION_MISMATCH`,
 * `REPORT_LINK_WORKSPACE_MISMATCH` (only when the session pins a
 * workspace and the link names a different one). The region check runs
 * before any HTTP call. The project and workspace checks run before the
 * record fetch; for a shortlink that is after the one redirect GET,
 * because the target is not known before it.
 *
 * @example
 * ```ts
 * const err = new ReportLinkScopeMismatchError("Link is for project 456", {
 *   code: "REPORT_LINK_PROJECT_MISMATCH",
 *   details: { project_id: 456, hint: "Switch to project 456" },
 * });
 * err.code; // "REPORT_LINK_PROJECT_MISMATCH"
 * ```
 * @see mixpanel_headless.exceptions.ReportLinkScopeMismatchError
 */
export class ReportLinkScopeMismatchError extends ReportLinkError {
  /** Error code this class reports by default. */
  protected static override readonly defaultCode: string =
    "REPORT_LINK_SCOPE_MISMATCH";
}

/**
 * A `/s/{code}` shortlink could not be expanded to a full report URL.
 *
 * Codes: `SHORT_LINK_RESOLUTION_ERROR` (default), `SHORT_LINK_NO_LOCATION`
 * (3xx without `Location`), `SHORT_LINK_UNEXPECTED_RESPONSE` (200 body
 * without the `window.location.href` script), `SHORT_LINK_CHAIN` (the
 * target is another shortlink; headless follows one redirect only).
 *
 * @example
 * ```ts
 * const err = new ShortLinkResolutionError("Redirect had no Location", {
 *   code: "SHORT_LINK_NO_LOCATION",
 *   details: { short_code: "k3Fz9", hint: "The shortlink may have been deleted" },
 * });
 * err.code; // "SHORT_LINK_NO_LOCATION"
 * ```
 * @see mixpanel_headless.exceptions.ShortLinkResolutionError
 */
export class ShortLinkResolutionError extends ReportLinkError {
  /** Error code this class reports by default. */
  protected static override readonly defaultCode: string =
    "SHORT_LINK_RESOLUTION_ERROR";
}
