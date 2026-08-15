/**
 * Central wiring of ported TS entry points into the conformance runner.
 *
 * This is the ONE place port batches register their bindings: an
 * {@link ImplementationRegistry} entry per Python dotted api name (flipping
 * those vectors from `UNPORTED` to live replay, R10.5) and a
 * {@link CodecRegistry} decoder per rich `$type` tag their signatures
 * consume (D4.4). Both the vitest corpus harness and the standalone
 * `npm run conformance` CLI build their dependencies here, so the two
 * entry points can never disagree about what is ported.
 *
 * TS-6 state (the D13 gate): the `compat.*` pythonCompat slice is bound to
 * the real `packages/core` port, and the `wirestub.*` gate apis are bound
 * to the replay-pipeline test double in `wirestub.ts`. Everything else in
 * the corpus replays as `UNPORTED`.
 */

import {
  pythonFloatStr,
  pythonStr,
  zfill,
  type PythonValue,
} from "../../packages/core/src/compat/index.js";
import { MixpanelHeadlessError } from "../../packages/core/src/errors.js";
import {
  CohortBreakdown,
  CohortCriteria,
  CohortDefinition,
  sanitizeRawCohort,
  type DidEventOptions,
  type DidNotDoEventOptions,
  type HasPropertyOperator,
  type HasPropertyType,
} from "../../packages/core/src/types/query-params/cohort.js";
import {
  Filter,
  ListItemGroupMode,
  type FilterFields,
  type PropertySpec,
} from "../../packages/core/src/types/query-params/filter.js";
import {
  FlowStep,
  type FlowStepFields,
} from "../../packages/core/src/types/query-params/flow.js";
import {
  FrequencyBreakdown,
  FrequencyFilter,
  type FrequencyBreakdownFields,
  type FrequencyFilterFields,
} from "../../packages/core/src/types/query-params/frequency.js";
import {
  Exclusion,
  FunnelStep,
  HoldingConstant,
  type ExclusionFields,
  type FunnelStepFields,
  type HoldingConstantFields,
} from "../../packages/core/src/types/query-params/funnel.js";
import {
  GroupBy,
  type GroupByFields,
} from "../../packages/core/src/types/query-params/group-by.js";
import {
  CohortMetric,
  Formula,
  Metric,
  TimeComparison,
  type MetricFields,
} from "../../packages/core/src/types/query-params/metric.js";
import {
  RetentionEvent,
  type RetentionEventFields,
} from "../../packages/core/src/types/query-params/retention.js";
import {
  Replay,
  ReplayBundle,
  ReplayEvent,
  ReplaySummary,
  SignedReplay,
  UserAction,
  type ReplayBundleFields,
  type ReplayEventFields,
  type ReplayFields,
  type ReplaySummaryFields,
  type SignedReplayFields,
  type UserActionFields,
} from "../../packages/core/src/types/results/replays.js";
import { CONTRACT_TAG_CODECS } from "../../packages/core/src/types/vector-codecs.js";
import { CodecRegistry, UndecodableValueError } from "./codecs.js";
import type { JsonValue } from "./json-value.js";
import { JsonNumber } from "./json-value.js";
import type {
  ExpectErrorConvertible,
  InvocationContext,
  RunnerDeps,
} from "./runner.js";
import { ImplementationRegistry } from "./runner.js";
import { WireStubClient, type WireStubRequestOptions } from "./wirestub.js";

/**
 * Read a required kwarg, throwing a descriptive error when absent.
 *
 * @param context - The invocation context.
 * @param name - The Python kwarg name.
 * @returns The decoded kwarg value.
 * @throws Error - When the kwarg is missing from `call.input`.
 */
function requireKwarg(context: InvocationContext, name: string): unknown {
  if (!Object.hasOwn(context.kwargs, name)) {
    throw new Error(
      `${context.api}: vector call.input is missing required kwarg ${JSON.stringify(name)}`,
    );
  }
  return context.kwargs[name];
}

/**
 * Extract the injected replay fetch from a wire invocation context.
 *
 * @param context - The invocation context.
 * @returns The `VectorFetch` seam.
 * @throws Error - When invoked without a fetch (a builder-kind vector
 *   reaching a wire binding is a corpus or registry bug).
 */
function requireFetch(context: InvocationContext): typeof fetch {
  if (context.fetch === undefined) {
    throw new Error(
      `${context.api}: wire binding invoked without an injected fetch`,
    );
  }
  return context.fetch;
}

/**
 * Convert one decoded `wirestub.*` request kwarg set into client options.
 *
 * Maps the Python keyword spellings (`params`/`headers`/`json_body`) onto
 * {@link WireStubRequestOptions}; absent kwargs stay absent (R3.5 —
 * omitting `params` entirely is the `params_absent` case under test).
 *
 * @param source - A decoded kwargs object carrying the optional keys.
 * @returns The stub-client options bag.
 */
function toRequestOptions(
  source: Readonly<Record<string, unknown>>,
): WireStubRequestOptions {
  return {
    ...(source["params"] !== undefined && source["params"] !== null
      ? { params: source["params"] as Readonly<Record<string, string>> }
      : {}),
    ...(source["headers"] !== undefined && source["headers"] !== null
      ? { headers: source["headers"] as Readonly<Record<string, string>> }
      : {}),
    ...(source["json_body"] !== undefined && source["json_body"] !== null
      ? { jsonBody: source["json_body"] }
      : {}),
  };
}

/**
 * Register the D13 compat gate bindings (`compat.*`, R11.1/R11.2/R11.4).
 *
 * @param implementations - The registry to extend.
 */
function registerCompatBindings(implementations: ImplementationRegistry): void {
  implementations.register("compat.zfill", (context) => {
    const value = requireKwarg(context, "value");
    const width = requireKwarg(context, "width");
    if (typeof value !== "string" || typeof width !== "number") {
      throw new TypeError(
        "compat.zfill expects (value: string, width: int) per the Python reference",
      );
    }
    return zfill(value, width);
  });
  implementations.register("compat.python_str", (context) => {
    // Python str() branches on float-vs-int; after decoding, 18.0 and 18
    // are the same JS number, so the float branch is recoverable only
    // from the raw token (InvocationContext.rawInput).
    const raw = context.rawInput["value"];
    if (raw instanceof JsonNumber && !raw.isIntegerToken()) {
      return pythonFloatStr(raw.toNumber());
    }
    return pythonStr(requireKwarg(context, "value") as PythonValue);
  });
  implementations.register("compat.python_float_str", (context) => {
    const value = requireKwarg(context, "value");
    if (typeof value !== "number") {
      throw new TypeError(
        "compat.python_float_str expects a float per the Python reference",
      );
    }
    return pythonFloatStr(value);
  });
}

/**
 * Register the D13 wire-stub gate bindings (`wirestub.*`).
 *
 * Each invocation builds a fresh {@link WireStubClient} over the vector's
 * injected fetch — the stub is stateless by design; only the replay
 * pipeline itself is under test.
 *
 * @param implementations - The registry to extend.
 */
function registerWireStubBindings(
  implementations: ImplementationRegistry,
): void {
  implementations.register("wirestub.request", async (context) => {
    const client = new WireStubClient({ fetch: requireFetch(context) });
    const method = requireKwarg(context, "method") as string;
    const path = requireKwarg(context, "path") as string;
    return client.request(method, path, toRequestOptions(context.kwargs));
  });
  implementations.register("wirestub.request_sequence", async (context) => {
    const client = new WireStubClient({ fetch: requireFetch(context) });
    const requests = requireKwarg(context, "requests") as readonly Readonly<
      Record<string, unknown>
    >[];
    return client.requestSequence(
      requests.map((entry) => ({
        method: entry["method"] as string,
        path: entry["path"] as string,
        options: toRequestOptions(entry),
      })),
    );
  });
  implementations.register("wirestub.stream_chunks", async (context) => {
    const client = new WireStubClient({ fetch: requireFetch(context) });
    const method = requireKwarg(context, "method") as string;
    const path = requireKwarg(context, "path") as string;
    const headers = context.kwargs["headers"];
    return client.streamChunks(method, path, {
      ...(headers !== undefined && headers !== null
        ? { headers: headers as Readonly<Record<string, string>> }
        : {}),
    });
  });
}

/**
 * A ported-library error re-thrown in vector `expect.error` form.
 *
 * Core exceptions cannot implement the runner's
 * {@link ExpectErrorConvertible} themselves (dependency direction:
 * runner -> core, never the reverse), so the binding layer wraps any
 * thrown `MixpanelHeadlessError` into this adapter; the runner then
 * diffs `{class, code}` structurally (R5.2/R5.4 — messages stripped).
 */
export class CoreLibraryError extends Error implements ExpectErrorConvertible {
  /** The original core exception. */
  readonly original: MixpanelHeadlessError;

  /**
   * Wrap a core exception.
   *
   * @param original - The thrown `MixpanelHeadlessError`.
   */
  constructor(original: MixpanelHeadlessError) {
    super(original.message, { cause: original });
    this.name = "CoreLibraryError";
    this.original = original;
  }

  /**
   * Encode this error as a vector `expect.error` value.
   *
   * @returns `{class: <Python exception class name>, code: <registry
   *   code>}` — TS class names equal the Python ones by construction
   *   (R5.1/R5.2).
   */
  toExpectError(): JsonValue {
    return { class: this.original.name, code: this.original.code };
  }
}

/**
 * Invoke a core entry point and encode its product for the runner.
 *
 * @param codecs - The codec registry (rich-tag encoders included).
 * @param invoke - Thunk performing the real library call.
 * @returns The vector-JSON encoding of the returned instance.
 * @throws CoreLibraryError - When the call raises a core exception.
 * @throws unknown - Anything else, unchanged (a runner/infra bug).
 */
function runGuarded(codecs: CodecRegistry, invoke: () => unknown): JsonValue {
  try {
    return codecs.encodeValue(invoke());
  } catch (cause) {
    if (cause instanceof MixpanelHeadlessError) {
      throw new CoreLibraryError(cause);
    }
    throw cause;
  }
}

/**
 * Build the kw-only options bag shared by most `Filter` factories.
 *
 * @param context - The invocation context.
 * @returns `{resource_type}` when the kwarg was recorded, else empty
 *   (absent kwargs stay absent — R3.5).
 */
function resourceTypeBag(context: InvocationContext): {
  readonly resource_type?: "events" | "people";
} {
  const value = context.kwargs["resource_type"];
  return value !== undefined
    ? { resource_type: value as "events" | "people" }
    : {};
}

/**
 * Register the P2-5a/P2-5b/P2-5c `types.*` builder bindings (filter/
 * metric/group core + the cohort family + the funnel/retention/flow/
 * frequency family — phase2-design C10).
 *
 * Each adapter is a thin shim: decoded kwargs -> the real core
 * constructor/factory -> encode the result (or wrap the coded guard
 * error). The `types.Filter` direct-construction binding passes the
 * decoded field bag straight through (absent fields take the dataclass
 * defaults, exactly like Python's `Filter(**decoded)` replay).
 *
 * @param implementations - The registry to extend.
 * @param codecs - The codec registry used to encode returned instances.
 */
function registerQueryParamBindings(
  implementations: ImplementationRegistry,
  codecs: CodecRegistry,
): void {
  const bind = (
    api: string,
    invoke: (context: InvocationContext) => unknown,
  ): void => {
    implementations.register(api, (context) =>
      runGuarded(codecs, () => invoke(context)),
    );
  };

  bind(
    "types.Filter",
    (context) => new Filter(context.kwargs as unknown as FilterFields),
  );
  bind("types.Filter.on", (context) =>
    Filter.on(
      requireKwarg(context, "property") as PropertySpec,
      requireKwarg(context, "date") as string,
      resourceTypeBag(context),
    ),
  );
  bind("types.Filter.before", (context) =>
    Filter.before(
      requireKwarg(context, "property") as PropertySpec,
      requireKwarg(context, "date") as string,
      resourceTypeBag(context),
    ),
  );
  bind("types.Filter.since", (context) =>
    Filter.since(
      requireKwarg(context, "property") as PropertySpec,
      requireKwarg(context, "date") as string,
      resourceTypeBag(context),
    ),
  );
  bind("types.Filter.in_the_last", (context) =>
    Filter.inTheLast(
      requireKwarg(context, "property") as PropertySpec,
      requireKwarg(context, "quantity") as number,
      requireKwarg(context, "date_unit") as Parameters<
        typeof Filter.inTheLast
      >[2],
      resourceTypeBag(context),
    ),
  );
  bind("types.Filter.not_in_the_last", (context) =>
    Filter.notInTheLast(
      requireKwarg(context, "property") as PropertySpec,
      requireKwarg(context, "quantity") as number,
      requireKwarg(context, "date_unit") as Parameters<
        typeof Filter.notInTheLast
      >[2],
      resourceTypeBag(context),
    ),
  );
  bind("types.Filter.in_the_next", (context) =>
    Filter.inTheNext(
      requireKwarg(context, "property") as PropertySpec,
      requireKwarg(context, "quantity") as number,
      requireKwarg(context, "date_unit") as Parameters<
        typeof Filter.inTheNext
      >[2],
      resourceTypeBag(context),
    ),
  );
  bind("types.Filter.date_between", (context) =>
    Filter.dateBetween(
      requireKwarg(context, "property") as PropertySpec,
      requireKwarg(context, "from_date") as string,
      requireKwarg(context, "to_date") as string,
      resourceTypeBag(context),
    ),
  );
  bind("types.Filter.date_not_between", (context) =>
    Filter.dateNotBetween(
      requireKwarg(context, "property") as PropertySpec,
      requireKwarg(context, "from_date") as string,
      requireKwarg(context, "to_date") as string,
      resourceTypeBag(context),
    ),
  );
  bind("types.Filter.in_cohort", (context) =>
    Filter.inCohort(
      requireKwarg(context, "cohort") as number | CohortDefinition,
      (context.kwargs["name"] ?? null) as string | null,
    ),
  );
  bind("types.Filter.not_in_cohort", (context) =>
    Filter.notInCohort(
      requireKwarg(context, "cohort") as number | CohortDefinition,
      (context.kwargs["name"] ?? null) as string | null,
    ),
  );
  bind("types.Filter.list_contains", (context) => {
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
    const equals: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context.kwargs)) {
      if (!named.has(key)) {
        equals[key] = value;
      }
    }
    const itemFilters = (context.kwargs["item_filters"] ??
      []) as readonly Filter[];
    const quantifier = context.kwargs["quantifier"];
    return Filter.listContains(
      requireKwarg(context, "property") as string,
      itemFilters,
      {
        ...(quantifier !== undefined
          ? { quantifier: quantifier as "any" | "all" }
          : {}),
        ...resourceTypeBag(context),
        equals: equals as Readonly<Record<string, string | readonly string[]>>,
      },
    );
  });
  bind(
    "types.ListItemGroupMode",
    (context) =>
      new ListItemGroupMode(
        context.kwargs as unknown as ConstructorParameters<
          typeof ListItemGroupMode
        >[0],
      ),
  );
  bind(
    "types.GroupBy",
    (context) => new GroupBy(context.kwargs as unknown as GroupByFields),
  );
  bind(
    "types.Metric",
    (context) => new Metric(context.kwargs as unknown as MetricFields),
  );
  bind(
    "types.CohortMetric",
    (context) =>
      new CohortMetric(
        context.kwargs as unknown as ConstructorParameters<
          typeof CohortMetric
        >[0],
      ),
  );
  bind(
    "types.Formula",
    (context) =>
      new Formula(
        context.kwargs as unknown as ConstructorParameters<typeof Formula>[0],
      ),
  );
  bind(
    "types.TimeComparison",
    (context) =>
      new TimeComparison(
        context.kwargs as unknown as ConstructorParameters<
          typeof TimeComparison
        >[0],
      ),
  );

  // ----- P2-5b cohort family (phase2-design C10) -----

  bind("types.CohortCriteria.did_event", (context) => {
    // Python signature: (event, *, at_least, at_most, exactly,
    // within_days, within_weeks, within_months, from_date, to_date,
    // where, aggregation, aggregation_property). Every recorded kwarg
    // except `event` is a kw-only option — pass the decoded bag through
    // (absent kwargs stay absent, R3.5).
    const options = Object.fromEntries(
      Object.entries(context.kwargs).filter(([key]) => key !== "event"),
    );
    return CohortCriteria.didEvent(
      requireKwarg(context, "event") as string,
      options as DidEventOptions,
    );
  });
  bind("types.CohortCriteria.did_not_do_event", (context) => {
    const options = Object.fromEntries(
      Object.entries(context.kwargs).filter(([key]) => key !== "event"),
    );
    return CohortCriteria.didNotDoEvent(
      requireKwarg(context, "event") as string,
      options as DidNotDoEventOptions,
    );
  });
  bind("types.CohortCriteria.has_property", (context) => {
    const operator = context.kwargs["operator"];
    const propertyType = context.kwargs["property_type"];
    return CohortCriteria.hasProperty(
      requireKwarg(context, "property") as string,
      requireKwarg(context, "value") as
        string | number | boolean | readonly string[],
      {
        ...(operator !== undefined
          ? { operator: operator as HasPropertyOperator }
          : {}),
        ...(propertyType !== undefined
          ? { property_type: propertyType as HasPropertyType }
          : {}),
      },
    );
  });
  bind("types.CohortCriteria.property_is_set", (context) =>
    CohortCriteria.propertyIsSet(requireKwarg(context, "property") as string),
  );
  bind("types.CohortCriteria.property_is_not_set", (context) =>
    CohortCriteria.propertyIsNotSet(
      requireKwarg(context, "property") as string,
    ),
  );
  bind("types.CohortCriteria.in_cohort", (context) =>
    CohortCriteria.inCohort(requireKwarg(context, "cohort_id") as number),
  );
  bind("types.CohortCriteria.not_in_cohort", (context) =>
    CohortCriteria.notInCohort(requireKwarg(context, "cohort_id") as number),
  );
  bind("types.CohortDefinition", (context) => {
    // Python signature: *criteria (positional varargs; the recorder
    // binds them under "criteria" — all recorded vectors are the empty
    // CD9 guard case).
    const criteria = (context.kwargs["criteria"] ?? []) as ReadonlyArray<
      CohortCriteria | CohortDefinition
    >;
    return new CohortDefinition(...criteria);
  });
  bind("types.CohortDefinition.all_of", (context) => {
    const criteria = (context.kwargs["criteria"] ?? []) as ReadonlyArray<
      CohortCriteria | CohortDefinition
    >;
    return CohortDefinition.allOf(...criteria);
  });
  bind("types.CohortDefinition.any_of", (context) => {
    const criteria = (context.kwargs["criteria"] ?? []) as ReadonlyArray<
      CohortCriteria | CohortDefinition
    >;
    return CohortDefinition.anyOf(...criteria);
  });
  bind("types.CohortDefinition.to_dict", (context) => {
    const self = requireKwarg(context, "self");
    if (!(self instanceof CohortDefinition)) {
      throw new Error(
        "types.CohortDefinition.to_dict: `self` did not decode to a CohortDefinition",
      );
    }
    return self.toDict();
  });
  bind(
    "types.CohortBreakdown",
    (context) =>
      new CohortBreakdown(
        context.kwargs as unknown as ConstructorParameters<
          typeof CohortBreakdown
        >[0],
      ),
  );
  bind("types._sanitize_raw_cohort", (context) =>
    sanitizeRawCohort(
      requireKwarg(context, "raw") as Readonly<Record<string, unknown>>,
    ),
  );

  // ----- P2-5c funnel/retention/flow/frequency family (phase2-design
  // C10). All seven are plain dataclass constructors: pass the decoded
  // kwarg bag straight through (absent fields take the Python defaults,
  // exactly like Python's `Cls(**decoded)` replay). -----

  bind(
    "types.FunnelStep",
    (context) => new FunnelStep(context.kwargs as unknown as FunnelStepFields),
  );
  bind(
    "types.Exclusion",
    (context) => new Exclusion(context.kwargs as unknown as ExclusionFields),
  );
  bind(
    "types.HoldingConstant",
    (context) =>
      new HoldingConstant(context.kwargs as unknown as HoldingConstantFields),
  );
  bind(
    "types.RetentionEvent",
    (context) =>
      new RetentionEvent(context.kwargs as unknown as RetentionEventFields),
  );
  bind(
    "types.FlowStep",
    (context) => new FlowStep(context.kwargs as unknown as FlowStepFields),
  );
  bind(
    "types.FrequencyBreakdown",
    (context) =>
      new FrequencyBreakdown(
        context.kwargs as unknown as FrequencyBreakdownFields,
      ),
  );
  bind(
    "types.FrequencyFilter",
    (context) =>
      new FrequencyFilter(context.kwargs as unknown as FrequencyFilterFields),
  );

  // ----- P2-6 replay-family constructors (phase2-design C6-d). All
  // recorded vectors are guard-failure cases; the decoded kwarg bag
  // passes straight through so the constructor guards fire exactly as
  // Python's `__post_init__` replay does. Nested `$type` children
  // (`UserAction`, `Replay`) arrive as decoded core instances. -----

  bind(
    "types.ReplaySummary",
    (context) =>
      new ReplaySummary(context.kwargs as unknown as ReplaySummaryFields),
  );
  bind("types.SignedReplay", (context) => {
    // The recorder captures `signed_at` as a raw float token (plain
    // number after decode) or a `$type: float` wrapper; unwrap the
    // wrapper's numeric value for the constructor.
    const kwargs: Record<string, unknown> = { ...context.kwargs };
    const signed_at = kwargs["signed_at"];
    if (
      typeof signed_at === "object" &&
      signed_at !== null &&
      "toNumber" in signed_at &&
      typeof (signed_at as { toNumber: unknown }).toNumber === "function"
    ) {
      kwargs["signed_at"] = (
        signed_at as { toNumber: () => number }
      ).toNumber();
    }
    return new SignedReplay(kwargs as unknown as SignedReplayFields);
  });
  bind(
    "types.UserAction",
    (context) => new UserAction(context.kwargs as unknown as UserActionFields),
  );
  bind(
    "types.ReplayEvent",
    (context) =>
      new ReplayEvent(context.kwargs as unknown as ReplayEventFields),
  );
  bind(
    "types.Replay",
    (context) => new Replay(context.kwargs as unknown as ReplayFields),
  );
  bind(
    "types.ReplayBundle",
    (context) =>
      new ReplayBundle(context.kwargs as unknown as ReplayBundleFields),
  );
}

/**
 * Register the Phase-2 contract tag codecs (phase2-design C7 item 2).
 *
 * One call per Phase-2 packet's additions — the table itself lives in
 * `packages/core/src/types/vector-codecs.ts` so the conformance runner
 * and the differential oracle can never disagree about how a tag
 * decodes. Decode failures wrap into {@link UndecodableValueError},
 * mirroring Python `_decode_model` (a committed vector that fails decode
 * is a codec-table or vector bug and must fail loudly).
 *
 * @param codecs - The registry to extend.
 */
export function registerContractCodecs(codecs: CodecRegistry): void {
  for (const [tag, codec] of CONTRACT_TAG_CODECS) {
    codecs.registerTagCodec(
      tag,
      (payload, decodeField) => {
        try {
          return codec.decode(payload, (value) =>
            decodeField(value as JsonValue),
          );
        } catch (cause) {
          throw new UndecodableValueError(
            `could not reconstruct ${tag} from vector fields: ${String(cause)}`,
          );
        }
      },
      {
        matches: (value) => codec.matches(value),
        // The core encode walk produces vector-JSON by construction
        // (children pass through encodeChild); the assertion re-types
        // the structurally generic core return for the runner.
        encode: (value, encodeChild) =>
          codec.encode(value, encodeChild) as JsonValue,
      },
    );
  }
}

/**
 * Build the runner dependencies with every current port-batch binding.
 *
 * @param recordEpoch - The frozen record instant (corpus config /
 *   manifest `record_epoch`).
 * @returns Fresh {@link RunnerDeps} carrying all registered bindings.
 *
 * @example
 * ```typescript
 * const deps = createRunnerDeps("2026-01-15T12:00:00Z");
 * const results = await runCorpus(corpus, deps);
 * ```
 */
export function createRunnerDeps(recordEpoch: string): RunnerDeps {
  const implementations = new ImplementationRegistry();
  const codecs = new CodecRegistry();
  registerCompatBindings(implementations);
  registerWireStubBindings(implementations);
  registerContractCodecs(codecs);
  registerQueryParamBindings(implementations, codecs);
  return { implementations, codecs, recordEpoch };
}
