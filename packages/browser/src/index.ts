/**
 * `@mixpanel-headless/browser` — the browser-specific surface of the
 * port: an injectable `CredentialStore` (in-memory default plus an
 * opt-in localStorage adapter with its security warning), first-class
 * `oauth_token` mode, a runtime refusal of service-account credentials,
 * exclusion of the Export API (its hosts serve no CORS headers, so a
 * browser call is dead on arrival), and the redirect-based PKCE login
 * flow built over core's WebCrypto primitives — plus a popup variant of
 * it for pages that are themselves embedded in another site.
 *
 * One entry point: the browser implementations plus re-exports of the
 * core surface a page needs at runtime — including the pure query
 * vocabulary (`Filter`, `Metric`, `CohortDefinition`, …) a page uses to
 * rebuild params from its own controls.
 *
 * @packageDocumentation
 */

// --- Browser implementations ---
export {
  browserSession,
  type BrowserSessionOptions,
  type BrowserWorkspaceFromStoreOptions,
  type BrowserWorkspaceOptions,
  createBrowserWorkspace,
  createBrowserWorkspaceFromStore,
} from "./client.js";
export {
  InMemoryCredentialStore,
  LocalStorageCredentialStore,
  type StorageLike,
} from "./credential-store.js";
export {
  BROWSER_EXPORT_UNSUPPORTED,
  BROWSER_NO_PENDING_LOGIN,
  BROWSER_POPUP_BLOCKED,
  BROWSER_POPUP_CLOSED,
  BROWSER_SERVICE_ACCOUNT_REFUSED,
  BrowserUnsupportedError,
} from "./errors.js";
export {
  serializeClientInfoPayload,
  serializeTokensPayload,
} from "./token-serialization.js";

// --- Redirect PKCE flow ---
export {
  beginLogin,
  type BeginLoginOptions,
  type BeginLoginResult,
  completeLogin,
  type CompleteLoginOptions,
  DEFAULT_MAX_PENDING_AGE_MS,
} from "./redirect-flow.js";
export {
  ensureBrowserClientRegistered,
  type EnsureBrowserClientRegisteredOptions,
} from "./registration.js";

// --- Popup PKCE flow ---
export {
  DEFAULT_POPUP_TIMEOUT_MS,
  loginInPopup,
  POPUP_RETURN_MESSAGE_TYPE,
  POPUP_WINDOW_NAME,
  type PopupHost,
  type PopupLoginOptions,
  type PopupWindowLike,
  relayPopupReturn,
  type RelayPopupReturnOptions,
} from "./popup-flow.js";

// --- Core re-exports (the surface a browser consumer needs) ---
export type { Account, Region } from "@mixpanel-headless/core";
export type { Session } from "@mixpanel-headless/core";
export { CREDENTIAL_KEYS, type CredentialStore } from "@mixpanel-headless/core";
export { PkceChallenge } from "@mixpanel-headless/core";
export {
  type OAuthClientInfo,
  OAuthTokens,
  parseOAuthClientInfo,
  parseOAuthTokens,
} from "@mixpanel-headless/core";
// Type-only re-export on purpose: a value export would let a page call
// `new Workspace({session})` with a service-account session, bypassing
// both the service-account refusal and the Export-API fetch guard.
// Annotations keep working; construction goes through the gated
// factories (`createBrowserWorkspace` / `createBrowserWorkspaceFromStore`).
export type { Workspace } from "@mixpanel-headless/core";
// The error hierarchy (coded errors; programs key on `.code`, never on
// message text). Listed by name: `export *` from another package would
// forward whatever core adds later without this barrel's review.
export {
  AccountExistsError,
  AccountInUseError,
  AccountNotFoundError,
  APIError,
  type APIErrorOptions,
  AuthenticationError,
  type AuthenticationErrorOptions,
  BookmarkValidationError,
  BusinessContextValidationError,
  ConfigError,
  DateRangeTooLargeError,
  type ErrorDict,
  EventNotFoundError,
  InvalidArgumentError,
  type InvalidArgumentErrorOptions,
  type InvalidArgumentViolation,
  MixpanelHeadlessError,
  OAuthError,
  ParamTypeError,
  ParamValidationError,
  ProjectNotFoundError,
  QueryError,
  type QueryErrorOptions,
  RateLimitError,
  type RateLimitErrorOptions,
  type RegionProbeAttempt,
  RegionProbeError,
  type RegionProbeErrorOptions,
  RegionProbeNetworkError,
  ReplayNotFoundError,
  ReportLinkError,
  type ReportLinkErrorOptions,
  ReportLinkNotFoundError,
  ReportLinkParseError,
  ReportLinkScopeMismatchError,
  ResponseValidationError,
  ServerError,
  type ServerErrorOptions,
  SessionReplayAccessError,
  SessionReplayError,
  type SessionReplayErrorOptions,
  ShortLinkResolutionError,
  SignedURLExpiredError,
  UnsupportedReplayFormatError,
  UnsupportedReportLinkError,
  ValidationError,
  type ValidationSeverity,
  WorkspaceScopeError,
} from "@mixpanel-headless/core";

// --- Query vocabulary (core re-exports) ---
// Browser pages build queries client-side: a control moves, the page
// rebuilds params (`Filter.equals(…)`, `new FunnelStep({…})`, an inline
// `CohortDefinition`) and re-queries. That vocabulary therefore needs a
// runtime presence on this entry point — a bundled build of
// `packages/browser` (esbuild IIFE) exposes exactly what this barrel
// exports, and a page has no other module to import from.
//
// Safe by construction, and deliberately unlike the `Workspace` case
// above: these are the pure `types/query-params` dataclasses plus
// `validate_bookmark`. They hold no session, open no socket and reach
// no transport. The module graph they pull in is not small (most of
// `compat/`, `types/`, `query/` validation, `bookmarks/`, `replays/`,
// `coerce` and the error hierarchy), but its shape is what matters:
// dataclasses, validators and pure Python-parity helpers, with no
// `auth/` module, no `client/transport` and no `client/client` — the
// one `client/` file reached is `client/json-value.ts`, a JSON
// type/guard module with no I/O. That is why they cannot bypass the
// service-account gate or the export guard — they never touch `fetch`;
// the gated factories remain the only way to get something that does.
// `query-vocabulary.test.ts` pins both that identity-with-core property
// and the absence of a transport seam, and fails if core grows a
// runtime export in `types/query-params` this barrel does not forward.
export {
  CohortBreakdown,
  CohortCriteria,
  CohortDefinition,
  CohortMetric,
  CustomPropertyRef,
  type DidEventOptions,
  type DidNotDoEventOptions,
  Exclusion,
  type ExclusionFields,
  Filter,
  type FilterFields,
  type FilterValue,
  FlowStep,
  type FlowStepFields,
  Formula,
  FrequencyBreakdown,
  type FrequencyBreakdownFields,
  FrequencyFilter,
  type FrequencyFilterFields,
  FunnelStep,
  type FunnelStepFields,
  GroupBy,
  type GroupByFields,
  type HasPropertyOperator,
  type HasPropertyType,
  HoldingConstant,
  type HoldingConstantFields,
  InlineCustomProperty,
  ListItemGroupMode,
  Metric,
  type MetricFields,
  PropertyInput,
  type PropertySpec,
  RetentionEvent,
  type RetentionEventFields,
  TimeComparison,
} from "@mixpanel-headless/core";
// The one public member of core's `query/` subtree (Python `__all__`
// entry `validate_bookmark`) — pages pre-flight the params they
// assemble before spending a lease call. The rest of `query/` mirrors
// Python `_internal` and is not reached into from here.
export type { ValidateBookmarkOptions } from "@mixpanel-headless/core";
export { validateBookmark } from "@mixpanel-headless/core";

// --- Entity params exposed for v1 write scopes ---
// Annotations is the one write class a page can be granted in v1, and
// `ws.createAnnotation(params)` takes a `CreateAnnotationParams`
// instance — so a page holding that scope cannot call it unless the
// class has a runtime presence here.
//
// This subsection is deliberately one class wide. The other entity
// models stay off the browser barrel; a further `Create*Params` is
// added here only when its write class becomes grantable to a page.
// Like the builders above this is a pure `EntityModel` dataclass — it
// validates and shapes a payload, it does not send one — so it opens
// no path around the service-account gate or the export guard.
// `query-vocabulary.test.ts` pins the identity, the absence of a
// transport seam, and the one-class scope.
export { CreateAnnotationParams } from "@mixpanel-headless/core";

// --- Identity helpers (core re-exports) ---
// Pages compute and cite QueryRef hashes: the hash is taken over
// `pythonJsonDumpsCanonical(params)` — CPython-parity
// `json.dumps(…, sort_keys=True, separators=(",", ":"))` — and the ref
// is labeled with the report type `inferBookmarkType(params)` derives.
// A page that builds params from its own controls therefore needs both
// at runtime on this entry point, for the same reason the vocabulary
// above is here: the vendored IIFE exposes exactly this barrel.
//
// Same posture as the builders — pure functions over plain data, no
// session, no transport (`inferBookmarkType` adds only
// `bookmarks/infer-type`; the canonicalizer is already in the graph).
export { inferBookmarkType } from "@mixpanel-headless/core";
export { pythonJsonDumpsCanonical } from "@mixpanel-headless/core";
