// The offline transport: a `fetch` that answers the requests the facade
// makes from the generated demo project, so the real library runs in the
// visitor's browser with canned data. Only data is stored in the fixtures;
// the wire envelopes are built here, in one place, in exactly the shapes the
// library parses (`transformQueryResult`, `extractFunnelStepsFromSeries`,
// `extractCohortsAndAverage`, `DiscoveryService`, `MeService`). Absolute
// dates are materialized relative to the `today` seam so "last 30 days"
// ends on the day the page is opened. An unknown route or a missing fixture
// key throws — never a silent 200.

import { inferBookmarkType } from "@mixpanel-headless/browser";

import {
  type DemoFixtures,
  FIXTURE_KEYS,
  SERIES_DAYS,
} from "./fixture-types.js";

/** What the transport needs from its host. */
export interface FixtureSeams {
  /** The clock: the last series point lands on this day. */
  readonly today: () => Date;
  /** Latency seam; the page adds a visible delay, tests resolve at once. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Nominal latency the page's `sleep` receives per request. */
export const FIXTURE_LATENCY_MS = 150;

/**
 * Bookmark-driven controls the fixtures cover, so the UI offers only what
 * the demo project can answer.
 */
export interface FixtureCoverage {
  /** Events the funnel builder may combine (any order, 2 or 3 steps). */
  readonly funnelEvents: readonly string[];
  /** Born event → return events with retention data. */
  readonly retentionPairs: Readonly<Record<string, readonly string[]>>;
  /** Funnel conversion windows (days) with data. */
  readonly conversionWindows: readonly number[];
}

type Json = Record<string, unknown>;

// The corpus's insights date keys carry the project timezone's offset
// (`2024-01-01T00:00:00-08:00`); the library trims to the day, so a fixed
// Pacific-standard offset is enough.
const DATE_KEY_SUFFIX = "T00:00:00-08:00";
/** Funnel entrant counts are stored for a 30-day range and scaled to the query's. */
const FUNNEL_BASE_DAYS = 30;
const UNIT_DAYS: Readonly<Record<string, number>> = { day: 1, week: 7 };
const JSON_HEADERS = { "content-type": "application/json" };
const DAY_MS = 86_400_000;

/**
 * Build the offline `fetch`.
 *
 * @param fixtures - The generated demo project.
 * @param seams - Clock and latency.
 * @returns A `fetch` the browser factories accept.
 * @example
 * ```ts
 * const ws = createBrowserWorkspace({
 *   token: "demo",
 *   projectId: "3141592",
 *   region: "us",
 *   workspaceId: 1,
 *   fetch: fixtureFetch(DEMO_FIXTURES, { today: () => new Date() }),
 * });
 * ```
 */
export function fixtureFetch(
  fixtures: DemoFixtures,
  seams: FixtureSeams,
): typeof fetch {
  const server = new FixtureServer(fixtures, seams.today);
  return async (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const body = typeof init?.body === "string" ? init.body : null;
    await seams.sleep?.(FIXTURE_LATENCY_MS);
    return server.handle(method, url, body);
  };
}

/**
 * What the fixtures can answer, for populating pickers.
 *
 * @param fixtures - The generated demo project.
 * @returns Funnel events, retention pairs and conversion windows present.
 */
export function fixtureCoverage(fixtures: DemoFixtures): FixtureCoverage {
  const funnelEvents = new Set<string>();
  const windows = new Set<number>();
  for (const key of Object.keys(fixtures.funnels)) {
    const [steps = "", window = ""] = key.split("|", 2);
    for (const step of steps.split(">")) {
      funnelEvents.add(step);
    }
    windows.add(Number(window));
  }
  const retentionPairs: Record<string, string[]> = {};
  for (const key of Object.keys(fixtures.retention)) {
    const [pair = ""] = key.split("|", 1);
    const [born = "", returnEvent = ""] = pair.split(">>", 2);
    const returns = (retentionPairs[born] ??= []);
    if (!returns.includes(returnEvent)) {
      returns.push(returnEvent);
    }
  }
  return {
    funnelEvents: [...funnelEvents],
    retentionPairs,
    conversionWindows: [...windows].sort((a, b) => a - b),
  };
}

/**
 * Throw the fixture-miss error every unknown route and key surfaces.
 *
 * @param what - `METHOD path` or the missing key.
 * @throws Error - Always.
 */
function miss(what: string): never {
  throw new Error(`demo fixture miss: ${what}`);
}

/**
 * JSON response in the shape the library's transport reads.
 *
 * @param body - Payload.
 * @param status - HTTP status.
 * @returns The response.
 */
function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: JSON_HEADERS });
}

/**
 * Read a nested value, tolerating any shape (the request body is untyped).
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
 * Names of the behaviors in a funnel or retention clause.
 *
 * @param behavior - `sections.show[0].behavior`.
 * @returns Event names in step order.
 */
function behaviorNames(behavior: unknown): string[] {
  const behaviors = pick(behavior, "behaviors");
  return Array.isArray(behaviors)
    ? behaviors.map((b: unknown) => String(pick(b, "name")))
    : [];
}

/**
 * Local calendar date shifted by whole days (DST-safe: the local constructor
 * normalizes day overflow).
 *
 * @param date - Anchor.
 * @param days - Offset (negative = past).
 * @returns The shifted date at local midnight.
 */
function shiftDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * `YYYY-MM-DD` of a local date.
 *
 * @param date - The date.
 * @returns ISO calendar day.
 */
function isoDay(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Parse `YYYY-MM-DD` as a local date.
 *
 * @param day - Calendar day.
 * @returns Local midnight of that day.
 */
function parseDay(day: string): Date {
  const [y = 0, m = 1, d = 1] = day.split("-", 3).map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Four-decimal rounding for ratios (what the UI formats as a percentage).
 *
 * @param x - Ratio.
 * @returns Rounded ratio.
 */
function round4(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}

/** Day offsets (relative to today, ≤ 0) a time section asks for. */
interface DayRange {
  readonly first: number;
  readonly last: number;
}

/** The one filter shape the fixtures answer: `Filter.equals(property, value)`. */
interface EqualsFilter {
  readonly property: string;
  readonly value: string;
}

/**
 * Read the equality filter out of `sections.filter`, in the shape
 * `buildFilterEntry` writes for `Filter.equals` on a plain property
 * (`filterOperator: "equals"`, `value: <property>`, `filterValue: [<one>]`).
 * Anything else the fixtures cannot answer, so it is a miss.
 *
 * @param filters - `sections.filter` of the bookmark.
 * @returns The filter, or `null` when the section is empty.
 */
function equalsFilter(filters: unknown): EqualsFilter | null {
  if (!Array.isArray(filters) || filters.length === 0) {
    return null;
  }
  const [entry] = filters as readonly unknown[];
  const property = pick(entry, "value");
  const values = pick(entry, "filterValue");
  if (
    filters.length !== 1 ||
    pick(entry, "filterOperator") !== "equals" ||
    typeof property !== "string" ||
    !Array.isArray(values) ||
    values.length !== 1 ||
    typeof values[0] !== "string"
  ) {
    return miss(`filter ${JSON.stringify(filters)}`);
  }
  return { property, value: values[0] };
}

/** Routes plus the envelope builders; one instance per `fixtureFetch`. */
class FixtureServer {
  readonly #fixtures: DemoFixtures;
  readonly #today: () => Date;

  constructor(fixtures: DemoFixtures, today: () => Date) {
    this.#fixtures = fixtures;
    this.#today = today;
  }

  /**
   * Dispatch one request.
   *
   * @param method - Upper-case HTTP method.
   * @param url - Request URL.
   * @param body - Request body text, when any.
   * @returns The response.
   */
  handle(method: string, url: URL, body: string | null): Response {
    const route = `${method} ${url.pathname}`;
    const query = url.searchParams;
    const f = this.#fixtures;
    switch (route) {
      case "GET /api/query/events/top": {
        const limit = Number(query.get("limit") ?? f.topEvents.length);
        return json({
          events: f.topEvents.slice(0, limit).map((row) => ({
            event: row.event,
            amount: row.amount,
            percent_change: row.percentChange,
          })),
          type: query.get("type") ?? "general",
        });
      }
      case "GET /api/query/events/names": {
        return json(f.events);
      }
      case "GET /api/query/events/properties/top": {
        const event = query.get("event") ?? "";
        const props = f.properties[event];
        return props === undefined
          ? json({ error: `Event ${event} not found` }, 400)
          : json(props);
      }
      case "GET /api/query/events/properties/values": {
        const values = f.propertyValues[query.get("name") ?? ""] ?? miss(route);
        return json(
          values.slice(0, Number(query.get("limit") ?? values.length)),
        );
      }
      case "GET /api/query/funnels/list":
      case "POST /api/query/cohorts/list": {
        return json([]);
      }
      case "POST /api/query/insights": {
        return json(this.#insights(JSON.parse(body ?? "{}") as Json));
      }
      case `POST /api/app/projects/${f.project.id}/bookmark-urls/`: {
        return json({ results: { created_at: f.reportLink.createdAt } });
      }
      case "GET /api/app/me": {
        return json({ results: this.#me() });
      }
      default: {
        return miss(route);
      }
    }
  }

  #me(): Json {
    const { project } = this.#fixtures;
    return {
      user_id: 1,
      user_email: project.userEmail,
      organizations: { "1": { id: 1, name: project.organizationName } },
      projects: {
        [project.id]: {
          name: project.name,
          organization_id: 1,
          timezone: project.timezone,
        },
      },
      workspaces: {
        [String(project.workspaceId)]: {
          id: project.workspaceId,
          name: "Default",
          project_id: Number(project.id),
          is_default: true,
        },
      },
    };
  }

  /**
   * Route an insights request by its bookmark's report type.
   *
   * @param body - The request body (`bookmark`, `project_id`, `queryLimits`).
   * @returns The insights envelope.
   */
  #insights(body: Json): Json {
    const bookmark = body["bookmark"];
    const range = this.#dayRange(pick(bookmark, "sections", "time", 0));
    const behavior = pick(bookmark, "sections", "show", 0, "behavior");
    switch (inferBookmarkType(bookmark)) {
      case "insights": {
        return this.#trend(
          String(pick(behavior, "name")),
          String(pick(bookmark, "sections", "show", 0, "measurement", "math")),
          pick(bookmark, "sections", "group", 0, "propertyName"),
          equalsFilter(pick(bookmark, "sections", "filter")),
          range,
        );
      }
      case "funnels": {
        return this.#funnel(
          behaviorNames(behavior),
          Number(pick(behavior, "conversionWindowDuration")),
          range,
        );
      }
      case "retention": {
        return this.#retention(
          behaviorNames(behavior),
          String(pick(behavior, "retentionUnit")),
          range,
        );
      }
      default: {
        return miss(
          `POST /api/query/insights (${String(pick(behavior, "type"))})`,
        );
      }
    }
  }

  /**
   * Translate `sections.time[0]` into day offsets.
   *
   * @param time - The time entry (`in the last` or `between`).
   * @returns Offsets within the stored window.
   */
  #dayRange(time: unknown): DayRange {
    const todayMs = shiftDays(this.#today(), 0).getTime();
    let first: number;
    let last = 0;
    if (pick(time, "dateRangeType") === "between") {
      const [from, to] = pick(time, "value") as readonly [string, string];
      const offset = (day: string): number =>
        Math.round((parseDay(day).getTime() - todayMs) / DAY_MS);
      first = offset(from);
      last = Math.min(0, offset(to));
    } else {
      first = 1 - Number(pick(time, "window", "value"));
    }
    if (!Number.isInteger(first) || first < 1 - SERIES_DAYS || first > last) {
      return miss(`time range ${JSON.stringify(time)}`);
    }
    return { first, last };
  }

  #envelope(range: DayRange, headers: readonly string[], series: Json): Json {
    const today = this.#today();
    return {
      computed_at: today.toISOString(),
      date_range: {
        from_date: isoDay(shiftDays(today, range.first)) + DATE_KEY_SUFFIX,
        to_date: isoDay(shiftDays(today, range.last)) + DATE_KEY_SUFFIX,
      },
      headers,
      series,
    };
  }

  #dated(values: readonly number[], range: DayRange): Json {
    const today = this.#today();
    const out: Json = {};
    for (let offset = range.first; offset <= range.last; offset += 1) {
      out[isoDay(shiftDays(today, offset)) + DATE_KEY_SUFFIX] =
        values[SERIES_DAYS - 1 + offset];
    }
    return out;
  }

  /**
   * The insights envelope for a trend, broken down and/or filtered. The
   * fixtures hold each property's marginal per event and math (segments
   * sum to the trend), so a filter on one property selects that segment's
   * series — an unknown value is a series of zeros, as Mixpanel would
   * report — and a breakdown by another property is scaled day by day to
   * the filtered share of the total, the closest answer marginals allow.
   *
   * @param event - Event name.
   * @param math - Insights math.
   * @param property - Breakdown property, when any.
   * @param where - Equality filter, when any.
   * @param range - Time range.
   * @returns The envelope.
   */
  #trend(
    event: string,
    math: string,
    property: unknown,
    where: EqualsFilter | null,
    range: DayRange,
  ): Json {
    const f = this.#fixtures;
    const trendKey = FIXTURE_KEYS.trend(event, math);
    const total = f.trends[trendKey] ?? miss(trendKey);
    const segmentsOf = (
      name: string,
    ): Readonly<Record<string, readonly number[]>> => {
      const key = FIXTURE_KEYS.breakdown(event, math, name);
      return f.breakdowns[key] ?? miss(key);
    };
    const filtered =
      where === null
        ? total
        : (segmentsOf(where.property)[where.value] ?? total.map(() => 0));
    if (typeof property !== "string") {
      return this.#envelope(range, ["$event"], {
        [event]: this.#dated(filtered, range),
      });
    }
    const bySegment: Json = {};
    if (where !== null && where.property === property) {
      bySegment[where.value] = this.#dated(filtered, range);
    } else {
      const share = (day: number): number => {
        const all = total[day] ?? 0;
        return all === 0 ? 0 : (filtered[day] ?? 0) / all;
      };
      for (const [segment, series] of Object.entries(segmentsOf(property))) {
        bySegment[segment] = this.#dated(
          series.map((n, day) => Math.round(n * share(day))),
          range,
        );
      }
    }
    return this.#envelope(range, ["$event", property], { [event]: bySegment });
  }

  /**
   * The Insights funnel format: `{metric: {measure: {"1. Step": {all: n}}}}`.
   *
   * @param steps - Step events in order.
   * @param window - Conversion window in days.
   * @param range - Time range (entrants scale with its length).
   * @returns The envelope.
   */
  #funnel(steps: readonly string[], window: number, range: DayRange): Json {
    const key = FIXTURE_KEYS.funnel(steps, window);
    const funnel = this.#fixtures.funnels[key] ?? miss(key);
    const scale = (range.last - range.first + 1) / FUNNEL_BASE_DAYS;
    const measures: Record<string, Json> = {
      count: {},
      step_conv_ratio: {},
      overall_conv_ratio: {},
      avg_time: {},
      avg_time_from_start: {},
    };
    const entrants = funnel.count[0] ?? 1;
    let fromStart = 0;
    for (const [i, event] of steps.entries()) {
      const label = `${String(i + 1)}. ${event}`;
      const count = funnel.count[i] ?? 0;
      const previous = funnel.count[i - 1] ?? count;
      const hop = funnel.avgTime[i] ?? 0;
      fromStart += hop;
      const values: Record<string, number> = {
        count: Math.round(count * scale),
        step_conv_ratio: i === 0 ? 1 : round4(count / previous),
        overall_conv_ratio: round4(count / entrants),
        avg_time: hop,
        avg_time_from_start: fromStart,
      };
      for (const [measure, value] of Object.entries(values)) {
        (measures[measure] as Json)[label] = { all: value };
      }
    }
    return this.#envelope(range, ["$event"], { "A. Funnel": measures });
  }

  /**
   * Retention cohorts keyed by cohort start date plus `$average`; the number
   * of cohorts follows the time range (one per unit, capped by the fixture).
   *
   * @param behaviors - `[born, return]` events.
   * @param unit - `day` or `week`.
   * @param range - Time range.
   * @returns The envelope.
   */
  #retention(
    behaviors: readonly string[],
    unit: string,
    range: DayRange,
  ): Json {
    const [born = "", returnEvent = ""] = behaviors;
    const key = FIXTURE_KEYS.retention(born, returnEvent, unit);
    const data = this.#fixtures.retention[key] ?? miss(key);
    const unitDays = UNIT_DAYS[unit] ?? miss(`retention unit ${unit}`);
    const days = range.last - range.first + 1;
    const stored = data.first.length;
    const wanted = Math.min(stored, Math.ceil(days / unitDays));
    const today = this.#today();
    const cohorts: Json = {};
    const rateSums: number[] = [];
    const rateHits: number[] = [];
    let firstSum = 0;
    for (let c = stored - wanted; c < stored; c += 1) {
      const first = data.first[c] ?? 0;
      const rates = data.rates[c] ?? [];
      const start = shiftDays(today, range.last - (stored - 1 - c) * unitDays);
      cohorts[isoDay(start) + DATE_KEY_SUFFIX] = {
        first,
        counts: rates.map((rate) => Math.round(first * rate)),
        rates,
      };
      firstSum += first;
      for (const [i, rate] of rates.entries()) {
        rateSums[i] = (rateSums[i] ?? 0) + rate;
        rateHits[i] = (rateHits[i] ?? 0) + 1;
      }
    }
    const averageRates = rateSums.map((s, i) => round4(s / (rateHits[i] ?? 1)));
    const averageFirst = Math.round(firstSum / Math.max(1, wanted));
    cohorts["$average"] = {
      first: averageFirst,
      counts: averageRates.map((rate) => Math.round(averageFirst * rate)),
      rates: averageRates,
    };
    return this.#envelope(range, ["$event"], { "A. Retention": cohorts });
  }
}
