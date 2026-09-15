/**
 * Relocation shim — `query/python-builtins` moved to
 * `compat/python-builtins` (CLEANUP-PLAN §10.4, Phase 6 Lane 0). Kept only
 * so the frozen `internal.ts` barrel line keeps resolving until the Lane Ω
 * sweep deletes it; new code imports `../compat/python-builtins.js`.
 */
export {
  AttributeError,
  KeyError,
  OverflowError,
  RuntimeError,
  ValueError,
} from "../compat/python-builtins.js";
