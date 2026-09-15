// The shape of the generated demo project (fixtures/demo-project.gen.ts,
// written by scripts/generate-demo-fixtures.mjs). Only data is stored: the
// wire envelopes are produced by the fixture transport (fixture-fetch.ts)
// at serve time, and absolute dates are never stored — series are day
// offsets relative to the transport's `today` seam, so "last 30 days" ends
// on the day the page is opened. Keys are camelCase (this is the
// playground's own format); the transport maps to wire names.

/** Number of daily values stored per series (day offsets -89..0). */
export const SERIES_DAYS = 90;

/** One `topEvents` row before envelope mapping (`amount` → `count`). */
export interface FixtureTopEvent {
  readonly event: string;
  readonly amount: number;
  readonly percentChange: number;
}

/** Funnel counts per step; ratios are derived at serve time. */
export interface FixtureFunnel {
  readonly count: readonly number[];
  /** Seconds from the previous step, index-aligned with `count` (first is 0). */
  readonly avgTime: readonly number[];
}

/** Retention cohorts: `first` per cohort, `rates` per cohort per bucket. */
export interface FixtureRetention {
  readonly first: readonly number[];
  readonly rates: ReadonlyArray<readonly number[]>;
}

/** The synthetic project. */
export interface DemoFixtures {
  readonly schema: 1;
  readonly project: {
    readonly id: string;
    readonly name: string;
    readonly workspaceId: number;
    readonly region: "us";
    readonly timezone: string;
    readonly userEmail: string;
    readonly organizationName: string;
  };
  /** Every event name (`ws.events()`). */
  readonly events: readonly string[];
  /** Ordered by `amount` descending (`ws.topEvents`). */
  readonly topEvents: readonly FixtureTopEvent[];
  /** `event` → `property` → count (`ws.properties`). */
  readonly properties: Readonly<
    Record<string, Readonly<Record<string, number>>>
  >;
  /** `property` → values (`ws.propertyValues`). */
  readonly propertyValues: Readonly<Record<string, readonly string[]>>;
  /** {@link FIXTURE_KEYS.trend} → 90 daily values. */
  readonly trends: Readonly<Record<string, readonly number[]>>;
  /** {@link FIXTURE_KEYS.breakdown} → segment → 90 daily values. */
  readonly breakdowns: Readonly<
    Record<string, Readonly<Record<string, readonly number[]>>>
  >;
  /** {@link FIXTURE_KEYS.funnel} → counts. */
  readonly funnels: Readonly<Record<string, FixtureFunnel>>;
  /** {@link FIXTURE_KEYS.retention} → cohorts. */
  readonly retention: Readonly<Record<string, FixtureRetention>>;
  /** What the bookmark-urls endpoint answers (`created_at`). */
  readonly reportLink: { readonly createdAt: string };
}

/** Key builders for the keyed tables — one place for the separators. */
export const FIXTURE_KEYS = {
  /**
   * @param event - Event name.
   * @param math - Insights math (`total`, `unique`, `dau`).
   * @returns `"<event>|<math>"`
   */
  trend: (event: string, math: string): string => `${event}|${math}`,
  /**
   * @param event - Event name.
   * @param math - Insights math.
   * @param property - Breakdown property.
   * @returns `"<event>|<math>|<property>"`
   */
  breakdown: (event: string, math: string, property: string): string =>
    `${event}|${math}|${property}`,
  /**
   * @param steps - Funnel step events in order.
   * @param conversionWindow - Conversion window in days.
   * @returns `"<step1>><step2>…|<window>"`
   */
  funnel: (steps: readonly string[], conversionWindow: number): string =>
    `${steps.join(">")}|${conversionWindow}`,
  /**
   * @param born - Born event.
   * @param returnEvent - Return event.
   * @param unit - `day` or `week`.
   * @returns `"<born>>>><return>|<unit>"`
   */
  retention: (born: string, returnEvent: string, unit: string): string =>
    `${born}>>${returnEvent}|${unit}`,
} as const;
