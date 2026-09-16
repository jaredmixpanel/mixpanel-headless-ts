// What the playground's controls edit. A `QuerySpec` is UI state (camelCase,
// closed unions); `toCall` turns it into the one `Call` whose argument
// literals carry the facade's option-bag keys (`math`, `last`, `group_by`,
// `where`, `conversion_window`, `retention_unit` — `WorkspaceQueryOptions`
// and friends in core's workspace-members/options.ts). Option keys are
// emitted in a fixed order so the code panel stays stable while a user
// flips controls; `limit` is never emitted (the facade's default is right
// here). A `where` filter is the one non-literal option: it becomes an
// expression argument (`Filter.equals(property, value)`) and the call
// declares the `Filter` import the setup must add.

import type { Call, CallArg } from "./call.js";

/** Time ranges the playground offers (`last: n` days). */
export const TIME_RANGES = [7, 30, 90] as const;

/** Member of {@link TIME_RANGES}. */
export type TimeRange = (typeof TIME_RANGES)[number];

/**
 * Insights maths the trend view offers — each a member of core's
 * `MATH_TYPE_VALUES` (tests/demo-calls.test.ts pins that).
 */
export const TREND_MATHS = ["total", "unique", "dau"] as const;

/** Member of {@link TREND_MATHS}. */
export type TrendMath = (typeof TREND_MATHS)[number];

/**
 * Funnel conversion windows (days) the playground offers — the four the
 * demo project records for every pair of its funnel pool, so the
 * conversion matrix can sweep a pair across all of them.
 */
export const CONVERSION_WINDOWS = [1, 7, 14, 30] as const;

/** Member of {@link CONVERSION_WINDOWS}. */
export type ConversionWindow = (typeof CONVERSION_WINDOWS)[number];

/** Retention bucket units the playground offers. */
export const RETENTION_UNITS = ["day", "week"] as const;

/** Member of {@link RETENTION_UNITS}. */
export type RetentionUnit = (typeof RETENTION_UNITS)[number];

/** An equality filter a value chip sets (`where: Filter.equals(…)`). */
export interface WhereFilter {
  readonly property: string;
  readonly value: string;
}

/** A single-event trend (`ws.query`). */
export interface TrendSpec {
  readonly kind: "trend";
  readonly event: string;
  readonly math: TrendMath;
  readonly last: TimeRange;
  /** Property to break the series down by (`group_by`). */
  readonly groupBy?: string;
  /** Equality filter on one property value (`where`). */
  readonly where?: WhereFilter;
}

/** A funnel over two or more steps (`ws.queryFunnel`). */
export interface FunnelSpec {
  readonly kind: "funnel";
  readonly steps: readonly string[];
  readonly last: TimeRange;
  readonly conversionWindow?: ConversionWindow;
}

/** A retention query (`ws.queryRetention`). */
export interface RetentionSpec {
  readonly kind: "retention";
  readonly born: string;
  readonly returnEvent: string;
  readonly retentionUnit: RetentionUnit;
  readonly last: TimeRange;
}

/** Everything the result panel can show. */
export type QuerySpec = TrendSpec | FunnelSpec | RetentionSpec;

/** The `const` name each engine's result is bound to in the rendered code. */
const BINDING_BY_KIND = {
  trend: "result",
  funnel: "funnel",
  retention: "retention",
} as const;

/** The `Filter` import a filtered query needs on the setup's import line. */
const FILTER_IMPORTS: readonly string[] = ["Filter"];

/**
 * A trend spec with its filter set, replaced or removed — rebuilt key by
 * key so a cleared filter leaves no `undefined` behind and key order stays
 * fixed, letting specs compare structurally.
 *
 * @param spec - The current trend.
 * @param where - The filter, or `null` to clear it.
 * @returns The new spec (the same event, math, range and breakdown).
 */
export function withWhere(
  spec: TrendSpec,
  where: WhereFilter | null,
): TrendSpec {
  const plain: TrendSpec = {
    kind: "trend",
    event: spec.event,
    math: spec.math,
    last: spec.last,
  };
  const kept =
    spec.groupBy === undefined ? plain : { ...plain, groupBy: spec.groupBy };
  return where === null ? kept : { ...kept, where };
}

/**
 * Build the facade call for a spec. Keys of the option literal follow the
 * order the playground documents: `math`, `last`, `group_by`, `where` for
 * trends; `conversion_window`, `last` for funnels; `retention_unit`, `last`
 * for retention.
 *
 * @param spec - The UI state.
 * @returns The call to render and run.
 */
export function toCall(spec: QuerySpec): Call {
  switch (spec.kind) {
    case "trend": {
      const options: Record<string, CallArg> = {
        math: spec.math,
        last: spec.last,
      };
      if (spec.groupBy !== undefined) {
        options["group_by"] = spec.groupBy;
      }
      if (spec.where !== undefined) {
        options["where"] = {
          $expr: "Filter.equals",
          args: [spec.where.property, spec.where.value],
        };
      }
      return {
        method: "query",
        args: [spec.event, options],
        binding: BINDING_BY_KIND.trend,
        imports: spec.where === undefined ? [] : FILTER_IMPORTS,
      };
    }
    case "funnel": {
      const options: Record<string, string | number> = {};
      if (spec.conversionWindow !== undefined) {
        options["conversion_window"] = spec.conversionWindow;
      }
      options["last"] = spec.last;
      return {
        method: "queryFunnel",
        args: [[...spec.steps], options],
        binding: BINDING_BY_KIND.funnel,
        imports: [],
      };
    }
    case "retention": {
      return {
        method: "queryRetention",
        args: [
          spec.born,
          spec.returnEvent,
          { retention_unit: spec.retentionUnit, last: spec.last },
        ],
        binding: BINDING_BY_KIND.retention,
        imports: [],
      };
    }
  }
}

/**
 * The discovery call the page issues on load.
 *
 * @param limit - How many events to list.
 * @returns `const top = await ws.topEvents({ limit });`
 */
export function topEventsCall(limit = 10): Call {
  return {
    method: "topEvents",
    args: [{ limit }],
    binding: "top",
    imports: [],
  };
}

/**
 * The discovery call behind "Break down by".
 *
 * @param event - The event whose properties to list.
 * @returns `const props = await ws.properties(event);`
 */
export function propertiesCall(event: string): Call {
  return {
    method: "properties",
    args: [event],
    binding: "props",
    imports: [],
  };
}

/**
 * The discovery call behind a segment chip.
 *
 * @param property - The property name.
 * @param event - The event to scope values to.
 * @param limit - How many values to list.
 * @returns `const values = await ws.propertyValues(property, { event, limit });`
 */
export function propertyValuesCall(
  property: string,
  event: string,
  limit = 20,
): Call {
  return {
    method: "propertyValues",
    args: [property, { event, limit }],
    binding: "values",
    imports: [],
  };
}

/**
 * The event-names call the funnel builder falls back to when a step is not
 * among the top events.
 *
 * @returns `const names = await ws.events();`
 */
export function eventsCall(): Call {
  return { method: "events", args: [], binding: "names", imports: [] };
}

/**
 * "Open in Mixpanel": a report link for a result bound earlier.
 *
 * @param binding - The binding holding the result (`result`, `funnel`, `retention`).
 * @param name - Report name shown in Mixpanel.
 * @returns `const link = await ws.createReportLink(<binding>, { name });`
 */
export function reportLinkCall(binding: string, name: string): Call {
  return {
    method: "createReportLink",
    args: [{ $binding: binding }, { name }],
    binding: "link",
    imports: [],
  };
}
