/**
 * Exception hierarchy for `@mixpanel-headless/core` — the TS port of
 * `mixpanel_headless/exceptions.py` (phase2-design C3, rulebook R5.1/R5.2).
 *
 * All 28 Python exception classes port as `Error` subclasses preserving
 * names and the parent-edge set; the conformance key is class name +
 * machine `code` (R5.2). Error MESSAGE text is explicitly out of contract
 * (R5.4): the human-readable strings below are copied from Python for
 * fidelity but are never asserted by vectors.
 *
 * Python's dual inheritance (`ParamValidationError(MixpanelHeadlessError,
 * ValueError)`) has no JS analog and none is needed — `except ValueError`
 * reachability is a Python-side compatibility concern only.
 *
 * The registry constants (`CODED_GUARD_REGISTRY`, `CODED_GUARD_TWIN_CODES`)
 * are re-exported from the generated `errors-codes.gen.ts` mirror of
 * `conformance-runner/corpus/contract/error-codes.json` — never hand-typed.
 *
 * The rulebook R5.1 client-tier transport class (`MixpanelHttpError`)
 * lives in `client/internals.ts` since Phase-3 B0-2 (the B0 retry loops'
 * catch clauses need it); it mirrors `httpx.HTTPError` and is deliberately
 * OUTSIDE this hierarchy. `MixpanelApiError` remains deferred to B4
 * (phase2-design C3/C8).
 */

export {
  CODED_GUARD_REGISTRY,
  CODED_GUARD_TWIN_CODES,
} from "./errors-codes.gen.js";

/** Serialized error shape produced by {@link MixpanelHeadlessError.toDict}. */
export interface ErrorDict {
  /** Machine-readable error code. */
  code: string;
  /** Human-readable error message (out of contract, R5.4). */
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
 */
export class MixpanelHeadlessError extends Error {
  /** Machine-readable error code (subclasses may override post-super). */
  protected _code: string;

  /**
   * Additional structured error data. Keys entering this bag keep their
   * Python snake_case spelling — it is serialized into `toDict()` output
   * and compared by the conformance canonicalizer (R7.6 wire exception).
   */
  protected readonly _details: Record<string, unknown>;

  /**
   * Initialize the exception.
   *
   * @param message - Human-readable error message (out of contract, R5.4).
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
    this.name = this.constructor.name;
    this._code = code;
    this._details = { ...details };
  }

  /** Machine-readable error code. */
  get code(): string {
    return this._code;
  }

  /** Additional structured error data (snake_case keys). */
  get details(): Readonly<Record<string, unknown>> {
    return this._details;
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
      code: this._code,
      message: this.message,
      details: this._details,
    };
  }
}

// ---------------------------------------------------------------------------
// Coded guard errors (E2 coding pass) — registry-coded argument guards.
// ---------------------------------------------------------------------------

/**
 * A builder/facade argument guard rejected a value (registry-coded).
 *
 * Python dual-inherits `ValueError` so converted guard sites stay
 * catchable by `except ValueError`; in TS the conformance key is class
 * name + `code` (R5.2), so plain `MixpanelHeadlessError` descent suffices.
 *
 * Example:
 * ```ts
 * try {
 *   Filter.on("plan").inTheLast(0, "days");
 * } catch (exc) {
 *   (exc as ParamValidationError).code; // "FD1_QUANTITY_NOT_POSITIVE"
 * }
 * ```
 */
export class ParamValidationError extends MixpanelHeadlessError {
  /**
   * Initialize the coded guard error.
   *
   * @param message - Human-readable error message (out of contract, R5.4).
   * @param code - Machine-readable registry code for the violated rule.
   *   Defaults to the generic `VALIDATION_ERROR` (R5.5 construction-path
   *   fallback).
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
 * A builder/facade argument guard rejected a value's TYPE (registry-coded).
 *
 * Python dual-inherits `TypeError`; see {@link ParamValidationError} for
 * why the TS port needs only `MixpanelHeadlessError` descent.
 */
export class ParamTypeError extends MixpanelHeadlessError {
  /**
   * Initialize the coded guard error.
   *
   * @param message - Human-readable error message (out of contract, R5.4).
   * @param code - Machine-readable registry code for the violated rule.
   *   Defaults to the generic `VALIDATION_ERROR` (R5.5).
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
 */
export class ResponseValidationError extends MixpanelHeadlessError {
  /**
   * Initialize the response validation error.
   *
   * @param message - Human-readable error message (out of contract, R5.4).
   * @param code - Machine-readable error code. Defaults to the generic
   *   `RESPONSE_VALIDATION_ERROR` (R5.5).
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

// ---------------------------------------------------------------------------
// API exceptions — base class for HTTP errors.
// ---------------------------------------------------------------------------

/**
 * Keyword-only options bag for {@link APIError} (Python `*`-marked params,
 * R3.8). Bag keys are camelCase (pure argument bag, R3.6); the derived
 * `details` dict keeps the Python snake_case spelling.
 */
export interface APIErrorOptions {
  /** HTTP status code from the response. */
  readonly statusCode: number;
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
  /** Machine-readable error code. */
  readonly code?: string | undefined;
  /** Underlying cause, threaded to `Error#cause`. */
  readonly cause?: unknown;
}

/**
 * Base class for Mixpanel API HTTP errors.
 *
 * Provides structured access to HTTP request/response context. The
 * HTTP-context accessors (`statusCode`, `responseBody`, …) become fully
 * exercised only in Phase-3 B4 when a transport exists (phase2-design C8
 * deferral table); the `details` construction below mirrors Python's
 * conditional key insertion exactly (R4.11 — absent, never `undefined`).
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
   * @param message - Human-readable error message (out of contract, R5.4).
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
    // details[k] = x`) — keys are ABSENT when the value is None (R4.11).
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

  /** HTTP status code from the response. */
  get statusCode(): number {
    return this.#statusCode;
  }

  /** Raw response body (lossless-parsed JSON or raw text), or `null`. */
  get responseBody(): unknown {
    return this.#responseBody;
  }

  /** HTTP method used (GET, POST), or `null`. */
  get requestMethod(): string | null {
    return this.#requestMethod;
  }

  /** Full request URL, or `null`. */
  get requestUrl(): string | null {
    return this.#requestUrl;
  }

  /** Query parameters sent, or `null`. */
  get requestParams(): Readonly<Record<string, unknown>> | null {
    return this.#requestParams;
  }

  /** Request body sent (for POST requests), or `null`. */
  get requestBody(): Readonly<Record<string, unknown>> | null {
    return this.#requestBody;
  }
}

// ---------------------------------------------------------------------------
// Configuration exceptions.
// ---------------------------------------------------------------------------

/**
 * Base for configuration-related errors.
 *
 * Raised when there's a problem with configuration files, environment
 * variables, or credential resolution.
 */
export class ConfigError extends MixpanelHeadlessError {
  /**
   * Initialize ConfigError.
   *
   * @param message - Human-readable error message (out of contract, R5.4).
   * @param details - Additional structured data.
   * @param options - Standard `ErrorOptions` (`cause` threading).
   */
  constructor(
    message: string,
    details?: Readonly<Record<string, unknown>> | null,
    options?: ErrorOptions,
  ) {
    super(message, "CONFIG_ERROR", details, options);
  }
}

/**
 * Named account does not exist in configuration.
 *
 * The {@link availableAccounts} accessor lists valid account names to
 * help users.
 */
export class AccountNotFoundError extends ConfigError {
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
    const available = availableAccounts ?? [];
    let message: string;
    if (available.length > 0) {
      const availableStr = available.map((a) => `'${a}'`).join(", ");
      message = `Account '${accountName}' not found. Available accounts: ${availableStr}`;
    } else {
      message = `Account '${accountName}' not found. No accounts configured.`;
    }
    super(message, {
      account_name: accountName,
      available_accounts: [...available],
    });
    this._code = "ACCOUNT_NOT_FOUND";
  }

  /** The requested account name that wasn't found. */
  get accountName(): string {
    const value = this._details["account_name"];
    return typeof value === "string" ? value : "";
  }

  /** List of valid account names. */
  get availableAccounts(): readonly string[] {
    const value = this._details["available_accounts"];
    return Array.isArray(value) ? (value as readonly string[]) : [];
  }
}

/**
 * Raised when a specified project is not accessible.
 *
 * Includes the requested project ID and optionally a list of accessible
 * project IDs to help the user correct their selection.
 */
export class ProjectNotFoundError extends ConfigError {
  /**
   * Initialize ProjectNotFoundError.
   *
   * @param projectId - The requested project ID that wasn't found.
   * @param availableProjects - List of accessible project IDs for suggestions.
   */
  constructor(projectId: string, availableProjects?: readonly string[] | null) {
    const available = availableProjects ?? [];
    let message: string;
    if (available.length > 0) {
      const availableStr = available.map((p) => `'${p}'`).join(", ");
      message = `Project '${projectId}' not found. Available projects: ${availableStr}`;
    } else {
      message = `Project '${projectId}' not found. No accessible projects discovered.`;
    }
    super(message, {
      project_id: projectId,
      available_projects: [...available],
    });
    this._code = "PROJECT_NOT_FOUND";
  }

  /** The requested project ID that wasn't found. */
  get projectId(): string {
    const value = this._details["project_id"];
    return typeof value === "string" ? value : "";
  }

  /** List of accessible project IDs. */
  get availableProjects(): readonly string[] {
    const value = this._details["available_projects"];
    return Array.isArray(value) ? (value as readonly string[]) : [];
  }
}

/**
 * Account name already exists in configuration.
 *
 * Raised when attempting to add an account with a name that's already in
 * use.
 */
export class AccountExistsError extends ConfigError {
  /**
   * Initialize AccountExistsError.
   *
   * @param accountName - The conflicting account name.
   */
  constructor(accountName: string) {
    super(`Account '${accountName}' already exists.`, {
      account_name: accountName,
    });
    this._code = "ACCOUNT_EXISTS";
  }

  /** The conflicting account name. */
  get accountName(): string {
    const value = this._details["account_name"];
    return typeof value === "string" ? value : "";
  }
}

/** The documented flag-combination violations (043 contract). */
export type InvalidArgumentViolation =
  "mutually_exclusive" | "no_browser_misuse" | "secret_stdin_misuse";

/** Runtime mirror of {@link InvalidArgumentViolation} for the guard check. */
const VALID_VIOLATIONS: readonly string[] = [
  "mutually_exclusive",
  "no_browser_misuse",
  "secret_stdin_misuse",
];

/** Keyword-only options bag for {@link InvalidArgumentError} (R3.8). */
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
 */
export class InvalidArgumentError extends ConfigError {
  /**
   * Initialize InvalidArgumentError.
   *
   * @param message - Human-readable error message (out of contract, R5.4).
   * @param options - Keyword-only bag: `violation` (required) and
   *   `detectedAuthType`.
   * @throws ParamValidationError - If `violation` is not one of the three
   *   documented values (Python raises a bare `ValueError` here; the site
   *   is uncoded/unvectored per R5.5, so the generic guard class is used).
   */
  constructor(message: string, options: InvalidArgumentErrorOptions) {
    const { violation } = options;
    const detectedAuthType = options.detectedAuthType ?? null;
    if (!VALID_VIOLATIONS.includes(violation)) {
      throw new ParamValidationError(
        `Invalid violation '${violation}'; must be one of ${VALID_VIOLATIONS.join(", ")}.`,
      );
    }
    // Mirror Python's conditional insert: key absent when None (R4.11).
    const details: Record<string, unknown> = { violation };
    if (detectedAuthType !== null) {
      details["detected_auth_type"] = detectedAuthType;
    }
    super(message, details);
    this._code = "INVALID_ARGUMENT";
  }

  /** The kind of misuse — see {@link InvalidArgumentViolation}. */
  get violation(): string {
    const value = this._details["violation"];
    return typeof value === "string" ? value : "";
  }

  /** The auth type the orchestrator resolved, or `null` if pre-detection. */
  get detectedAuthType(): string | null {
    const value = this._details["detected_auth_type"];
    return value !== null && value !== undefined ? String(value) : null;
  }
}

/**
 * Account is referenced by one or more targets and cannot be removed.
 *
 * The list of dependent target names is available in {@link referencedBy}
 * so callers can show a helpful error or pass `force=True` (Python side)
 * to delete the account and orphan the targets.
 */
export class AccountInUseError extends ConfigError {
  /**
   * Initialize AccountInUseError.
   *
   * @param accountName - The account that callers tried to remove.
   * @param referencedBy - Names of targets that reference the account.
   */
  constructor(accountName: string, referencedBy?: readonly string[] | null) {
    const targets = referencedBy ?? [];
    let message: string;
    if (targets.length > 0) {
      const targetStr = targets.map((t) => `'${t}'`).join(", ");
      message =
        `Account '${accountName}' is referenced by target(s): ${targetStr}. ` +
        `Pass \`force=True\` to remove anyway.`;
    } else {
      message = `Account '${accountName}' is in use. Pass \`force=True\` to remove.`;
    }
    super(message, {
      account_name: accountName,
      referenced_by: [...targets],
    });
    this._code = "ACCOUNT_IN_USE";
  }

  /** The account name that callers tried to remove. */
  get accountName(): string {
    const value = this._details["account_name"];
    return typeof value === "string" ? value : "";
  }

  /** Target names that reference the account. */
  get referencedBy(): readonly string[] {
    const value = this._details["referenced_by"];
    return Array.isArray(value) ? (value as readonly string[]) : [];
  }
}

// ---------------------------------------------------------------------------
// Authentication exceptions.
// ---------------------------------------------------------------------------

/** Options bag for {@link AuthenticationError} (fixed code `AUTH_FAILED`). */
export interface AuthenticationErrorOptions {
  /** HTTP status code (default 401). */
  readonly statusCode?: number | undefined;
  /** Raw response body. */
  readonly responseBody?: unknown;
  /** HTTP method used. */
  readonly requestMethod?: string | null | undefined;
  /** Full request URL. */
  readonly requestUrl?: string | null | undefined;
  /** Query parameters sent. */
  readonly requestParams?: Readonly<Record<string, unknown>> | null | undefined;
  /** Request body sent (for POST/PATCH requests). */
  readonly requestBody?: Readonly<Record<string, unknown>> | null | undefined;
  /** Underlying cause, threaded to `Error#cause`. */
  readonly cause?: unknown;
}

/**
 * Authentication with the Mixpanel API failed (HTTP 401).
 *
 * Raised when credentials are invalid, expired, or lack required
 * permissions. Inherits from {@link APIError} for full request/response
 * context.
 */
export class AuthenticationError extends APIError {
  /**
   * Initialize AuthenticationError.
   *
   * @param message - Human-readable error message (default
   *   `"Authentication failed"`; out of contract, R5.4).
   * @param options - Keyword-only HTTP context bag; `statusCode`
   *   defaults to 401.
   */
  constructor(
    message: string = "Authentication failed",
    options: AuthenticationErrorOptions = {},
  ) {
    super(message, {
      statusCode: options.statusCode ?? 401,
      responseBody: options.responseBody ?? null,
      requestMethod: options.requestMethod ?? null,
      requestUrl: options.requestUrl ?? null,
      requestParams: options.requestParams ?? null,
      requestBody: options.requestBody ?? null,
      code: "AUTH_FAILED",
      cause: options.cause,
    });
  }
}

// ---------------------------------------------------------------------------
// Rate-limit exceptions.
// ---------------------------------------------------------------------------

// Rate-limit lead-collection form. Short forms.gle links can't carry
// prefill query params, so the long-form URL is used whenever the
// project_id is known. (Strings copied from Python; never asserted — R5.4.)
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
 * which (unlike the other APIError subclasses) has NO `request_body`
 * parameter.
 */
export interface RateLimitErrorOptions {
  /** Seconds until retry is allowed (from the Retry-After header). */
  readonly retryAfter?: number | null | undefined;
  /** HTTP status code (default 429). */
  readonly statusCode?: number | undefined;
  /** Raw response body. */
  readonly responseBody?: unknown;
  /** HTTP method used. */
  readonly requestMethod?: string | null | undefined;
  /** Full request URL. */
  readonly requestUrl?: string | null | undefined;
  /** Query parameters sent. */
  readonly requestParams?: Readonly<Record<string, unknown>> | null | undefined;
  /** Mixpanel project id active when the limit was hit, if known. */
  readonly projectId?: string | null | undefined;
  /** Underlying cause, threaded to `Error#cause`. */
  readonly cause?: unknown;
}

/**
 * Mixpanel API rate limit exceeded (HTTP 429).
 *
 * The {@link retryAfter} accessor indicates when the request can be
 * retried; {@link rateLimitFormUrl} links the rate-limit-increase form.
 */
export class RateLimitError extends APIError {
  readonly #retryAfter: number | null;
  readonly #projectId: string | null;

  /**
   * Initialize RateLimitError.
   *
   * @param message - Human-readable error message (default
   *   `"Rate limit exceeded"`; out of contract, R5.4).
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
    super(finalMessage, {
      statusCode: options.statusCode ?? 429,
      responseBody: options.responseBody ?? null,
      requestMethod: options.requestMethod ?? null,
      requestUrl: options.requestUrl ?? null,
      requestParams: options.requestParams ?? null,
      code: "RATE_LIMITED",
      cause: options.cause,
    });
    this.#retryAfter = retryAfter;
    this.#projectId = projectId;
    // Post-super detail merges, exactly as Python appends them.
    if (retryAfter !== null) {
      this._details["retry_after"] = retryAfter;
    }
    if (projectId !== null) {
      this._details["project_id"] = projectId;
    }
  }

  /** Seconds until retry is allowed, or `null` if unknown. */
  get retryAfter(): number | null {
    return this.#retryAfter;
  }

  /** Mixpanel project id active when the rate limit was hit, if known. */
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

// ---------------------------------------------------------------------------
// Query exceptions.
// ---------------------------------------------------------------------------

/**
 * Event name not found in the Mixpanel project.
 *
 * Includes suggestions for similar event names to help users correct
 * typos or case mismatches.
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

  /** The event name that was not found. */
  get eventName(): string {
    return this.#eventName;
  }

  /** List of similar event names. */
  get similarEvents(): readonly string[] {
    return this.#similarEvents;
  }
}

/** Options bag for {@link QueryError} (fixed code `QUERY_FAILED`). */
export interface QueryErrorOptions {
  /** HTTP status code (default 400). */
  readonly statusCode?: number | undefined;
  /** Raw response body with error details. */
  readonly responseBody?: unknown;
  /** HTTP method used. */
  readonly requestMethod?: string | null | undefined;
  /** Full request URL. */
  readonly requestUrl?: string | null | undefined;
  /** Query parameters sent. */
  readonly requestParams?: Readonly<Record<string, unknown>> | null | undefined;
  /** Request body sent (for POST). */
  readonly requestBody?: Readonly<Record<string, unknown>> | null | undefined;
  /** Underlying cause, threaded to `Error#cause`. */
  readonly cause?: unknown;
}

/**
 * Query execution failed (HTTP 400 or query-specific error).
 *
 * Raised when an API query fails due to invalid parameters, syntax
 * errors, or other query-specific issues.
 */
export class QueryError extends APIError {
  /**
   * Initialize QueryError.
   *
   * @param message - Human-readable error message (default
   *   `"Query execution failed"`; out of contract, R5.4).
   * @param options - Keyword-only HTTP context bag; `statusCode`
   *   defaults to 400.
   */
  constructor(
    message: string = "Query execution failed",
    options: QueryErrorOptions = {},
  ) {
    super(message, {
      statusCode: options.statusCode ?? 400,
      responseBody: options.responseBody ?? null,
      requestMethod: options.requestMethod ?? null,
      requestUrl: options.requestUrl ?? null,
      requestParams: options.requestParams ?? null,
      requestBody: options.requestBody ?? null,
      code: "QUERY_FAILED",
      cause: options.cause,
    });
  }
}

/** Options bag for {@link ServerError} (fixed code `SERVER_ERROR`). */
export interface ServerErrorOptions {
  /** HTTP status code (default 500). */
  readonly statusCode?: number | undefined;
  /** Raw response body with error details. */
  readonly responseBody?: unknown;
  /** HTTP method used. */
  readonly requestMethod?: string | null | undefined;
  /** Full request URL. */
  readonly requestUrl?: string | null | undefined;
  /** Query parameters sent. */
  readonly requestParams?: Readonly<Record<string, unknown>> | null | undefined;
  /** Request body sent (for POST). */
  readonly requestBody?: Readonly<Record<string, unknown>> | null | undefined;
  /** Underlying cause, threaded to `Error#cause`. */
  readonly cause?: unknown;
}

/**
 * Mixpanel server error (HTTP 5xx).
 *
 * Typically transient; the {@link APIError.responseBody} often carries
 * actionable information.
 */
export class ServerError extends APIError {
  /**
   * Initialize ServerError.
   *
   * @param message - Human-readable error message (default
   *   `"Server error"`; out of contract, R5.4).
   * @param options - Keyword-only HTTP context bag; `statusCode`
   *   defaults to 500.
   */
  constructor(
    message: string = "Server error",
    options: ServerErrorOptions = {},
  ) {
    super(message, {
      statusCode: options.statusCode ?? 500,
      responseBody: options.responseBody ?? null,
      requestMethod: options.requestMethod ?? null,
      requestUrl: options.requestUrl ?? null,
      requestParams: options.requestParams ?? null,
      requestBody: options.requestBody ?? null,
      code: "SERVER_ERROR",
      cause: options.cause,
    });
  }
}

// ---------------------------------------------------------------------------
// Validation exceptions.
// ---------------------------------------------------------------------------

/**
 * Date range exceeds the maximum allowed by the Mixpanel API.
 *
 * The Mixpanel Export API limits requests to 100 days maximum; split
 * large date ranges into smaller chunks.
 */
export class DateRangeTooLargeError extends MixpanelHeadlessError {
  readonly #fromDate: string;
  readonly #toDate: string;
  readonly #daysRequested: number;
  readonly #maxDays: number;

  /**
   * Initialize DateRangeTooLargeError (positional params, R3.8).
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

  /** Start date that was requested. */
  get fromDate(): string {
    return this.#fromDate;
  }

  /** End date that was requested. */
  get toDate(): string {
    return this.#toDate;
  }

  /** Number of days in the requested range. */
  get daysRequested(): number {
    return this.#daysRequested;
  }

  /** Maximum allowed days. */
  get maxDays(): number {
    return this.#maxDays;
  }
}

// ---------------------------------------------------------------------------
// OAuth exceptions.
// ---------------------------------------------------------------------------

/**
 * OAuth authentication flow error.
 *
 * Raised for failures during the OAuth 2.0 PKCE flow, including token
 * exchange, token refresh, client registration, callback timeout, port
 * unavailability, and browser launch failures. Known codes:
 * `OAUTH_TOKEN_ERROR`, `OAUTH_REFRESH_ERROR`, `OAUTH_REGISTRATION_ERROR`,
 * `OAUTH_TIMEOUT`, `OAUTH_PORT_ERROR`, `OAUTH_BROWSER_ERROR`.
 */
export class OAuthError extends MixpanelHeadlessError {
  /**
   * Initialize OAuthError.
   *
   * @param message - Human-readable error message (out of contract, R5.4).
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
 * One region-probe attempt: `[region, statusCode, errorBody]`.
 *
 * `region` is typed `string` in Phase 2; the `Region` literal union lands
 * with the P2-4 auth model (`auth/account.ts`) and may tighten this alias
 * there. A status code of `0` indicates the request never reached the
 * server (network error).
 */
export type RegionProbeAttempt = readonly [string, number, string];

/** Keyword-only options bag for {@link RegionProbeError} (R3.8). */
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
 */
export class RegionProbeError extends OAuthError {
  readonly #attempts: readonly RegionProbeAttempt[];

  /**
   * Initialize RegionProbeError.
   *
   * @param message - Human-readable error message (out of contract, R5.4).
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

  /** Ordered list of `(region, statusCode, errorBody)` tuples (a copy). */
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
 * Raised when EVERY region probe attempt failed at the network layer.
 *
 * Used when all recorded attempts have `statusCode === 0` — the
 * credential was never evaluated because no region was reachable. Carries
 * the same `attempts` shape as the parent.
 */
export class RegionProbeNetworkError extends RegionProbeError {
  /**
   * Initialize RegionProbeNetworkError.
   *
   * @param message - Human-readable error message (out of contract, R5.4).
   * @param options - Keyword-only bag: `attempts` — every entry must have
   *   status `0` by construction (the probe loop only raises this
   *   subclass when that invariant holds).
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
 */
export class WorkspaceScopeError extends MixpanelHeadlessError {
  /**
   * Initialize WorkspaceScopeError.
   *
   * @param message - Human-readable error message (out of contract, R5.4).
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

// ---------------------------------------------------------------------------
// Business-context validation.
// ---------------------------------------------------------------------------

/**
 * Business-context content failed client-side validation.
 *
 * Raised when supplied content exceeds `BUSINESS_CONTEXT_MAX_CHARS`
 * (50,000 characters). The `details` dict carries `length` and `max`.
 */
export class BusinessContextValidationError extends MixpanelHeadlessError {
  /**
   * Initialize BusinessContextValidationError.
   *
   * @param message - Human-readable error message (out of contract, R5.4).
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

// ---------------------------------------------------------------------------
// Bookmark validation.
// ---------------------------------------------------------------------------

/** Severity of a {@link ValidationError} finding. */
export type ValidationSeverity = "error" | "warning";

/**
 * A single validation issue found in query arguments or bookmark params.
 *
 * NOT an exception — Python defines this as a frozen dataclass; it ports
 * as a plain class (phase2-design C3). It rides inside
 * {@link BookmarkValidationError.errors} and oracle error payloads. There
 * is no `field` attribute — the field list mirrors `exceptions.py:1255+`
 * exactly.
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
   * Initialize a validation finding (positional params mirror the Python
   * dataclass field order, R3.8).
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
   * (tuple → JSON array) and `fix` ONLY when non-null — byte-matching
   * Python's `to_dict` (R4.11 conditional emission).
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
   * Return the formatted error string (Python `__str__` port; display
   * only — out of contract, R5.4).
   *
   * @returns Formatted string with severity prefix, path, and message.
   */
  toString(): string {
    const prefix = this.severity === "warning" ? "WARNING" : "ERROR";
    let s = `[${prefix}] ${this.path}: ${this.message}`;
    // Python truthiness: `if self.suggestion` is false for None AND ().
    if (this.suggestion !== null && this.suggestion.length > 0) {
      s += ` Did you mean '${this.suggestion[0]}'?`;
    }
    return s;
  }
}

/**
 * Bookmark params failed validation.
 *
 * Contains ALL validation errors found, enabling callers to fix multiple
 * issues in a single pass.
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

  /** All validation errors found (both errors and warnings). */
  get errors(): readonly ValidationError[] {
    return this.#errors;
  }

  /** Number of severity `"error"` items. */
  get errorCount(): number {
    return this.#errorCount;
  }

  /** Number of severity `"warning"` items. */
  get warningCount(): number {
    return this.#warningCount;
  }
}

// ---------------------------------------------------------------------------
// Session-replay exceptions (044-session-replay).
// ---------------------------------------------------------------------------

/**
 * Options bag for {@link SessionReplayError} and subclasses: the full
 * APIError context (all optional — status/code fall back to per-class
 * defaults) plus a replay-specific `details` dict merged on top.
 */
export interface SessionReplayErrorOptions {
  /** Replay-specific structured context (merged into `details`). */
  readonly details?: Readonly<Record<string, unknown>> | null | undefined;
  /** HTTP status; defaults to the subclass's default status. */
  readonly statusCode?: number | null | undefined;
  /** Raw response body for debugging. */
  readonly responseBody?: unknown;
  /** HTTP method (GET, POST, …). */
  readonly requestMethod?: string | null | undefined;
  /** Full request URL. */
  readonly requestUrl?: string | null | undefined;
  /** Query parameters sent on the failing request. */
  readonly requestParams?: Readonly<Record<string, unknown>> | null | undefined;
  /** Request body sent on the failing request. */
  readonly requestBody?: Readonly<Record<string, unknown>> | null | undefined;
  /** Machine-readable code; defaults to the subclass's default code. */
  readonly code?: string | null | undefined;
  /** Underlying cause, threaded to `Error#cause`. */
  readonly cause?: unknown;
}

/**
 * Base class for session-replay-specific failures.
 *
 * Subclasses override the static default code/status pair, mirroring the
 * Python `_DEFAULT_CODE` / `_DEFAULT_STATUS` class attributes (read via
 * `new.target` so the most-derived class wins, exactly like Python's
 * `self._DEFAULT_CODE`). Because this is an {@link APIError}, generic
 * `instanceof APIError` handlers continue to catch these.
 */
export class SessionReplayError extends APIError {
  /** Default machine code when the constructor receives none. */
  protected static readonly defaultCode: string = "SESSION_REPLAY_ERROR";

  /** Default HTTP status when the constructor receives none. */
  protected static readonly defaultStatus: number = 500;

  /**
   * Initialize SessionReplayError.
   *
   * @param message - Human-readable error message (out of contract, R5.4).
   * @param options - Keyword-only bag; `statusCode`/`code` default to the
   *   most-derived class's static defaults; `details` is merged into the
   *   APIError details dict AFTER construction, exactly as Python's
   *   `self._details.update(details)` does.
   */
  constructor(message: string, options: SessionReplayErrorOptions = {}) {
    const ctor = new.target as typeof SessionReplayError;
    super(message, {
      statusCode: options.statusCode ?? ctor.defaultStatus,
      responseBody: options.responseBody ?? null,
      requestMethod: options.requestMethod ?? null,
      requestUrl: options.requestUrl ?? null,
      requestParams: options.requestParams ?? null,
      requestBody: options.requestBody ?? null,
      code: options.code ?? ctor.defaultCode,
      cause: options.cause,
    });
    const extra = options.details ?? null;
    // Python: `if details: self._details.update(details)` — empty dict is
    // falsy in Python, and merging an empty object is a no-op anyway.
    if (extra !== null) {
      Object.assign(this._details, extra);
    }
  }
}

/**
 * Project has SESSION_RECORDING_SENSITIVE_DATA enabled and the caller
 * lacks access (bulk-sign endpoint 403).
 */
export class SessionReplayAccessError extends SessionReplayError {
  /** @inheritDoc */
  protected static override readonly defaultCode: string =
    "SESSION_REPLAY_ACCESS_ERROR";

  /** @inheritDoc */
  protected static override readonly defaultStatus: number = 403;
}

/**
 * Signed CDN URL passed to a fetch has expired (5-minute TTL).
 */
export class SignedURLExpiredError extends SessionReplayError {
  /** @inheritDoc */
  protected static override readonly defaultCode: string = "SIGNED_URL_EXPIRED";

  /** @inheritDoc */
  protected static override readonly defaultStatus: number = 403;
}

/**
 * No CDN bytes found for a requested replay (404 on the first file).
 */
export class ReplayNotFoundError extends SessionReplayError {
  /** @inheritDoc */
  protected static override readonly defaultCode: string = "REPLAY_NOT_FOUND";

  /** @inheritDoc */
  protected static override readonly defaultStatus: number = 404;
}

/**
 * Replay bytes are not in rrweb format (mobile or other non-web
 * recording). Default status 501 (Not Implemented): no HTTP request
 * failed, the format simply isn't supported yet.
 */
export class UnsupportedReplayFormatError extends SessionReplayError {
  /** @inheritDoc */
  protected static override readonly defaultCode: string =
    "UNSUPPORTED_REPLAY_FORMAT";

  /** @inheritDoc */
  protected static override readonly defaultStatus: number = 501;
}

// ---------------------------------------------------------------------------
// Report-link exceptions (045-report-links, Python PR #223).
// ---------------------------------------------------------------------------

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
 * Base class for report-link failures (045-report-links).
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
 */
export class ReportLinkError extends MixpanelHeadlessError {
  /** Default machine code when the constructor receives none. */
  protected static readonly defaultCode: string = "REPORT_LINK_ERROR";

  /**
   * Initialize a report-link error.
   *
   * @param message - Human-readable error message (out of contract,
   *   R5.4; the Python repo's
   *   `specs/045-report-links/contracts/error-messages.md` holds the
   *   stable wording per code).
   * @param options - Keyword-only bag; `code` defaults to the
   *   most-derived class's static default.
   */
  constructor(message: string, options: ReportLinkErrorOptions = {}) {
    const ctor = new.target as typeof ReportLinkError;
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
 */
export class ReportLinkParseError extends ReportLinkError {
  /** @inheritDoc */
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
 */
export class UnsupportedReportLinkError extends ReportLinkError {
  /** @inheritDoc */
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
 */
export class ReportLinkNotFoundError extends ReportLinkError {
  /** @inheritDoc */
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
 */
export class ReportLinkScopeMismatchError extends ReportLinkError {
  /** @inheritDoc */
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
 */
export class ShortLinkResolutionError extends ReportLinkError {
  /** @inheritDoc */
  protected static override readonly defaultCode: string =
    "SHORT_LINK_RESOLUTION_ERROR";
}
