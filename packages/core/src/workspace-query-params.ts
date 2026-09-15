/**
 * The `Workspace` query-parameter engine — TS port of the private
 * param-building methods of `mixpanel_headless/workspace.py` for
 * Phase-3 batch B5, shard S2
 * (`docs/history/phase3/design/b5-packets.md` §3).
 *
 * Split out of `workspace.ts` per R7.2 (the facade file already carries
 * the S1/S3/B6 member sections; these ten helpers are ~1,100 lines on
 * their own). Every one of them is `self`-free in Python apart from the
 * `self._build_*_params` call chain, so they port as free functions and
 * the facade members delegate.
 *
 * Contents, in Python source order:
 *
 * | Python | Here |
 * |---|---|
 * | `_check_step_direction` `:353` | {@link checkStepDirection} |
 * | `_flow_mode_from_params` `:438` | {@link flowModeFromParams} |
 * | `_build_query_params` `:2047` | {@link buildQueryParams} |
 * | `_resolve_and_build_params` `:2546` | {@link resolveAndBuildParams} |
 * | `_build_funnel_params` `:2746` | {@link buildFunnelParams} |
 * | `_resolve_and_build_funnel_params` `:2930` | {@link resolveAndBuildFunnelParams} |
 * | `_build_retention_params` `:3321` | {@link buildRetentionParams} |
 * | `_build_flow_params` `:3493` | {@link buildFlowParams} |
 * | `_resolve_and_build_flow_params` `:3635` | {@link resolveAndBuildFlowParams} |
 * | `_resolve_and_build_retention_params` `:4100` | {@link resolveAndBuildRetentionParams} |
 * | `_resolve_and_build_user_params` `:9336` | {@link resolveAndBuildUserParams} |
 * | `_build_page_kwargs` `:10209` | {@link buildPageKwargs} |
 *
 * Port-wide conventions applied here:
 *
 * - R10.8 — the B2 validators (`validateQueryArgs`, `validateFunnelArgs`,
 *   `validateRetentionArgs`, `validateFlowArgs`, `validateUserArgs`,
 *   `validateUserParams`, `validateBookmark`, `validateFlowBookmark`,
 *   `_scanCustomProperties`) and the B3 builders (`buildTimeSection`,
 *   `buildFilterSection`, `buildGroupSection`, `buildFilterEntry`,
 *   `buildDateRange`, `buildSegfilterEntry`, `buildFlowCohortFilter`,
 *   `buildFlowPropertyFilter`, `buildTimeComparison`,
 *   `patchCustomPropertyFiltersForTransform`, `buildComposedProperties`,
 *   `sanitizeRawCohort`) are IMPORTED BY NAME, never re-implemented.
 * - R4.8 — the three `chart_type_map` lookups are `ReadonlyMap`s, so a
 *   `mode` of `"toString"` cannot reach `Object.prototype`.
 * - R11.7 — `json.dumps` renders through {@link pythonJsonDumps}
 *   (CPython's separators and `\uXXXX` policy), never `JSON.stringify`.
 * - Guard order is SOURCE order in every function.
 */

import {
  buildComposedProperties,
  buildDateRange,
  buildFilterEntry,
  buildFilterSection,
  buildFlowCohortFilter,
  buildFlowPropertyFilter,
  buildGroupSection,
  buildTimeComparison,
  buildTimeSection,
  patchCustomPropertyFiltersForTransform,
} from "./bookmarks/builders.js";
import { toNativeJson } from "./client/json-value.js";
import { parseLossless } from "./client/lossless-json.js";
import { ValueError } from "./compat/python-builtins.js";
import { dateTodayIso, isLeapYear } from "./compat/python-dates.js";
import { isPythonDict } from "./compat/python-dict.js";
import { pythonJsonDumps } from "./compat/python-json-dumps.js";
import { isPythonValue, pythonRepr, pythonStrOf } from "./compat/python-str.js";
import {
  BookmarkValidationError,
  ParamValidationError,
  ValidationError,
} from "./errors.js";
import { defined } from "./invariant.js";
import { buildSegfilterEntry } from "./query/segfilter.js";
import {
  extractCohortFilter,
  filtersToSelector,
} from "./query/user-builders.js";
import {
  validateUserArgs,
  validateUserParams,
} from "./query/user-validators.js";
import {
  validateFlowArgs,
  validateFunnelArgs,
  validateQueryArgs,
  validateRetentionArgs,
} from "./query/validation-args.js";
import {
  validateBookmark,
  validateFlowBookmark,
} from "./query/validation-bookmark.js";
import {
  containsControlChars,
  pythonTypeName,
  scanCustomProperties,
} from "./query/validation-shared.js";
import type { FlowMode } from "./services/live-query-transforms.js";
import type { QueryTimeUnit } from "./types/literals.js";
import {
  type CohortBreakdown,
  CohortDefinition,
  sanitizeRawCohort,
} from "./types/query-params/cohort.js";
import {
  CustomPropertyRef,
  Filter,
  InlineCustomProperty,
} from "./types/query-params/filter.js";
import { FlowStep } from "./types/query-params/flow.js";
import {
  type FrequencyBreakdown,
  FrequencyFilter,
} from "./types/query-params/frequency.js";
import {
  Exclusion,
  FunnelStep,
  HoldingConstant,
} from "./types/query-params/funnel.js";
import type { GroupBy } from "./types/query-params/group-by.js";
import { isPyInt } from "./types/query-params/guards.js";
import {
  CohortMetric,
  Formula,
  Metric,
  type TimeComparison,
} from "./types/query-params/metric.js";
import { RetentionEvent } from "./types/query-params/retention.js";

/** Any JSON-ish dict the bookmark builders emit or consume. */
export type ParamsDict = Record<string, unknown>;

/** Union accepted in the `events` position of the insights query. */
export type EventsInput =
  | string
  | Metric
  | CohortMetric
  | Formula
  | ReadonlyArray<string | Metric | CohortMetric | Formula>;

/** Union accepted in the `group_by` position. */
export type GroupByInput =
  | string
  | GroupBy
  | CohortBreakdown
  | FrequencyBreakdown
  | ReadonlyArray<string | GroupBy | CohortBreakdown | FrequencyBreakdown>
  | null;

/** Union accepted in the `where` position of the insights query. */
export type WhereInput =
  Filter | FrequencyFilter | ReadonlyArray<Filter | FrequencyFilter> | null;

/** Union accepted in the `where` position of funnel/retention/flow. */
export type FilterWhereInput = Filter | readonly Filter[] | null;

/** Clock seam mirroring Python's `date.today().isoformat()`. */
export type TodayFn = () => string;

/**
 * `repr(value)` for a JSON-derived value whose static type is `unknown`
 * (a `Filter.in_cohort()` payload): exact CPython `repr` when the value is
 * in the Python domain, else the loose `str` rendering.
 *
 * @param value - The value to render.
 * @returns The Python text.
 */
function reprOf(value: unknown): string {
  return isPythonValue(value) ? pythonRepr(value) : pythonStrOf(value);
}

/**
 * `any(e.severity == "error" for e in errors)` (the guard every
 * `_resolve_and_build_*` uses before raising).
 *
 * @param errors - The collected findings.
 * @returns `true` when at least one is blocking.
 */
function anyError(errors: readonly ValidationError[]): boolean {
  return errors.some((e) => e.severity === "error");
}

/** Insights `mode` → `displayOptions.chartType` (`workspace.py:2245`). */
const INSIGHTS_CHART_TYPE: ReadonlyMap<string, string> = new Map([
  ["timeseries", "line"],
  ["total", "bar"],
  ["table", "table"],
]);

/** Funnel `mode` → `chartType` (`workspace.py:2896`). */
const FUNNEL_CHART_TYPE: ReadonlyMap<string, string> = new Map([
  ["steps", "funnel-steps"],
  ["trends", "line"],
  ["table", "table"],
]);

/** Retention `mode` → `chartType` (`workspace.py:3434`). */
const RETENTION_CHART_TYPE: ReadonlyMap<string, string> = new Map([
  ["curve", "retention-curve"],
  ["trends", "line"],
  ["table", "table"],
]);

// ===========================================================================
// `_check_step_direction` (`workspace.py:353-390`)
// ===========================================================================

/**
 * Validate a per-step `forward`/`reverse` value for type and range
 * (`_check_step_direction`, `workspace.py:353-390`).
 *
 * `None` means "inherit the default" and produces no finding. The type
 * check rejects `bool` explicitly (Python's `bool` is an `int`
 * subclass, so `isinstance(True, int)` is `True` — the source tests
 * `isinstance(value, bool) or not isinstance(value, int)`).
 *
 * @param value - The forward or reverse value.
 * @param name - Field name (`"forward"` or `"reverse"`).
 * @param stepPath - Parent path for error reporting (`"steps[0]"`).
 * @returns The findings (empty when valid).
 */
export function checkStepDirection(
  value: unknown,
  name: "forward" | "reverse",
  stepPath: string,
): ValidationError[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (typeof value === "boolean" || !isPyInt(value)) {
    return [
      new ValidationError(
        `${stepPath}.${name}`,
        `Per-step ${name} must be an integer (got ${pythonTypeName(value)})`,
        `FL_TYPE_${name.toUpperCase()}`,
      ),
    ];
  }
  const numeric = Number(value);
  if (numeric < 0 || numeric > 5) {
    const code = name === "forward" ? "FL3_FORWARD_RANGE" : "FL4_REVERSE_RANGE";
    return [
      new ValidationError(
        `${stepPath}.${name}`,
        `Per-step ${name} must be between 0 and 5 (got ${numeric})`,
        code,
      ),
    ];
  }
  return [];
}

// ===========================================================================
// `_flow_mode_from_params` (`workspace.py:410-465`)
// ===========================================================================

/**
 * Maps a flow `flows_merge_type` value to the `query_flow` mode that
 * runs it (`_FLOW_MERGE_TYPE_TO_MODE`, `workspace.py:410`).
 *
 * `build_flow_params` writes this key for every mode, so it is the
 * authoritative source when present.
 */
const FLOW_MERGE_TYPE_TO_MODE: ReadonlyMap<string, FlowMode> = new Map([
  ["tree", "tree"],
  ["list", "paths"],
  ["graph", "sankey"],
]);

/**
 * Maps a flow `chartType` value to the `query_flow` mode that runs it
 * (`_FLOW_CHART_TYPE_TO_MODE`, `workspace.py:422`).
 *
 * Fallback for params without `flows_merge_type`. `build_flow_params`
 * writes `"top-paths"` for paths mode and `"sankey"` for both sankey and
 * tree mode, so `chartType` alone cannot tell tree from sankey.
 * `"paths"` and `"tree"` are accepted for hand-written params.
 */
const FLOW_CHART_TYPE_TO_MODE: ReadonlyMap<string, FlowMode> = new Map([
  ["sankey", "sankey"],
  ["top-paths", "paths"],
  ["paths", "paths"],
  ["tree", "tree"],
]);

/**
 * Derive the flow chart mode from pre-built flow params
 * (`_flow_mode_from_params`, `workspace.py:438-465`).
 *
 * `flows_merge_type` wins when present and recognised. `chartType` is
 * the fallback. Anything else runs as sankey.
 *
 * @param params - Flow bookmark params, normally from `buildFlowParams`.
 * @returns `"sankey"`, `"paths"`, or `"tree"`.
 * @example
 * ```typescript
 * flowModeFromParams({ chartType: "sankey", flows_merge_type: "tree" }); // "tree"
 * flowModeFromParams({ chartType: "top-paths" }); // "paths"
 * flowModeFromParams({}); // "sankey"
 * ```
 */
export function flowModeFromParams(
  params: Readonly<Record<string, unknown>>,
): FlowMode {
  const mergeType = params["flows_merge_type"];
  if (typeof mergeType === "string") {
    const mode = FLOW_MERGE_TYPE_TO_MODE.get(mergeType);
    if (mode !== undefined) {
      return mode;
    }
  }
  const chartType = params["chartType"];
  if (typeof chartType === "string") {
    return FLOW_CHART_TYPE_TO_MODE.get(chartType) ?? "sankey";
  }
  return "sankey";
}

// ===========================================================================
// `_build_query_params` (`workspace.py:2047-2283`)
// ===========================================================================

/** Keyword-only arguments of {@link buildQueryParams}. */
export interface BuildQueryParamsOptions {
  /** Event names, `Metric`s or `CohortMetric`s (already normalized). */
  readonly events: ReadonlyArray<string | Metric | CohortMetric>;
  /** Top-level aggregation function. */
  readonly math: string;
  /** Property for property-based math. */
  readonly math_property: unknown;
  /** Per-user pre-aggregation. */
  readonly per_user: string | null;
  /** Custom percentile value. */
  readonly percentile_value?: number | null | undefined;
  /** Start date (`YYYY-MM-DD`) or `null`. */
  readonly from_date: string | null;
  /** End date (`YYYY-MM-DD`) or `null`. */
  readonly to_date: string | null;
  /** Relative date range in days. */
  readonly last: number;
  /** Time unit. */
  readonly unit: string;
  /** Breakdown specification. */
  readonly group_by: GroupByInput;
  /** Filter conditions. */
  readonly where: WhereInput;
  /** Formula objects to append. */
  readonly formulas: readonly Formula[];
  /** Rolling window size. */
  readonly rolling: number | null;
  /** Cumulative analysis mode. */
  readonly cumulative: boolean;
  /** Result mode (`timeseries`, `total`, `table`). */
  readonly mode: string;
  /** Optional period-over-period comparison. */
  readonly time_comparison?: TimeComparison | null | undefined;
  /** Optional data group ID. */
  readonly data_group_id?: number | null | undefined;
  /** Clock seam threaded into {@link buildTimeSection}. */
  readonly today?: TodayFn | undefined;
}

/**
 * Build the insights bookmark params dict from typed arguments
 * (`_build_query_params`, `workspace.py:2047-2283`).
 *
 * @param options - Keyword-only bag mirroring the Python signature.
 * @returns Bookmark params ready for the insights query API.
 */
export function buildQueryParams(options: BuildQueryParamsOptions): ParamsDict {
  const {
    events,
    math,
    math_property,
    per_user,
    percentile_value = null,
    from_date,
    to_date: toDate,
    last,
    unit,
    group_by,
    where,
    formulas,
    rolling,
    cumulative,
    mode,
    time_comparison = null,
    data_group_id = null,
  } = options;

  // --- Build sections.show[] ---
  const show: ParamsDict[] = [];
  for (const item of events) {
    if (item instanceof CohortMetric) {
      // CohortMetric: cohort size tracking (CM3: ignore top-level math)
      const cohortBehavior: ParamsDict = {
        type: "cohort",
        name: item.name ?? "",
        resourceType: "cohorts",
        dataGroupId: null,
        dataset: "$mixpanel",
        filtersDeterminer: "all",
        filters: [],
      };
      if (typeof item.cohort === "number") {
        cohortBehavior["id"] = item.cohort;
      } else {
        const raw = sanitizeRawCohort(item.cohort.toDict()) as ParamsDict;
        // Server-side cohort processing expects `name` in the
        // raw_cohort dict; without it label generation crashes.
        raw["name"] = item.name ?? "";
        cohortBehavior["raw_cohort"] = raw;
      }

      show.push({
        type: "metric",
        behavior: cohortBehavior,
        measurement: {
          math: "unique",
          property: null,
          perUserAggregation: null,
        },
        isHidden: formulas.length > 0,
      });
      continue;
    }

    let eventName: unknown;
    let itemMath: string;
    let itemProp: unknown;
    let itemPerUser: string | null;
    let itemPercentile: number | null;
    let itemFilters: readonly Filter[] | null;
    let itemFiltersCombinator: string;
    let itemSegmentMethod: string | null;
    if (item instanceof Metric) {
      eventName = item.event;
      itemMath = item.math;
      itemProp = item.property;
      itemPerUser = item.per_user;
      itemPercentile = item.percentile_value;
      itemFilters = item.filters;
      itemFiltersCombinator = item.filters_combinator;
      itemSegmentMethod = item.segment_method;
    } else {
      eventName = item;
      itemMath = math;
      itemProp = math_property;
      itemPerUser = per_user;
      itemPercentile = percentile_value;
      itemFilters = null;
      itemFiltersCombinator = "all";
      itemSegmentMethod = null;
    }

    // Map user-facing "percentile" to bookmark "custom_percentile"
    const bookmarkMath =
      itemMath === "percentile" ? "custom_percentile" : itemMath;

    const measurement: ParamsDict = { math: bookmarkMath };
    if (itemProp !== null && itemProp !== undefined) {
      if (itemProp instanceof CustomPropertyRef) {
        measurement["property"] = {
          customPropertyId: itemProp.id,
          name: "",
          resourceType: "events",
        };
      } else if (itemProp instanceof InlineCustomProperty) {
        const cpDict: ParamsDict = {
          displayFormula: itemProp.formula,
          composedProperties: buildComposedProperties(itemProp.inputs),
          name: "",
          description: "",
          resourceType: itemProp.resource_type,
        };
        if (itemProp.property_type !== null) {
          cpDict["propertyType"] = itemProp.property_type;
        }
        measurement["property"] = {
          customProperty: cpDict,
          name: "",
          resourceType: itemProp.resource_type,
          dataset: "$mixpanel",
          dataGroupId: null,
        };
      } else {
        measurement["property"] = { name: itemProp, resourceType: "events" };
      }
    }
    if (itemPerUser !== null) {
      measurement["perUserAggregation"] = itemPerUser;
    }
    if (itemPercentile !== null) {
      measurement["percentile"] = itemPercentile;
    }
    if (itemSegmentMethod !== null) {
      measurement["segmentMethod"] = itemSegmentMethod;
    }

    // Build behavior block with optional per-metric filters
    let behaviorFilters: ParamsDict[] = [];
    // Python `if item_filters:` — an emptiness test (watchlist #6).
    if (itemFilters !== null && itemFilters.length > 0) {
      behaviorFilters = itemFilters.map((f) => buildFilterEntry(f));
    }

    const entry: ParamsDict = {
      type: "metric",
      behavior: {
        type: "event",
        name: eventName,
        resourceType: "events",
        filtersDeterminer: itemFiltersCombinator,
        filters: behaviorFilters,
      },
      measurement,
    };

    // Mark hidden when a formula is present
    if (formulas.length > 0) {
      entry["isHidden"] = true;
    }

    show.push(entry);
  }

  // Append formula entries to show[]
  for (const f of formulas) {
    const formulaEntry: ParamsDict = {
      type: "formula",
      definition: f.expression,
      measurement: {},
      referencedMetrics: [],
    };
    // Python `if f.label:` — empty labels are dropped (watchlist #6).
    if (f.label !== null && f.label !== "") {
      formulaEntry["name"] = f.label;
    }
    show.push(formulaEntry);
  }

  // --- Build sections.time (array) ---
  const timeSection = buildTimeSection({
    from_date,
    to_date: toDate,
    last,
    // Forwarded verbatim, as Python does; the bookmark schema validation
    // downstream is what rejects an unknown unit.
    unit: unit as QueryTimeUnit,
    ...(options.today === undefined ? {} : { today: options.today }),
  });

  // --- Build sections.filter[] ---
  const filterSection = buildFilterSection(where);

  // --- Build sections.group[] ---
  const groupSection = buildGroupSection(group_by, { data_group_id });

  // --- Build displayOptions ---
  const displayOptions: ParamsDict = {
    chartType: INSIGHTS_CHART_TYPE.get(mode) ?? "line",
    analysis: "linear",
  };
  if (rolling !== null) {
    displayOptions["analysis"] = "rolling";
    displayOptions["rollingWindowSize"] = rolling;
  } else if (cumulative) {
    displayOptions["analysis"] = "cumulative";
  }

  if (time_comparison !== null) {
    displayOptions["timeComparison"] = buildTimeComparison(time_comparison);
  }

  // --- Assemble bookmark params ---
  const sections: ParamsDict = {
    show,
    time: timeSection,
    filter: filterSection,
    group: groupSection,
  };
  if (data_group_id !== null) {
    // Contract: the Sections model has no `dataGroupId` key — the
    // sections-level spelling is `globalDataGroupId: string | null`
    // (`workspace.py` insights/funnel/retention sites post-FIX-1;
    // fix-of-record
    // docs/history/phase3/bug-reports/mixpanel-headless-datagroupid-int-clause.md).
    sections["globalDataGroupId"] = String(data_group_id);
  }

  return { sections, displayOptions };
}

// ===========================================================================
// `_resolve_and_build_params` (`workspace.py:2546-2743`)
// ===========================================================================

/** Keyword-only arguments of {@link resolveAndBuildParams}. */
export interface ResolveAndBuildParamsOptions {
  /** Raw events input. */
  readonly events: unknown;
  /** Start date (`YYYY-MM-DD`) or `null`. */
  readonly from_date: string | null;
  /** End date (`YYYY-MM-DD`) or `null`. */
  readonly to_date: string | null;
  /** Relative time range in days. */
  readonly last: number;
  /** Time aggregation unit. */
  readonly unit: string;
  /** Aggregation function. */
  readonly math: string;
  /** Property for property-based math. */
  readonly math_property: unknown;
  /** Per-user pre-aggregation. */
  readonly per_user: string | null;
  /** Custom percentile value. */
  readonly percentile_value?: number | null | undefined;
  /** Breakdown specification. */
  readonly group_by?: GroupByInput;
  /** Filter conditions. */
  readonly where?: unknown;
  /** Top-level formula expression. */
  readonly formula?: string | null | undefined;
  /** Display label for the formula. */
  readonly formula_label?: string | null | undefined;
  /** Rolling window size. */
  readonly rolling?: number | null | undefined;
  /** Cumulative analysis mode. */
  readonly cumulative?: boolean | undefined;
  /** Result shape. */
  readonly mode?: string | undefined;
  /** Optional period-over-period comparison. */
  readonly time_comparison?: TimeComparison | null | undefined;
  /** Optional data group ID. */
  readonly data_group_id?: number | null | undefined;
  /** Clock seam. */
  readonly today?: TodayFn | undefined;
}

/**
 * Normalize, validate and build insights bookmark params
 * (`_resolve_and_build_params`, `workspace.py:2546-2743`).
 *
 * Shared implementation of `query` and `build_params`: type guards,
 * event/formula normalization, Layer-1 argument validation, bookmark
 * construction, Layer-2 structure validation.
 *
 * @param options - Keyword-only bag mirroring the Python signature.
 * @returns The validated bookmark params dict.
 * @throws BookmarkValidationError - Any layer's blocking findings
 *   (`V21_INVALID_EVENT_TYPE`, `V25_INVALID_FILTER_TYPE`,
 *   `V0_NO_EVENTS`, `V4_FORMULA_CONFLICT`, then the `V*` and `B*`
 *   sets).
 */
export function resolveAndBuildParams(
  options: ResolveAndBuildParamsOptions,
): ParamsDict {
  const {
    events,
    from_date,
    to_date: toDate,
    last,
    unit,
    math,
    math_property,
    per_user,
    percentile_value = null,
    group_by = null,
    where = null,
    formula = null,
    formula_label = null,
    rolling = null,
    cumulative = false,
    mode = "timeseries",
    time_comparison = null,
    data_group_id = null,
  } = options;

  // Type guard: events must be str, Metric, CohortMetric, Formula, or
  // a sequence thereof.
  if (!(
    typeof events === "string" ||
    events instanceof Metric ||
    events instanceof CohortMetric ||
    events instanceof Formula ||
    Array.isArray(events)
  )) {
    throw new BookmarkValidationError([
      new ValidationError(
        "events",
        "events must be a string, Metric, CohortMetric, Formula, or " +
          `sequence, got ${pythonTypeName(events)}`,
        "V21_INVALID_EVENT_TYPE",
      ),
    ]);
  }

  // Type guard: where must be Filter, FrequencyFilter, or list
  if (
    where !== null &&
    where !== undefined &&
    !(
      where instanceof Filter ||
      where instanceof FrequencyFilter ||
      Array.isArray(where)
    )
  ) {
    throw new BookmarkValidationError([
      new ValidationError(
        "where",
        "where must be a Filter, FrequencyFilter, or list, " +
          `got ${pythonTypeName(where)}`,
        "V25_INVALID_FILTER_TYPE",
      ),
    ]);
  }

  // Normalize events to a sequence, separating Formula objects
  let eventsList: Array<string | Metric | CohortMetric>;
  let formulasFromList: Formula[];
  if (
    typeof events === "string" ||
    events instanceof Metric ||
    events instanceof CohortMetric
  ) {
    eventsList = [events];
    formulasFromList = [];
  } else if (events instanceof Formula) {
    throw new BookmarkValidationError([
      new ValidationError(
        "events",
        "Formula cannot be the only item; provide event(s) too",
        "V0_NO_EVENTS",
      ),
    ]);
  } else {
    eventsList = [];
    formulasFromList = [];
    for (const item of events as readonly unknown[]) {
      if (item instanceof Formula) {
        formulasFromList.push(item);
      } else {
        eventsList.push(item as string | Metric | CohortMetric);
      }
    }
  }

  // Resolve formulas: can't use both approaches
  if (formula !== null && formulasFromList.length > 0) {
    throw new BookmarkValidationError([
      new ValidationError(
        "formula",
        "Cannot combine top-level 'formula' parameter with " +
          "Formula objects in the events list; use one approach",
        "V4_FORMULA_CONFLICT",
      ),
    ]);
  }

  let resolvedFormulas: readonly Formula[];
  if (formula === null) {
    resolvedFormulas = formulasFromList;
  } else {
    resolvedFormulas = [
      new Formula({ expression: formula, label: formula_label ?? null }),
    ];
  }

  // Layer 1: Argument validation
  const argErrors = validateQueryArgs({
    events: eventsList,
    math,
    math_property: math_property as string | null,
    per_user,
    percentile_value,
    from_date,
    to_date: toDate,
    last,
    has_formula: resolvedFormulas.length > 0,
    rolling,
    cumulative,
    group_by,
    formulas: resolvedFormulas,
    data_group_id,
  });
  // CP1-CP6: Custom property validation for where filters
  argErrors.push(...scanCustomProperties({ where }));
  if (anyError(argErrors)) {
    throw new BookmarkValidationError(argErrors);
  }

  // Build bookmark params
  const params = buildQueryParams({
    events: eventsList,
    math,
    math_property,
    per_user,
    percentile_value,
    from_date,
    to_date: toDate,
    last,
    unit,
    group_by,
    where: where as WhereInput,
    formulas: resolvedFormulas,
    rolling,
    cumulative,
    mode,
    time_comparison,
    data_group_id,
    ...(options.today === undefined ? {} : { today: options.today }),
  });

  // Layer 2: Bookmark structure validation
  const bookmarkErrors = validateBookmark(params);
  if (anyError(bookmarkErrors)) {
    throw new BookmarkValidationError(bookmarkErrors);
  }

  return params;
}

// ===========================================================================
// `_build_funnel_params` (`workspace.py:2746-2927`)
// ===========================================================================

/** Keyword-only arguments of {@link buildFunnelParams}. */
export interface BuildFunnelParamsOptions {
  /** Normalized funnel steps. */
  readonly steps: readonly FunnelStep[];
  /** Conversion window size. */
  readonly conversion_window: number;
  /** Conversion window time unit. */
  readonly conversion_window_unit: string;
  /** Funnel step ordering mode. */
  readonly order: string;
  /** Aggregation function. */
  readonly math: string;
  /** Numeric property name for property aggregation. */
  readonly math_property: string | null;
  /** Start date or `null`. */
  readonly from_date: string | null;
  /** End date or `null`. */
  readonly to_date: string | null;
  /** Relative date range in days. */
  readonly last: number;
  /** Time granularity. */
  readonly unit: string;
  /** Breakdown specification. */
  readonly group_by: GroupByInput;
  /** Filter conditions. */
  readonly where: FilterWhereInput;
  /** Normalized exclusions. */
  readonly exclusions: readonly Exclusion[];
  /** Normalized holding-constant entries. */
  readonly holding_constant: readonly HoldingConstant[];
  /** Display mode (`steps`, `trends`, `table`). */
  readonly mode: string;
  /** Funnel reentry mode. */
  readonly reentry_mode?: string | null | undefined;
  /** Optional period-over-period comparison. */
  readonly time_comparison?: TimeComparison | null | undefined;
  /** Optional data group ID. */
  readonly data_group_id?: number | null | undefined;
  /** Clock seam. */
  readonly today?: TodayFn | undefined;
}

/**
 * Build the funnel bookmark params dict (`_build_funnel_params`,
 * `workspace.py:2746-2927`).
 *
 * @param options - Keyword-only bag mirroring the Python signature.
 * @returns Bookmark params ready for the insights query API.
 */
export function buildFunnelParams(
  options: BuildFunnelParamsOptions,
): ParamsDict {
  const {
    steps,
    conversion_window,
    conversion_window_unit,
    order,
    math,
    math_property,
    from_date,
    to_date: toDate,
    last,
    unit,
    group_by,
    where,
    exclusions,
    holding_constant,
    mode,
    reentry_mode = null,
    time_comparison = null,
    data_group_id = null,
  } = options;

  // Build behaviors array from steps
  const behaviors: ParamsDict[] = [];
  for (const step of steps) {
    const behaviorEntry: ParamsDict = {
      type: "event",
      id: null,
      name: step.event,
      filters: [],
      filtersDeterminer: step.filters_combinator,
      funnelOrder: order,
    };
    // Per-step filters
    if (step.filters !== null && step.filters.length > 0) {
      behaviorEntry["filters"] = step.filters.map((f) => buildFilterEntry(f));
    }
    // Per-step label → renamed
    if (step.label !== null) {
      behaviorEntry["renamed"] = step.label;
    }
    // Per-step order override
    if (step.order !== null) {
      behaviorEntry["funnelOrder"] = step.order;
    }
    behaviors.push(behaviorEntry);
  }

  // Build exclusions array
  const exclusionsList: ParamsDict[] = [];
  for (const ex of exclusions) {
    // Step range — API uses 1-indexed, Exclusion uses 0-indexed
    const apiFrom = ex.from_step + 1;
    const apiTo = ex.to_step === null ? steps.length : ex.to_step + 1;
    exclusionsList.push({
      event: ex.event,
      steps: { from: apiFrom, to: apiTo },
    });
  }

  // Build aggregateBy array
  const aggregateBy: ParamsDict[] = holding_constant.map((hc) => ({
    value: hc.property,
    resourceType: hc.resource_type,
  }));

  // Build behavior block
  const behavior: ParamsDict = {
    type: "funnel",
    resourceType: "events",
    behaviors,
    conversionWindowDuration: conversion_window,
    conversionWindowUnit: conversion_window_unit,
    funnelOrder: order,
    exclusions: exclusionsList,
    aggregateBy,
    filter: [],
  };
  if (reentry_mode !== null) {
    behavior["funnelReentryMode"] = reentry_mode;
  }

  // Build measurement (`if math_property` — an empty string is falsy)
  const measurement: ParamsDict = {
    math,
    property:
      math_property !== null && math_property !== ""
        ? { name: math_property, type: "number", resourceType: "events" }
        : null,
    stepIndex: null,
  };

  // Build show clause
  const show: ParamsDict[] = [{ type: "metric", behavior, measurement }];

  // Build sections using the shared builders
  const timeSection = buildTimeSection({
    from_date,
    to_date: toDate,
    last,
    // Forwarded verbatim, as Python does; the bookmark schema validation
    // downstream is what rejects an unknown unit.
    unit: unit as QueryTimeUnit,
    ...(options.today === undefined ? {} : { today: options.today }),
  });
  const filterSection = patchCustomPropertyFiltersForTransform(
    buildFilterSection(where),
  );
  const groupSection = buildGroupSection(group_by, { data_group_id });

  const displayOptions: ParamsDict = {
    chartType: FUNNEL_CHART_TYPE.get(mode) ?? "funnel-steps",
  };
  if (time_comparison !== null) {
    displayOptions["timeComparison"] = buildTimeComparison(time_comparison);
  }

  const sections: ParamsDict = {
    show,
    time: timeSection,
    filter: filterSection,
    group: groupSection,
    formula: [],
  };
  if (data_group_id !== null) {
    // Contract: the Sections model has no `dataGroupId` key — the
    // sections-level spelling is `globalDataGroupId: string | null`
    // (`workspace.py` insights/funnel/retention sites post-FIX-1;
    // fix-of-record
    // docs/history/phase3/bug-reports/mixpanel-headless-datagroupid-int-clause.md).
    sections["globalDataGroupId"] = String(data_group_id);
  }

  return { sections, displayOptions };
}

// ===========================================================================
// `_resolve_and_build_funnel_params` (`workspace.py:2930-3062`)
// ===========================================================================

/** Keyword-only arguments of {@link resolveAndBuildFunnelParams}. */
export interface ResolveAndBuildFunnelParamsOptions {
  /** Funnel step specs (strings or `FunnelStep`s). */
  readonly steps: ReadonlyArray<string | FunnelStep>;
  /** Conversion window size. */
  readonly conversion_window: number;
  /** Conversion window time unit. */
  readonly conversion_window_unit: string;
  /** Funnel step ordering mode. */
  readonly order: string;
  /** Aggregation function. */
  readonly math: string;
  /** Numeric property name for property aggregation. */
  readonly math_property: string | null;
  /** Start date or `null`. */
  readonly from_date: string | null;
  /** End date or `null`. */
  readonly to_date: string | null;
  /** Relative date range in days. */
  readonly last: number;
  /** Time granularity. */
  readonly unit: string;
  /** Breakdown specification. */
  readonly group_by: GroupByInput;
  /** Filter conditions. */
  readonly where: FilterWhereInput;
  /** Events to exclude, or `null`. */
  readonly exclusions: ReadonlyArray<string | Exclusion> | null;
  /** Properties to hold constant, or `null`. */
  readonly holding_constant:
    string | HoldingConstant | ReadonlyArray<string | HoldingConstant> | null;
  /** Display mode. */
  readonly mode: string;
  /** Funnel reentry mode. */
  readonly reentry_mode?: string | null | undefined;
  /** Optional period-over-period comparison. */
  readonly time_comparison?: TimeComparison | null | undefined;
  /** Optional data group ID. */
  readonly data_group_id?: number | null | undefined;
  /** Clock seam. */
  readonly today?: TodayFn | undefined;
}

/**
 * Normalize, validate and build funnel bookmark params
 * (`_resolve_and_build_funnel_params`, `workspace.py:2930-3062`).
 *
 * @param options - Keyword-only bag mirroring the Python signature.
 * @returns The validated bookmark params dict.
 * @throws BookmarkValidationError - Layer-1 or Layer-2 findings.
 */
export function resolveAndBuildFunnelParams(
  options: ResolveAndBuildFunnelParamsOptions,
): ParamsDict {
  const {
    steps,
    conversion_window,
    conversion_window_unit,
    order,
    math,
    math_property,
    from_date,
    to_date: toDate,
    last,
    unit,
    group_by,
    where,
    exclusions,
    holding_constant,
    mode,
    reentry_mode = null,
    time_comparison = null,
    data_group_id = null,
  } = options;

  // Normalize steps: str → FunnelStep
  const normalizedSteps: FunnelStep[] = [...steps].map((s) =>
    typeof s === "string" ? new FunnelStep({ event: s }) : s,
  );

  // Normalize exclusions: str → Exclusion
  let normalizedExclusions: Exclusion[] = [];
  if (exclusions !== null) {
    normalizedExclusions = [...exclusions].map((e) =>
      typeof e === "string" ? new Exclusion({ event: e }) : e,
    );
  }

  // Normalize holding_constant: str → HoldingConstant
  let normalizedHc: HoldingConstant[] = [];
  if (holding_constant !== null) {
    const hcList: ReadonlyArray<string | HoldingConstant> =
      typeof holding_constant === "string" ||
      holding_constant instanceof HoldingConstant
        ? [holding_constant]
        : [...holding_constant];
    normalizedHc = hcList.map((h) =>
      typeof h === "string" ? new HoldingConstant({ property: h }) : h,
    );
  }

  // Layer 1: Argument validation
  const argErrors = validateFunnelArgs({
    steps: normalizedSteps,
    conversion_window,
    conversion_window_unit,
    math,
    math_property,
    exclusions: normalizedExclusions.length > 0 ? normalizedExclusions : null,
    holding_constant: normalizedHc.length > 0 ? normalizedHc : null,
    from_date,
    to_date: toDate,
    last,
    group_by,
    reentry_mode,
    data_group_id,
  });
  // CP1-CP6: Custom property validation for where filters
  argErrors.push(...scanCustomProperties({ where }));
  if (anyError(argErrors)) {
    throw new BookmarkValidationError(argErrors);
  }

  // Build bookmark params
  const params = buildFunnelParams({
    steps: normalizedSteps,
    conversion_window,
    conversion_window_unit,
    order,
    math,
    math_property,
    from_date,
    to_date: toDate,
    last,
    unit,
    group_by,
    where,
    exclusions: normalizedExclusions,
    holding_constant: normalizedHc,
    mode,
    reentry_mode,
    time_comparison,
    data_group_id,
    ...(options.today === undefined ? {} : { today: options.today }),
  });

  // Layer 2: Bookmark structure validation
  const bookmarkErrors = validateBookmark(params, {
    bookmark_type: "funnels",
  });
  if (anyError(bookmarkErrors)) {
    throw new BookmarkValidationError(bookmarkErrors);
  }

  return params;
}

// ===========================================================================
// `_build_retention_params` (`workspace.py:3321-3487`)
// ===========================================================================

/** Keyword-only arguments of {@link buildRetentionParams}. */
export interface BuildRetentionParamsOptions {
  /** Normalized born event. */
  readonly born_event: RetentionEvent;
  /** Normalized return event. */
  readonly return_event: RetentionEvent;
  /** Retention period unit. */
  readonly retention_unit: string;
  /** Retention alignment mode. */
  readonly alignment: string;
  /** Custom bucket sizes or `null`. */
  readonly bucket_sizes: readonly number[] | null;
  /** Aggregation function. */
  readonly math: string;
  /** Start date or `null`. */
  readonly from_date: string | null;
  /** End date or `null`. */
  readonly to_date: string | null;
  /** Relative date range in days. */
  readonly last: number;
  /** Time granularity. */
  readonly unit: string;
  /** Breakdown specification. */
  readonly group_by: GroupByInput;
  /** Filter conditions. */
  readonly where: FilterWhereInput;
  /** Display mode (`curve`, `trends`, `table`). */
  readonly mode: string;
  /** Retention unbounded mode. */
  readonly unbounded_mode?: string | null | undefined;
  /** Cumulative retention counting. */
  readonly retention_cumulative?: boolean | undefined;
  /** Optional period-over-period comparison. */
  readonly time_comparison?: TimeComparison | null | undefined;
  /** Optional data group ID. */
  readonly data_group_id?: number | null | undefined;
  /** Clock seam. */
  readonly today?: TodayFn | undefined;
}

/**
 * Build the retention bookmark params dict
 * (`_build_retention_params`, `workspace.py:3321-3487`).
 *
 * The trailing `sorting` / `columnWidths` literals are transcribed
 * verbatim — they are part of the emitted contract.
 *
 * @param options - Keyword-only bag mirroring the Python signature.
 * @returns Bookmark params ready for the insights query API.
 */
export function buildRetentionParams(
  options: BuildRetentionParamsOptions,
): ParamsDict {
  const {
    born_event,
    return_event,
    retention_unit,
    alignment,
    bucket_sizes,
    math,
    from_date,
    to_date: toDate,
    last,
    unit,
    group_by,
    where,
    mode,
    unbounded_mode = null,
    retention_cumulative = false,
    time_comparison = null,
    data_group_id = null,
  } = options;

  // Build behaviors array (exactly 2: born + return)
  const behaviors: ParamsDict[] = [];
  for (const evt of [born_event, return_event]) {
    const behaviorEntry: ParamsDict = {
      type: "event",
      id: null,
      name: evt.event,
      filters: [],
      filtersDeterminer: evt.filters_combinator,
    };
    // Per-event filters
    if (evt.filters !== null && evt.filters.length > 0) {
      behaviorEntry["filters"] = evt.filters.map((f) => buildFilterEntry(f));
    }
    behaviors.push(behaviorEntry);
  }

  // Build behavior block (`if bucket_sizes` — [] is falsy)
  const behavior: ParamsDict = {
    type: "retention",
    resourceType: "events",
    behaviors,
    retentionUnit: retention_unit,
    retentionAlignmentType: alignment,
    retentionCustomBucketSizes:
      bucket_sizes !== null && bucket_sizes.length > 0 ? [...bucket_sizes] : [],
    filter: [],
  };
  if (unbounded_mode !== null) {
    behavior["retentionUnboundedMode"] = unbounded_mode;
  }

  // Build measurement
  const measurement: ParamsDict = { math };
  if (retention_cumulative) {
    measurement["retentionCumulative"] = true;
  }

  // Build show clause
  const show: ParamsDict[] = [{ type: "metric", behavior, measurement }];

  // Build sections using the shared builders
  const timeSection = buildTimeSection({
    from_date,
    to_date: toDate,
    last,
    // Forwarded verbatim, as Python does; the bookmark schema validation
    // downstream is what rejects an unknown unit.
    unit: unit as QueryTimeUnit,
    ...(options.today === undefined ? {} : { today: options.today }),
  });
  const filterSection = patchCustomPropertyFiltersForTransform(
    buildFilterSection(where),
  );
  const groupSection = buildGroupSection(group_by, { data_group_id });

  const displayOptions: ParamsDict = {
    chartType: RETENTION_CHART_TYPE.get(mode) ?? "retention-curve",
  };
  if (time_comparison !== null) {
    displayOptions["timeComparison"] = buildTimeComparison(time_comparison);
  }

  const sections: ParamsDict = {
    show,
    time: timeSection,
    filter: filterSection,
    group: groupSection,
    formula: [],
  };
  if (data_group_id !== null) {
    // Contract: the Sections model has no `dataGroupId` key — the
    // sections-level spelling is `globalDataGroupId: string | null`
    // (`workspace.py` insights/funnel/retention sites post-FIX-1;
    // fix-of-record
    // docs/history/phase3/bug-reports/mixpanel-headless-datagroupid-int-clause.md).
    sections["globalDataGroupId"] = String(data_group_id);
  }

  return {
    sections,
    displayOptions,
    sorting: {
      bar: { colSortAttrs: [], sortBy: "column" },
      line: {
        sortBy: "column",
        colSortAttrs: [
          { sortBy: "value", sortOrder: "desc", valueField: "averageValue" },
        ],
      },
      table: {
        sortBy: "column",
        colSortAttrs: [
          {
            sortBy: "value",
            sortOrder: "desc",
            valueField: "size",
            viewNLimit: 12,
          },
        ],
      },
    },
    columnWidths: { bar: {} },
  };
}

// ===========================================================================
// `_build_flow_params` (`workspace.py:3493-3632`)
// ===========================================================================

/** Keyword-only arguments of {@link buildFlowParams}. */
export interface BuildFlowParamsOptions {
  /** Normalized flow steps. */
  readonly steps: readonly FlowStep[];
  /** Start date or `null`. */
  readonly from_date: string | null;
  /** End date or `null`. */
  readonly to_date: string | null;
  /** Relative time range in days. */
  readonly last: number;
  /** Conversion window size. */
  readonly conversion_window: number;
  /** Conversion window unit. */
  readonly conversion_window_unit: string;
  /** Counting method. */
  readonly count_type: string;
  /** Number of top paths to display. */
  readonly cardinality: number;
  /** Whether to merge consecutive repeated events. */
  readonly collapse_repeated: boolean;
  /** Events to hide from the visualization. */
  readonly hidden_events: readonly string[] | null;
  /** Display mode (`sankey`, `paths`, `tree`). */
  readonly mode: string;
  /** Filter results by cohort membership or property conditions. */
  readonly where?: FilterWhereInput;
  /** Optional data group ID. */
  readonly data_group_id?: number | null | undefined;
  /** Segment (breakdown) specification. */
  readonly segments?: GroupByInput;
  /** Event names to exclude from flow paths. */
  readonly exclusions?: readonly string[] | null | undefined;
}

/**
 * Build the FLAT flow bookmark params dict (`_build_flow_params`,
 * `workspace.py:3493-3632`).
 *
 * Flows use a flat dict (no `sections` / `displayOptions` wrapper).
 *
 * @param options - Keyword-only bag mirroring the Python signature.
 * @returns The flat bookmark params dict.
 */
export function buildFlowParams(options: BuildFlowParamsOptions): ParamsDict {
  const {
    steps,
    from_date,
    to_date: toDate,
    last,
    conversion_window,
    conversion_window_unit,
    count_type,
    cardinality,
    collapse_repeated,
    hidden_events,
    mode,
    where = null,
    data_group_id = null,
    segments = null,
    exclusions = null,
  } = options;

  // Build step dicts, including session_event when present
  const stepDicts: ParamsDict[] = [];
  for (const step of steps) {
    const stepDict: ParamsDict = {
      event: step.event,
      // Python `step.label or step.event` — an empty label falls back.
      step_label:
        step.label !== null && step.label !== "" ? step.label : step.event,
      forward: step.forward ?? 0,
      reverse: step.reverse ?? 0,
      bool_op: step.filters_combinator === "any" ? "or" : "and",
      property_filter_params_list: (step.filters ?? []).map((f) =>
        buildSegfilterEntry(f),
      ),
    };
    if (step.session_event !== null) {
      stepDict["session_event"] = step.session_event;
    }
    stepDicts.push(stepDict);
  }

  const params: ParamsDict = {
    steps: stepDicts,
    date_range: buildDateRange({ from_date, to_date: toDate, last }),
    chartType: mode === "paths" ? "top-paths" : "sankey",
    flows_merge_type: flowsMergeType(mode),
    count_type,
    cardinality_threshold: cardinality,
    version: 2,
    conversion_window: {
      unit: conversion_window_unit,
      value: conversion_window,
    },
    anchor_position: 1,
    collapse_repeated,
    show_custom_events: true,
    // Python `hidden_events or []` — an empty list also falls back.
    hidden_events:
      hidden_events !== null && hidden_events.length > 0 ? hidden_events : [],
    exclusions: exclusions ?? [],
  };

  if (data_group_id !== null) {
    params["data_group_id"] = data_group_id;
  }

  // Add filters if present — route cohort vs property filters
  if (where !== null) {
    const filterList: readonly Filter[] = Array.isArray(where)
      ? (where as readonly Filter[])
      : [where as Filter];
    const cohortFilters = filterList.filter((f) => f._property === "$cohorts");
    const propertyFilters = filterList.filter(
      (f) => f._property !== "$cohorts",
    );

    if (cohortFilters.length > 0) {
      const cohortFilter = buildFlowCohortFilter(cohortFilters);
      if (cohortFilter !== null) {
        params["filter_by_cohort"] = cohortFilter;
      }
    }

    if (propertyFilters.length > 0) {
      params["filter_by_event"] = buildFlowPropertyFilter(propertyFilters);
    }
  }

  // Add segments if present
  if (segments !== null) {
    params["segments"] = buildGroupSection(segments);
  }

  return params;
}

// ===========================================================================
// `_resolve_and_build_flow_params` (`workspace.py:3635-3849`)
// ===========================================================================

/** Keyword-only arguments of {@link resolveAndBuildFlowParams}. */
export interface ResolveAndBuildFlowParamsOptions {
  /** Event specification — string, `FlowStep`, or list of either. */
  readonly event: string | FlowStep | ReadonlyArray<string | FlowStep>;
  /** Default forward step count. */
  readonly forward: number;
  /** Default reverse step count. */
  readonly reverse: number;
  /** Start date or `null`. */
  readonly from_date: string | null;
  /** End date or `null`. */
  readonly to_date: string | null;
  /** Relative time range in days. */
  readonly last: number;
  /** Conversion window size. */
  readonly conversion_window: number;
  /** Conversion window unit. */
  readonly conversion_window_unit: string;
  /** Counting method. */
  readonly count_type: string;
  /** Number of top paths to display. */
  readonly cardinality: number;
  /** Whether to merge consecutive repeated events. */
  readonly collapse_repeated: boolean;
  /** Events to hide from the visualization. */
  readonly hidden_events: readonly string[] | null;
  /** Display mode. */
  readonly mode: string;
  /** Filter conditions. */
  readonly where?: FilterWhereInput;
  /** Optional data group ID. */
  readonly data_group_id?: number | null | undefined;
  /** Segment (breakdown) specification. */
  readonly segments?: GroupByInput;
  /** Event names to exclude from flow paths. */
  readonly exclusions?: readonly string[] | null | undefined;
  /** Clock seam for the `to_date` default (`_date.today()`). */
  readonly today?: TodayFn | undefined;
}

/**
 * Normalize, validate and build flow bookmark params
 * (`_resolve_and_build_flow_params`, `workspace.py:3635-3849`).
 *
 * @param options - Keyword-only bag mirroring the Python signature.
 * @returns The validated flow bookmark params dict.
 * @throws BookmarkValidationError - Layer-0.5, Layer-1 or Layer-2
 *   findings (`FL_TYPE_*`, `FL3`/`FL4`, `FL_INVALID_*`, then the FL*
 *   argument and bookmark sets).
 */
export function resolveAndBuildFlowParams(
  options: ResolveAndBuildFlowParamsOptions,
): ParamsDict {
  const {
    event,
    forward,
    reverse,
    from_date,
    last,
    conversion_window,
    conversion_window_unit,
    count_type,
    cardinality,
    collapse_repeated,
    hidden_events,
    mode,
    where = null,
    data_group_id = null,
    segments = null,
    exclusions = null,
  } = options;
  let toDate = options.to_date;

  // Normalize input: str → FlowStep, single → list
  let rawSteps: ReadonlyArray<string | FlowStep>;
  if (typeof event === "string") {
    rawSteps = [new FlowStep({ event })];
  } else if (event instanceof FlowStep) {
    rawSteps = [event];
  } else {
    rawSteps = [...event];
  }

  let steps: FlowStep[] = rawSteps.map((s) =>
    typeof s === "string" ? new FlowStep({ event: s }) : s,
  );

  // Apply the top-level forward/reverse defaults where the step has none
  steps = steps.map(
    (s) =>
      new FlowStep({
        event: s.event,
        forward: s.forward ?? forward,
        reverse: s.reverse ?? reverse,
        label: s.label,
        filters: s.filters,
        filters_combinator: s.filters_combinator,
        session_event: s.session_event,
      }),
  );

  // Layer 0.5: per-step validation (fields `validate_flow_args` cannot
  // see — it only receives event names).
  const stepErrors: ValidationError[] = [];

  // Top-level forward/reverse type checks (int, not bool/float)
  for (const [fname, fval] of [
    ["forward", forward],
    ["reverse", reverse],
  ] as ReadonlyArray<[string, unknown]>) {
    if (typeof fval === "boolean" || !isPyInt(fval)) {
      stepErrors.push(
        new ValidationError(
          fname,
          `${fname} must be an integer (got ${pythonTypeName(fval)})`,
          `FL_TYPE_${fname.toUpperCase()}`,
        ),
      );
    }
  }

  for (const [i, s] of steps.entries()) {
    const spath = `steps[${i}]`;
    // Per-step forward/reverse type + range checks
    stepErrors.push(
      ...checkStepDirection(s.forward, "forward", spath),
      ...checkStepDirection(s.reverse, "reverse", spath),
    );
    // Per-step filters_combinator must be "all" or "any"
    // Runtime guard for untyped callers (the type already says
    // "all" | "any"; Python raises for anything else).
    const combinator: string = s.filters_combinator;
    if (combinator !== "all" && combinator !== "any") {
      stepErrors.push(
        new ValidationError(
          `${spath}.filters_combinator`,
          "filters_combinator must be 'all' or 'any' " +
            `(got ${pythonRepr(combinator)})`,
          "FL_INVALID_FILTERS_COMBINATOR",
        ),
      );
    }
  }
  // Per-step filter property validation
  for (const [i, s] of steps.entries()) {
    if (s.filters !== null && s.filters.length > 0) {
      for (const [fi, f] of s.filters.entries()) {
        if (
          typeof f._property === "string" &&
          containsControlChars(f._property)
        ) {
          stepErrors.push(
            new ValidationError(
              `steps[${i}].filters[${fi}]`,
              "Filter property name contains " +
                `control characters: ${pythonRepr(f._property)}`,
              "FL_FILTER_CONTROL_CHAR",
            ),
          );
        }
      }
    }
  }

  // hidden_events type validation
  if (hidden_events !== null) {
    for (const [i, he] of hidden_events.entries()) {
      if (typeof he !== "string") {
        stepErrors.push(
          new ValidationError(
            `hidden_events[${i}]`,
            "hidden_events values must be strings " +
              `(got ${pythonTypeName(he)})`,
            "FL_INVALID_HIDDEN_EVENT_TYPE",
          ),
        );
      }
    }
  }

  if (anyError(stepErrors)) {
    throw new BookmarkValidationError(stepErrors);
  }

  // Default to_date to today when from_date is set alone, so the
  // absolute date isn't silently ignored by build_date_range().
  if (from_date !== null && toDate === null) {
    toDate = (options.today ?? dateTodayIso)();
  }

  // Layer 1: Argument validation — use the effective direction values
  // from the normalized steps so per-step overrides aren't rejected.
  const effectiveForward = pyMax(steps.map((s) => s.forward ?? 0));
  const effectiveReverse = pyMax(steps.map((s) => s.reverse ?? 0));
  const eventNames = steps.map((s) => s.event);
  const argErrors = validateFlowArgs({
    steps: eventNames,
    forward: effectiveForward,
    reverse: effectiveReverse,
    count_type,
    mode,
    cardinality,
    conversion_window,
    conversion_window_unit,
    from_date,
    to_date: toDate,
    last,
    data_group_id,
  });
  // CP1-CP6: Custom property validation for flow step filters
  argErrors.push(
    ...scanCustomProperties({
      flow_steps: steps,
      where,
    }),
  );
  if (anyError(argErrors)) {
    throw new BookmarkValidationError(argErrors);
  }

  // Build bookmark params
  const params = buildFlowParams({
    steps,
    from_date,
    to_date: toDate,
    last,
    conversion_window,
    conversion_window_unit,
    count_type,
    cardinality,
    collapse_repeated,
    hidden_events,
    mode,
    where,
    data_group_id,
    segments,
    exclusions,
  });

  // Layer 2: Bookmark structure validation
  const bookmarkErrors = validateFlowBookmark(params);
  if (anyError(bookmarkErrors)) {
    throw new BookmarkValidationError(bookmarkErrors);
  }

  return params;
}

/**
 * CPython `max(iterable)` over the flow direction values.
 *
 * @param values - The candidates (never empty — `steps` always has at
 *   least one member by the time this runs).
 * @returns The maximum.
 * @throws ValueError - On an empty sequence (CPython's
 *   `max() iterable argument is empty`).
 */
function pyMax(values: readonly number[]): number {
  const [first, ...rest] = values;
  if (first === undefined) {
    throw new ValueError("max() iterable argument is empty");
  }
  let best = first;
  for (const v of rest) {
    if (v > best) {
      best = v;
    }
  }
  return best;
}

// ===========================================================================
// `_resolve_and_build_retention_params` (`workspace.py:4100-4222`)
// ===========================================================================

/** Keyword-only arguments of {@link resolveAndBuildRetentionParams}. */
export interface ResolveAndBuildRetentionParamsOptions {
  /** Born event spec (string or `RetentionEvent`). */
  readonly born_event: string | RetentionEvent;
  /** Return event spec (string or `RetentionEvent`). */
  readonly return_event: string | RetentionEvent;
  /** Retention period unit. */
  readonly retention_unit: string;
  /** Retention alignment mode. */
  readonly alignment: string;
  /** Custom bucket sizes or `null`. */
  readonly bucket_sizes: readonly number[] | null;
  /** Aggregation function. */
  readonly math: string;
  /** Start date or `null`. */
  readonly from_date: string | null;
  /** End date or `null`. */
  readonly to_date: string | null;
  /** Relative date range in days. */
  readonly last: number;
  /** Time granularity. */
  readonly unit: string;
  /** Breakdown specification. */
  readonly group_by: GroupByInput;
  /** Filter conditions. */
  readonly where: FilterWhereInput;
  /** Display mode. */
  readonly mode: string;
  /** Retention unbounded mode. */
  readonly unbounded_mode?: string | null | undefined;
  /** Cumulative retention counting. */
  readonly retention_cumulative?: boolean | undefined;
  /** Optional period-over-period comparison. */
  readonly time_comparison?: TimeComparison | null | undefined;
  /** Optional data group ID. */
  readonly data_group_id?: number | null | undefined;
  /** Clock seam. */
  readonly today?: TodayFn | undefined;
}

/**
 * Normalize, validate and build retention bookmark params
 * (`_resolve_and_build_retention_params`, `workspace.py:4100-4222`).
 *
 * @param options - Keyword-only bag mirroring the Python signature.
 * @returns The validated bookmark params dict.
 * @throws BookmarkValidationError - Layer-1 or Layer-2 findings.
 */
export function resolveAndBuildRetentionParams(
  options: ResolveAndBuildRetentionParamsOptions,
): ParamsDict {
  const {
    born_event,
    return_event,
    retention_unit,
    alignment,
    bucket_sizes,
    math,
    from_date,
    to_date: toDate,
    last,
    unit,
    group_by,
    where,
    mode,
    unbounded_mode = null,
    retention_cumulative = false,
    time_comparison = null,
    data_group_id = null,
  } = options;

  // Normalize events: str → RetentionEvent
  const normBorn =
    typeof born_event === "string"
      ? new RetentionEvent({ event: born_event })
      : born_event;
  const normReturn =
    typeof return_event === "string"
      ? new RetentionEvent({ event: return_event })
      : return_event;

  // Layer 1: Argument validation
  const argErrors = validateRetentionArgs({
    born_event: normBorn.event,
    return_event: normReturn.event,
    retention_unit,
    alignment,
    bucket_sizes,
    math,
    mode,
    unit,
    from_date,
    to_date: toDate,
    last,
    group_by,
    unbounded_mode,
    data_group_id,
  });
  // CP1-CP6: Custom property validation for where and event filters
  argErrors.push(
    ...scanCustomProperties({
      where,
      retention_events: [normBorn, normReturn],
    }),
  );
  if (anyError(argErrors)) {
    throw new BookmarkValidationError(argErrors);
  }

  // Build bookmark params
  const params = buildRetentionParams({
    born_event: normBorn,
    return_event: normReturn,
    retention_unit,
    alignment,
    bucket_sizes,
    math,
    from_date,
    to_date: toDate,
    last,
    unit,
    group_by,
    where,
    mode,
    unbounded_mode,
    retention_cumulative,
    time_comparison,
    data_group_id,
    ...(options.today === undefined ? {} : { today: options.today }),
  });

  // Layer 2: Bookmark structure validation
  const bookmarkErrors = validateBookmark(params, {
    bookmark_type: "retention",
  });
  if (anyError(bookmarkErrors)) {
    throw new BookmarkValidationError(bookmarkErrors);
  }

  return params;
}

// ===========================================================================
// `_resolve_and_build_user_params` (`workspace.py:9336-9627`)
// ===========================================================================

/** Keyword-only arguments of {@link resolveAndBuildUserParams}. */
export interface ResolveAndBuildUserParamsOptions {
  /** Profile filter (single, list, raw selector, or `null`). */
  readonly where?: unknown;
  /** Cohort membership filter. */
  readonly cohort?: number | CohortDefinition | null | undefined;
  /** Output properties. */
  readonly properties?: readonly string[] | null | undefined;
  /** Property name to sort by. */
  readonly sort_by?: string | null | undefined;
  /** Sort direction. */
  readonly sort_order?: string | undefined;
  /** Full-text search term. */
  readonly search?: string | null | undefined;
  /** Single distinct-ID lookup. */
  readonly distinct_id?: string | null | undefined;
  /** Batch distinct-ID lookup. */
  readonly distinct_ids?: readonly string[] | null | undefined;
  /** Group-profile scope. */
  readonly group_id?: string | null | undefined;
  /** Point-in-time query (ISO date string or Unix timestamp). */
  readonly as_of?: string | number | null | undefined;
  /** Output mode. */
  readonly mode?: string | undefined;
  /** Aggregation function. */
  readonly aggregate?: string | undefined;
  /** Property to aggregate on. */
  readonly aggregate_property?: string | null | undefined;
  /** Percentile value. */
  readonly percentile?: number | null | undefined;
  /** Cohort IDs for segmented aggregation. */
  readonly segment_by?: readonly number[] | null | undefined;
  /** Concurrent page fetching. */
  readonly parallel?: boolean | undefined;
  /** Maximum concurrent workers. */
  readonly workers?: number | undefined;
  /** Maximum profiles (validation only; not emitted). */
  readonly limit?: number | null | undefined;
  /** Include non-members in cohort query results. */
  readonly include_all_users?: boolean | undefined;
  /** Clock seam for the U8 `as_of` future check. */
  readonly today?: TodayFn | undefined;
}

/**
 * Validate arguments and build the engage API params dict
 * (`_resolve_and_build_user_params`, `workspace.py:9336-9627`).
 *
 * @param options - Keyword-only bag mirroring the Python signature.
 * @returns The engage params dict for `export_profiles_page`.
 * @throws BookmarkValidationError - Argument-level (U1-U28) or
 *   param-level (UP1-UP4) findings, plus the `U9` / `U_FILTER` /
 *   `U_COHORT` guards raised here.
 */
export function resolveAndBuildUserParams(
  options: ResolveAndBuildUserParamsOptions = {},
): ParamsDict {
  const {
    where = null,
    cohort = null,
    properties = null,
    sort_by = null,
    sort_order = "descending",
    search = null,
    distinct_id = null,
    distinct_ids = null,
    group_id = null,
    as_of = null,
    mode = "aggregate",
    aggregate = "count",
    aggregate_property = null,
    percentile = null,
    segment_by = null,
    parallel = false,
    workers = 5,
    limit = 1,
    include_all_users = false,
  } = options;

  // Type guard for where
  if (
    where !== null &&
    where !== undefined &&
    !(
      where instanceof Filter ||
      Array.isArray(where) ||
      typeof where === "string"
    )
  ) {
    throw new BookmarkValidationError([
      new ValidationError(
        "where",
        "where must be a Filter, list[Filter], str, or None " +
          `(got ${pythonTypeName(where)})`,
        "U9",
      ),
    ]);
  }

  // Layer 1: argument-level validation
  const argErrors = validateUserArgs({
    where: (where ?? null) as string | Filter | readonly unknown[] | null,
    cohort,
    properties,
    sort_by,
    // Python's `Literal[...]` is erased at runtime, so an out-of-union
    // string MUST still reach the validator (which raises U2/U13/U14
    // for it). The casts restore that reachability past the TS
    // narrowing on the B2 options bag.
    sort_order: sort_order as "ascending" | "descending",
    limit,
    search,
    distinct_id,
    distinct_ids,
    group_id,
    as_of,
    mode: mode as "profiles" | "aggregate",
    aggregate: aggregate as
      "count" | "extremes" | "percentile" | "numeric_summary",
    aggregate_property,
    percentile,
    segment_by,
    parallel,
    workers,
    include_all_users,
    ...(options.today === undefined ? {} : { today: options.today }),
  });
  const errorSeverity = argErrors.filter((e) => e.severity === "error");
  if (errorSeverity.length > 0) {
    throw new BookmarkValidationError(errorSeverity);
  }

  // Build params dict
  const params: ParamsDict = {};

  // --- where handling ---
  let cohortFromFilter: Filter | null = null;
  if (typeof where === "string") {
    params["where"] = where;
  } else if (where instanceof Filter || Array.isArray(where)) {
    const filtersList: readonly Filter[] =
      where instanceof Filter ? [where] : (where as readonly Filter[]);
    const [remaining, extracted] = extractCohortFilter(filtersList);
    cohortFromFilter = extracted;
    if (remaining.length > 0) {
      let selector: string;
      try {
        selector = filtersToSelector(remaining);
      } catch (error) {
        // Python's `except ValueError` here catches BOTH the builtin and
        // `ParamValidationError`, which dual-inherits `ValueError`
        // (`exceptions.py:97`). The converted ES* guards inside
        // `filters_to_selector` raise the latter, and RR-4
        // (`test_workspace_query_user_integration.py:1116-1152`) pins
        // that they surface here as `U_FILTER` with the guard error as
        // the chained cause. The Phase-2 header note ("`except
        // ValueError` reachability is a Python-side concern only",
        // `errors.ts:11-14`) does NOT hold at this one site, so the
        // catch names both classes explicitly.
        if (
          error instanceof ValueError ||
          error instanceof ParamValidationError
        ) {
          const wrapped = new BookmarkValidationError([
            new ValidationError("where", error.message, "U_FILTER"),
          ]);
          // Python's `raise ... from exc`.
          (wrapped as { cause?: unknown }).cause = error;
          throw wrapped;
        }
        throw error;
      }
      if (selector !== "") {
        params["where"] = selector;
      }
    }
  }

  // --- cohort handling ---
  if (cohort !== null) {
    if (typeof cohort === "number") {
      params["filter_by_cohort"] = pythonJsonDumps({ id: cohort });
    } else if (cohort instanceof CohortDefinition) {
      params["filter_by_cohort"] = pythonJsonDumps({
        raw_cohort: sanitizeRawCohort(cohort.toDict()),
      });
    }
  } else if (cohortFromFilter !== null) {
    // Extract the cohort ID from the Filter.in_cohort() value:
    // [{"cohort": {"id": N, "negated": bool, "name": str}}]
    const rawValue = cohortFromFilter._value;
    if (!Array.isArray(rawValue) || rawValue.length === 0) {
      throw new BookmarkValidationError([
        new ValidationError(
          "where",
          "Expected non-empty list from Filter.in_cohort() " +
            `value, got ${pythonTypeName(rawValue)}`,
          "U_COHORT",
        ),
      ]);
    }
    const firstItem: unknown = rawValue[0];
    if (!isPythonDict(firstItem)) {
      throw new BookmarkValidationError([
        new ValidationError(
          "where",
          "Expected dict in Filter.in_cohort() value, " +
            `got ${pythonTypeName(firstItem)}`,
          "U_COHORT",
        ),
      ]);
    }
    if (!Object.hasOwn(firstItem, "cohort")) {
      throw new BookmarkValidationError([
        new ValidationError(
          "where",
          "Filter.in_cohort() value missing 'cohort' " +
            `key: ${reprOf(firstItem)}`,
          "U_COHORT",
        ),
      ]);
    }
    const cohortWrapper = firstItem["cohort"] as Record<string, unknown>;
    if (Object.hasOwn(cohortWrapper, "id")) {
      params["filter_by_cohort"] = pythonJsonDumps({
        id: cohortWrapper["id"],
      });
    } else if (Object.hasOwn(cohortWrapper, "raw_cohort")) {
      params["filter_by_cohort"] = pythonJsonDumps({
        raw_cohort: cohortWrapper["raw_cohort"],
      });
    } else {
      throw new BookmarkValidationError([
        new ValidationError(
          "where",
          "Filter.in_cohort() value has no 'id' or " +
            `'raw_cohort' key: ${reprOf(cohortWrapper)}`,
          "U_COHORT",
        ),
      ]);
    }
  }

  // --- properties → output_properties ---
  if (properties !== null) {
    params["output_properties"] = pythonJsonDumps([...properties]);
  }

  // --- sort_by → sort_key ---
  if (sort_by !== null) {
    const escapedSort = sort_by
      .replaceAll("\\", "\\\\")
      .replaceAll('"', String.raw`\"`);
    params["sort_key"] = `properties["${escapedSort}"]`;
    params["sort_order"] = sort_order;
  }

  // --- as_of → as_of_timestamp ---
  if (as_of !== null) {
    if (typeof as_of === "string") {
      params["as_of_timestamp"] = timegmFromIsoDate(as_of);
    } else if (typeof as_of === "number") {
      params["as_of_timestamp"] = as_of;
    }
  }

  // --- distinct_id ---
  if (distinct_id !== null) {
    params["distinct_id"] = distinct_id;
  }

  // --- distinct_ids ---
  if (distinct_ids !== null) {
    params["distinct_ids"] = pythonJsonDumps([...distinct_ids]);
  }

  // --- group_id → data_group_id ---
  if (group_id !== null) {
    params["data_group_id"] = group_id;
  }

  // --- search ---
  if (search !== null) {
    params["search"] = search;
  }

  // --- include_all_users (only when cohort is set) ---
  if (Object.hasOwn(params, "filter_by_cohort")) {
    params["include_all_users"] = include_all_users;
  }

  // --- aggregate mode ---
  if (mode === "aggregate") {
    let action: string;
    if (aggregate === "count") {
      action = "count()";
    } else {
      const escapedAggProp =
        aggregate_property === null
          ? ""
          : aggregate_property
              .replaceAll("\\", "\\\\")
              .replaceAll('"', String.raw`\"`);
      if (aggregate === "percentile") {
        action = `percentile(properties["${escapedAggProp}"], ${pythonNumberText(
          percentile,
        )})`;
      } else {
        action = `${aggregate}(properties["${escapedAggProp}"])`;
      }
    }
    params["action"] = action;
    if (segment_by !== null) {
      const segMap: Record<string, boolean> = {};
      for (const sid of segment_by) {
        segMap[pythonNumberText(sid)] = true;
      }
      params["segment_by_cohorts"] = pythonJsonDumps(segMap);
    }
  }

  // Layer 2: param-level validation
  const paramErrors = validateUserParams(params);
  if (paramErrors.length > 0) {
    throw new BookmarkValidationError(paramErrors);
  }

  return params;
}

/**
 * `str(x)` for the numbers interpolated into the engage `action` and
 * the `segment_by_cohorts` keys (CPython `str(int)` / `str(float)` —
 * `95` stays `"95"`, `95.0` becomes `"95.0"`).
 *
 * @param value - The number (or `null`, which Python renders `None`).
 * @returns The CPython text.
 */
function pythonNumberText(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "None";
  }
  return pythonRepr(value);
}

/**
 * `calendar.timegm(date.fromisoformat(s).timetuple())`
 * (`workspace.py:9570`) — midnight UTC of an ISO calendar date.
 *
 * `date.fromisoformat` accepts only `YYYY-MM-DD` in the range this
 * code path can reach (the U8 validator has already rejected malformed
 * values), and `timetuple()` zeroes the time fields, so the result is
 * `days_since_epoch * 86400`.
 *
 * @param value - The ISO date text.
 * @returns The Unix timestamp of midnight UTC.
 * @throws ValueError - When the text is not an ISO calendar date
 *   (CPython's `Invalid isoformat string`).
 */
function timegmFromIsoDate(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m === null) {
    throw new ValueError(`Invalid isoformat string: ${pythonRepr(value)}`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) {
    throw new ValueError(`month must be in 1..12`);
  }
  const monthDays = daysInMonth(year, month);
  if (day < 1 || day > monthDays) {
    throw new ValueError(`day is out of range for month`);
  }
  return daysFromCivilDate(year, month, day) * 86400;
}

/**
 * The `flows_merge_type` bookmark literal for a flows `mode`.
 *
 * @param mode - The flows mode (`tree` / `paths` / anything else = sankey).
 * @returns The bookmark literal.
 */
function flowsMergeType(mode: string): "tree" | "list" | "graph" {
  if (mode === "tree") {
    return "tree";
  }
  if (mode === "paths") {
    return "list";
  }
  return "graph";
}

/**
 * Days in a proleptic-Gregorian month.
 *
 * @param year - The year.
 * @param month - The 1-based month.
 * @returns The day count.
 */
function daysInMonth(year: number, month: number): number {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && isLeapYear(year)) {
    return 29;
  }
  return defined(lengths[month - 1], "month length");
}

/**
 * Days since 1970-01-01 for a proleptic-Gregorian date (Howard
 * Hinnant's `days_from_civil`).
 *
 * @param y - Year.
 * @param m - Month (1-12).
 * @param d - Day (1-31).
 * @returns The day count (may be negative).
 */
function daysFromCivilDate(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

// ===========================================================================
// `_build_page_kwargs` (`workspace.py:10209-10256`)
// ===========================================================================

/**
 * Extract `export_profiles_page` kwargs from the engage params dict
 * (`_build_page_kwargs`, `workspace.py:10209-10256`).
 *
 * The two JSON-encoded members (`output_properties`, `distinct_ids`)
 * are decoded back to lists when they arrive as strings, exactly as
 * Python does.
 *
 * @param params - The engage params dict.
 * @returns The keyword arguments for the page call.
 */
export function buildPageKwargs(
  params: Readonly<Record<string, unknown>>,
): ParamsDict {
  const kwargs: ParamsDict = {};
  if (Object.hasOwn(params, "where")) {
    kwargs["where"] = params["where"];
  }
  if (Object.hasOwn(params, "output_properties")) {
    const val = params["output_properties"];
    kwargs["output_properties"] =
      typeof val === "string" ? pythonJsonLoads(val) : val;
  }
  if (Object.hasOwn(params, "sort_key")) {
    kwargs["sort_key"] = params["sort_key"];
  }
  if (Object.hasOwn(params, "sort_order")) {
    kwargs["sort_order"] = params["sort_order"];
  }
  if (Object.hasOwn(params, "search")) {
    kwargs["search"] = params["search"];
  }
  if (Object.hasOwn(params, "filter_by_cohort")) {
    kwargs["filter_by_cohort"] = params["filter_by_cohort"];
  }
  if (Object.hasOwn(params, "data_group_id")) {
    kwargs["group_id"] = params["data_group_id"];
  }
  if (Object.hasOwn(params, "as_of_timestamp")) {
    kwargs["as_of_timestamp"] = params["as_of_timestamp"];
  }
  if (Object.hasOwn(params, "include_all_users")) {
    kwargs["include_all_users"] = params["include_all_users"];
  }
  if (Object.hasOwn(params, "distinct_id")) {
    kwargs["distinct_id"] = params["distinct_id"];
  }
  if (Object.hasOwn(params, "distinct_ids")) {
    const val = params["distinct_ids"];
    kwargs["distinct_ids"] =
      typeof val === "string" ? pythonJsonLoads(val) : val;
  }
  return kwargs;
}

// ===========================================================================
// The `engage_stats` kwargs block of `_execute_user_aggregate`
// (`workspace.py:10027-10046`)
// ===========================================================================

/**
 * Extract the `engage_stats` kwargs from the engage params dict — the
 * `self`-free block of `_execute_user_aggregate`
 * (`workspace.py:10027-10046`), lifted here for the same R7.2 reason
 * as {@link buildPageKwargs} (and so the Layer-3 malformed-JSON case
 * `test_query_user_edge_cases.py:664` has a reachable seam; the Python
 * test calls the private method directly).
 *
 * `segment_by_cohorts` is decoded back to a dict when it arrives as a
 * string, exactly as Python does.
 *
 * @param params - The engage params dict.
 * @returns The keyword arguments for `engage_stats`.
 * @throws LosslessJsonError - Malformed `segment_by_cohorts` JSON
 *   (Python's `json.JSONDecodeError`).
 */
export function buildStatsKwargs(
  params: Readonly<Record<string, unknown>>,
): ParamsDict {
  const kwargs: ParamsDict = {};
  if (Object.hasOwn(params, "where")) {
    kwargs["where"] = params["where"];
  }
  if (Object.hasOwn(params, "action")) {
    kwargs["action"] = params["action"];
  }
  if (Object.hasOwn(params, "filter_by_cohort")) {
    kwargs["filter_by_cohort"] = params["filter_by_cohort"];
  }
  if (Object.hasOwn(params, "segment_by_cohorts")) {
    const raw = params["segment_by_cohorts"];
    kwargs["segment_by_cohorts"] =
      typeof raw === "string" ? pythonJsonLoads(raw) : raw;
  }
  if (Object.hasOwn(params, "data_group_id")) {
    kwargs["group_id"] = params["data_group_id"];
  }
  if (Object.hasOwn(params, "as_of_timestamp")) {
    kwargs["as_of_timestamp"] = params["as_of_timestamp"];
  }
  if (Object.hasOwn(params, "include_all_users")) {
    kwargs["include_all_users"] = params["include_all_users"];
  }
  return kwargs;
}

/**
 * `json.loads(text)` for the three engage-param round-trips — the
 * library encoded these with `pythonJsonDumps`, so the decode uses the
 * shared lossless parser (B0-1 F1: never a bare `JSON.parse`) and its
 * `LosslessJsonError` is the `json.JSONDecodeError` analog.
 *
 * @param text - The JSON text.
 * @returns The native-valued tree.
 * @throws LosslessJsonError - On malformed JSON.
 */
function pythonJsonLoads(text: string): unknown {
  return toNativeJson(parseLossless(text, { pythonConstants: true }));
}
