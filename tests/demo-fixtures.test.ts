// The generated demo project (docs/.vitepress/theme/demo/fixtures/
// demo-project.gen.ts): byte-exact freshness against its generator, the
// size budget, and the property that matters — the real browser package,
// run over the fixture transport, parses every stored key. The insights
// envelope is also held to the shape of a corpus vector, so a drift in
// what core expects from the wire fails here before it reaches the page.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { createBrowserWorkspace } from "@mixpanel-headless/browser";

import { DEMO_FIXTURES } from "../docs/.vitepress/theme/demo/fixtures/demo-project.gen.js";
import { fixtureFetch } from "../docs/.vitepress/theme/demo/model/fixture-fetch.js";
import { SERIES_DAYS } from "../docs/.vitepress/theme/demo/model/fixture-types.js";
import {
  TREND_MATHS,
  type TrendMath,
} from "../docs/.vitepress/theme/demo/model/query-spec.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATOR = join(REPO_ROOT, "scripts/generate-demo-fixtures.mjs");
const OUTPUT = join(
  REPO_ROOT,
  "docs/.vitepress/theme/demo/fixtures/demo-project.gen.ts",
);
const SIZE_BUDGET_BYTES = 160 * 1024;
const CORPUS_CONFIG = join(REPO_ROOT, "conformance-runner/corpus.config.json");
const VECTOR_BUNDLE = join(
  REPO_ROOT,
  "conformance-runner/corpus/bookmarks/test_api_client_phase008.jsonl",
);
const VECTOR_ID =
  "bookmarks/api_client.query_saved_report/test_api_client_phase008-testquerysavedreport-test_query_saved_report_basic";
const DATE_KEY = /^\d{4}-\d{2}-\d{2}T00:00:00-08:00$/u;

const today = (): Date => new Date(2026, 8, 15);

/**
 * Read a nested value from parsed JSON.
 *
 * @param root - Where to start.
 * @param path - Keys and indices.
 * @returns The value, or `undefined` off the path.
 */
function pick(root: unknown, ...path: ReadonlyArray<string | number>): unknown {
  let node: unknown = root;
  for (const step of path) {
    if (node === null || typeof node !== "object") {
      return undefined;
    }
    node = (node as Record<string | number, unknown>)[step];
  }
  return node;
}

/**
 * The recorded insights response of the oracle vector, read straight from
 * its bundle (the rig's loader lives in a DOM-typed project this test
 * cannot import). The bundle header is held to the corpus pin, as the
 * loader would.
 *
 * @returns The response body of the vector's single interaction.
 */
function oracleEnvelope(): Record<string, unknown> {
  const lines = readFileSync(VECTOR_BUNDLE, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const pin = (
    JSON.parse(readFileSync(CORPUS_CONFIG, "utf8")) as {
      sourceCommit: string;
    }
  ).sourceCommit;
  expect(pick(lines[0], "$bundle", "source_commit")).toBe(pin);
  const vector = lines.find((line) => line["id"] === VECTOR_ID);
  const body = pick(vector, "expect", "interactions", 0, "response", "body");
  expect(body).toBeTypeOf("object");
  return body as Record<string, unknown>;
}

/**
 * A workspace over the fixtures, optionally recording every JSON response.
 *
 * @param onResponse - Receives each parsed response body.
 * @returns The facade.
 */
function workspace(
  onResponse?: (body: unknown) => void,
): ReturnType<typeof createBrowserWorkspace> {
  const inner = fixtureFetch(DEMO_FIXTURES, { today });
  const fetchImpl: typeof fetch = async (input, init) => {
    const response = await inner(input, init);
    if (onResponse !== undefined) {
      onResponse(await response.clone().json());
    }
    return response;
  };
  return createBrowserWorkspace({
    token: "demo",
    projectId: DEMO_FIXTURES.project.id,
    region: "us",
    workspaceId: DEMO_FIXTURES.project.workspaceId,
    fetch: fetchImpl,
  });
}

/**
 * Narrow a fixture math key to the playground's union.
 *
 * @param math - The `<math>` part of a fixture key.
 * @returns The math.
 */
function asMath(math: string): TrendMath {
  expect(TREND_MATHS).toContain(math);
  return math as TrendMath;
}

describe("demo fixtures: generator", () => {
  it("the committed file is byte-identical to a fresh render", () => {
    const rendered = execFileSync("node", [GENERATOR, "--stdout"], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    expect(rendered).toBe(readFileSync(OUTPUT, "utf8"));
  });

  it("stays within the size budget", () => {
    expect(statSync(OUTPUT).size).toBeLessThanOrEqual(SIZE_BUDGET_BYTES);
  });

  it("stores 90 days per series and consistent breakdowns", () => {
    for (const [key, values] of Object.entries(DEMO_FIXTURES.trends)) {
      expect(values, key).toHaveLength(SERIES_DAYS);
    }
    for (const [key, segments] of Object.entries(DEMO_FIXTURES.breakdowns)) {
      const [event = "", math = ""] = key.split("|", 3);
      const trend = DEMO_FIXTURES.trends[`${event}|${math}`] ?? [];
      const summed = Array.from({ length: SERIES_DAYS }, (_, day) =>
        Object.values(segments).reduce((a, s) => a + (s[day] ?? 0), 0),
      );
      expect(summed, key).toStrictEqual([...trend]);
    }
  });
});

describe("demo fixtures: the library parses every key", () => {
  const ws = workspace();

  it("lists the top events in amount order", async () => {
    const top = await ws.topEvents({ limit: 10 });
    expect(top.map((t) => t.event)).toStrictEqual(
      DEMO_FIXTURES.topEvents.map((t) => t.event),
    );
    expect(top.map((t) => t.count)).toStrictEqual(
      top.map((t) => t.count).sort((a, b) => b - a),
    );
  });

  it("lists every event's properties and every property's values", async () => {
    for (const [event, props] of Object.entries(DEMO_FIXTURES.properties)) {
      await expect(ws.properties(event)).resolves.toStrictEqual(
        Object.keys(props).sort(),
      );
    }
    for (const [name, values] of Object.entries(DEMO_FIXTURES.propertyValues)) {
      await expect(
        ws.propertyValues(name, { limit: 20 }),
      ).resolves.toStrictEqual([...values]);
    }
    await expect(ws.events()).resolves.toStrictEqual([...DEMO_FIXTURES.events]);
  });

  it("answers every trend key with 30 dated rows", async () => {
    for (const key of Object.keys(DEMO_FIXTURES.trends)) {
      const [event = "", math = ""] = key.split("|", 2);
      const result = await ws.query(event, { math: asMath(math), last: 30 });
      expect(result.rowColumns(), key).toStrictEqual([
        "date",
        "event",
        "count",
      ]);
      expect(result.toRows(), key).toHaveLength(30);
    }
  });

  it("answers every breakdown key with segmented rows", async () => {
    for (const [key, segments] of Object.entries(DEMO_FIXTURES.breakdowns)) {
      const [event = "", math = "", property = ""] = key.split("|", 3);
      const result = await ws.query(event, {
        math: asMath(math),
        last: 30,
        group_by: property,
      });
      expect(result.rowColumns(), key).toStrictEqual([
        "date",
        "event",
        "segment",
        "count",
      ]);
      expect(result.toRows(), key).toHaveLength(
        Object.keys(segments).length * 30,
      );
    }
  });

  it("answers every funnel key with one row per step", async () => {
    for (const key of Object.keys(DEMO_FIXTURES.funnels)) {
      const [path = "", window = ""] = key.split("|", 2);
      const steps = path.split(">");
      const funnel = await ws.queryFunnel(steps, {
        conversion_window: Number(window),
        last: 30,
      });
      expect(
        funnel.toRows().map((row) => row["event"]),
        key,
      ).toStrictEqual(steps);
      expect(funnel.overall_conversion_rate, key).toBeGreaterThan(0);
      expect(funnel.overall_conversion_rate, key).toBeLessThanOrEqual(1);
    }
  });

  it("answers every retention key with cohort × bucket rows", async () => {
    for (const [key, data] of Object.entries(DEMO_FIXTURES.retention)) {
      const [pair = "", unit = ""] = key.split("|", 2);
      const [born = "", returnEvent = ""] = pair.split(">>", 2);
      const retention = await ws.queryRetention(born, returnEvent, {
        retention_unit: unit,
        last: 30,
      });
      const shown = Math.min(
        data.first.length,
        Math.ceil(30 / (unit === "week" ? 7 : 1)),
      );
      const buckets = data.rates
        .slice(data.first.length - shown)
        .reduce((a, rates) => a + rates.length, 0);
      expect(retention.rowColumns(), key).toStrictEqual([
        "cohort_date",
        "bucket",
        "count",
        "rate",
      ]);
      expect(retention.toRows(), key).toHaveLength(buckets);
      expect(Object.keys(retention.cohorts), key).toHaveLength(shown);
      expect(retention.average["rates"], key).toHaveLength(
        Math.max(
          ...data.rates.slice(data.first.length - shown).map((r) => r.length),
        ),
      );
    }
  });

  it("materialises a non-empty first cohort for every range and unit", async () => {
    for (const key of Object.keys(DEMO_FIXTURES.retention)) {
      const [pair = "", unit = ""] = key.split("|", 2);
      const [born = "", returnEvent = ""] = pair.split(">>", 2);
      for (const last of [7, 30, 90]) {
        const retention = await ws.queryRetention(born, returnEvent, {
          retention_unit: unit,
          last,
        });
        for (const [date, cohort] of Object.entries(retention.cohorts)) {
          expect(
            cohort["first"],
            `${key} last ${last} ${date}`,
          ).toBeGreaterThan(0);
        }
        expect(
          retention.average["first"],
          `${key} last ${last}`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("creates a report link for the demo project", async () => {
    const result = await ws.query("Note Saved", { math: "total", last: 30 });
    const link = await ws.createReportLink(result, { name: "Playground" });
    expect(
      link.url.startsWith(
        "https://mixpanel.com/project/3141592/view/1/app/insights#",
      ),
    ).toBe(true);
    expect(link.report_type).toBe("insights");
  });

  it("answers /me with the demo user and project", async () => {
    const me = await ws.me();
    expect(me.user_email).toBe(DEMO_FIXTURES.project.userEmail);
    expect([...me.projects.keys()]).toStrictEqual([DEMO_FIXTURES.project.id]);
    expect(me.workspaces.get("1")?.is_default).toBe(true);
  });
});

describe("demo fixtures: insights envelope shape", () => {
  it("matches the corpus vector for a one-event query", async () => {
    const oracle = oracleEnvelope();
    const responses: unknown[] = [];
    const ws = workspace((body) => {
      responses.push(body);
    });
    await ws.query("Note Saved", { math: "total", last: 7 });
    expect(responses).toHaveLength(1);
    const captured = responses[0] as Record<string, unknown>;

    expect(Object.keys(captured).sort()).toStrictEqual(
      Object.keys(oracle).sort(),
    );
    expect(Object.keys(captured["date_range"] as object).sort()).toStrictEqual(
      Object.keys(oracle["date_range"] as object).sort(),
    );
    expect(captured["headers"]).toStrictEqual(["$event"]);

    const dateKeys = (series: unknown): string[] =>
      Object.values(series as Record<string, Record<string, unknown>>).flatMap(
        (byDate) => Object.keys(byDate),
      );
    const ours = dateKeys(captured["series"]);
    const theirs = dateKeys(oracle["series"]);
    expect(ours).toHaveLength(7);
    expect(theirs.length).toBeGreaterThan(0);
    for (const key of [...ours, ...theirs]) {
      expect(key).toMatch(DATE_KEY);
    }
    expect(Object.keys(captured["series"] as object)).toHaveLength(1);
  });
});
