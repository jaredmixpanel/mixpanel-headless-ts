/**
 * Throwaway probe: does `pythonStrip` strip U+001F the way CPython's
 * `str.strip()` does (`"\x1f".isspace() is True`), while JS `trim()`
 * does not? Feeds the W3 flake note in `B6-W6-notes.md` §4.
 */
import { pythonStrip } from "../../packages/core/src/compat/index.js";

const ctrl = String.fromCharCode(0x1f);
console.log("pythonStrip:", JSON.stringify(pythonStrip(ctrl)));
console.log("trim:", JSON.stringify(ctrl.trim()));
