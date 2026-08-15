/**
 * Shared HTTP-client internals of @mixpanel-headless/core — Phase-3
 * packet B0-2 (R10.8: `app_request`, `_handle_response`, retry/backoff,
 * `maybe_scoped_path`, `_iter_jsonl_lines`, `_request_headers`, URL
 * building, and the lossless response-body parser are ported ONCE, here,
 * by name; every later batch imports these — B4 domain shards and B6
 * entity clients never re-implement them).
 *
 * Most of this surface is `@internal`-grade plumbing that the B4
 * `createMixpanelClient` assembly consumes; it is exported (R2.8: no
 * `private` across module boundaries) but not part of the end-user
 * facade.
 */

export { appRequest } from "./app-request.js";
export type { AppRequestDeps, AppRequestOptions } from "./app-request.js";
export {
  BACKOFF_BASE_SECONDS,
  BACKOFF_MAX_SECONDS,
  calculateBackoff,
  parseRetryAfter,
  retryWaitSeconds,
} from "./backoff.js";
export type { HeaderCarrier, RandomSource } from "./backoff.js";
export {
  QUERY_ORIGIN,
  getEntryPoint,
  getUserAgent,
  requestHeaders,
  setEntryPoint,
} from "./headers.js";
export type { EntryPoint, RequestHeadersDeps } from "./headers.js";
export {
  MixpanelHttpError,
  errorMessage,
  executeWithRetry,
  handleResponse,
  isPlainRecord,
  parseBody,
} from "./internals.js";
export type {
  ExecuteWithRetryArgs,
  RequestExecutor,
  ResponseContext,
  RetryExecutorDeps,
  RetryLogger,
  TransportRequestOptions,
  WireResponse,
} from "./internals.js";
export { JsonNumber } from "./json-value.js";
export type { JsonValue } from "./json-value.js";
export { iterJsonlLines } from "./jsonl.js";
export { LosslessJsonError, parseLossless } from "./lossless-json.js";
export { maybeScopedPath } from "./scope.js";
export type { PathScope } from "./scope.js";
export { ENDPOINTS, buildUrl, endpointBase } from "./url.js";
export type { EndpointKind } from "./url.js";
