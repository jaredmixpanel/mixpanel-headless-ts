// The playground's ranking report (docs/.vitepress/theme/demo/model/aha.ts):
// the loop program the code panel prints is built from the same candidate
// array and option literal as the calls that run (re-parsed here), it is
// laid out as Prettier would print it, the helper shown under it is the
// helper that ranks (its source text is held to the module), and the
// ranking over the demo fixtures tells the story the fixtures were made
// to tell.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { format } from "prettier";
import { describe, expect, it } from "vitest";

import { createBrowserWorkspace } from "@mixpanel-headless/browser";

import { DEMO_FIXTURES } from "../docs/.vitepress/theme/demo/fixtures/demo-project.gen.js";
import {
  ahaCalls,
  type AhaSpec,
  MAX_CANDIDATES,
  plannedBucket,
  RANK_BY_RETENTION_SOURCE,
  rankByRetention,
  rankingRows,
  renderAhaProgram,
  seedCandidates,
  sparklinePath,
  TARGET_BUCKET,
} from "../docs/.vitepress/theme/demo/model/aha.js";
import {
  READ_METHODS,
  runCall,
} from "../docs/.vitepress/theme/demo/model/call.js";
import {
  fixtureCoverage,
  fixtureFetch,
} from "../docs/.vitepress/theme/demo/model/fixture-fetch.js";
import type { RetentionResult } from "../docs/.vitepress/theme/demo/model/series.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODULE = join(REPO_ROOT, "docs/.vitepress/theme/demo/model/aha.ts");

const today = (): Date => new Date(2026, 8, 15);

/** The default offline run: born Signup, its top-event candidates, weekly, 30 days. */
const DEFAULT_SPEC: AhaSpec = {
  kind: "aha",
  born: "Signup",
  candidates: seedCandidates(
    DEMO_FIXTURES.topEvents.map((row) => row.event),
    "Signup",
    fixtureCoverage(DEMO_FIXTURES).retentionPairs["Signup"] ?? [],
  ),
  retentionUnit: "week",
  last: 30,
};

const SHORT_SPEC: AhaSpec = {
  kind: "aha",
  born: "Signup",
  candidates: ["Note Shared", "Note Saved", "Search"],
  retentionUnit: "week",
  last: 30,
};

/**
 * Turn a printed literal back into JSON: quote identifier keys and drop
 * trailing commas.
 *
 * @param text - A literal as `printArg` printed it.
 * @returns The parsed value.
 */
function reparse(text: string): unknown {
  return JSON.parse(
    text
      .replaceAll(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/gu, '$1"$2":')
      .replaceAll(/,(\s*[}\]])/gu, "$1"),
  ) as unknown;
}

/**
 * The candidate array, born event and option literal of a rendered
 * program, as printed.
 *
 * @param program - `renderAhaProgram(spec)`.
 * @returns The three literals' text.
 */
function literals(program: string): {
  candidates: string;
  born: string;
  options: string;
} {
  const candidates = /^const candidates = (\[[\s\S]*?\]);$/mu.exec(program);
  const call =
    /await ws\.queryRetention\(("(?:[^"\\]|\\.)*"), event, (\{[\s\S]*?\})\),$/mu.exec(
      program,
    );
  expect(candidates, "candidates literal").not.toBeNull();
  expect(call, "queryRetention call").not.toBeNull();
  return {
    candidates: candidates?.[1] ?? "",
    born: call?.[1] ?? "",
    options: call?.[2] ?? "",
  };
}

/**
 * A workspace over the fixtures.
 *
 * @returns The facade.
 */
function workspace(): ReturnType<typeof createBrowserWorkspace> {
  return createBrowserWorkspace({
    token: "demo",
    projectId: DEMO_FIXTURES.project.id,
    region: "us",
    workspaceId: DEMO_FIXTURES.project.workspaceId,
    fetch: fixtureFetch(DEMO_FIXTURES, { today }),
  });
}

/**
 * Run a report's calls the way the page does — sequentially, through
 * `runCall` — and return the results in candidate order.
 *
 * @param spec - The report.
 * @returns One result per candidate.
 */
async function runReport(spec: AhaSpec): Promise<RetentionResult[]> {
  const ws = workspace();
  const results: RetentionResult[] = [];
  for (const call of ahaCalls(spec)) {
    results.push((await runCall(ws, call)) as RetentionResult);
  }
  return results;
}

describe("ahaCalls", () => {
  it("builds one queryRetention call per candidate, in order, with the same option literal", () => {
    const calls = ahaCalls(DEFAULT_SPEC);
    expect(calls).toHaveLength(DEFAULT_SPEC.candidates.length);
    for (const [i, call] of calls.entries()) {
      expect(call.method).toBe("queryRetention");
      expect(READ_METHODS).toContain(call.method);
      expect(call.args).toStrictEqual([
        "Signup",
        DEFAULT_SPEC.candidates[i],
        { retention_unit: "week", last: 30 },
      ]);
      expect(call.binding).toBe(`results[${String(i)}]`);
      expect(call.imports).toStrictEqual([]);
    }
  });

  it("never emits limit", () => {
    for (const call of ahaCalls(DEFAULT_SPEC)) {
      expect(JSON.stringify(call.args)).not.toContain("limit");
    }
  });
});

describe("renderAhaProgram", () => {
  it("prints the default offline run", () => {
    expect(renderAhaProgram(SHORT_SPEC))
      .toBe(`const candidates = ["Note Shared", "Note Saved", "Search"];
const results = [];
for (const event of candidates) {
  results.push(
    await ws.queryRetention("Signup", event, {
      retention_unit: "week",
      last: 30,
    }),
  );
}
const ranking = rankByRetention(candidates, results, { bucket: 4 });
`);
  });

  const ROUND_TRIP: ReadonlyArray<readonly [string, AhaSpec]> = [
    ["three candidates", SHORT_SPEC],
    ["the default candidate set", DEFAULT_SPEC],
    [
      "daily buckets over 90 days",
      { ...DEFAULT_SPEC, retentionUnit: "day", last: 90 },
    ],
  ];

  it.each(ROUND_TRIP)(
    "re-parses to the executed calls' arguments: %s",
    (_name, spec) => {
      const { candidates, born, options } = literals(renderAhaProgram(spec));
      const parsedCandidates = reparse(candidates) as string[];
      const parsedOptions = reparse(options);
      const calls = ahaCalls(spec);
      expect(parsedCandidates).toHaveLength(calls.length);
      for (const [i, call] of calls.entries()) {
        expect(call.args).toStrictEqual([
          JSON.parse(born),
          parsedCandidates[i],
          parsedOptions,
        ]);
      }
    },
  );

  const LAYOUTS: ReadonlyArray<readonly [string, AhaSpec]> = [
    ["three candidates", SHORT_SPEC],
    ["the default candidate set", DEFAULT_SPEC],
    [
      "ten long names",
      {
        ...SHORT_SPEC,
        candidates: Array.from(
          { length: MAX_CANDIDATES },
          (_, i) => `Candidate Event Number ${String(i + 1)}`,
        ),
      },
    ],
  ];

  it.each(LAYOUTS)(
    "is laid out as Prettier prints it: %s",
    async (_name, spec) => {
      const program = renderAhaProgram(spec);
      await expect(format(program, { parser: "typescript" })).resolves.toBe(
        program,
      );
    },
  );

  it("ends with the ranking at the target bucket", () => {
    expect(renderAhaProgram(SHORT_SPEC)).toContain(
      `rankByRetention(candidates, results, { bucket: ${String(TARGET_BUCKET)} });`,
    );
  });
});

describe("RANK_BY_RETENTION_SOURCE", () => {
  it("is the declaration of rankByRetention in the module", () => {
    const source = readFileSync(MODULE, "utf8");
    const start = source.indexOf("export function rankByRetention(");
    expect(start).toBeGreaterThan(-1);
    const end = source.indexOf("\n}\n", start);
    expect(end).toBeGreaterThan(start);
    const declaration = source.slice(start, end + "\n}\n".length);
    expect(RANK_BY_RETENTION_SOURCE).toBe(declaration.replace(/^export /u, ""));
  });
});

describe("rankByRetention over the demo fixtures", () => {
  it("ranks Note Shared first and Settings Changed last after Signup, weekly, 30 days", async () => {
    const results = await runReport(DEFAULT_SPEC);
    const ranking = rankByRetention(DEFAULT_SPEC.candidates, results, {
      bucket: TARGET_BUCKET,
    });
    expect(ranking.bucket).toBe(4);
    const events = ranking.rows.map((row) => row.event);
    expect(events[0]).toBe("Note Shared");
    expect(events.at(-1)).toBe("Settings Changed");
    expect(events.slice(1, 3).sort()).toStrictEqual(["Export", "Upgrade"]);
    expect(ranking.rows[0]?.rate).toBeGreaterThan(0.38);
    expect(ranking.rows[0]?.rate).toBeLessThan(0.46);
    expect(ranking.rows.at(-1)?.rate).toBeGreaterThan(0.08);
    expect(ranking.rows.at(-1)?.rate).toBeLessThan(0.13);
  });

  it.each([
    ["Signup", "week", 90],
    ["Signup", "day", 7],
    ["Signup", "day", 30],
    ["App Opened", "week", 30],
    ["App Opened", "day", 90],
  ] as const)(
    "keeps Note Shared first and the lowest last for %s, %s, %d days",
    async (born, retentionUnit, last) => {
      const coverage = fixtureCoverage(DEMO_FIXTURES);
      const spec: AhaSpec = {
        kind: "aha",
        born,
        candidates: seedCandidates(
          DEMO_FIXTURES.topEvents.map((row) => row.event),
          born,
          coverage.retentionPairs[born] ?? [],
        ),
        retentionUnit,
        last,
      };
      const results = await runReport(spec);
      const ranking = rankByRetention(spec.candidates, results, {
        bucket: TARGET_BUCKET,
      });
      expect(ranking.bucket).toBe(4);
      expect(ranking.rows[0]?.event).toBe("Note Shared");
      expect(ranking.rows.at(-1)?.event).toBe(
        born === "Signup" ? "Settings Changed" : "Signup",
      );
    },
  );

  it("numbers the ranks, sorts by rate, and measures lift against the median", async () => {
    const results = await runReport(DEFAULT_SPEC);
    const ranking = rankByRetention(DEFAULT_SPEC.candidates, results, {
      bucket: TARGET_BUCKET,
    });
    expect(ranking.rows.map((row) => row.rank)).toStrictEqual(
      ranking.rows.map((_, i) => i + 1),
    );
    const rates = ranking.rows.map((row) => row.rate);
    expect(rates).toStrictEqual([...rates].sort((a, b) => b - a));
    // Seven candidates: the fourth is the median and has no lift.
    expect(ranking.rows).toHaveLength(7);
    expect(ranking.rows[3]?.lift).toBe(0);
    expect(ranking.rows[3]?.rate).toBe(ranking.median);
    for (const row of ranking.rows) {
      expect(row.lift).toBeCloseTo(row.rate - ranking.median, 12);
      expect(row.curve).toHaveLength(5);
      expect(row.curve[0]).toBe(1);
      expect(row.curve[4]).toBe(row.rate);
    }
  });

  it("counts the cohorts and sums their entrants from the result", async () => {
    const [result] = await runReport(SHORT_SPEC);
    const ranking = rankByRetention(["Note Shared"], [result!], {
      bucket: TARGET_BUCKET,
    });
    const cohorts = Object.values(result!.cohorts);
    expect(ranking.rows[0]?.cohorts).toBe(cohorts.length);
    expect(ranking.rows[0]?.entrants).toBe(
      cohorts.reduce((sum, cohort) => sum + Number(cohort["first"]), 0),
    );
    expect(ranking.rows[0]?.entrants).toBeGreaterThan(0);
  });

  it("compares at the deepest bucket every candidate reaches", () => {
    const fake = (rates: number[]): RetentionResult =>
      ({ average: { rates }, cohorts: {} }) as unknown as RetentionResult;
    const ranking = rankByRetention(
      ["deep", "shallow"],
      [fake([1, 0.5, 0.4, 0.3, 0.2]), fake([1, 0.6, 0.5])],
      { bucket: TARGET_BUCKET },
    );
    expect(ranking.bucket).toBe(2);
    expect(ranking.rows.map((row) => [row.event, row.rate])).toStrictEqual([
      ["shallow", 0.5],
      ["deep", 0.4],
    ]);
    expect(ranking.median).toBe(0.45);
  });

  it("returns an empty ranking for no candidates", () => {
    expect(rankByRetention([], [], { bucket: TARGET_BUCKET })).toStrictEqual({
      bucket: TARGET_BUCKET,
      median: 0,
      rows: [],
    });
  });
});

describe("rankingRows", () => {
  it("exports raw numbers under the Markdown columns", async () => {
    const results = await runReport(SHORT_SPEC);
    const ranking = rankByRetention(SHORT_SPEC.candidates, results, {
      bucket: TARGET_BUCKET,
    });
    const rows = rankingRows(ranking);
    expect(rows).toHaveLength(3);
    expect(Object.keys(rows[0] ?? {})).toStrictEqual([
      "rank",
      "event",
      "rate",
      "lift",
      "cohorts",
      "entrants",
    ]);
    expect(rows[0]?.["rate"]).toBe(ranking.rows[0]?.rate);
  });
});

describe("seedCandidates and plannedBucket", () => {
  it("seeds from the top events, without the born event, capped at ten", () => {
    const top = Array.from({ length: 14 }, (_, i) => `E${String(i)}`);
    const seeded = seedCandidates(top, "E3", null);
    expect(seeded).toHaveLength(MAX_CANDIDATES);
    expect(seeded).not.toContain("E3");
    expect(seeded).toStrictEqual(top.filter((e) => e !== "E3").slice(0, 10));
  });

  it("keeps only the allowed events when a list is given", () => {
    expect(seedCandidates(["A", "B", "C"], "A", ["C"])).toStrictEqual(["C"]);
  });

  it("the default offline set is every covered Signup pair, in top-event order", () => {
    const covered =
      fixtureCoverage(DEMO_FIXTURES).retentionPairs["Signup"] ?? [];
    expect([...DEFAULT_SPEC.candidates].sort()).toStrictEqual(
      [...covered].sort(),
    );
    expect(DEFAULT_SPEC.candidates).toHaveLength(7);
  });

  it.each([
    ["week", 7, 0],
    ["week", 30, 4],
    ["week", 90, 4],
    ["day", 7, 4],
    ["day", 30, 4],
  ] as const)(
    "plans bucket %s × %d days → %d",
    (retentionUnit, last, bucket) => {
      expect(plannedBucket({ ...SHORT_SPEC, retentionUnit, last })).toBe(
        bucket,
      );
    },
  );
});

describe("sparklinePath", () => {
  it("maps bucket 0 to the left edge and rate 1 to the top", () => {
    expect(sparklinePath([1, 0.5, 0.25], 40, 10)).toBe(
      "M0.0,0.0 L20.0,5.0 L40.0,7.5",
    );
    expect(sparklinePath([], 40, 10)).toBe("");
    expect(sparklinePath([0.5], 40, 10)).toBe("M0.0,5.0");
  });
});
