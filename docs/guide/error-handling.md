---
title: Error handling
description: "The coded error hierarchy — instanceof versus .code, what the wire raises, retries and transport failures, and the full table of classes and codes."
---

# Error handling

Every error the library throws extends [`MixpanelHeadlessError`](/reference/core/classes/MixpanelHeadlessError) and carries a stable, machine-readable `code` plus a structured `details` bag. Branch on classes and codes, never on message text:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import {
  AuthenticationError,
  MixpanelHeadlessError,
  RateLimitError,
} from "@mixpanel-headless/core";

const ws = createNodeWorkspace();

try {
  const result = await ws.query("Purchase", { last: 30 });
} catch (err) {
  if (err instanceof RateLimitError) {
    await new Promise((r) => setTimeout(r, (err.retryAfter ?? 1) * 1000));
  } else if (err instanceof AuthenticationError) {
    // credentials expired or revoked — code "AUTH_FAILED"
  } else if (err instanceof MixpanelHeadlessError) {
    console.error(err.toDict()); // { code, message, details }
  } else {
    throw err;
  }
}
```

The class name and the `code` are the contract — they are the same as the Python library's and are checked by the conformance corpus on every release. Message text is copied from Python for fidelity but may change; do not parse it.

## Anatomy of an error

| Member     | Type                                | Meaning                                                                                                   |
| ---------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `name`     | `string`                            | The class name (`"RateLimitError"`), also what `instanceof` tests                                         |
| `code`     | `string`                            | Machine-readable code, fixed at construction (`"RATE_LIMITED"`)                                           |
| `message`  | `string`                            | Human-readable; not part of the contract                                                                  |
| `details`  | `Readonly<Record<string, unknown>>` | Structured data with **snake_case** keys — the wire spelling (`retry_after`, `project_id`, `hint`, …)     |
| `cause`    | `unknown`                           | The underlying `Error`, when one exists (standard `ErrorOptions`)                                         |
| `toDict()` | `ErrorDict`                         | `{ code, message, details }` — byte-identical to Python's `to_dict()`, ready for a log line or a response |

Subclasses add typed accessors for the same data: `APIError.statusCode`, `responseBody`, `requestMethod`, `requestUrl`, `requestParams`, `requestBody`; `RateLimitError.retryAfter` (seconds, or `null`), `projectId` and `rateLimitFormUrl`; `AccountNotFoundError.accountName` and `availableAccounts`; `BookmarkValidationError.errors`, `errorCount`, `warningCount`; `DateRangeTooLargeError.daysRequested` and `maxDays`; `RegionProbeError.attempts`.

## `instanceof` or `.code`?

Use both, for different questions:

- **`instanceof`** answers _what kind of failure_. It follows the hierarchy, so `err instanceof APIError` catches every wire failure and `err instanceof ConfigError` catches every configuration problem, including subclasses added later.
- **`.code`** answers _which exact check failed_. Many classes carry more than one code: a `ParamValidationError` from a query builder carries the registry code of the specific guard (`FD1_QUANTITY_NOT_POSITIVE`, `WS1_TARGET_MUTUALLY_EXCLUSIVE`, …), an `OAuthError` distinguishes `OAUTH_TIMEOUT` from `OAUTH_REFRESH_REVOKED`, a `ReportLinkParseError` says _why_ the URL was rejected. Codes are stable strings you can `switch` on, log, and store.

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";
import { ConfigError, OAuthError } from "@mixpanel-headless/core";

function explain(err: unknown): string {
  if (err instanceof OAuthError && err.code === "OAUTH_REFRESH_REVOKED") {
    return "Your login was revoked — run loginUnified() again.";
  }
  if (err instanceof ConfigError) {
    return `Configuration problem (${err.code}): ${err.message}`;
  }
  throw err;
}
```

`details` is where the structured context lives: a `ParamValidationError` from a builder names the offending field, a `ReportLinkError` carries a `hint`, an `OAuthError` from the browser flow carries the region. Keys are the same as the Python library's, so a log pipeline built for one works for both.

## Where errors come from

### Before any request: validation

Builders and facade methods validate their arguments client-side and throw **before a request is made**:

- [`ParamValidationError`](/reference/core/classes/ParamValidationError) — a value guard failed (empty event name, non-positive window, malformed date, mutually exclusive options). The `code` is the guard's registry code — see [the registry](#coded-guard-registry).
- `ParamTypeError` — a type guard failed (`code` `VALIDATION_ERROR`).
- [`BookmarkValidationError`](/reference/core/classes/BookmarkValidationError) — the assembled bookmark params failed schema validation. `errors` is a list of [`ValidationError`](/reference/core/classes/ValidationError) findings (a plain record, not an exception: `path`, `message`, `code`, `severity`, `suggestion`, `fix`), so a UI can point at the exact field.
- `DateRangeTooLargeError`, `EventNotFoundError`, `BusinessContextValidationError`, `WorkspaceScopeError` — domain guards with their own codes.

### Configuration and login

- [`ConfigError`](/reference/core/classes/ConfigError) — an axis could not be resolved, the config or bridge file is malformed, or an account operation was invalid. Subclasses: `AccountNotFoundError`, `AccountExistsError`, `AccountInUseError`, `ProjectNotFoundError`, `InvalidArgumentError`.
- [`OAuthError`](/reference/core/classes/OAuthError) — anything in the PKCE flow, token refresh or static-token resolution. Codes include `OAUTH_TOKEN_ERROR` (default), `OAUTH_REFRESH_ERROR`, `OAUTH_REFRESH_REVOKED`, `OAUTH_REGISTRATION_ERROR`, `OAUTH_TIMEOUT`, `OAUTH_PORT_ERROR`, `OAUTH_BROWSER_ERROR`, `OAUTH_AUTH_DENIED`, `OAUTH_STATE_MISMATCH`, `OAUTH_CONFIG_ERROR`, `OAUTH_PASTE_ERROR`. `RegionProbeError` (`OAUTH_REGION_PROBE_FAILED`) and `RegionProbeNetworkError` (`OAUTH_NETWORK_UNREACHABLE`) come from the `us → eu → in` probe during login and carry the per-region `attempts`.

### The wire: [`APIError`](/reference/core/classes/APIError) and its children

An HTTP response outside `2xx` is mapped by status:

| Status                           | Error                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------- |
| `401`                            | `AuthenticationError` (`AUTH_FAILED`)                                                              |
| `403`                            | `QueryError` (permission denied; a session-replay access denial raises `SessionReplayAccessError`) |
| `400`, `404`, `422`, other `4xx` | `QueryError` (`QUERY_FAILED`) with the parsed response body                                        |
| `429`                            | retried — then `RateLimitError` (`RATE_LIMITED`) once retries are exhausted                        |
| `5xx`                            | `ServerError` (`SERVER_ERROR`)                                                                     |

Every `APIError` keeps the request context (`requestMethod`, `requestUrl`, `requestParams`, `requestBody`) and the parsed `responseBody`, so a failed call can be reproduced without re-running it.

### Retries and transport failures

`429` responses are retried automatically with the server's `Retry-After` when it sends one, otherwise exponential backoff with jitter (base 1 s, capped at 60 s). The retry budget is `maxRetries`, default `3`, set through `clientOptions` on any factory:

```ts twoslash
import { createNodeWorkspace } from "@mixpanel-headless/node";

const ws = createNodeWorkspace({ clientOptions: { maxRetries: 5 } });
```

Once the budget is spent you get a [`RateLimitError`](/reference/core/classes/RateLimitError); `retryAfter` tells you how long the server asked you to wait and `rateLimitFormUrl` links the rate-limit-increase form. Other statuses are not retried — a `ServerError` reaches you on the first `5xx`.

Network-level failures — DNS, connection refused, TLS, the wall-clock timeout — surface as a plain `MixpanelHeadlessError` with code `HTTP_ERROR` and the underlying exception in `cause`. Timeouts are route-aware by default (sized to outlast the server's own deadline) and can be pinned with `clientOptions.timeoutSeconds`. Cancelling a call through an `AbortSignal` is not an error of the library's: it rejects with a standard `AbortError` `DOMException`, which passes through untouched.

### Report links and session replay

- The report-link family ([`ReportLinkError`](/reference/core/classes/ReportLinkError) and its subclasses `ReportLinkParseError`, `UnsupportedReportLinkError`, `ReportLinkNotFoundError`, `ReportLinkScopeMismatchError`, `ShortLinkResolutionError`) is raised by `resolveReportLink` / `queryReportLink`; `details.hint` says what to do, and the `code` narrows the cause (for example `REPORT_LINK_REGION_MISMATCH`, `UNSUPPORTED_DASHBOARD_LINK`, `SHORT_LINK_NO_LOCATION`). See [Report links](/guide/report-links).
- The session-replay family ([`SessionReplayError`](/reference/core/classes/SessionReplayError) and its subclasses `ReplayNotFoundError`, `SessionReplayAccessError`, `SignedURLExpiredError`, `UnsupportedReplayFormatError`) extends `APIError`, so `statusCode` is available. See [Session replay](/guide/session-replay).

### Browser-only refusals

`@mixpanel-headless/browser` adds one class, [`BrowserUnsupportedError`](/reference/browser/classes/BrowserUnsupportedError) (extends `MixpanelHeadlessError`), for capabilities the browser build refuses on policy or platform grounds: `BROWSER_SERVICE_ACCOUNT_REFUSED` (a service-account credential reached a page), `BROWSER_EXPORT_UNSUPPORTED` (the Export API serves no CORS headers) and `BROWSER_NO_PENDING_LOGIN` (`completeLogin` ran with no pending login in the store). See [In the browser](/guide/browser).

## The hierarchy

```
MixpanelHeadlessError                 UNKNOWN_ERROR
├── APIError                          API_ERROR
│   ├── AuthenticationError           AUTH_FAILED
│   ├── QueryError                    QUERY_FAILED
│   ├── RateLimitError                RATE_LIMITED
│   ├── ServerError                   SERVER_ERROR
│   └── SessionReplayError            SESSION_REPLAY_ERROR
│       ├── ReplayNotFoundError       REPLAY_NOT_FOUND
│       ├── SessionReplayAccessError  SESSION_REPLAY_ACCESS_ERROR
│       ├── SignedURLExpiredError     SIGNED_URL_EXPIRED
│       └── UnsupportedReplayFormatError  UNSUPPORTED_REPLAY_FORMAT
├── BookmarkValidationError           BOOKMARK_VALIDATION_ERROR
├── BusinessContextValidationError    BUSINESS_CONTEXT_TOO_LONG
├── ConfigError                       CONFIG_ERROR
│   ├── AccountExistsError            ACCOUNT_EXISTS
│   ├── AccountInUseError             ACCOUNT_IN_USE
│   ├── AccountNotFoundError          ACCOUNT_NOT_FOUND
│   ├── InvalidArgumentError          INVALID_ARGUMENT
│   └── ProjectNotFoundError          PROJECT_NOT_FOUND
├── DateRangeTooLargeError            DATE_RANGE_TOO_LARGE
├── EventNotFoundError                EVENT_NOT_FOUND
├── OAuthError                        OAUTH_TOKEN_ERROR
│   └── RegionProbeError              OAUTH_REGION_PROBE_FAILED
│       └── RegionProbeNetworkError   OAUTH_NETWORK_UNREACHABLE
├── ParamTypeError                    VALIDATION_ERROR
├── ParamValidationError              VALIDATION_ERROR
├── ReportLinkError                   REPORT_LINK_ERROR
│   ├── ReportLinkNotFoundError       REPORT_LINK_NOT_FOUND
│   ├── ReportLinkParseError          REPORT_LINK_UNPARSEABLE
│   ├── ReportLinkScopeMismatchError  REPORT_LINK_SCOPE_MISMATCH
│   ├── ShortLinkResolutionError      SHORT_LINK_RESOLUTION_ERROR
│   └── UnsupportedReportLinkError    UNSUPPORTED_REPORT_LINK
├── ResponseValidationError           RESPONSE_VALIDATION_ERROR
└── WorkspaceScopeError               NO_WORKSPACES
```

Every class is exported from `@mixpanel-headless/core` and re-exported from `@mixpanel-headless/browser` (so a page needs one import); `@mixpanel-headless/node` does not re-export them — import the error classes from `@mixpanel-headless/core` alongside `createNodeWorkspace`, as the examples on this page do. The classes are the same objects everywhere, so `instanceof` works whichever entry point constructed the workspace. Each class has its own page in the [API reference](/api/) with the accessors it adds.

## Code reference

The tables below are derived from the error-code contract the port shares with the Python library (`packages/core/src/errors-codes.gen.ts`, generated from the Python revision `0dde5060`). The registry-equality test in the repository keeps them in step with the live classes.

### Classes and default codes

Each class carries this code unless the raise site supplies a more specific one.

| Class                            | Extends                 | Default `code`                |
| -------------------------------- | ----------------------- | ----------------------------- |
| `MixpanelHeadlessError`          | `Error`                 | `UNKNOWN_ERROR`               |
| `APIError`                       | `MixpanelHeadlessError` | `API_ERROR`                   |
| `AuthenticationError`            | `APIError`              | `AUTH_FAILED`                 |
| `QueryError`                     | `APIError`              | `QUERY_FAILED`                |
| `RateLimitError`                 | `APIError`              | `RATE_LIMITED`                |
| `ServerError`                    | `APIError`              | `SERVER_ERROR`                |
| `SessionReplayError`             | `APIError`              | `SESSION_REPLAY_ERROR`        |
| `ReplayNotFoundError`            | `SessionReplayError`    | `REPLAY_NOT_FOUND`            |
| `SessionReplayAccessError`       | `SessionReplayError`    | `SESSION_REPLAY_ACCESS_ERROR` |
| `SignedURLExpiredError`          | `SessionReplayError`    | `SIGNED_URL_EXPIRED`          |
| `UnsupportedReplayFormatError`   | `SessionReplayError`    | `UNSUPPORTED_REPLAY_FORMAT`   |
| `BookmarkValidationError`        | `MixpanelHeadlessError` | `BOOKMARK_VALIDATION_ERROR`   |
| `BusinessContextValidationError` | `MixpanelHeadlessError` | `BUSINESS_CONTEXT_TOO_LONG`   |
| `ConfigError`                    | `MixpanelHeadlessError` | `CONFIG_ERROR`                |
| `AccountExistsError`             | `ConfigError`           | `ACCOUNT_EXISTS`              |
| `AccountInUseError`              | `ConfigError`           | `ACCOUNT_IN_USE`              |
| `AccountNotFoundError`           | `ConfigError`           | `ACCOUNT_NOT_FOUND`           |
| `InvalidArgumentError`           | `ConfigError`           | `INVALID_ARGUMENT`            |
| `ProjectNotFoundError`           | `ConfigError`           | `PROJECT_NOT_FOUND`           |
| `DateRangeTooLargeError`         | `MixpanelHeadlessError` | `DATE_RANGE_TOO_LARGE`        |
| `EventNotFoundError`             | `MixpanelHeadlessError` | `EVENT_NOT_FOUND`             |
| `OAuthError`                     | `MixpanelHeadlessError` | `OAUTH_TOKEN_ERROR`           |
| `RegionProbeError`               | `OAuthError`            | `OAUTH_REGION_PROBE_FAILED`   |
| `RegionProbeNetworkError`        | `RegionProbeError`      | `OAUTH_NETWORK_UNREACHABLE`   |
| `ParamTypeError`                 | `MixpanelHeadlessError` | `VALIDATION_ERROR`            |
| `ParamValidationError`           | `MixpanelHeadlessError` | `VALIDATION_ERROR`            |
| `ReportLinkError`                | `MixpanelHeadlessError` | `REPORT_LINK_ERROR`           |
| `ReportLinkNotFoundError`        | `ReportLinkError`       | `REPORT_LINK_NOT_FOUND`       |
| `ReportLinkParseError`           | `ReportLinkError`       | `REPORT_LINK_UNPARSEABLE`     |
| `ReportLinkScopeMismatchError`   | `ReportLinkError`       | `REPORT_LINK_SCOPE_MISMATCH`  |
| `ShortLinkResolutionError`       | `ReportLinkError`       | `SHORT_LINK_RESOLUTION_ERROR` |
| `UnsupportedReportLinkError`     | `ReportLinkError`       | `UNSUPPORTED_REPORT_LINK`     |
| `ResponseValidationError`        | `MixpanelHeadlessError` | `RESPONSE_VALIDATION_ERROR`   |
| `WorkspaceScopeError`            | `MixpanelHeadlessError` | `NO_WORKSPACES`               |

### Coded guard registry

Argument guards in the builders and the facade throw `ParamValidationError` with one of these 126 codes. The prefix names the guard family; the number is stable across releases. Programs that need to distinguish _which_ argument was rejected key on the full code.

| Prefix     | Guards                                                                                                                                                                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AC`       | `AC1_BODY_MUTUALLY_EXCLUSIVE`, `AC2_DISTINCT_ID_CONFLICT`, `AC3_BEHAVIORS_COHORT_CONFLICT`, `AC4_INCLUDE_ALL_USERS_REQUIRES_COHORT`, `AC5_BEHAVIORS_NOT_LIST`, `AC6_AS_OF_TIMESTAMP_FUTURE`                                                                                                                                                                                     |
| `BB`       | `BB1_GROUP_BY_ELEMENT_TYPE`, `BB2_FLOW_PROPERTY_FILTER_EMPTY`, `BB3_FLOW_PROPERTY_FILTER_TYPE`, `BB4_FLOW_COHORT_FILTER_TYPE`, `BB5_FLOW_MULTIPLE_COHORT_FILTERS`, `BB6_COHORT_VALUE_NOT_LIST`, `BB7_COHORT_VALUE_NOT_DICT`, `BB8_COHORT_KEY_MISSING`                                                                                                                           |
| `CA`       | `CA1_AGGREGATION_PAIR`, `CA2_EMPTY_AGGREGATION_PROPERTY`                                                                                                                                                                                                                                                                                                                        |
| `CB`       | `CB1_COHORT_ID_NOT_POSITIVE`, `CB2_COHORT_NAME_EMPTY`                                                                                                                                                                                                                                                                                                                           |
| `CD`       | `CD1_FREQUENCY_PARAM_REQUIRED`, `CD2_FREQUENCY_NEGATIVE`, `CD3_TIME_CONSTRAINT_REQUIRED`, `CD3_WINDOW_NOT_POSITIVE`, `CD4_EMPTY_EVENT`, `CD5_FROM_REQUIRES_TO`, `CD5_TO_REQUIRES_FROM`, `CD6_DATE_FORMAT`, `CD6_DATE_INVALID`, `CD6_DATE_ORDER`, `CD7_EMPTY_PROPERTY`, `CD8_COHORT_ID_NOT_POSITIVE`, `CD9_EMPTY_CRITERIA`, `CD10_UNSUPPORTED_FILTER_OPERATOR`                   |
| `CF`       | `CF1_COHORT_ID_NOT_POSITIVE`, `CF2_COHORT_NAME_EMPTY`                                                                                                                                                                                                                                                                                                                           |
| `CM`       | `CM1_COHORT_ID_NOT_POSITIVE`, `CM2_COHORT_NAME_EMPTY`                                                                                                                                                                                                                                                                                                                           |
| `ES`       | `ES1_PROPERTY_NOT_STRING`, `ES2_EQUALS_EXPECTS_LIST`, `ES3_EQUALS_NO_TERMS`, `ES4_NOT_EQUALS_EXPECTS_LIST`, `ES5_NOT_EQUALS_NO_TERMS`, `ES6_CONTAINS_EXPECTS_STR`, `ES7_NOT_CONTAINS_EXPECTS_STR`, `ES8_GT_EXPECTS_NUMBER`, `ES9_LT_EXPECTS_NUMBER`, `ES10_BETWEEN_EXPECTS_PAIR`, `ES11_BETWEEN_LOWER_NOT_NUMBER`, `ES12_BETWEEN_UPPER_NOT_NUMBER`, `ES13_UNSUPPORTED_OPERATOR` |
| `EV`       | `EV1_EMPTY_EVENT`, `EV2_CONTROL_CHAR_EVENT`                                                                                                                                                                                                                                                                                                                                     |
| `EX`       | `EX1_FROM_STEP_NEGATIVE`, `EX2_STEP_ORDER`                                                                                                                                                                                                                                                                                                                                      |
| `FB`       | `FB1_EMPTY_EVENT`, `FB2_BUCKET_SIZE_NOT_POSITIVE`, `FB3_BUCKET_ORDER`, `FB4_BUCKET_MIN_NEGATIVE`                                                                                                                                                                                                                                                                                |
| `FD`       | `FD1_QUANTITY_NOT_POSITIVE`, `FD2_DATE_ORDER`                                                                                                                                                                                                                                                                                                                                   |
| `FF`       | `FF1_EMPTY_EVENT`, `FF2_INVALID_OPERATOR`, `FF3_VALUE_NEGATIVE`, `FF4_DATE_RANGE_PAIR`, `FF5_DATE_RANGE_VALUE_NOT_POSITIVE`                                                                                                                                                                                                                                                     |
| `FM`       | `FM1_EMPTY_EXPRESSION`                                                                                                                                                                                                                                                                                                                                                          |
| `FS`       | `FS1_SESSION_EVENT_MISMATCH`                                                                                                                                                                                                                                                                                                                                                    |
| `GB`       | `GB1_EMPTY_PROPERTY`, `GB4_LIST_ITEM_BUCKETING`, `GB5_LIST_ITEM_PROPERTY_TYPE`                                                                                                                                                                                                                                                                                                  |
| `HC`       | `HC1_EMPTY_PROPERTY`                                                                                                                                                                                                                                                                                                                                                            |
| `LC`       | `LC1_MISSING_ITEM_FILTERS`, `LC2_MISSING_QUANTIFIER`, `LC3_MIXED_ARGS`, `LC4_INVALID_QUANTIFIER`, `LC5_EMPTY_KWARG_KEY`, `LC6_KWARG_VALUE_TYPE`, `LC7_NO_CONDITIONS`, `LC8_NESTED_LIST_CONTAINS`                                                                                                                                                                                |
| `LG`       | `LG1_EMPTY_SUB`, `LG2_INVALID_SUB_TYPE`                                                                                                                                                                                                                                                                                                                                         |
| `MT`       | `MT2_INVALID_SEGMENT_METHOD`                                                                                                                                                                                                                                                                                                                                                    |
| `RB`       | `RB1_PROJECT_ID_MISMATCH`                                                                                                                                                                                                                                                                                                                                                       |
| `RE`       | `RE1_EMPTY_REPLAY_ID`, `RE2_EMPTY_EVENT_NAME`, `RE3_EVENT_TIME_NOT_POSITIVE`                                                                                                                                                                                                                                                                                                    |
| `RESPONSE` | `RESPONSE_VALIDATION_ERROR`                                                                                                                                                                                                                                                                                                                                                     |
| `RL`       | `RL1_UNKNOWN_REPORT_TYPE`, `RL2_INVALID_SLUG`, `RL3_UNKNOWN_REGION`, `RL4_REPORT_TYPE_CONFLICT`, `RL5_RESOLVED_REPORT_INCONSISTENT`, `RL6_INVALID_ID`                                                                                                                                                                                                                           |
| `RP`       | `RP1_EMPTY_REPLAY_ID`, `RP2_PROJECT_ID_NOT_POSITIVE`, `RP3_START_TIME_NOT_POSITIVE`, `RP4_TIME_ORDER`, `RP5_INVALID_RETENTION_DAYS`                                                                                                                                                                                                                                             |
| `RS`       | `RS1_EMPTY_REPLAY_ID`, `RS2_PROJECT_ID_NOT_POSITIVE`, `RS3_START_TIME_NOT_POSITIVE`, `RS4_INVALID_RETENTION_DAYS`                                                                                                                                                                                                                                                               |
| `SG`       | `SG1_UNKNOWN_STRING_OPERATOR`, `SG2_UNKNOWN_NUMBER_OPERATOR`, `SG3_UNKNOWN_DATETIME_OPERATOR`, `SG4_UNSUPPORTED_PROPERTY_TYPE`                                                                                                                                                                                                                                                  |
| `SR`       | `SR1_URL_NO_TRAILING_SLASH`, `SR2_EMPTY_QUERY_STRING`, `SR3_INVALID_ENV`, `SR4_SIGNED_AT_NEGATIVE`                                                                                                                                                                                                                                                                              |
| `TC`       | `TC0_INVALID_TYPE`, `TC1_REJECTS_DATE`, `TC1_REQUIRES_UNIT`, `TC1B_INVALID_UNIT`, `TC2_REJECTS_UNIT`, `TC2_REQUIRES_DATE`, `TC3_DATE_FORMAT`, `TC3B_DATE_INVALID`                                                                                                                                                                                                               |
| `UA`       | `UA1_TIMESTAMP_NOT_POSITIVE`, `UA2_EMPTY_TARGET_DESC`                                                                                                                                                                                                                                                                                                                           |
| `WR`       | `WR1_TOO_MANY_EVENT_PROPERTIES`, `WR2_LIMIT_TOO_SMALL`, `WR3_LIMIT_TOO_LARGE`, `WR4_REPLAY_SELECTOR_REQUIRED`, `WR5_DATE_RANGE_REQUIRED`                                                                                                                                                                                                                                        |
| `WS`       | `WS1_TARGET_MUTUALLY_EXCLUSIVE`, `WS2_INVALID_LEVEL`                                                                                                                                                                                                                                                                                                                            |

Nine bookmark-validation codes are reused by guard twins — sites that are checked both by a builder and by the bookmark schema, so the same code appears whichever check fires first: `CM5_INLINE_COHORT_METRIC`, `FL3_FORWARD_RANGE`, `FL4_REVERSE_RANGE`, `V8_DATE_FORMAT`, `V8_DATE_INVALID`, `V12_BUCKET_SIZE_POSITIVE`, `V13_METRIC_MATH_PROPERTY`, `V18_BUCKET_ORDER`, `V26_PERCENTILE_REQUIRES_VALUE`.

### Codes minted outside the registry

A few codes belong to no class default and no guard family:

| Code                                                                                                                                                                                                                           | Raised by                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HTTP_ERROR`                                                                                                                                                                                                                   | `MixpanelHeadlessError` — network, transport, timeout or residual-status failure; the original exception is in `cause`                             |
| `OAUTH_REFRESH_ERROR`, `OAUTH_REFRESH_REVOKED`, `OAUTH_REGISTRATION_ERROR`, `OAUTH_TIMEOUT`, `OAUTH_PORT_ERROR`, `OAUTH_BROWSER_ERROR`, `OAUTH_AUTH_DENIED`, `OAUTH_STATE_MISMATCH`, `OAUTH_CONFIG_ERROR`, `OAUTH_PASTE_ERROR` | `OAuthError` — the specific stage of the PKCE flow or refresh that failed                                                                          |
| `PY_INT_UNSAFE_INTEGER`, `PY_INT_NON_FINITE`, `PY_INT_INVALID_LITERAL`                                                                                                                                                         | `MixpanelHeadlessError` — an integer beyond ±(2<sup>53</sup> − 1), a non-finite number, or a non-numeric string where Python's `int()` is mirrored |
| `BROWSER_SERVICE_ACCOUNT_REFUSED`, `BROWSER_EXPORT_UNSUPPORTED`, `BROWSER_NO_PENDING_LOGIN`                                                                                                                                    | `BrowserUnsupportedError` (`@mixpanel-headless/browser`)                                                                                           |
| `UNPORTED_RESOLVER_SEAM`, `UNPORTED_AUTH_SEAM`, `UNPORTED_FILE_READ_SEAM`                                                                                                                                                      | `MixpanelHeadlessError` — a `Workspace` built without the corresponding injected seam (for example `ws.use({ account })` on a browser workspace)   |

Report-link and session-replay subclasses also refine their class default with a more specific code (`REPORT_LINK_REGION_MISMATCH`, `UNSUPPORTED_DASHBOARD_LINK`, `SHORT_LINK_NO_LOCATION`, `SESSION_RECORDING_SENSITIVE_DATA`, …); the class tells you the family, the code tells you the cause, and `details.hint` tells you what to do.

## Next steps

- [Coming from the Python library?](/guide/coming-from-python) — `except` → `instanceof`
- [Configuration](/getting-started/configuration) — what a `ConfigError` is asking you to fix
- [In the browser](/guide/browser) — the browser-only refusals
