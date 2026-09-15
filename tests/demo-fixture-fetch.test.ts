// The offline transport (docs/.vitepress/theme/demo/model/fixture-fetch.ts):
// its route table (unknown routes and keys throw, never a silent 200), the
// facade-visible errors it produces, date materialisation relative to the
// frozen clock, both time-section shapes, and the chart adapters
// (model/series.ts) over the results the real library builds from it.

import { describe, expect, it } from "vitest";

import {
  createBrowserWorkspace,
  EventNotFoundError,
} from "@mixpanel-headless/browser";

import { DEMO_FIXTURES } from "../docs/.vitepress/theme/demo/fixtures/demo-project.gen.js";
import {
  FIXTURE_LATENCY_MS,
  fixtureCoverage,
  fixtureFetch,
} from "../docs/.vitepress/theme/demo/model/fixture-fetch.js";
import {
  formatCount,
  formatPct,
  funnelBars,
  MAX_SERIES,
  OTHER_SERIES,
  retentionGrid,
  trendSeries,
} from "../docs/.vitepress/theme/demo/model/series.js";

const today = (): Date => new Date(2026, 8, 15);
const BASE = "https://mixpanel.com";

/**
 * An insights request body with one trend clause and the given time entry.
 *
 * @param time - `sections.time[0]`.
 * @returns The body text.
 */
function insightsBody(time: Record<string, unknown>): string {
  return JSON.stringify({
    bookmark: {
      sections: {
        show: [
          {
            type: "metric",
            behavior: { type: "event", name: "Note Saved" },
            measurement: { math: "total" },
          },
        ],
        time: [time],
        filter: [],
        group: [],
      },
    },
    project_id: 3141592,
  });
}

/**
 * POST an insights body straight at the transport.
 *
 * @param fetchImpl - The transport.
 * @param time - The time entry.
 * @returns The parsed envelope.
 */
async function insights(
  fetchImpl: typeof fetch,
  time: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(
    `${BASE}/api/query/insights?workspace_id=1`,
    {
      method: "POST",
      body: insightsBody(time),
    },
  );
  return (await response.json()) as Record<string, unknown>;
}

const ws = createBrowserWorkspace({
  token: "demo",
  projectId: "3141592",
  region: "us",
  workspaceId: 1,
  fetch: fixtureFetch(DEMO_FIXTURES, { today }),
});

describe("fixtureFetch: routes", () => {
  const fetchImpl = fixtureFetch(DEMO_FIXTURES, { today });

  it("throws on an unknown path instead of answering", async () => {
    await expect(fetchImpl(`${BASE}/api/query/segmentation`)).rejects.toThrow(
      "demo fixture miss: GET /api/query/segmentation",
    );
  });

  it("throws on a known path with an unknown method", async () => {
    await expect(
      fetchImpl(`${BASE}/api/query/events/top`, { method: "DELETE" }),
    ).rejects.toThrow("demo fixture miss: DELETE /api/query/events/top");
  });

  it("accepts URL and Request inputs", async () => {
    const byUrl = await fetchImpl(new URL(`${BASE}/api/query/events/names`));
    await expect(byUrl.json()).resolves.toStrictEqual([
      ...DEMO_FIXTURES.events,
    ]);
    const byRequest = await fetchImpl(
      new Request(`${BASE}/api/query/cohorts/list`, { method: "POST" }),
    );
    await expect(byRequest.json()).resolves.toStrictEqual([]);
  });

  it("answers properties/top with 400 for an unknown event", async () => {
    const response = await fetchImpl(
      `${BASE}/api/query/events/properties/top?event=Nope`,
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toBe("application/json");
  });

  it("honours the top-events limit and maps amount", async () => {
    const response = await fetchImpl(
      `${BASE}/api/query/events/top?type=general&limit=2`,
    );
    const body = (await response.json()) as {
      events: Array<{ amount: number; percent_change: number }>;
    };
    expect(body.events).toHaveLength(2);
    expect(body.events[0]?.amount).toBe(DEMO_FIXTURES.topEvents[0]?.amount);
  });

  it("throws on an insights key the fixtures do not hold", async () => {
    await expect(ws.query("Nope", { math: "total", last: 30 })).rejects.toThrow(
      "demo fixture miss: Nope|total",
    );
    await expect(
      ws.queryFunnel(["Export", "Search"], { last: 30 }),
    ).rejects.toThrow("demo fixture miss: Export>Search|14");
  });

  it("passes the nominal latency to the sleep seam", async () => {
    const waits: number[] = [];
    const sleeping = fixtureFetch(DEMO_FIXTURES, {
      today,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    await sleeping(`${BASE}/api/query/events/names`);
    expect(waits).toStrictEqual([FIXTURE_LATENCY_MS]);
  });
});

describe("fixtureFetch: through the facade", () => {
  it("raises EventNotFoundError for an unknown event's properties", async () => {
    const error = await ws
      .properties("Nope")
      .catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(EventNotFoundError);
    expect((error as EventNotFoundError).code).toBe("EVENT_NOT_FOUND");
  });

  it("materialises 'in the last' relative to the frozen clock", async () => {
    const result = await ws.query("Note Saved", { math: "total", last: 7 });
    expect(result.to_date).toBe("2026-09-15T00:00:00-08:00");
    expect(result.from_date).toBe("2026-09-09T00:00:00-08:00");
    expect(result.toRows().map((row) => row["date"])).toStrictEqual([
      "2026-09-09T00:00:00",
      "2026-09-10T00:00:00",
      "2026-09-11T00:00:00",
      "2026-09-12T00:00:00",
      "2026-09-13T00:00:00",
      "2026-09-14T00:00:00",
      "2026-09-15T00:00:00",
    ]);
    const stored = DEMO_FIXTURES.trends["Note Saved|total"] ?? [];
    expect(result.toRows().at(-1)?.["count"]).toBe(stored.at(-1));
  });

  it("uses the facade's default 14-day window and scales entrants by range", async () => {
    const month = await ws.queryFunnel(["Signup", "Note Saved"], { last: 30 });
    const week = await ws.queryFunnel(["Signup", "Note Saved"], { last: 7 });
    const stored = DEMO_FIXTURES.funnels["Signup>Note Saved|14"];
    expect(month.toRows()[0]?.["count"]).toBe(stored?.count[0]);
    expect(week.toRows()[0]?.["count"]).toBe(
      Math.round((stored?.count[0] ?? 0) * (7 / 30)),
    );
    expect(month.overall_conversion_rate).toBe(week.overall_conversion_rate);
  });

  it("shows one retention cohort per unit in the range", async () => {
    const weekly = await ws.queryRetention("Signup", "Note Saved", {
      retention_unit: "week",
      last: 30,
    });
    expect(Object.keys(weekly.cohorts)).toHaveLength(5);
    expect(Object.keys(weekly.cohorts).at(-1)).toBe("2026-09-15");
    const daily = await ws.queryRetention("Signup", "Note Saved", {
      retention_unit: "day",
      last: 7,
    });
    expect(Object.keys(daily.cohorts)).toHaveLength(7);
    expect(daily.average["rates"]).toBeDefined();
  });
});

describe("fixtureFetch: time sections", () => {
  const fetchImpl = fixtureFetch(DEMO_FIXTURES, { today });

  it("handles 'between' with both ends inside the window", async () => {
    const envelope = await insights(fetchImpl, {
      dateRangeType: "between",
      unit: "day",
      value: ["2026-09-01", "2026-09-07"],
    });
    const series = envelope["series"] as Record<string, Record<string, number>>;
    const keys = Object.keys(series["Note Saved"] ?? {});
    expect(keys).toHaveLength(7);
    expect(keys[0]).toBe("2026-09-01T00:00:00-08:00");
    expect(envelope["date_range"]).toStrictEqual({
      from_date: "2026-09-01T00:00:00-08:00",
      to_date: "2026-09-07T00:00:00-08:00",
    });
  });

  it("clamps a 'between' end in the future to today", async () => {
    const envelope = await insights(fetchImpl, {
      dateRangeType: "between",
      unit: "day",
      value: ["2026-09-14", "2026-09-20"],
    });
    expect((envelope["date_range"] as { to_date: string }).to_date).toBe(
      "2026-09-15T00:00:00-08:00",
    );
  });

  it("throws when the range starts before the stored window", async () => {
    await expect(
      insights(fetchImpl, {
        dateRangeType: "between",
        unit: "day",
        value: ["2026-01-01", "2026-09-07"],
      }),
    ).rejects.toThrow("demo fixture miss: time range");
  });

  it("throws on an 'in the last' window longer than the stored series", async () => {
    await expect(
      insights(fetchImpl, {
        dateRangeType: "in the last",
        unit: "day",
        window: { unit: "day", value: 365 },
      }),
    ).rejects.toThrow("demo fixture miss: time range");
  });
});

describe("fixtureCoverage", () => {
  const coverage = fixtureCoverage(DEMO_FIXTURES);

  it("lists the funnel pool, windows and retention pairs", () => {
    expect(coverage.funnelEvents).toHaveLength(5);
    expect(coverage.funnelEvents).toContain("Signup");
    expect(coverage.conversionWindows).toStrictEqual([1, 7, 14, 30]);
    expect(coverage.retentionPairs["Signup"]).toContain("Note Saved");
  });

  it("covers every ordered pair and triple of the pool at every window", () => {
    const n = coverage.funnelEvents.length;
    const combos = n * (n - 1) + n * (n - 1) * (n - 2);
    expect(Object.keys(DEMO_FIXTURES.funnels)).toHaveLength(
      combos * coverage.conversionWindows.length,
    );
  });
});

describe("series adapters", () => {
  it("builds one line per segment, ranked by total", async () => {
    const result = await ws.query("Note Saved", {
      math: "total",
      last: 7,
      group_by: "platform",
    });
    const lines = trendSeries(result);
    expect(lines.map((l) => l.name)).toStrictEqual(["iOS", "Android", "Web"]);
    expect(lines[0]?.points).toHaveLength(7);
    expect(lines[0]?.points[0]?.date).toBe("2026-09-09");
  });

  it("collapses lines beyond the maximum into Other", async () => {
    const result = await ws.query("Signup", {
      math: "total",
      last: 7,
      group_by: "country",
    });
    const stored = Object.keys(
      DEMO_FIXTURES.breakdowns["Signup|total|country"] ?? {},
    );
    expect(stored).toHaveLength(MAX_SERIES);
    // Six segments fit exactly; add one more row to force the collapse.
    const rows = [
      ...result.toRows(),
      { date: "2026-09-09T00:00:00", event: "Signup", segment: "ZZ", count: 1 },
    ];
    const lines = trendSeries({
      toRows: () => rows,
    } as unknown as typeof result);
    expect(lines).toHaveLength(MAX_SERIES);
    expect(lines.at(-1)?.name).toBe(OTHER_SERIES);
    const total = (l: { points: ReadonlyArray<{ value: number }> }): number =>
      l.points.reduce((a, p) => a + p.value, 0);
    const original = result
      .toRows()
      .reduce((a, r) => a + (r["count"] as number), 0);
    expect(lines.reduce((a, l) => a + total(l), 0)).toBe(original + 1);
  });

  it("maps funnel rows to bars", async () => {
    const funnel = await ws.queryFunnel(
      ["Signup", "Note Saved", "Note Shared"],
      {
        last: 30,
      },
    );
    const bars = funnelBars(funnel);
    expect(bars.map((b) => b.event)).toStrictEqual([
      "Signup",
      "Note Saved",
      "Note Shared",
    ]);
    expect(bars[0]?.overallRatio).toBe(1);
    expect(bars[2]?.overallRatio).toBe(funnel.overall_conversion_rate);
  });

  it("maps retention rows to a grid with the query's unit", async () => {
    const retention = await ws.queryRetention("Signup", "Note Saved", {
      retention_unit: "week",
      last: 30,
    });
    const grid = retentionGrid(retention);
    expect(grid.unit).toBe("week");
    expect(grid.cohorts).toHaveLength(5);
    expect(grid.cohorts[0]?.rates[0]).toBe(1);
    expect(grid.cohorts[0]?.size).toBe(
      retention.cohorts[grid.cohorts[0]?.date ?? ""]?.["first"],
    );
  });

  it("formats counts and percentages", () => {
    expect(formatCount(1562)).toBe("1,562");
    expect(formatCount(45_407)).toBe("45.4K");
    expect(formatCount(0)).toBe("0");
    expect(formatPct(0.6098)).toBe("61%");
    expect(formatPct(0.2316)).toBe("23.2%");
    expect(formatPct(1)).toBe("100%");
  });
});
