/**
 * B5-S3 R10.9 differential harness — the comparator.
 *
 *     npx vite-node throwaway/b5-s3/compare.ts
 *
 * Both sides are compared as PARSED JSON, which erases exactly one
 * documented narrowing: CPython's int/float spelling (`18.0` vs `18`),
 * which `toNativeJson` erases by contract (`json-value.ts:108-112`).
 * Nothing else is normalized — `-0` vs `0`, `true` vs `1`, key order in
 * arrays, and every string are compared verbatim.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/** One family's outputs, as loaded from a side's JSON. */
type Sides = Record<string, unknown[]>;

const HERE = dirname(fileURLToPath(import.meta.url));
const py = JSON.parse(readFileSync(join(HERE, "py-out.json"), "utf8")) as Sides;
const ts = JSON.parse(readFileSync(join(HERE, "ts-out.json"), "utf8")) as Sides;
const cases = JSON.parse(
  readFileSync(join(HERE, "cases.json"), "utf8"),
) as Sides;

/**
 * Stable JSON with object keys sorted (Python dict order vs JS insertion
 * order is not contract for these outputs — R4.10 note 10).
 *
 * @param value - The value to encode.
 * @returns The canonical encoding.
 */
function canon(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canon).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${canon(record[k])}`)
      .join(",")}}`;
  }
  if (typeof value === "number" && Object.is(value, -0)) {
    return "-0";
  }
  return JSON.stringify(value);
}

let compared = 0;
let diverged = 0;
const report: Array<{
  family: string;
  index: number;
  input: string;
  py: string;
  ts: string;
}> = [];
for (const family of Object.keys(py)) {
  const left = py[family];
  const right = ts[family] ?? [];
  let familyDiv = 0;
  for (let i = 0; i < left.length; i += 1) {
    compared += 1;
    const a = canon(left[i]);
    const b = canon(right[i]);
    if (a !== b) {
      diverged += 1;
      familyDiv += 1;
      if (familyDiv <= 3) {
        // Window on the FIRST differing code unit so long params dicts
        // do not hide the delta behind a shared prefix.
        let at = 0;
        while (at < a.length && at < b.length && a[at] === b[at]) {
          at += 1;
        }
        const lo = Math.max(0, at - 120);
        report.push({
          family,
          index: i,
          input: canon((cases[family] ?? [])[i]).slice(0, 400),
          py: `@${at} …${a.slice(lo, at + 160)}`,
          ts: `@${at} …${b.slice(lo, at + 160)}`,
        });
      }
    }
  }
  console.log(
    `${family.padEnd(26)} ${String(left.length).padStart(5)} compared  ${String(
      familyDiv,
    ).padStart(4)} diverged`,
  );
}
console.log(`\nTOTAL ${compared} compared / ${diverged} divergences`);
for (const row of report) {
  console.log(`\n--- ${row.family}[${row.index}]`);
  console.log(`in : ${row.input}`);
  console.log(`py : ${row.py}`);
  console.log(`ts : ${row.ts}`);
}
process.exitCode = diverged === 0 ? 0 : 1;
