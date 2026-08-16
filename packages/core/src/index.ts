/**
 * @mixpanel-headless/core — isomorphic core of the mixpanel_headless port.
 *
 * The module directories are laid out per the D11 design; `compat/` is the
 * first implemented module (TS-2, rulebook §11). Core is pure per R9.1 —
 * no Node built-ins, no undici, no `process` access.
 */
export * from "./compat/index.js";

// Phase-2 contract layer (P2-2): error taxonomy + Secret + coercion +
// invariant. `errors-codes.gen.ts` internals (parent-edge/default-code
// maps) stay module-scoped for the C8(c) registry test; the two registry
// sets mirror Python's `exceptions` module surface and re-export via
// errors.ts.
export * from "./errors.js";
export * from "./secret.js";
export * from "./coerce.js";
export * from "./invariant.js";

// Phase-2 contract layer (P2-3): the 37 Literal-alias unions + runtime
// membership tuples and the 8 Python Enum-class ports (public `__all__`
// names — phase2-design C2). The bookmarks/ enum tables are Python
// `_internal` and intentionally NOT re-exported here.
export * from "./types/index.js";
export * from "./auth/index.js";

// Phase-3 B0-2 (R10.8): shared client internals — retry/backoff trio,
// `_handle_response`/`_execute_with_retry`/`app_request`, header merge,
// URL builder, JSONL splitter, scoped-path builder, and the lossless
// response-body parser (GATE-VERDICT R5). Internal plumbing for the B4
// client assembly; exported per R2.8 (no `private` across modules).
export * from "./client/index.js";

// Phase-3 B2 (shard V1b): the ONE public member of the `query/`
// subtree — Python's `validate_bookmark` (`__init__.py:9`, `__all__`
// entry `"validate_bookmark"`; phase2-audit A1 deferral, owner B2).
// The rest of `query/` mirrors Python `_internal` and stays unexported,
// as do the `bookmarks/` tables and the `bookmark_schema` sorting slice.
export { validateBookmark } from "./query/validation.js";
export type { ValidateBookmarkOptions } from "./query/validation.js";

// Phase-3 B5 (shard S3): the three PUBLIC members of `replay_labels.py`
// (`__init__.py` `__all__` entries `default_label_fn`,
// `selector_label_fn`, `url_normalizer` — the last three phase2-audit
// A1 deferrals). The rest of `replays/` mirrors Python `_internal`
// (`_internal/replays/rrweb_analyzer.py`, `aggregators.py`) and stays
// unexported, reachable through `src/replays/index.js` for the
// in-package consumers (`types/results/replays.ts`, `workspace.ts`).
export {
  defaultLabelFn,
  selectorLabelFn,
  urlNormalizer,
} from "./replays/replay-labels.js";

// Phase-3 B7 (shard A1): the namespace surface behind the four
// deferred `__all__` names `accounts` / `session` / `targets` /
// `login_unified` (playbook `:74-79`). Core exports FACTORIES over the
// injected `AuthEffects` bag plus the throwing `defaultAuthEffects()`;
// B8 exports the ready-made namespace objects bound to on-disk
// effects (`b7-packets.md` §3.1-§3.2).
export * from "./accounts/index.js";

/** Package name constant exercised by the skeleton smoke test. */
export const CORE_PACKAGE_NAME = "@mixpanel-headless/core";
