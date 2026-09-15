// What the playground's controls edit. A `QuerySpec` is UI state (camelCase,
// closed unions); `toCall` turns it into the one `Call` whose argument
// literals carry the facade's option-bag keys (`math`, `last`, `group_by`,
// `conversion_window`, `retention_unit` — `WorkspaceQueryOptions` and
// friends in core's workspace-members/options.ts). Option keys are emitted
// in a fixed order so the code panel stays stable while a user flips
// controls; `limit` is never emitted (the facade's default is right here).

import type { Call } from "./call.js";

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

/** Funnel conversion windows (days) the playground offers. */
export const CONVERSION_WINDOWS = [1, 7, 30] as const;

/** Member of {@link CONVERSION_WINDOWS}. */
export type ConversionWindow = (typeof CONVERSION_WINDOWS)[number];

/** Retention bucket units the playground offers. */
export const RETENTION_UNITS = ["day", "week"] as const;

/** Member of {@link RETENTION_UNITS}. */
export type RetentionUnit = (typeof RETENTION_UNITS)[number];

/** A single-event trend (`ws.query`). */
export interface TrendSpec {
  readonly kind: "trend";
  readonly event: string;
  readonly math: TrendMath;
  readonly last: TimeRange;
  /** Property to break the series down by (`group_by`). */
  readonly groupBy?: string;
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

/**
 * Build the facade call for a spec. Keys of the option literal follow the
 * order the playground documents: `math`, `last`, `group_by` for trends;
 * `conversion_window`, `last` for funnels; `retention_unit`, `last` for
 * retention.
 *
 * @param spec - The UI state.
 * @returns The call to render and run.
 */
export function toCall(spec: QuerySpec): Call {
  switch (spec.kind) {
    case "trend": {
      const options: Record<string, string | number> = {
        math: spec.math,
        last: spec.last,
      };
      if (spec.groupBy !== undefined) {
        options["group_by"] = spec.groupBy;
      }
      return {
        method: "query",
        args: [spec.event, options],
        binding: BINDING_BY_KIND.trend,
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
  return { method: "topEvents", args: [{ limit }], binding: "top" };
}

/**
 * The discovery call behind "Break down by".
 *
 * @param event - The event whose properties to list.
 * @returns `const props = await ws.properties(event);`
 */
export function propertiesCall(event: string): Call {
  return { method: "properties", args: [event], binding: "props" };
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
  };
}

/**
 * The event-names call the funnel builder falls back to when a step is not
 * among the top events.
 *
 * @returns `const names = await ws.events();`
 */
export function eventsCall(): Call {
  return { method: "events", args: [], binding: "names" };
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
  };
}
