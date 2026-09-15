// Provenance check for the four CPython-generated artefacts (the three
// compat tables under packages/core/src/compat/*.gen.ts and the canonical
// json.dumps fixture table). Byte-exact regeneration needs the pinned
// interpreter through `uv` and stays manual (`npm run generate:compat-tables`,
// `npm run generate:canonical-fixtures`), so instead of re-running the
// generators this test pins what each header records:
//
// - the CPython / Unicode versions equal scripts/compat-python.pin.json
//   (a table emitted by another interpreter carries another Unicode
//   database and is wrong even when it looks plausible);
// - the embedded generator sha256 equals the current bytes of the
//   generator script (an edited generator whose output was not re-emitted);
// - the counts the header claims equal what the body contains (a hand edit
//   to a generated file);
// - the fixture table's corpus pin equals corpus.config.json (a corpus
//   re-pin without a fixture refresh — the sample is drawn from the corpus);
// - the npm scripts select exactly the pinned interpreter.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

function sha256OfFile(rel: string): string {
  return createHash("sha256")
    .update(readFileSync(join(REPO_ROOT, rel)))
    .digest("hex");
}

function sha256OfText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`${what} missing`);
  }
  return value;
}

interface InterpreterPin {
  readonly cpython: string;
  readonly unicode: string;
}

const PIN = JSON.parse(
  read("scripts/compat-python.pin.json"),
) as InterpreterPin;

const UV_PREFIX = `uv run --python ${PIN.cpython} --no-project python `;

// ---------------------------------------------------------------------------
// The three compat tables
// ---------------------------------------------------------------------------

const PROVENANCE_RE =
  /^\/\/ Provenance: CPython (?<cpython>\d+\.\d+\.\d+), Unicode database (?<unicode>\d+\.\d+\.\d+), (?<counts>.+)$/m;
const GENERATOR_RE =
  /^\/\/ Generator sha256: (?<sha>[0-9a-f]{64}) \((?<script>scripts\/[\w.-]+\.py)\)\.$/m;

interface TableSpec {
  readonly table: string;
  readonly generator: string;
  /** Numbers in the header's trailing count phrase, in order. */
  readonly counts: RegExp;
  /** The same numbers measured from the emitted body. */
  readonly measure: (body: string) => number[];
}

const HEX_PAIR_ROW = /^ {2}\[0x[0-9a-f]+, 0x[0-9a-f]+\],$/gm;
const RUN_ROW = /^ {2}\[0x[0-9a-f]+, \d+, (?<length>\d+)\],$/gm;
const CODEPOINT_ROW = /^ {2}0x[0-9a-f]+,$/gm;

const TABLES: readonly TableSpec[] = [
  {
    table: "packages/core/src/compat/non-printable.gen.ts",
    generator: "scripts/generate-non-printable.py",
    counts: /^(?<ranges>\d+) ranges\.$/,
    measure: (body) => [[...body.matchAll(HEX_PAIR_ROW)].length],
  },
  {
    table: "packages/core/src/compat/decimal-digits.gen.ts",
    generator: "scripts/generate-decimal-digits.py",
    counts: /^(?<runs>\d+) runs \/ (?<codepoints>\d+) codepoints\.$/,
    measure: (body) => {
      const runs = [...body.matchAll(RUN_ROW)];
      const codepoints = runs.reduce(
        (sum, m) => sum + Number(must(m.groups?.["length"], "run length")),
        0,
      );
      return [runs.length, codepoints];
    },
  },
  {
    table: "packages/core/src/compat/whitespace.gen.ts",
    generator: "scripts/generate-whitespace.py",
    counts: /^(?<str>\d+) str \/ (?<numeric>\d+) numeric codepoints\.$/,
    measure: (body) => {
      const split = body.indexOf("export const PYTHON_NUMERIC_WHITESPACE");
      expect(split).toBeGreaterThan(0);
      return [
        [...body.slice(0, split).matchAll(CODEPOINT_ROW)].length,
        [...body.slice(split).matchAll(CODEPOINT_ROW)].length,
      ];
    },
  },
];

describe.each(TABLES)("$table", ({ table, generator, counts, measure }) => {
  const body = read(table);
  const provenance = must(
    PROVENANCE_RE.exec(body)?.groups,
    "provenance header",
  );
  const generated = must(GENERATOR_RE.exec(body)?.groups, "generator header");

  it("was emitted by the pinned CPython / Unicode database", () => {
    expect(provenance["cpython"]).toBe(PIN.cpython);
    expect(provenance["unicode"]).toBe(PIN.unicode);
  });

  it("records the sha256 of the generator that produced it", () => {
    expect(generated["script"]).toBe(generator);
    expect(generated["sha"]).toBe(sha256OfFile(generator));
  });

  it("header counts match the emitted body", () => {
    const claimed = must(
      counts.exec(must(provenance["counts"], "counts")),
      "count phrase",
    )
      .slice(1)
      .map(Number);
    expect(measure(body)).toStrictEqual(claimed);
  });

  it("is invoked through the pinned interpreter by npm", () => {
    const scripts = (
      JSON.parse(read("package.json")) as { scripts: Record<string, string> }
    ).scripts;
    const steps = must(
      scripts["generate:compat-tables"],
      "generate:compat-tables",
    ).split(" && ");
    expect(steps).toContain(`${UV_PREFIX}${generator}`);
  });
});

// ---------------------------------------------------------------------------
// The canonical json.dumps fixture table
// ---------------------------------------------------------------------------

interface FixtureRow {
  readonly name: string;
  readonly canonical: string;
  readonly sha256: string;
}

interface FixtureDocument {
  readonly $comment: readonly string[];
  readonly fixtures: readonly FixtureRow[];
}

const FIXTURES = "packages/core/test/compat/fixtures/canonical-fixtures.json";
const FIXTURES_GENERATOR = "scripts/generate-canonical-fixtures.py";
const FIXTURE_PROVENANCE_RE =
  /^Provenance: CPython (?<cpython>\d+\.\d+\.\d+), corpus pin (?<pin>[0-9a-f]{40}), (?<count>\d+) fixtures\.$/;
const FIXTURE_GENERATOR_RE =
  /^Generator sha256: (?<sha>[0-9a-f]{64}) \((?<script>scripts\/[\w.-]+\.py)\)\.$/;

describe("canonical-fixtures.json (CPython json.dumps oracle table)", () => {
  const document = JSON.parse(read(FIXTURES)) as FixtureDocument;
  const comment = document.$comment;
  const provenance = must(
    comment
      .map((line) => FIXTURE_PROVENANCE_RE.exec(line)?.groups)
      .find(Boolean),
    "provenance line",
  );
  const generated = must(
    comment
      .map((line) => FIXTURE_GENERATOR_RE.exec(line)?.groups)
      .find(Boolean),
    "generator line",
  );

  it("was emitted by the pinned CPython", () => {
    expect(provenance["cpython"]).toBe(PIN.cpython);
  });

  it("samples the corpus at the pin conformance-runner/corpus.config.json names", () => {
    const config = JSON.parse(
      read("conformance-runner/corpus.config.json"),
    ) as {
      sourceCommit: string;
    };
    expect(provenance["pin"]).toBe(config.sourceCommit);
  });

  it("claims exactly the rows it carries", () => {
    expect(Number(provenance["count"])).toBe(document.fixtures.length);
  });

  it("records the sha256 of the generator that produced it", () => {
    expect(generated["script"]).toBe(FIXTURES_GENERATOR);
    expect(generated["sha"]).toBe(sha256OfFile(FIXTURES_GENERATOR));
  });

  it("every row's sha256 is the hash of its canonical bytes (the QueryRef hash)", () => {
    for (const row of document.fixtures) {
      expect(row.sha256, row.name).toBe(sha256OfText(row.canonical));
    }
  });

  it("is invoked through the pinned interpreter by npm, then Prettier", () => {
    const scripts = (
      JSON.parse(read("package.json")) as { scripts: Record<string, string> }
    ).scripts;
    const steps = must(
      scripts["generate:canonical-fixtures"],
      "generate:canonical-fixtures",
    ).split(" && ");
    expect(steps[0]).toBe(`${UV_PREFIX}${FIXTURES_GENERATOR}`);
    expect(steps[1]).toBe(`prettier --write ${FIXTURES}`);
  });
});
