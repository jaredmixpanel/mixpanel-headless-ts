/**
 * Re-export of the core `parse_qs` twin — the module body moved to
 * `packages/core/src/auth/query-params.ts` at B9-R2 (b9-packets.md
 * §3.1 row 2, the fetch-pure hoist; R10.8: shared internals ported
 * once, by name). Keeping this file preserves every existing node
 * import path; the untouched B8 suites are the zero-behavior-change
 * proof.
 */

export { parseQs, pythonUnquote } from "../../../core/src/auth/query-params.js";
