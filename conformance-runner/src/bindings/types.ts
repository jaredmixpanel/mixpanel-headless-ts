/**
 * The `types.*` builder bindings: filter/metric/group core, the cohort
 * family, the funnel/retention/flow/frequency dataclasses and the
 * replay-family constructors.
 *
 * Each adapter is a thin shim: decoded kwargs -> the real core
 * constructor/factory -> encode the result (or wrap the coded guard
 * error). Direct-construction bindings pass the decoded field bag
 * straight through (`kwargsAsFields`) so absent fields take the
 * dataclass defaults and the constructor guards fire exactly like
 * Python's `Cls(**decoded)` replay; factory kwargs the LIBRARY validates
 * (`quantifier`, `operator`, `date_unit`, ...) are forwarded typed but
 * unchecked (`kwargAs`) for the same reason.
 */

import {
  CohortBreakdown,
  CohortCriteria,
  CohortDefinition,
  CohortMetric,
  Exclusion,
  type ExclusionFields,
  Filter,
  type FilterFields,
  FlowStep,
  type FlowStepFields,
  Formula,
  FrequencyBreakdown,
  type FrequencyBreakdownFields,
  FrequencyFilter,
  type FrequencyFilterFields,
  FunnelStep,
  type FunnelStepFields,
  GroupBy,
  type GroupByFields,
  type HasPropertyOperator,
  type HasPropertyType,
  HoldingConstant,
  type HoldingConstantFields,
  ListItemGroupMode,
  Metric,
  type MetricFields,
  type PropertySpec,
  Replay,
  ReplayBundle,
  ReplayEvent,
  type ReplayEventFields,
  type ReplayFields,
  ReplaySummary,
  type ReplaySummaryFields,
  RetentionEvent,
  type RetentionEventFields,
  SignedReplay,
  type SignedReplayFields,
  TimeComparison,
  UserAction,
  type UserActionFields,
} from "@mixpanel-headless/core";
import { sanitizeRawCohort } from "@mixpanel-headless/core/internal";

import type { CodecRegistry } from "../codecs.js";
import {
  isAnyOf,
  isArrayOf,
  isInstanceOf,
  isNullable,
} from "../internal/guards.js";
import {
  kwarg,
  kwargAs,
  kwargsAsFields,
  optionalKwarg,
  optionalKwargAs,
} from "../internal/kwargs.js";
import type { ImplementationRegistry, InvocationContext } from "../runner.js";
import { type BindingTable, registerTable, runGuarded } from "./shared.js";

/** Decoded `criteria` varargs: nested `$type` criteria/definitions. */
const isCriteriaList = isArrayOf(
  isAnyOf(isInstanceOf(CohortCriteria), isInstanceOf(CohortDefinition)),
);

/**
 * Build the kw-only options bag shared by most `Filter` factories.
 *
 * @param context - The invocation context.
 * @returns `{resource_type}` when the kwarg was recorded, else empty
 *   (absent kwargs stay absent).
 */
function resourceTypeBag(context: InvocationContext): {
  readonly resource_type?: "events" | "people";
} {
  const value = optionalKwargAs<"events" | "people">(context, "resource_type");
  return value === undefined ? {} : { resource_type: value };
}

/**
 * The `(property, date, resource_type?)` argument triple of the dated
 * `Filter` factories.
 *
 * @param context - The invocation context.
 * @returns The positional arguments.
 */
function datedFilterArgs(
  context: InvocationContext,
): readonly [
  PropertySpec,
  string,
  { readonly resource_type?: "events" | "people" },
] {
  return [
    kwargAs<PropertySpec>(context, "property"),
    kwargAs<string>(context, "date"),
    resourceTypeBag(context),
  ];
}

/**
 * The `(property, quantity, date_unit, resource_type?)` argument tuple
 * of the relative-window `Filter` factories.
 *
 * @param context - The invocation context.
 * @returns The positional arguments.
 */
function windowFilterArgs(
  context: InvocationContext,
): Parameters<typeof Filter.inTheLast> {
  return [
    kwargAs<PropertySpec>(context, "property"),
    kwargAs<number>(context, "quantity"),
    kwargAs<Parameters<typeof Filter.inTheLast>[2]>(context, "date_unit"),
    resourceTypeBag(context),
  ];
}

/**
 * The `(property, from_date, to_date, resource_type?)` argument tuple of
 * the date-range `Filter` factories.
 *
 * @param context - The invocation context.
 * @returns The positional arguments.
 */
function rangeFilterArgs(
  context: InvocationContext,
): Parameters<typeof Filter.dateBetween> {
  return [
    kwargAs<PropertySpec>(context, "property"),
    kwargAs<string>(context, "from_date"),
    kwargAs<string>(context, "to_date"),
    resourceTypeBag(context),
  ];
}

/**
 * Every recorded kwarg except `event` of the `did_event` family is a
 * kw-only option — pass the decoded bag through (absent stays absent).
 *
 * @param context - The invocation context.
 * @returns The options bag without `event`.
 */
function didEventOptions(
  context: InvocationContext,
): Parameters<typeof CohortCriteria.didEvent>[1] {
  return Object.fromEntries(
    Object.entries(context.kwargs).filter(([key]) => key !== "event"),
  );
}

/** The `types.*` table (each binder runs under {@link runGuarded}). */
const QUERY_PARAM_BINDINGS: BindingTable = [
  [
    "types.Filter",
    (context) => new Filter(kwargsAsFields<FilterFields>(context)),
  ],
  ["types.Filter.on", (context) => Filter.on(...datedFilterArgs(context))],
  [
    "types.Filter.before",
    (context) => Filter.before(...datedFilterArgs(context)),
  ],
  [
    "types.Filter.since",
    (context) => Filter.since(...datedFilterArgs(context)),
  ],
  [
    "types.Filter.in_the_last",
    (context) => Filter.inTheLast(...windowFilterArgs(context)),
  ],
  [
    "types.Filter.not_in_the_last",
    (context) => Filter.notInTheLast(...windowFilterArgs(context)),
  ],
  [
    "types.Filter.in_the_next",
    (context) => Filter.inTheNext(...windowFilterArgs(context)),
  ],
  [
    "types.Filter.date_between",
    (context) => Filter.dateBetween(...rangeFilterArgs(context)),
  ],
  [
    "types.Filter.date_not_between",
    (context) => Filter.dateNotBetween(...rangeFilterArgs(context)),
  ],
  [
    "types.Filter.in_cohort",
    (context) =>
      Filter.inCohort(
        kwargAs<number | CohortDefinition>(context, "cohort"),
        optionalKwargAs<string | null>(context, "name") ?? null,
      ),
  ],
  [
    "types.Filter.not_in_cohort",
    (context) =>
      Filter.notInCohort(
        kwargAs<number | CohortDefinition>(context, "cohort"),
        optionalKwargAs<string | null>(context, "name") ?? null,
      ),
  ],
  [
    "types.Filter.list_contains",
    (context) => {
      // Python signature: (property, *item_filters, quantifier="any",
      // resource_type="events", **equals). The recorder binds the
      // positional varargs under "item_filters"; EVERY other input key is
      // an **equals kwarg, in recorded (== Python kwarg) order.
      const named = new Set([
        "property",
        "item_filters",
        "quantifier",
        "resource_type",
      ]);
      const equals = Object.fromEntries(
        Object.entries(context.kwargs).filter(([key]) => !named.has(key)),
      ) as Readonly<Record<string, string | readonly string[]>>;
      const quantifier = optionalKwargAs<"any" | "all">(context, "quantifier");
      return Filter.listContains(
        kwargAs<string>(context, "property"),
        optionalKwargAs<readonly Filter[] | null>(context, "item_filters") ??
          [],
        {
          ...(quantifier === undefined ? {} : { quantifier }),
          ...resourceTypeBag(context),
          equals,
        },
      );
    },
  ],
  [
    "types.ListItemGroupMode",
    (context) =>
      new ListItemGroupMode(
        kwargsAsFields<ConstructorParameters<typeof ListItemGroupMode>[0]>(
          context,
        ),
      ),
  ],
  [
    "types.GroupBy",
    (context) => new GroupBy(kwargsAsFields<GroupByFields>(context)),
  ],
  [
    "types.Metric",
    (context) => new Metric(kwargsAsFields<MetricFields>(context)),
  ],
  [
    "types.CohortMetric",
    (context) =>
      new CohortMetric(
        kwargsAsFields<ConstructorParameters<typeof CohortMetric>[0]>(context),
      ),
  ],
  [
    "types.Formula",
    (context) =>
      new Formula(
        kwargsAsFields<ConstructorParameters<typeof Formula>[0]>(context),
      ),
  ],
  [
    "types.TimeComparison",
    (context) =>
      new TimeComparison(
        kwargsAsFields<ConstructorParameters<typeof TimeComparison>[0]>(
          context,
        ),
      ),
  ],

  // ----- cohort family -----

  [
    "types.CohortCriteria.did_event",
    (context) =>
      CohortCriteria.didEvent(
        kwargAs<string>(context, "event"),
        didEventOptions(context),
      ),
  ],
  [
    "types.CohortCriteria.did_not_do_event",
    (context) =>
      CohortCriteria.didNotDoEvent(
        kwargAs<string>(context, "event"),
        didEventOptions(context),
      ),
  ],
  [
    "types.CohortCriteria.has_property",
    (context) => {
      const operator = optionalKwargAs<HasPropertyOperator>(
        context,
        "operator",
      );
      const propertyType = optionalKwargAs<HasPropertyType>(
        context,
        "property_type",
      );
      return CohortCriteria.hasProperty(
        kwargAs<string>(context, "property"),
        kwargAs<string | number | boolean | readonly string[]>(
          context,
          "value",
        ),
        {
          ...(operator === undefined ? {} : { operator }),
          ...(propertyType === undefined
            ? {}
            : { property_type: propertyType }),
        },
      );
    },
  ],
  [
    "types.CohortCriteria.property_is_set",
    (context) =>
      CohortCriteria.propertyIsSet(kwargAs<string>(context, "property")),
  ],
  [
    "types.CohortCriteria.property_is_not_set",
    (context) =>
      CohortCriteria.propertyIsNotSet(kwargAs<string>(context, "property")),
  ],
  [
    "types.CohortCriteria.in_cohort",
    (context) => CohortCriteria.inCohort(kwargAs<number>(context, "cohort_id")),
  ],
  [
    "types.CohortCriteria.not_in_cohort",
    (context) =>
      CohortCriteria.notInCohort(kwargAs<number>(context, "cohort_id")),
  ],
  // Python signature: *criteria (positional varargs; the recorder binds
  // them under "criteria" — all recorded vectors are the empty guard
  // case).
  [
    "types.CohortDefinition",
    (context) =>
      new CohortDefinition(
        ...(optionalKwarg(
          context,
          "criteria",
          isNullable(isCriteriaList),
          "list[CohortCriteria | CohortDefinition]",
        ) ?? []),
      ),
  ],
  [
    "types.CohortDefinition.all_of",
    (context) =>
      CohortDefinition.allOf(
        ...(optionalKwarg(
          context,
          "criteria",
          isNullable(isCriteriaList),
          "list[CohortCriteria | CohortDefinition]",
        ) ?? []),
      ),
  ],
  [
    "types.CohortDefinition.any_of",
    (context) =>
      CohortDefinition.anyOf(
        ...(optionalKwarg(
          context,
          "criteria",
          isNullable(isCriteriaList),
          "list[CohortCriteria | CohortDefinition]",
        ) ?? []),
      ),
  ],
  [
    "types.CohortDefinition.to_dict",
    (context) =>
      kwarg(
        context,
        "self",
        isInstanceOf(CohortDefinition),
        "CohortDefinition",
      ).toDict(),
  ],
  [
    "types.CohortBreakdown",
    (context) =>
      new CohortBreakdown(
        kwargsAsFields<ConstructorParameters<typeof CohortBreakdown>[0]>(
          context,
        ),
      ),
  ],
  [
    "types._sanitize_raw_cohort",
    (context) =>
      sanitizeRawCohort(
        kwargAs<Readonly<Record<string, unknown>>>(context, "raw"),
      ),
  ],

  // ----- funnel/retention/flow/frequency family: plain dataclass
  // constructors, decoded kwarg bag straight through -----

  [
    "types.FunnelStep",
    (context) => new FunnelStep(kwargsAsFields<FunnelStepFields>(context)),
  ],
  [
    "types.Exclusion",
    (context) => new Exclusion(kwargsAsFields<ExclusionFields>(context)),
  ],
  [
    "types.HoldingConstant",
    (context) =>
      new HoldingConstant(kwargsAsFields<HoldingConstantFields>(context)),
  ],
  [
    "types.RetentionEvent",
    (context) =>
      new RetentionEvent(kwargsAsFields<RetentionEventFields>(context)),
  ],
  [
    "types.FlowStep",
    (context) => new FlowStep(kwargsAsFields<FlowStepFields>(context)),
  ],
  [
    "types.FrequencyBreakdown",
    (context) =>
      new FrequencyBreakdown(kwargsAsFields<FrequencyBreakdownFields>(context)),
  ],
  [
    "types.FrequencyFilter",
    (context) =>
      new FrequencyFilter(kwargsAsFields<FrequencyFilterFields>(context)),
  ],

  // ----- replay-family constructors: all recorded vectors are
  // guard-failure cases; the decoded kwarg bag passes straight through so
  // the constructor guards fire exactly as Python's `__post_init__`
  // replay does. Nested `$type` children (`UserAction`, `Replay`) arrive
  // as decoded core instances. -----

  [
    "types.ReplaySummary",
    (context) =>
      new ReplaySummary(kwargsAsFields<ReplaySummaryFields>(context)),
  ],
  [
    "types.SignedReplay",
    (context) => {
      // The recorder captures `signed_at` as a raw float token (plain
      // number after decode) or a `$type: float` wrapper; unwrap the
      // wrapper's numeric value for the constructor.
      const fields = kwargsAsFields<SignedReplayFields>(context);
      const signedAt: unknown = context.kwargs["signed_at"];
      return new SignedReplay(
        typeof signedAt === "object" &&
          signedAt !== null &&
          "toNumber" in signedAt &&
          typeof signedAt.toNumber === "function"
          ? {
              ...fields,
              signed_at: (signedAt as { toNumber: () => number }).toNumber(),
            }
          : fields,
      );
    },
  ],
  [
    "types.UserAction",
    (context) => new UserAction(kwargsAsFields<UserActionFields>(context)),
  ],
  [
    "types.ReplayEvent",
    (context) => new ReplayEvent(kwargsAsFields<ReplayEventFields>(context)),
  ],
  [
    "types.Replay",
    (context) => new Replay(kwargsAsFields<ReplayFields>(context)),
  ],
  ["types.ReplayBundle", (context) => new ReplayBundle(context.kwargs)],
];

/**
 * Register the `types.*` builder bindings.
 *
 * @param implementations - The registry to extend.
 * @param codecs - The codec registry used to encode returned instances.
 */
export function registerQueryParamBindings(
  implementations: ImplementationRegistry,
  codecs: CodecRegistry,
): void {
  registerTable(
    implementations,
    QUERY_PARAM_BINDINGS,
    (binder) => (context) => runGuarded(codecs, () => binder(context)),
  );
}
