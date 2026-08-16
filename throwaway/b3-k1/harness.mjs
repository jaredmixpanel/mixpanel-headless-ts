/**
 * B3-K1 R10.9 differential harness, Node driver.
 *
 * Modes:
 *   node harness.mjs enums     -> dump every enums.ts table as JSON
 *   node harness.mjs replay F  -> replay a CPython oracle file F
 *   node harness.mjs dispatch  -> get_root_model_for_bookmark_type probe
 *
 * The oracle files are produced by the Python half
 * (`dump-cases.py`, `fuzz-cases.py`) driving the REAL
 * `bookmark_schema.validate_with_pydantic`; this side drives the REAL
 * `packages/core/src/bookmarks/schema.ts` through `.build/entry.mjs`.
 */

import { readFileSync } from "node:fs";
import {
  BOOKMARK_MODEL_HANDLES,
  getRootModelForBookmarkType,
  enums,
} from "./.build/entry.mjs";

/** PyFloat carrier stand-in: a class instance, never a plain dict. */
class PyFloatStub {
  constructor(spelling) {
    this.spelling = spelling;
  }
}

/** Rebuild the PyFloat carriers the Python encoder wrapped. */
function decode(value) {
  if (Array.isArray(value)) {
    return value.map(decode);
  }
  if (value !== null && typeof value === "object") {
    if (Object.hasOwn(value, "__pyfloat__") && Object.keys(value).length === 1) {
      return new PyFloatStub(String(value.__pyfloat__));
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = decode(v);
    return out;
  }
  return value;
}

/** Dump the ported enum tables for the parity audit. */
function dumpEnums() {
  const out = {};
  for (const [name, value] of Object.entries(enums)) {
    if (value instanceof Set) {
      out[name] = [...value].sort();
    } else if (value instanceof Map) {
      const obj = {};
      for (const k of [...value.keys()].sort()) obj[String(k)] = value.get(k);
      out[name] = obj;
    } else if (typeof value === "number") {
      out[name] = value;
    }
  }
  console.log(JSON.stringify(out, null, 1));
}

/** Replay one CPython oracle file and report divergences. */
function replay(file) {
  const rows = JSON.parse(readFileSync(file, "utf8"));
  let compared = 0;
  let divergences = 0;
  let skipped = 0;
  for (const row of rows) {
    const handle = BOOKMARK_MODEL_HANDLES.get(row.model);
    if (handle === undefined) {
      skipped += 1;
      console.log(`SKIP (no handle) ${row.case} [${row.model}]`);
      continue;
    }
    compared += 1;
    const actual = handle
      .validate(decode(row.input))
      .map((e) => [e.type, [...e.loc]]);
    if (JSON.stringify(actual) !== JSON.stringify(row.errors)) {
      divergences += 1;
      console.log(`DIVERGENCE ${row.case} [${row.model}]`);
      console.log(`  py: ${JSON.stringify(row.errors)}`);
      console.log(`  ts: ${JSON.stringify(actual)}`);
    }
  }
  console.log(
    `${file}: compared=${compared} divergences=${divergences} skipped=${skipped} rows=${rows.length}`,
  );
  return divergences;
}

/** Exhaustive-with-junk probe of the root-model dispatch. */
function dispatch() {
  const inputs = [
    "insights",
    "funnels",
    "retention",
    "flows",
    "user",
    "",
    "insightz",
    "USER",
    "\u{1D4B3}",
    "sorting",
    "displayOptions",
  ];
  const out = {};
  for (const bt of inputs) {
    const handle = getRootModelForBookmarkType(bt);
    out[bt] = handle === null ? null : handle.name;
  }
  console.log(JSON.stringify(out, null, 1));
}

const [mode, arg] = process.argv.slice(2);
if (mode === "enums") {
  dumpEnums();
} else if (mode === "replay") {
  process.exitCode = replay(arg) === 0 ? 0 : 1;
} else if (mode === "dispatch") {
  dispatch();
} else {
  console.log("usage: node harness.mjs enums|replay FILE|dispatch");
  process.exitCode = 2;
}
