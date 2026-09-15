/**
 * `pythonCompat` module of @mixpanel-headless/core (rulebook §11; D13).
 *
 * Python stdlib semantics ported once, first — every later port batch
 * imports these; no module re-derives them (root cause of parity findings
 * P1, P2, P6 and half the semantic-trap watchlist).
 */
export {
  codepoints,
  compareCodepoints,
  compareCodeUnits,
  cpLength,
  cpSlice,
  sortedByCodepoint,
} from "./codepoint.js";
export { getCloseMatches } from "./difflib.js";
export { isPythonDict, setOwn } from "./python-dict.js";
export { pythonFloat } from "./python-float.js";
export { pythonFloatCoerce } from "./python-float-coerce.js";
export { pythonFloatStr } from "./python-float-str.js";
export { pythonInt } from "./python-int.js";
export { pythonJsonDumps } from "./python-json-dumps.js";
export { pythonJsonDumpsCanonical } from "./python-json-dumps-canonical.js";
export type { PythonValue } from "./python-str.js";
export { pythonRepr, pythonStr, pythonStrOf } from "./python-str.js";
export { pythonStrip } from "./python-strip.js";
export {
  codepointGreater,
  dictGet,
  floatCarrierValue,
  isFloatCarrier,
  isPythonFloat,
  isPythonInt,
  pythonIterableElements,
  pythonListRepr,
  pythonNumberStr,
  pythonStrLoose,
  pythonStrValue,
  pythonTypeName,
  requireHashable,
} from "./python-values.js";
export { zfill } from "./zfill.js";
