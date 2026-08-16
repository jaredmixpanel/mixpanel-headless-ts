/**
 * B3-K3 R10.9 harness bundle entry — the REAL ported modules, nothing
 * re-implemented (P3-5 rule 3 in spirit: the harness calls the same
 * entry points the bindings will).
 */

export { buildSegfilterEntry } from "../../packages/core/src/query/segfilter.js";
export { normalizeOnExpression } from "../../packages/core/src/query/expressions.js";
export {
  transformEvent,
  transformProfile,
} from "../../packages/core/src/query/transforms.js";
export { Filter } from "../../packages/core/src/types/index.js";
