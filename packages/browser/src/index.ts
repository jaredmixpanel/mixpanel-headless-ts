/**
 * @mixpanel-headless/browser — browser-specific surface (rulebook
 * R9.3): injectable `CredentialStore` (in-memory default; documented
 * localStorage adapter with security warning), first-class
 * `oauth_token` mode, service-account runtime refusal, Export-API
 * exclusion (plan §4.3: Export is Node-only), and — landing in B9-R2 —
 * the redirect-based PKCE flow over the core WebCrypto primitives.
 *
 * One entry point (R7-consistent): browser implementations plus
 * re-exports of the core surface a browser consumer needs — including
 * the pure query vocabulary (`Filter`, `Metric`, `CohortDefinition`, …)
 * that a page needs at runtime to rebuild params from its own controls.
 */

/** Package name constant exercised by the skeleton smoke test. */
export const BROWSER_PACKAGE_NAME = "@mixpanel-headless/browser";

// ── Browser implementations (B9-R1) ────────────────────────────────────
export {
  InMemoryCredentialStore,
  LocalStorageCredentialStore,
  type StorageLike,
} from "./credential-store.js";
export {
  browserSession,
  createBrowserWorkspace,
  createBrowserWorkspaceFromStore,
  type BrowserSessionOptions,
  type BrowserWorkspaceFromStoreOptions,
  type BrowserWorkspaceOptions,
} from "./client.js";
export {
  BROWSER_EXPORT_UNSUPPORTED,
  BROWSER_NO_PENDING_LOGIN,
  BROWSER_SERVICE_ACCOUNT_REFUSED,
  BrowserUnsupportedError,
} from "./errors.js";
export {
  serializeClientInfoPayload,
  serializeTokensPayload,
} from "./token-serialization.js";

// ── Redirect PKCE flow (B9-R2, b9-packets.md §3.2) ─────────────────────
export {
  beginLogin,
  completeLogin,
  DEFAULT_MAX_PENDING_AGE_MS,
  type BeginLoginOptions,
  type BeginLoginResult,
  type CompleteLoginOptions,
} from "./redirect-flow.js";
export {
  ensureBrowserClientRegistered,
  type EnsureBrowserClientRegisteredOptions,
} from "./registration.js";

// ── Core re-exports (the surface a browser consumer needs — §2.5) ─────
export { CREDENTIAL_KEYS, type CredentialStore } from "@mixpanel-headless/core";
export { PkceChallenge } from "@mixpanel-headless/core";
export type { Account, Region } from "@mixpanel-headless/core";
export type { Session } from "@mixpanel-headless/core";
export {
  OAuthTokens,
  parseOAuthClientInfo,
  parseOAuthTokens,
  type OAuthClientInfo,
} from "@mixpanel-headless/core";
// TYPE-ONLY re-export (pair-B FB-2, b9-reviewB-threat.md F2): a VALUE
// export let `new Workspace({session})` accept a service-account
// session with neither the §2.3 SA gate nor the §2.4 export guard.
// Annotations keep working; construction goes through the gated
// factories (`createBrowserWorkspace` / `createBrowserWorkspaceFromStore`).
export type { Workspace } from "@mixpanel-headless/core";
// The error hierarchy (coded errors; programs key on `.code` — R5).
// Listed by name: `export *` from another package would forward whatever
// core adds later without this barrel's review.
export {
  APIError,
  AccountExistsError,
  AccountInUseError,
  AccountNotFoundError,
  AuthenticationError,
  BookmarkValidationError,
  BusinessContextValidationError,
  ConfigError,
  DateRangeTooLargeError,
  EventNotFoundError,
  InvalidArgumentError,
  MixpanelHeadlessError,
  OAuthError,
  ParamTypeError,
  ParamValidationError,
  ProjectNotFoundError,
  QueryError,
  RateLimitError,
  RegionProbeError,
  RegionProbeNetworkError,
  ReplayNotFoundError,
  ReportLinkError,
  ReportLinkNotFoundError,
  ReportLinkParseError,
  ReportLinkScopeMismatchError,
  ResponseValidationError,
  ServerError,
  SessionReplayAccessError,
  SessionReplayError,
  ShortLinkResolutionError,
  SignedURLExpiredError,
  UnsupportedReplayFormatError,
  UnsupportedReportLinkError,
  ValidationError,
  WorkspaceScopeError,
  type APIErrorOptions,
  type AuthenticationErrorOptions,
  type ErrorDict,
  type InvalidArgumentErrorOptions,
  type InvalidArgumentViolation,
  type QueryErrorOptions,
  type RateLimitErrorOptions,
  type RegionProbeAttempt,
  type RegionProbeErrorOptions,
  type ReportLinkErrorOptions,
  type ServerErrorOptions,
  type SessionReplayErrorOptions,
  type ValidationSeverity,
} from "@mixpanel-headless/core";

// ── Query vocabulary (core re-exports) ────────────────────────────────
// Browser pages BUILD queries client-side: a control moves, the page
// rebuilds params (`Filter.equals(…)`, `new FunnelStep({…})`, an inline
// `CohortDefinition`) and re-queries. That vocabulary therefore has to
// have a runtime presence on THIS entry point — a bundled build of
// `packages/browser` (esbuild IIFE) exposes exactly what this barrel
// exports, and a page has no other module to import from.
//
// Safe by construction, and deliberately unlike the `Workspace` case
// above: these are the pure `types/query-params` dataclasses plus
// `validate_bookmark`. They hold no session, open no socket and reach
// no transport.
//
// The graph is not small — measured with esbuild on 2026-09-03, these
// builders plus `validateBookmark` pull 69 core modules (70 once the
// entity-params and identity-helper subsections below are counted in),
// spanning `compat/`, `types/` (query-params, entities, results,
// literals/enums), `query/` validation, `bookmarks/` (enums,
// schema-sorting, infer-type), `replays/`, `coerce` and the error
// hierarchy. Size is not the property that matters; SHAPE is. What the
// graph contains is dataclasses, validators and pure Python-parity
// helpers. What it contains ZERO of is a way to talk to Mixpanel:
// no `auth/` module, no `client/transport`, no `client/client`. The one
// `client/` file reached is `client/json-value.ts`, a JSON type/guard
// module with no I/O.
//
// That is why they cannot bypass the §2.3 service-account gate or the
// §2.4 export guard — they never touch `fetch`; the gated factories
// remain the only way to get something that does.
// `query-vocabulary.test.ts` pins both that identity-with-core property
// and the absence of a transport seam, and fails if core grows a
// runtime export in `types/query-params` this barrel does not forward.
export {
  CohortBreakdown,
  CohortCriteria,
  CohortDefinition,
  CohortMetric,
  CustomPropertyRef,
  Exclusion,
  Filter,
  FlowStep,
  Formula,
  FrequencyBreakdown,
  FrequencyFilter,
  FunnelStep,
  GroupBy,
  HoldingConstant,
  InlineCustomProperty,
  ListItemGroupMode,
  Metric,
  PropertyInput,
  RetentionEvent,
  TimeComparison,
  type DidEventOptions,
  type DidNotDoEventOptions,
  type ExclusionFields,
  type FilterFields,
  type FilterValue,
  type FlowStepFields,
  type FrequencyBreakdownFields,
  type FrequencyFilterFields,
  type FunnelStepFields,
  type GroupByFields,
  type HasPropertyOperator,
  type HasPropertyType,
  type HoldingConstantFields,
  type MetricFields,
  type PropertySpec,
  type RetentionEventFields,
} from "@mixpanel-headless/core";
// The ONE public member of core's `query/` subtree (core barrel
// comment: Python `__all__` entry `validate_bookmark`) — pages
// pre-flight the params they assemble before spending a lease call.
// The rest of `query/` mirrors Python `_internal` and is NOT reached
// into from here.
export { validateBookmark } from "@mixpanel-headless/core";
export type { ValidateBookmarkOptions } from "@mixpanel-headless/core";

// ── Entity params exposed for v1 write scopes ─────────────────────────
// Annotations is the ONE grantable write class in v1 (heads spec 05
// §2.1, §3.2 rule 7), and `ws.createAnnotation(params)` takes a
// `CreateAnnotationParams` INSTANCE — so a page holding that scope
// cannot call it unless the class has a runtime presence here.
//
// This subsection is deliberately one class wide. The other ~119
// entity models stay off the browser barrel; a further `Create*Params`
// is added here ONLY when its write class becomes grantable to a page.
// Like the builders above this is a pure `EntityModel` dataclass — it
// validates and shapes a payload, it does not send one — so it opens
// no path around the §2.3 service-account gate or the §2.4 export
// guard. `query-vocabulary.test.ts` pins the identity, the absence of
// a transport seam, and the one-class scope.
export { CreateAnnotationParams } from "@mixpanel-headless/core";

// ── Identity helpers (core re-exports) ────────────────────────────────
// Pages compute and cite QueryRef hashes (heads spec 02 §3.3): the hash
// is taken over `pythonJsonDumpsCanonical(params)` — CPython-parity
// `json.dumps(…, sort_keys=True, separators=(",", ":"))` — and the ref
// is labelled with the report type `inferBookmarkType(params)` derives.
// A page that builds params from its own controls therefore needs both
// at runtime on THIS entry point, for the same reason the vocabulary
// above is here: the vendored IIFE exposes exactly this barrel.
//
// Same posture as the builders — pure functions over plain data, no
// session, no transport (`inferBookmarkType` adds only
// `bookmarks/infer-type`; the canonicalizer is already in the graph).
export { inferBookmarkType } from "@mixpanel-headless/core";
export { pythonJsonDumpsCanonical } from "@mixpanel-headless/core";
