/**
 * Builder functions for the fragments of a Mixpanel bookmark `params`
 * object: time / filter / group sections, flow filters, frequency
 * clauses and the display-options time comparison. The Python module
 * is `_internal`; this one is exported through
 * `@mixpanel-headless/core/internal` for the facade, the conformance
 * bindings and the translated tests, never from the package barrel.
 *
 * Contract notes a reader must not "clean up": new-format insights
 * `filterValue` carries native JSON values — no `String(...)` or
 * `pythonStr(...)` near a `filterValue` assignment; dict discrimination
 * goes through {@link isPythonDict} and key-presence tests through
 * `Object.hasOwn`, never `in`; {@link patchCustomPropertyFiltersForTransform}
 * mutates and returns the same array and the negated cohort copy is a
 * shallow spread, because facade callers chain the results; the
 * from-only branch of {@link buildTimeSection} is the module's only
 * `date.today()` read and is injectable through `options.today`.
 *
 * @see mixpanel_headless._internal.bookmark_builders
 * @internal
 */

import {
  isPythonDict,
  pythonRepr,
  pythonTypeName,
  setOwn,
} from "../compat/index.js";
import { dateTodayIso } from "../compat/python-dates.js";
import { ParamTypeError, ParamValidationError } from "../errors.js";
import type { QueryTimeUnit } from "../types/literals.js";
// `sanitizeRawCohort` and `isPyIntOrBool` are module-level `@internal`
// exports that the query-params barrel deliberately does not re-export
// (see `types/query-params/index.ts`); import them by name from their
// owning modules rather than re-deriving them.
import { CohortBreakdown } from "../types/query-params/cohort.js";
import {
  CustomPropertyRef,
  Filter,
  InlineCustomProperty,
  type PropertyInput,
} from "../types/query-params/filter.js";
import {
  FrequencyBreakdown,
  FrequencyFilter,
} from "../types/query-params/frequency.js";
import { GroupBy } from "../types/query-params/group-by.js";
import {
  isPyIntOrBool,
  sanitizeRawCohort,
} from "../types/query-params/guards.js";
import type { TimeComparison } from "../types/query-params/metric.js";

/**
 * A bookmark JSON fragment — the ported twin of Python's
 * `dict[str, Any]` return type. Keys are inserted in Python source
 * order (the conformance canonicalizer sorts dict keys, but array
 * emission order and key presence are contract).
 */
export type BookmarkFragment = Record<string, unknown>;

/**
 * Elements accepted by {@link buildGroupSection} (Python's
 * `str | GroupBy | CohortBreakdown | FrequencyBreakdown`).
 */
export type GroupByElement =
  string | GroupBy | CohortBreakdown | FrequencyBreakdown;

/** Elements accepted by {@link buildFilterSection}. */
type FilterSectionElement = Filter | FrequencyFilter;

/**
 * Render a value the way a Python `{x!r}` conversion would — display
 * only, never contract.
 *
 * `pythonRepr` rejects class instances and `undefined`; the BB1 guard
 * can be handed literally anything, so those shapes degrade to a
 * `<TypeName object>` marker rather than throwing a second error out of
 * an error path.
 *
 * @param value - The value to render.
 * @returns A Python-flavoured repr string.
 */
function reprForMessage(value: unknown): string {
  if (value === undefined) {
    return "None";
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  ) {
    return pythonRepr(value);
  }
  if (Array.isArray(value) || isPythonDict(value)) {
    try {
      return pythonRepr(value as never);
    } catch {
      return `<${pythonTypeName(value)} object>`;
    }
  }
  return `<${pythonTypeName(value)} object>`;
}

/**
 * Convert a `PropertyInput` mapping to bookmark `composedProperties`
 * format.
 *
 * Python builds the result with a dict comprehension, so entries land
 * in `inputs` insertion order; `Object.entries` mirrors that for the
 * A-Z keys this map is documented to carry (JS reorders integer-like
 * keys, but dict key order is not a conformance contract — the
 * canonicalizer sorts them). Module-private in Python; exported for
 * in-package use only.
 *
 * @param inputs - Mapping from single uppercase letters (A-Z) to
 *   `PropertyInput` objects.
 * @returns Dict mapping each letter to a dict with `value`, `type` and
 *   `resourceType` keys.
 * @example
 * ```typescript
 * buildComposedProperties({ A: new PropertyInput({ name: "price", type: "number" }) });
 * // { A: { value: "price", type: "number", resourceType: "event" } }
 * ```
 * @see mixpanel_headless._internal.bookmark_builders._build_composed_properties
 * @internal
 */
export function buildComposedProperties(
  inputs: Readonly<Record<string, PropertyInput>>,
): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  for (const [key, prop] of Object.entries(inputs)) {
    // `setOwn`: an input key of `"__proto__"` must land as an own key,
    // exactly as the Python dict comprehension keeps it.
    setOwn(result, key, {
      value: prop.name,
      type: prop.type,
      resourceType: prop.resource_type,
    });
  }
  return result;
}

/**
 * Build the `sections.time` array for bookmark params.
 *
 * Three cases: absolute range (both dates), from-only (the `to_date`
 * slot is filled with today — the module's only clock read), and
 * relative (`last` days).
 *
 * @param options - Keyword-only bag mirroring Python's `*`-signature:
 *   `from_date` / `to_date` (`YYYY-MM-DD` or `null`), `last` (days for
 *   the relative window), `unit` (time granularity), and the optional
 *   `today` clock seam returning today's ISO date (defaults to the real
 *   local clock; the conformance binding injects a frozen one).
 * @returns Single-element array holding one time-entry dict.
 * @example
 * ```typescript
 * buildTimeSection({ from_date: "2025-01-01", to_date: "2025-01-31", last: 30, unit: "day" });
 * // [{ dateRangeType: "between", unit: "day", value: ["2025-01-01", "2025-01-31"] }]
 * ```
 * @see mixpanel_headless._internal.bookmark_builders.build_time_section
 */
export function buildTimeSection(options: {
  readonly from_date: string | null;
  readonly to_date: string | null;
  readonly last: number;
  readonly unit: QueryTimeUnit;
  readonly today?: () => string;
}): BookmarkFragment[] {
  let timeEntry: BookmarkFragment;
  if (options.from_date === null) {
    timeEntry = {
      dateRangeType: "in the last",
      unit: options.unit,
      window: { unit: "day", value: options.last },
    };
  } else {
    const today = options.today ?? dateTodayIso;
    const effectiveTo = options.to_date ?? today();
    timeEntry = {
      dateRangeType: "between",
      unit: options.unit,
      value: [options.from_date, effectiveTo],
    };
  }
  return [timeEntry];
}

/**
 * Build a flat date-range dict for flows.
 *
 * Flows use a flat `date_range` object rather than the sections-based
 * `sections.time` array. The relative branch emits the literal string
 * `"$now"`; there is no clock read here.
 *
 * @param options - Keyword-only bag: `from_date` / `to_date`
 *   (`YYYY-MM-DD` or `null`) and `last` (days for the relative window).
 * @returns Date-range dict — `{type: "between", from_date, to_date}`
 *   when both dates are set, otherwise the relative shape.
 * @example
 * ```typescript
 * buildDateRange({ from_date: null, to_date: null, last: 30 });
 * // { type: "in the last", from_date: { unit: "day", value: 30 }, to_date: "$now" }
 * ```
 * @see mixpanel_headless._internal.bookmark_builders.build_date_range
 */
export function buildDateRange(options: {
  readonly from_date: string | null;
  readonly to_date: string | null;
  readonly last: number;
}): BookmarkFragment {
  if (options.from_date !== null && options.to_date !== null) {
    return {
      type: "between",
      from_date: options.from_date,
      to_date: options.to_date,
    };
  }
  return {
    type: "in the last",
    from_date: { unit: "day", value: options.last },
    to_date: "$now",
  };
}

/**
 * Build the `sections.filter` array.
 *
 * `null` yields `[]`; a single `Filter`/`FrequencyFilter` is wrapped;
 * a list is processed element-by-element. Elements that are neither a
 * `FrequencyFilter` nor a `Filter` are silently skipped — Python has no
 * `else` branch, so the skip is the behavior, not an oversight.
 *
 * Dispatch order mirrors Python: `FrequencyFilter` is tested before
 * `Filter` (they are unrelated classes in Python, but the source order
 * is preserved so a future subclass cannot silently re-route).
 *
 * @param where - Filter specification (`null`, one filter, or a list).
 * @returns Array of filter-entry dicts (possibly empty).
 * @example
 * ```typescript
 * buildFilterSection(Filter.equals("country", "US"));
 * // [{ resourceType: "events", filterType: "string", … }]
 * ```
 * @see mixpanel_headless._internal.bookmark_builders.build_filter_section
 */
export function buildFilterSection(
  where:
    Filter | FrequencyFilter | ReadonlyArray<Filter | FrequencyFilter> | null,
): BookmarkFragment[] {
  if (where === null) {
    return [];
  }
  // Python: `list(where) if isinstance(where, (list, tuple)) else [where]`.
  const filtersList: readonly FilterSectionElement[] = Array.isArray(where)
    ? (where as readonly FilterSectionElement[])
    : [where as FilterSectionElement];
  const result: BookmarkFragment[] = [];
  for (const f of filtersList) {
    if (f instanceof FrequencyFilter) {
      result.push(buildFrequencyFilterEntry(f));
    } else if (f instanceof Filter) {
      result.push(buildFilterEntry(f));
    }
    // No else: foreign elements are dropped, as in Python.
  }
  return result;
}

/**
 * Add a `value` sentinel to custom-property filters for server compat.
 *
 * The server's `transform_insights_filters_to_funnels()` does a hard
 * `f["value"]` access on global `sections.filter` entries; custom
 * property filters identify the property via `customPropertyId` /
 * `customProperty` instead, causing a `KeyError` and HTTP 500.
 * Injecting `value: null` satisfies the hard access. This must not be
 * applied to per-step or per-metric filters.
 *
 * The array is mutated in place and returned; the facade chains
 * `patchCustomPropertyFiltersForTransform(buildFilterSection(where))`
 * as Python does, so the aliasing is contract. All three membership
 * tests are key-presence checks (`Object.hasOwn`, never `in`, never a
 * truthiness test): an entry whose `value` is already `null` is left
 * alone.
 *
 * @param filterEntries - Entries produced by {@link buildFilterSection}.
 * @returns The same array instance, mutated.
 * @example
 * ```typescript
 * const entries = buildFilterSection(Filter.equals(new CustomPropertyRef(42), "x"));
 * patchCustomPropertyFiltersForTransform(entries) === entries; // true
 * entries[0].value; // null
 * ```
 * @see mixpanel_headless._internal.bookmark_builders.patch_custom_property_filters_for_transform
 */
export function patchCustomPropertyFiltersForTransform(
  filterEntries: BookmarkFragment[],
): BookmarkFragment[] {
  for (const entry of filterEntries) {
    if (
      !Object.hasOwn(entry, "value") &&
      (Object.hasOwn(entry, "customPropertyId") ||
        Object.hasOwn(entry, "customProperty"))
    ) {
      entry["value"] = null;
    }
  }
  return filterEntries;
}

/**
 * Build the `sections.group` array.
 *
 * Dispatch order is Python source order: `str` → `FrequencyBreakdown` →
 * `GroupBy` (itself splitting `CustomPropertyRef` /
 * `InlineCustomProperty` / list-item mode / plain) → `CohortBreakdown`
 * → BB1.
 *
 * @param groupBy - Group-by specification; `null` means no grouping.
 *   Strings produce default string-typed entries; `GroupBy` allows
 *   custom property types and numeric bucketing; `CohortBreakdown` and
 *   `FrequencyBreakdown` produce their own entry shapes; lists mix all
 *   four.
 * @param options - Optional bag: `data_group_id` (default `null`),
 *   threaded into the `dataGroupId` field of the entries that carry one
 *   and coerced to a string at emission, because the bookmark contract
 *   types clause-level `dataGroupId` as `string | null`.
 * @returns Array of group-entry dicts (possibly empty).
 * @throws {@link ParamTypeError} - `BB1_GROUP_BY_ELEMENT_TYPE` when an
 *   element is none of the four accepted shapes.
 * @example
 * ```typescript
 * buildGroupSection(new CohortBreakdown({ cohort: 123, name: "Power Users" }));
 * // [{ value: ["Power Users", "Not In Power Users"], resourceType: "events", … }]
 * ```
 * @see mixpanel_headless._internal.bookmark_builders.build_group_section
 */
// eslint-disable-next-line max-lines-per-function -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
export function buildGroupSection(
  groupBy: GroupByElement | readonly GroupByElement[] | null,
  options?: { readonly data_group_id?: number | null },
): BookmarkFragment[] {
  if (groupBy === null) {
    return [];
  }
  const dataGroupId = options?.data_group_id ?? null;
  // Contract: GroupClause.dataGroupId is string | null — coerce the
  // int-typed parameter once at emission, as Python does. The raw value
  // still threads into the frequency/cohort sub-builders, which coerce
  // themselves.
  const dgid = dataGroupId === null ? null : String(dataGroupId);

  // Python: `list(group_by) if isinstance(group_by, (list, tuple))`.
  const groups: readonly GroupByElement[] = Array.isArray(groupBy)
    ? (groupBy as readonly GroupByElement[])
    : [groupBy as GroupByElement];
  const groupSection: BookmarkFragment[] = [];

  for (const g of groups) {
    let groupEntry: BookmarkFragment;
    if (typeof g === "string") {
      groupSection.push({
        value: g,
        propertyName: g,
        resourceType: "events",
        propertyType: "string",
        propertyDefaultType: "string",
      });
      continue;
    }
    if (g instanceof FrequencyBreakdown) {
      groupSection.push(
        buildFrequencyGroupEntry(g, { data_group_id: dataGroupId }),
      );
      continue;
    }
    if (g instanceof GroupBy) {
      const prop = g.property;
      if (prop instanceof CustomPropertyRef) {
        groupEntry = {
          customPropertyId: prop.id,
          value: null,
          resourceType: "events",
          profileType: null,
          search: "",
          dataGroupId: dgid,
          dataset: "$mixpanel",
          propertyType: g.property_type,
          typeCast: null,
          unit: null,
          isHidden: false,
        };
      } else if (prop instanceof InlineCustomProperty) {
        const effectiveType = prop.property_type ?? g.property_type;
        const composed = buildComposedProperties(prop.inputs);
        groupEntry = {
          customProperty: {
            displayFormula: prop.formula,
            composedProperties: composed,
            name: "",
            description: "",
            propertyType: effectiveType,
            resourceType: prop.resource_type,
          },
          value: null,
          resourceType: prop.resource_type,
          profileType: null,
          search: "",
          dataGroupId: dgid,
          dataset: "$mixpanel",
          propertyType: effectiveType,
          typeCast: null,
          unit: null,
          isHidden: false,
        };
      } else if (g._list_item_mode === null) {
        groupEntry = {
          value: prop,
          propertyName: prop,
          resourceType: "events",
          propertyType: g.property_type,
          propertyDefaultType: g.property_type,
        };
      } else {
        // resourceType is hardcoded "events" and propertyType is
        // hardcoded "object": GroupBy.list_item is event-only — the
        // Mixpanel UI does not support list-of-object breakdowns for
        // people properties, so the classmethod exposes no
        // resource_type parameter. Asymmetric with
        // Filter.list_contains, which does accept
        // resource_type="people" because the wire format permits
        // list-object filters on people properties (just not
        // breakdowns).
        const mode = g._list_item_mode;
        groupEntry = {
          dataset: "$mixpanel",
          value: prop,
          resourceType: "events",
          joinPropertyType: "list",
          propertyType: "object",
          listItemGroup: {
            resourceType: "event",
            propertyName: mode.sub,
            propertyDefaultType: mode.sub_type,
            propertyType: mode.sub_type,
          },
        };
      }
      // `min` / `max` land only when non-null.
      if (g.bucket_size !== null) {
        const customBucket: BookmarkFragment = { bucketSize: g.bucket_size };
        if (g.bucket_min !== null) {
          customBucket["min"] = g.bucket_min;
        }
        if (g.bucket_max !== null) {
          customBucket["max"] = g.bucket_max;
        }
        groupEntry["customBucket"] = customBucket;
      }
      groupSection.push(groupEntry);
    } else if (g instanceof CohortBreakdown) {
      groupSection.push(
        buildCohortGroupEntry(g, { data_group_id: dataGroupId }),
      );
    } else {
      throw new ParamTypeError(
        `group_by elements must be str, GroupBy, CohortBreakdown, ` +
          `or FrequencyBreakdown, got ${pythonTypeName(g)}: ${reprForMessage(
            g,
          )}`,
        "BB1_GROUP_BY_ELEMENT_TYPE",
      );
    }
  }

  return groupSection;
}

/**
 * Build a single cohort group entry for `sections.group[]`.
 *
 * Saved (integer) and inline cohorts use different API schemas: saved
 * allows `groups`/`count`/`description`, inline allows
 * `raw_cohort`/`dataset` but not `groups`.
 *
 * `name = cb.name or ""` — Python's falsy-or catches both `None` and
 * `""`; only `string | null` reaches this field, so `?? ""` is exact.
 * The negated entry is `{...base_cohort, negated: true}`, a shallow
 * spread sharing the `groups` array / `raw_cohort` object with the base
 * entry exactly as Python does; do not deep-copy. Module-private in
 * Python.
 *
 * @param cb - CohortBreakdown specification.
 * @param options - Optional bag: `data_group_id` (default `null`),
 *   threaded into both `data_group_id` (cohort entries) and
 *   `dataGroupId` (the group entry) and coerced to a string, because the
 *   bookmark contract types both slots `string | null`.
 * @returns Group-entry dict carrying a `cohorts` array of one or two
 *   entries depending on `include_negated`.
 * @example
 * ```typescript
 * buildCohortGroupEntry(new CohortBreakdown({ cohort: 123, name: "PU" }));
 * // { value: ["PU", "Not In PU"], cohorts: [...], … }
 * ```
 * @see mixpanel_headless._internal.bookmark_builders._build_cohort_group_entry
 * @internal
 */
function buildCohortGroupEntry(
  cb: CohortBreakdown,
  options?: { readonly data_group_id?: number | null },
): BookmarkFragment {
  const dataGroupId = options?.data_group_id ?? null;
  // Contract: GroupByCohort.data_group_id and GroupClause.dataGroupId
  // are both string | null — coerce the int-typed parameter at
  // emission, as Python does.
  const dgid = dataGroupId === null ? null : String(dataGroupId);
  const name = cb.name ?? "";

  const baseCohort: BookmarkFragment = {
    name,
    negated: false,
    data_group_id: dgid,
  };
  // `isinstance(cb.cohort, int)` — a Python `float` (the rig's PyFloat
  // carrier, or a fractional number) is not an int and falls to the
  // inline branch exactly as Python does. Booleans are ints in Python
  // (`bool <: int`), so `CohortBreakdown(True)` takes the saved branch
  // and emits `id: true`; the bool-exclusive `isPyInt` would instead
  // crash here on `cb.cohort.toDict()`.
  if (isPyIntOrBool(cb.cohort)) {
    baseCohort["id"] = cb.cohort;
    baseCohort["groups"] = [];
  } else {
    baseCohort["raw_cohort"] = sanitizeRawCohort(cb.cohort.toDict());
  }

  const cohorts: BookmarkFragment[] = [baseCohort];
  const valueLabels: string[] = [name];

  if (cb.include_negated) {
    cohorts.push({ ...baseCohort, negated: true });
    valueLabels.push(`Not In ${name}`);
  }

  return {
    value: valueLabels,
    resourceType: "events",
    profileType: null,
    search: "",
    dataGroupId: dgid,
    propertyType: null,
    typeCast: null,
    cohorts,
    isHidden: false,
  };
}

/**
 * Convert a `Filter` to a bookmark filter dict.
 *
 * `filterValue: f._value` passes numbers, booleans and `null` through
 * natively; never stringify it.
 *
 * Key order mirrors the Python dict literal: `resourceType`,
 * `filterType`, `defaultType`, `filterValue`, `filterOperator`, then
 * the per-property-kind keys, then `value` (plain-string properties
 * only), then the conditional `filterDateUnit`.
 *
 * @param f - A `Filter` built through its static factories.
 * @returns Bookmark filter dict. `CustomPropertyRef` properties add
 *   `customPropertyId` + `dataset`; `InlineCustomProperty` properties
 *   add `customProperty` + `dataset` and override
 *   `filterType`/`defaultType`/`resourceType` from the inline
 *   property; plain-string properties add `value`.
 * @example
 * ```typescript
 * buildFilterEntry(Filter.equals("country", "US"));
 * // { resourceType: "events", filterType: "string", defaultType: "string",
 * //   filterValue: ["US"], filterOperator: "equals", value: "country" }
 * ```
 * @see mixpanel_headless._internal.bookmark_builders.build_filter_entry
 */
export function buildFilterEntry(f: Filter): BookmarkFragment {
  if (f._operator === "list_contains") {
    return buildListContainsEntry(f);
  }
  const prop = f._property;
  const entry: BookmarkFragment = {
    resourceType: f._resource_type,
    filterType: f._property_type,
    defaultType: f._property_type,
    // Native pass-through — no String(), no pythonStr().
    filterValue: f._value,
    filterOperator: f._operator,
  };
  if (prop instanceof CustomPropertyRef) {
    entry["customPropertyId"] = prop.id;
    entry["dataset"] = "$mixpanel";
  } else if (prop instanceof InlineCustomProperty) {
    const effectiveType = prop.property_type ?? f._property_type;
    entry["customProperty"] = {
      displayFormula: prop.formula,
      composedProperties: buildComposedProperties(prop.inputs),
      name: "",
      description: "",
      propertyType: effectiveType,
      resourceType: prop.resource_type,
    };
    entry["filterType"] = effectiveType;
    entry["defaultType"] = effectiveType;
    entry["dataset"] = "$mixpanel";
    entry["resourceType"] = prop.resource_type;
  } else {
    entry["value"] = prop;
  }
  if (f._date_unit !== null) {
    entry["filterDateUnit"] = f._date_unit;
  }
  return entry;
}

/**
 * Build the bookmark entry for a `Filter.listContains` filter.
 *
 * Emits the `listItemFilters` wire structure used to filter on
 * subproperties of objects nested inside a list property. Each inner
 * `Filter` is serialized through {@link buildFilterEntry} recursively,
 * then `dataset` is backfilled to `"$mixpanel"` (Python `setdefault` —
 * an existing `dataset`, e.g. from a `CustomPropertyRef` sub-filter, is
 * left untouched).
 *
 * `Filter`'s constructor guarantees `_list_item_filters` /
 * `_list_item_quantifier` are non-null for this operator; the two `as`
 * assertions below are the narrowing claim Python spells with
 * `cast(...)`, not a runtime check. Module-private in Python.
 *
 * @param f - A `Filter` built via `Filter.listContains(...)`.
 * @returns Bookmark filter dict carrying `listItemFilters`,
 *   `listQuantifier`, and the constant outer wrapper
 *   (`filterOperator: "true"`, `filterValue: true` — JSON `true`, the
 *   boolean form of the native pass-through — `filterType: "object"`,
 *   `filterJoinType: "list"`).
 * @see mixpanel_headless._internal.bookmark_builders._build_list_contains_entry
 * @internal
 */
function buildListContainsEntry(f: Filter): BookmarkFragment {
  const listItemFilters = f._list_item_filters as readonly Filter[];
  const listItemQuantifier = f._list_item_quantifier as "any" | "all";
  const inner: BookmarkFragment[] = [];
  for (const sub of listItemFilters) {
    const subEntry = buildFilterEntry(sub);
    // Python `dict.setdefault` — insert only when the key is absent.
    if (!Object.hasOwn(subEntry, "dataset")) {
      subEntry["dataset"] = "$mixpanel";
    }
    inner.push(subEntry);
  }
  return {
    dataset: "$mixpanel",
    value: f._property,
    resourceType: f._resource_type,
    filterType: "object",
    defaultType: "object",
    filterJoinType: "list",
    listQuantifier: listItemQuantifier,
    listItemFilters: inner,
    filterOperator: "true",
    // Native pass-through: JSON `true`, never the string "true".
    filterValue: true,
  };
}

/**
 * Build the `filter_by_event` dict for flow bookmark params.
 *
 * Guard order is contract: BB2 fires on an empty list; then, per
 * filter, `buildFilterEntry(f)` runs first so any error it raises wins,
 * and only afterwards does the non-string property check raise BB3.
 * Both `CustomPropertyRef` and `InlineCustomProperty` reach BB3.
 *
 * @param filters - Property filters; must be non-empty.
 * @returns Dict with `operator: "and"` and a `children` array; each
 *   child is a filter entry plus `propertyName`, minus the `value` and
 *   `defaultType` keys.
 * @throws {@link ParamValidationError} - `BB2_FLOW_PROPERTY_FILTER_EMPTY`
 *   when `filters` is empty.
 * @throws {@link ParamTypeError} - `BB3_FLOW_PROPERTY_FILTER_TYPE` when a
 *   filter's property is not a plain string.
 * @example
 * ```typescript
 * buildFlowPropertyFilter([Filter.equals("country", "US")]);
 * // { operator: "and", children: [{ …, propertyName: "country" }] }
 * ```
 * @see mixpanel_headless._internal.bookmark_builders.build_flow_property_filter
 */
export function buildFlowPropertyFilter(
  filters: readonly Filter[],
): BookmarkFragment {
  // Python `if not filters` on a list is an emptiness test.
  if (filters.length === 0) {
    throw new ParamValidationError(
      "build_flow_property_filter requires at least one filter; " +
        "caller should check before calling",
      "BB2_FLOW_PROPERTY_FILTER_EMPTY",
    );
  }
  const children: BookmarkFragment[] = [];
  for (const f of filters) {
    const entry = buildFilterEntry(f);
    // Add propertyName — flow filters only support string property names.
    const prop = f._property;
    if (typeof prop === "string") {
      entry["propertyName"] = prop;
    } else {
      throw new ParamTypeError(
        "build_flow_property_filter only supports string property " +
          `filters; got ${pythonTypeName(prop)} — custom property refs ` +
          "are not supported in flow filters",
        "BB3_FLOW_PROPERTY_FILTER_TYPE",
      );
    }
    // Remove "value" — flow filters use propertyName instead.
    delete entry["value"];
    // Remove defaultType — flow filters don't use it.
    delete entry["defaultType"];
    children.push(entry);
  }

  return {
    operator: "and",
    children,
  };
}

/**
 * Build the `filter_by_cohort` dict for flow bookmark params.
 *
 * Flows use a legacy `filter_by_cohort` top-level key rather than the
 * `sections.filter` array. Only cohort filters are accepted.
 *
 * Normalization asymmetry worth noting: this site tests
 * `isinstance(where, list)` only — unlike {@link buildFilterSection},
 * which also accepts a tuple. `Array.isArray` is the faithful twin of
 * the reachable domain.
 *
 * Guard order (Python source order): BB4 is checked for every filter
 * before the BB5 count check.
 *
 * @param where - A single cohort `Filter` or a list of them.
 * @returns The `filter_by_cohort` dict, or `null` when `where` is an
 *   empty list.
 * @throws {@link ParamValidationError} - `BB4_FLOW_COHORT_FILTER_TYPE` (a
 *   non-cohort filter), `BB5_FLOW_MULTIPLE_COHORT_FILTERS` (more than
 *   one), `BB6_COHORT_VALUE_NOT_LIST` / `BB7_COHORT_VALUE_NOT_DICT` /
 *   `BB8_COHORT_KEY_MISSING` (a malformed internal `_value`).
 * @example
 * ```typescript
 * buildFlowCohortFilter(Filter.inCohort(123, "PU"));
 * // { name: "PU", negated: false, id: 123 }
 * ```
 * @see mixpanel_headless._internal.bookmark_builders.build_flow_cohort_filter
 */
export function buildFlowCohortFilter(
  where: Filter | readonly Filter[],
): BookmarkFragment | null {
  const filters: readonly Filter[] = Array.isArray(where)
    ? (where as readonly Filter[])
    : [where as Filter];
  // Python `if not filters` — an emptiness test on a list.
  if (filters.length === 0) {
    return null;
  }

  for (const candidate of filters) {
    if (candidate._property !== "$cohorts") {
      throw new ParamValidationError(
        "build_flow_cohort_filter only accepts cohort filters " +
          "(Filter.in_cohort/not_in_cohort); property filters should " +
          "use build_flow_property_filter instead",
        "BB4_FLOW_COHORT_FILTER_TYPE",
      );
    }
  }

  if (filters.length > 1) {
    throw new ParamValidationError(
      // Display-only message tail. `filters.length` is a JS integer
      // count, so template interpolation matches Python's
      // `{len(filters)}` exactly; no ported value is rendered here.
      `query_flow supports a single cohort filter, but ${filters.length} ` +
        "were provided. Pass only one Filter.in_cohort/not_in_cohort.",
      "BB5_FLOW_MULTIPLE_COHORT_FILTERS",
    );
  }

  const f = filters[0] as Filter;
  // Extract from the _value structure: [{"cohort": {...}}]
  const cohortValue: unknown = f._value;
  if (!Array.isArray(cohortValue) || cohortValue.length === 0) {
    throw new ParamValidationError(
      "Internal error: cohort filter _value must be a non-empty list; " +
        `got ${pythonTypeName(cohortValue)}. This indicates a bug in ` +
        "Filter._build_cohort_filter.",
      "BB6_COHORT_VALUE_NOT_LIST",
    );
  }
  const firstItem: unknown = cohortValue[0];
  // `isinstance(first_item, dict)` → isPythonDict.
  if (!isPythonDict(firstItem)) {
    throw new ParamValidationError(
      "Internal error: cohort filter _value[0] is not a dict; " +
        `got ${pythonTypeName(firstItem)}. This indicates a bug in ` +
        "Filter._build_cohort_filter.",
      "BB7_COHORT_VALUE_NOT_DICT",
    );
  }
  // `first_item.get("cohort")` — absent key yields undefined, which
  // isPythonDict rejects exactly as Python's None does.
  const cohortData: unknown = firstItem["cohort"];
  if (!isPythonDict(cohortData)) {
    throw new ParamValidationError(
      "Internal error: cohort filter _value[0] is missing 'cohort' key; " +
        `got keys ${pythonRepr(Object.keys(firstItem))}. This indicates a ` +
        "bug in Filter._build_cohort_filter.",
      "BB8_COHORT_KEY_MISSING",
    );
  }
  const result: BookmarkFragment = {
    // `cohort_data.get("name", "")` — default only when the key is absent.
    name: Object.hasOwn(cohortData, "name") ? cohortData["name"] : "",
    negated: f._operator === "does not contain",
  };
  // Key-presence tests → Object.hasOwn, never `in`.
  if (Object.hasOwn(cohortData, "id")) {
    result["id"] = cohortData["id"];
  }
  if (Object.hasOwn(cohortData, "raw_cohort")) {
    result["raw_cohort"] = cohortData["raw_cohort"];
  }
  return result;
}

/**
 * Build a single frequency group entry for `sections.group[]`.
 *
 * The display label falls back to `"<event> Frequency"` only when
 * `fb.label` is null — an empty-string label is emitted verbatim.
 *
 * @param fb - FrequencyBreakdown specification.
 * @param options - Optional bag: `data_group_id` (default `null`),
 *   coerced to a string at emission because the bookmark contract types
 *   `dataGroupId` as `string | null`.
 * @returns Group-entry dict with `behaviorType` nested inside
 *   `behavior`, `event` as a `{label, value}` object, and bucket
 *   configuration under `customBucket` with camelCase keys.
 * @example
 * ```typescript
 * buildFrequencyGroupEntry(new FrequencyBreakdown({ event: "Purchase" }));
 * // { dataset: "$mixpanel", resourceType: "people",
 * //   behavior: { behaviorType: "$frequency", … },
 * //   customBucket: { bucketSize: 1, min: 0, max: 10, disabled: false } }
 * ```
 * @see mixpanel_headless._internal.bookmark_builders.build_frequency_group_entry
 */
export function buildFrequencyGroupEntry(
  fb: FrequencyBreakdown,
  options?: { readonly data_group_id?: number | null },
): BookmarkFragment {
  const dataGroupId = options?.data_group_id ?? null;
  // Contract: GroupClause.dataGroupId is string | null — coerce the
  // int-typed parameter at emission, as Python does.
  const dgid = dataGroupId === null ? null : String(dataGroupId);
  const displayLabel = fb.label ?? `${fb.event} Frequency`;
  return {
    dataset: "$mixpanel",
    behavior: {
      aggregationOperator: "total",
      event: { label: fb.event, value: fb.event },
      behaviorType: "$frequency",
      filters: [],
      filtersOperator: "and",
      dateRange: null,
    },
    value: displayLabel,
    resourceType: "people",
    propertyType: "number",
    dataGroupId: dgid,
    customBucket: {
      bucketSize: fb.bucket_size,
      min: fb.bucket_min,
      max: fb.bucket_max,
      disabled: false,
    },
  };
}

/**
 * Build a single frequency filter entry for `sections.filter[]`.
 *
 * Emits the platform-native frequency filter clause: top-level
 * `filterType` / `filterOperator` / `filterValue` with the
 * `"$frequency"` marker nested under `behavior.behaviorType`. An older
 * `customProperty`-nested clause shape made the query engine return
 * HTTP 500; Python moved to this shape and the port follows it.
 * Conditionals ported verbatim: the lookback `dateRange` renders as an
 * `"in the last"` range with a `window` offset only when both
 * `date_range_value` and `date_range_unit` are non-null; event filters
 * render into `behavior.filters` when `event_filters` is non-null (an
 * empty list re-assigns `filters: []`, same as the default); the
 * display label lands in top-level `value`, defaulting to
 * `"<event> Frequency"` when `label` is null. `filterValue` is
 * `ff.value` natively.
 *
 * @param ff - FrequencyFilter specification.
 * @returns Filter clause dict with `dataset`, `resourceType`
 *   (`"people"`), `profileType`, `search`, `dataGroupId`, a `behavior`
 *   sub-dict (`aggregationOperator`, `behaviorType`, `dateRange`,
 *   `event` as `{label, value}`, `filters`, `filtersOperator`),
 *   `filterType` / `defaultType` (`"number"`), `filterOperator`,
 *   `filterValue`, `propertyObjectKey`, and `value`.
 * @example
 * ```typescript
 * buildFrequencyFilterEntry(new FrequencyFilter({ event: "Login", value: 5 }));
 * // { resourceType: "people", filterType: "number",
 * //   filterOperator: "is at least", filterValue: 5,
 * //   behavior: { behaviorType: "$frequency",
 * //     event: { label: "Login", value: "Login" }, … },
 * //   value: "Login Frequency", … }
 * ```
 * @see mixpanel_headless._internal.bookmark_builders.build_frequency_filter_entry
 */
export function buildFrequencyFilterEntry(
  ff: FrequencyFilter,
): BookmarkFragment {
  const behavior: BookmarkFragment = {
    aggregationOperator: "total",
    behaviorType: "$frequency",
    dateRange: null,
    event: { label: ff.event, value: ff.event },
    filters: [],
    filtersOperator: "and",
  };
  if (ff.date_range_value !== null && ff.date_range_unit !== null) {
    behavior["dateRange"] = {
      type: "in the last",
      unit: ff.date_range_unit,
      window: { unit: ff.date_range_unit, value: ff.date_range_value },
    };
  }
  if (ff.event_filters !== null) {
    behavior["filters"] = ff.event_filters.map((f) => buildFilterEntry(f));
  }
  const displayLabel = ff.label ?? `${ff.event} Frequency`;
  return {
    dataset: "$mixpanel",
    resourceType: "people",
    profileType: null,
    search: "",
    dataGroupId: null,
    behavior,
    filterType: "number",
    defaultType: "number",
    filterOperator: ff.operator,
    // Native pass-through.
    filterValue: ff.value,
    propertyObjectKey: null,
    value: displayLabel,
  };
}

/**
 * Build the `timeComparison` dict for `displayOptions`.
 *
 * For `type="relative"` the value is the comparison unit; for
 * `absolute-start` / `absolute-end` it is the ISO date string.
 *
 * The two Python `AssertionError` branches are `pragma: no cover` —
 * `TimeComparison.__post_init__` rules TC1/TC2 make them unreachable.
 * They are ported as unreachable throws (never as coded, fuzzable
 * guards) so the contract surface stays identical.
 *
 * @param tc - A validated `TimeComparison` instance.
 * @returns Dict with `type` and `value`, both strings.
 * @throws {@link Error} - only on the two unreachable-by-contract branches.
 * @example
 * ```typescript
 * buildTimeComparison(TimeComparison.relative("month"));
 * // { type: "relative", value: "month" }
 * ```
 * @see mixpanel_headless._internal.bookmark_builders.build_time_comparison
 */
export function buildTimeComparison(tc: TimeComparison): {
  type: string;
  value: string;
} {
  let value: string;
  if (tc.type === "relative") {
    // tc.unit guaranteed non-null by __post_init__ TC1.
    if (tc.unit === null) {
      /* c8 ignore next 3 -- unreachable: guarded by TC1 */
      throw new Error("unreachable: TC1 guarantees unit when type='relative'");
    }
    value = tc.unit;
  } else {
    // tc.date guaranteed non-null by __post_init__ TC2.
    if (tc.date === null) {
      /* c8 ignore next 3 -- unreachable: guarded by TC2 */
      throw new Error(
        "unreachable: TC2 guarantees date when type='absolute-*'",
      );
    }
    value = tc.date;
  }
  return { type: tc.type, value };
}
