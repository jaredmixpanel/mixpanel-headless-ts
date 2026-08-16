/**
 * `pythonCompat` module of @mixpanel-headless/core (rulebook §11; D13).
 *
 * Python stdlib semantics ported once, first — every later port batch
 * imports these; no module re-derives them (root cause of parity findings
 * P1, P2, P6 and half the semantic-trap watchlist).
 */
export {
  compareCodepoints,
  cpLength,
  cpSlice,
  sortedByCodepoint,
} from "./codepoint.js";
export { pythonFloat } from "./python-float.js";
export { pythonFloatStr } from "./python-float-str.js";
export { pythonInt } from "./python-int.js";
export { pythonJsonDumps } from "./python-json-dumps.js";
export { pythonStrip } from "./python-strip.js";
export { pythonRepr, pythonStr } from "./python-str.js";
export type { PythonValue } from "./python-str.js";
export { zfill } from "./zfill.js";
