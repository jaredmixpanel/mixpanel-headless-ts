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
  BookmarkValidationError,
  CohortBreakdown,
  CohortCriteria,
  CohortDefinition,
  CohortMetric,
  cpLength,
  cpSlice,
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
  MixpanelHeadlessError,
  type PropertySpec,
  pythonFloat,
  pythonFloatCoerce,
  pythonFloatStr,
  pythonInt,
  pythonStr,
  pythonStrip,
  type PythonValue,
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
  sortedByCodepoint,
  TimeComparison,
  UserAction,
  type UserActionFields,
  validateBookmark,
  type ValidateBookmarkOptions,
  ValidationError,
  zfill,
} from "@mixpanel-headless/core";
import {
  BOOKMARK_MODEL_HANDLES,
  buildDateRange,
  buildFilterEntry,
  buildFilterSection,
  buildFlowCohortFilter,
  buildFlowPropertyFilter,
  buildFrequencyFilterEntry,
  buildGroupSection,
  buildSegfilterEntry,
  buildTimeSection,
  extractCohortFilter,
  filtersToSelector,
  filterToSelector,
  getRootModelForBookmarkType,
  iterJsonlLines,
  normalizeOnExpression,
  sanitizeRawCohort,
  transformEvent,
  transformProfile,
  validateFlowArgs,
  type ValidateFlowArgsOptions,
  validateFlowBookmark,
  validateFunnelArgs,
  type ValidateFunnelArgsOptions,
  validateGroupByArgs,
  type ValidateGroupByArgsOptions,
  validateQueryArgs,
  type ValidateQueryArgsOptions,
  validateRetentionArgs,
  type ValidateRetentionArgsOptions,
  validateSortingBlock,
  validateTimeArgs,
  type ValidateTimeArgsOptions,
  validateUserArgs,
  validateUserParams,
  validateWithPydantic,
  ValueError,
} from "@mixpanel-headless/core/internal";

import {
  CodecRegistry,
  PyDatetime,
  PyFloat,
  UndecodableValueError,
} from "./codecs.js";
import { JsonNumber, type JsonValue } from "./json-value.js";
import { registerReplaysBindings } from "./replays-bindings.js";
import {
  type ExpectErrorConvertible,
  ImplementationRegistry,
  type InvocationContext,
  type RunnerDeps,
} from "./runner.js";
import { CONTRACT_TAG_CODECS } from "./vector-codecs.js";
import { registerAuthWireBindings } from "./wire-auth.js";
import { registerApiClientCoreBindings } from "./wire-client.js";
import { registerEntityWireBindings } from "./wire-entities.js";
import { registerGovernanceWireBindings } from "./wire-governance.js";
import { registerLifecycleWireBindings } from "./wire-lifecycle.js";
import { registerPaginationBindings } from "./wire-pagination.js";
import { registerQueryWireBindings } from "./wire-queries.js";
import { registerWorkspaceBindings } from "./wire-workspace.js";
import { registerWorkspaceEntityBindings } from "./wire-workspace-entities.js";
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
  registerCompatCompletionBindings(implementations);
}

/**
 * Read a required string kwarg for a compat binding.
 *
 * @param context - The invocation context.
 * @param name - The Python kwarg name.
 * @returns The string value.
 * @throws TypeError - When the kwarg is not a string (a corpus bug — the
 *   reference wrappers are str-typed).
 */
function requireStringKwarg(context: InvocationContext, name: string): string {
  const value = requireKwarg(context, name);
  if (typeof value !== "string") {
    throw new TypeError(
      `${context.api} expects ${name}: string per the Python reference`,
    );
  }
  return value;
}

/**
 * Invoke a compat entry point, wrapping coded library errors for the
 * runner (same contract as {@link runGuarded}, without the codec walk —
 * the B0-1 compat outputs are primitives/string arrays/`JsonNumber`).
 *
 * @param invoke - Thunk performing the real library call.
 * @returns The thunk's value.
 * @throws CoreLibraryError - When the call raises a core exception.
 * @throws unknown - Anything else, unchanged (a runner/infra bug).
 */
function guardCompat<T>(invoke: () => T): T {
  try {
    return invoke();
  } catch (error) {
    if (error instanceof MixpanelHeadlessError) {
      throw new CoreLibraryError(error);
    }
    throw error;
  }
}

/**
 * Encode one `pythonFloat` result exactly as the Python reference wrapper
 * does (B0-notes design decision 2 — the wrapper IS the recorded api, so
 * the binding mirrors its two output translations verbatim):
 *
 * - non-finite results become the `repr` sentinel strings (`"inf"` /
 *   `"-inf"` / `"nan"`; non-finite floats are illegal in vector JSON,
 *   D6 rule 5);
 * - finite results ride as a `JsonNumber` carrying the CPython `repr`
 *   token so canonical float-ness is preserved (`42.0`, not `42` — the
 *   raw-token fidelity rule from P2-5a/P2-9).
 *
 * @param value - The `pythonFloat` return value.
 * @returns The vector-JSON encoding.
 */
function encodePythonFloatResult(value: number): JsonValue {
  if (Number.isNaN(value)) {
    return "nan";
  }
  if (value === Infinity) {
    return "inf";
  }
  if (value === -Infinity) {
    return "-inf";
  }
  return new JsonNumber(pythonFloatStr(value));
}

/**
 * Register the B0-1 pythonCompat completion bindings (P3-4 packet:
 * R11.3 `python_int`/`python_float`, `python_strip`, R11.5
 * `sorted_strings`, R11.6 `cp_length`/`cp_slice`).
 *
 * Each binding calls the real `packages/core` entry point (P3-5 rule 3 —
 * no re-implementation); the only adaptations are kwarg plumbing, the
 * shared error wrap, and the `pythonFloat` output encoding above.
 *
 * @param implementations - The registry to extend.
 */
function registerCompatCompletionBindings(
  implementations: ImplementationRegistry,
): void {
  implementations.register("compat.python_int", (context) =>
    guardCompat(() => pythonInt(requireStringKwarg(context, "value"))),
  );
  implementations.register("compat.python_float", (context) =>
    guardCompat(() =>
      encodePythonFloatResult(
        pythonFloat(requireStringKwarg(context, "value")),
      ),
    ),
  );
  // B6-GATE (B5-notes.md outbound ledger item 5): the R11.7 float(x)
  // coercion ladder. Kwarg decode may hand a native number, bool, null,
  // string, list, plain dict, or the runner's PyFloat spelling wrapper
  // — the library twin handles every arm; bare TypeError/OverflowError
  // twins propagate for class-name comparison (oracle-protocol §4.1).
  implementations.register("compat.python_float_coerce", (context) =>
    guardCompat(() =>
      encodePythonFloatResult(
        pythonFloatCoerce(requireKwarg(context, "value")),
      ),
    ),
  );
  implementations.register("compat.python_strip", (context) =>
    pythonStrip(requireStringKwarg(context, "value")),
  );
  implementations.register("compat.sorted_strings", (context) => {
    const values = requireKwarg(context, "values");
    if (
      !Array.isArray(values) ||
      values.some((item) => typeof item !== "string")
    ) {
      throw new TypeError(
        "compat.sorted_strings expects values: list[str] per the Python reference",
      );
    }
    return sortedByCodepoint(values as readonly string[]);
  });
  implementations.register("compat.cp_length", (context) =>
    cpLength(requireStringKwarg(context, "value")),
  );
  implementations.register("compat.cp_slice", (context) => {
    const value = requireStringKwarg(context, "value");
    // Tri-state note (rig api): `start`/`end` absent and explicit-null
    // both spell Python None (the open slice end) for this reference
    // wrapper — cp_slice(value, start=None) IS the default.
    const bound = (name: string): number | undefined => {
      const raw = context.kwargs[name];
      if (raw === undefined || raw === null) {
        return undefined;
      }
      if (typeof raw !== "number") {
        throw new TypeError(
          `compat.cp_slice expects ${name}: int | None per the Python reference`,
        );
      }
      return raw;
    };
    // Explicit `undefined` and omission are the same open end for
    // `cpSlice` (its own `=== undefined` checks), matching Python.
    return cpSlice(value, bound("start"), bound("end"));
  });
}

/**
 * Register the Phase-3 B0-2 shared-client-internal binding:
 * `api_client._iter_jsonl_lines` over the authored chunk vectors
 * (`corpus/authored/streaming/jsonl-chunks.jsonl`, design D2/D4.2 item 9).
 *
 * Mirrors the Python recorder adapter (`conformance/record/adapters.py::
 * iter_jsonl_lines`): rebuild a boundary-preserving byte stream from the
 * explicit chunks — decompressing when the vector's response headers say
 * `content-encoding: gzip`, exactly as httpx decodes before
 * `iter_bytes()` — and collect the lines the REAL `iterJsonlLines`
 * yields (P3-5 rule-3 binding honesty: the library entry point does all
 * the work; the binding only adds the transport shape).
 *
 * @param implementations - The registry to extend.
 */
function registerClientInternalsBindings(
  implementations: ImplementationRegistry,
): void {
  implementations.register("api_client._iter_jsonl_lines", async (context) => {
    const chunks = requireKwarg(context, "chunks") as readonly Uint8Array[];
    const rawHeaders = context.kwargs["headers"];
    const headers = (rawHeaders ?? {}) as Readonly<Record<string, string>>;
    const contentEncoding = Object.entries(headers).find(
      ([name]) => name.toLowerCase() === "content-encoding",
    )?.[1];
    let source: AsyncIterable<Uint8Array> = (async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    })();
    if (contentEncoding?.toLowerCase() === "gzip") {
      // Transport-layer decompression (httpx does this inside the
      // response; fetch runtimes do it inside the body stream).
      source = new ReadableStream<Uint8Array>({
        start(controller): void {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      }).pipeThrough(
        // Platform-typing shim: @types/node's DecompressionStream is not
        // declared as a ReadableWritablePair; the runtime object is one.
        new DecompressionStream("gzip") as unknown as ReadableWritablePair<
          Uint8Array,
          Uint8Array
        >,
      );
    }
    const lines: string[] = [];
    for await (const line of iterJsonlLines(source)) {
      lines.push(line);
    }
    return lines;
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
    const requests = requireKwarg(context, "requests") as ReadonlyArray<
      Readonly<Record<string, unknown>>
    >;
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
   *   (R5.1/R5.2). `BookmarkValidationError` additionally carries its
   *   `errors[]` `{path, code, severity}` triples so the facade
   *   bypass/build vectors' `expect.error` comparisons see them
   *   (B2-BIND forward note, b5-packets.md §6.5).
   */
  toExpectError(): JsonValue {
    if (this.original instanceof BookmarkValidationError) {
      return {
        class: this.original.name,
        code: this.original.code,
        errors: this.original.errors.map((err) => ({
          path: err.path,
          code: err.code,
          severity: err.severity,
        })),
      };
    }
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
  } catch (error) {
    if (error instanceof MixpanelHeadlessError) {
      throw new CoreLibraryError(error);
    }
    throw error;
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
  return value === undefined
    ? {}
    : { resource_type: value as "events" | "people" };
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
        ...(quantifier === undefined
          ? {}
          : { quantifier: quantifier as "any" | "all" }),
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
      options,
    );
  });
  bind("types.CohortCriteria.did_not_do_event", (context) => {
    const options = Object.fromEntries(
      Object.entries(context.kwargs).filter(([key]) => key !== "event"),
    );
    return CohortCriteria.didNotDoEvent(
      requireKwarg(context, "event") as string,
      options,
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
        ...(operator === undefined
          ? {}
          : { operator: operator as HasPropertyOperator }),
        ...(propertyType === undefined
          ? {}
          : { property_type: propertyType as HasPropertyType }),
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
      typeof signed_at.toNumber === "function"
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
  bind("types.ReplayBundle", (context) => new ReplayBundle(context.kwargs));
}

// ---------------------------------------------------------------------------
// B2 validator bindings (P3-6 step 3 / P3-2 b′ — fable rig task)
// ---------------------------------------------------------------------------

/**
 * Encode a validator's return exactly like the Python recorder's
 * `validation_errors` output codec (`conformance/record/codecs.py::
 * _encode_validation_errors`): one `{path, code, severity}` object per
 * error, emission order preserved. `message`/`suggestion`/`fix` never
 * enter the encoding (R5.3/R5.4 — the runner's `diffReturnedValue`
 * does NOT strip advisory keys from `expect.output`, so serializing
 * them would fail every vector; b2-packets.md §Binding-shape).
 *
 * @param returned - The validator's return value.
 * @returns The structural `[{path, code, severity}]` encoding.
 * @throws TypeError - When the value is not `ValidationError[]` (a
 *   binding wiring bug, mirroring Python's `UnencodableValueError`).
 */
function encodeValidationErrors(returned: unknown): JsonValue {
  if (
    !Array.isArray(returned) ||
    returned.some((item) => !(item instanceof ValidationError))
  ) {
    throw new TypeError(
      "validation_errors encoding expects ValidationError[] from the validator",
    );
  }
  return returned.map((item: ValidationError) => ({
    path: item.path,
    code: item.code,
    severity: item.severity,
  }));
}

/**
 * Unwrap one finite-integral `PyFloat` carrier to its native number.
 *
 * Applied ONLY at the kwarg positions the B2 module tasks measured as
 * pure NUMERIC comparisons in the Python source (B2-M1/B2-M3 carrier
 * tables): there Python's `30.0` compares equal to `30`, so the TS twin
 * needs the native number. Positions with `isinstance(int/float)`
 * semantics keep the carrier — the ported validators classify it via
 * `isPythonInt`/`isFloatCarrier` exactly where CPython classifies a
 * float (Caution §8; any wider unwrap is a binding-honesty smell).
 *
 * @param value - A decoded kwarg value.
 * @returns The carrier's numeric value, or the value unchanged.
 */
function unwrapCarrierNumber(value: unknown): unknown {
  return value instanceof PyFloat ? value.toNumber() : value;
}

/**
 * Whether a value is a plain (prototype-Object) record — a decoded
 * vector-JSON dict, never a reconstructed core instance.
 *
 * @param value - The value to test.
 * @returns `true` for plain objects only.
 */
function isPlainDict(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/**
 * Deep-unwrap NON-FINITE `PyFloat` carriers to native non-finite
 * numbers (B2-M1 rule "non-finite spellings always unwrap", the
 * `vector-codecs.ts` SignedReplay precedent). Finite carriers stay
 * carriers — that is what makes `isinstance(x, int)` fail in TS
 * exactly where it fails in CPython (B18B/B22/R5/DG1/F3). The walk
 * covers plain dicts/lists only; reconstructed core instances pass
 * through untouched. Behavior-neutral for the carrier-aware M2 surface
 * (`_isFinite`, `pythonIntValue`, and the sorting mirror's
 * `optionalInt` classify native non-finite numbers identically) — this
 * is NOT a `params.sorting` unwrap rule (B2-M2 finding 1).
 *
 * @param value - A decoded kwarg value.
 * @returns The value with every non-finite carrier made native.
 */
function unwrapNonFiniteDeep(value: unknown): unknown {
  if (
    value instanceof PyFloat &&
    ["Infinity", "-Infinity", "NaN"].includes(value.spelling)
  ) {
    return value.toNumber();
  }
  if (Array.isArray(value)) {
    return value.map((item) => unwrapNonFiniteDeep(item));
  }
  if (isPlainDict(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value)) {
      out[key] = unwrapNonFiniteDeep(member);
    }
    return out;
  }
  return value;
}

/**
 * Build one validator options bag from the decoded kwargs.
 *
 * Every kwarg passes through {@link unwrapNonFiniteDeep}; the
 * `numericFields` then get the finite-carrier unwrap
 * ({@link unwrapCarrierNumber}). Absent kwargs stay absent (R3.5 — the
 * TS validators' destructuring defaults mirror the Python kwonly
 * defaults). The B2-M1 table's remaining unwrap row — `GroupBy`
 * bucket fields — is owned by the GroupBy contract codec itself
 * (`vector-codecs.ts`, SignedReplay precedent), so decoded `group_by`
 * values arrive here already native.
 *
 * @param context - The invocation context.
 * @param numericFields - Kwarg names measured as numeric comparisons.
 * @returns The prepared kwargs bag.
 */
function validatorKwargs(
  context: InvocationContext,
  numericFields: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(context.kwargs)) {
    let value = unwrapNonFiniteDeep(raw);
    if (numericFields.includes(key)) {
      value = unwrapCarrierNumber(value);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Read the required `params` dict kwarg of a Layer-2 validator, with
 * the deep non-finite unwrap applied.
 *
 * @param context - The invocation context.
 * @returns The prepared params dict.
 * @throws Error - When the kwarg is missing from `call.input`.
 */
function requireParamsDict(
  context: InvocationContext,
): Record<string, unknown> {
  return unwrapNonFiniteDeep(requireKwarg(context, "params")) as Record<
    string,
    unknown
  >;
}

/**
 * Register the B2 validator bindings — the 11 `validation.*` /
 * `user_validators.*` registry names (b2-packets.md §Binding-plan; the
 * 12th `_validator_entries()` row, `bookmark_schema.validate_with_pydantic`,
 * is B3's — its prefix flips at the B3 gate).
 *
 * Binding honesty (P3-5 rule 3): every binding calls the real ported
 * public entry point from `packages/core/src/query`; the only
 * adaptations are kwarg plumbing, the measured PyFloat carrier policy
 * (B2-M1/M2/M3 findings), the frozen-clock `today` seam, the shared
 * error wrap, and the `validation_errors` output encoding. Nothing here
 * re-derives a check or filters/reorders the returned list.
 *
 * Oracle note: oracle-ts serves every name registered here through the
 * same registry (`differential/oracle/server.ts` `executeBound`), so
 * this registration IS the batch's oracle-surface extension (P3-2e
 * step 3). `validation.validate_sorting_block` has zero corpus vectors
 * but is bound for the gate's mechanical `oracle.call` probe.
 *
 * @param implementations - The registry to extend.
 */
function registerValidatorBindings(
  implementations: ImplementationRegistry,
): void {
  const bindValidator = (
    api: string,
    invoke: (context: InvocationContext) => ValidationError[],
  ): void => {
    implementations.register(api, (context) =>
      encodeValidationErrors(guardCompat(() => invoke(context))),
    );
  };

  bindValidator("validation.validate_time_args", (context) =>
    validateTimeArgs(
      validatorKwargs(context, ["last"]) as unknown as ValidateTimeArgsOptions,
    ),
  );
  bindValidator("validation.validate_group_by_args", (context) =>
    validateGroupByArgs(
      validatorKwargs(context, []) as unknown as ValidateGroupByArgsOptions,
    ),
  );
  bindValidator("validation.validate_funnel_args", (context) =>
    // `conversion_window` and `data_group_id` keep carriers: Python
    // type-checks them (F3_CONVERSION_WINDOW_TYPE / DG1 — B2-M1 table).
    validateFunnelArgs(
      validatorKwargs(context, [
        "last",
      ]) as unknown as ValidateFunnelArgsOptions,
    ),
  );
  bindValidator("validation.validate_retention_args", (context) =>
    // `bucket_sizes[i]` and `data_group_id` keep carriers
    // (R5_BUCKET_SIZES_INTEGER / DG1 — B2-M1 table).
    validateRetentionArgs(
      validatorKwargs(context, [
        "last",
      ]) as unknown as ValidateRetentionArgsOptions,
    ),
  );
  bindValidator("validation.validate_flow_args", (context) =>
    validateFlowArgs(
      validatorKwargs(context, [
        "last",
        "forward",
        "reverse",
        "cardinality",
        "conversion_window",
      ]) as unknown as ValidateFlowArgsOptions,
    ),
  );
  bindValidator("validation.validate_query_args", (context) =>
    validateQueryArgs(
      validatorKwargs(context, [
        "last",
        "rolling",
      ]) as unknown as ValidateQueryArgsOptions,
    ),
  );
  bindValidator("validation.validate_bookmark", (context) => {
    const bookmarkType = context.kwargs["bookmark_type"];
    const options: ValidateBookmarkOptions =
      bookmarkType === undefined
        ? {}
        : { bookmark_type: bookmarkType as string };
    return validateBookmark(requireParamsDict(context), options);
  });
  bindValidator("validation.validate_flow_bookmark", (context) =>
    validateFlowBookmark(requireParamsDict(context)),
  );
  bindValidator("validation.validate_sorting_block", (context) =>
    validateSortingBlock(unwrapNonFiniteDeep(requireKwarg(context, "sorting"))),
  );
  bindValidator("user_validators.validate_user_args", (context) => {
    // B2-M3 carrier table: `limit`/`percentile`/`workers` and the
    // ELEMENTS of `segment_by` are pure numeric comparisons in Python
    // (no isinstance(int/float) anywhere in user_validators.py);
    // `cohort`/`as_of` keep carriers (isinstance-only reads).
    const options = validatorKwargs(context, [
      "limit",
      "percentile",
      "workers",
    ]);
    const segmentBy = options["segment_by"];
    if (Array.isArray(segmentBy)) {
      options["segment_by"] = segmentBy.map((item) =>
        unwrapCarrierNumber(item),
      );
    }
    // U8 clock seam: the recorder and both oracles run under the frozen
    // record epoch (b2-packets.md §V2 trap 2b) — the binding injects the
    // shims' date; the library defaults to the real clock.
    options["today"] = (): string => context.shims.today();
    return validateUserArgs(options);
  });
  bindValidator("user_validators.validate_user_params", (context) =>
    validateUserParams(requireParamsDict(context)),
  );
}

// ---------------------------------------------------------------------------
// B3 builder bindings (P3-6 step 3 / P3-2 b′ — fable rig task)
// ---------------------------------------------------------------------------

/**
 * The rich (dataclass/model) `$type` tags whose members Python's EXPECT
 * encoder drops (`_encode_common(tagged_models=False)`), as opposed to
 * the built-in value tags (`datetime`, `date`, `bytes`, `SecretStr`,
 * `float`), which appear in expect encodings too. Derived from the
 * shared contract-codec table so this set can never drift from the
 * decode side.
 */
const RICH_MODEL_TAGS: ReadonlySet<string> = new Set(
  CONTRACT_TAG_CODECS.keys(),
);

/**
 * Re-encode one `codecs.encodeValue` product in Python's EXPECT
 * encoding (b3-packets.md §Binding shapes).
 *
 * The runner's `diffReturnedValue` canonicalizes the binding's return
 * with NO rich-tag hook and the canonicalizer does not normalize
 * `$type: float` payloads, so builder bindings emit expect-position
 * encodings themselves: rich model tags are dropped (Python
 * `encode_expect_value` serializes dataclasses to their plain to-dict
 * shape — the `extract_cohort_filter` Filter outputs), and finite
 * `$type: float` payloads become raw `JsonNumber` tokens so float-ness
 * renders `18.0` exactly like the recorded expect token (D6 rule 3).
 * Built-in tags (`datetime`, `bytes`, ...) and non-finite float
 * spellings stay tagged, mirroring oracle-py `_encode_result` and
 * oracle-ts `toExpectEncoding` (`differential/oracle/server.ts` — whose
 * own transform is idempotent over this one).
 *
 * @param value - A vector-JSON tree from {@link CodecRegistry.encodeValue}.
 * @returns The expect-encoded tree.
 */
function toBuilderExpectOutput(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => toBuilderExpectOutput(item));
  }
  if (isPlainDict(value)) {
    if (value["$type"] === "float") {
      const spelling = value["value"];
      if (
        typeof spelling === "string" &&
        !["NaN", "Infinity", "-Infinity"].includes(spelling)
      ) {
        return new JsonNumber(spelling);
      }
    }
    const out: Record<string, JsonValue> = {};
    for (const [key, member] of Object.entries(value)) {
      if (
        key === "$type" &&
        typeof member === "string" &&
        RICH_MODEL_TAGS.has(member)
      ) {
        continue;
      }
      out[key] = toBuilderExpectOutput(member);
    }
    return out;
  }
  return value;
}

/**
 * Register the B3 builder bindings — the 17 `bookmark_builders.*` /
 * `segfilter.*` / `expressions.*` / `transforms.*` / `user_builders.*` /
 * `bookmark_schema.*` registry names (b3-packets.md §Binding plan).
 *
 * Binding honesty (P3-5 rule 3): every binding calls the real ported
 * public entry point (`bookmarks/builders.ts`, `bookmarks/schema.ts`,
 * `query/{segfilter,expressions,transforms,user-builders}.ts`). The only
 * adaptations are kwarg plumbing (decoded kwargs pass through
 * UNCONVERTED — the modules are carrier-aware, b3-packets §Binding
 * shapes "PyFloat discipline"), the `today`/`uuid` determinism seams,
 * the shared error wrap, and the recorder output-codec twins:
 * {@link toBuilderExpectOutput} (generic expect encoding),
 * `model_name` (`codecs.py:780-784` — the handle's `.name` or `null`),
 * `selector_str` (verbatim strings — pass through untouched), the
 * 2-element JSON array for the `extract_cohort_filter` tuple, the
 * `PyDatetime` wrap of `transform_event().event_time` iso text
 * (`codecs.py:227-228`), and the B2 `validation_errors` encoder for
 * `validate_with_pydantic`.
 *
 * The K3 builtin-exception twins (`ValueError`/`OverflowError`/
 * `AttributeError`, `query/python-builtins.ts`) are NOT
 * `MixpanelHeadlessError` descendants, so {@link runGuarded} rethrows
 * them raw; the oracle's `errorPayload` encodes their
 * `constructor.name`, matching oracle-py's bare-class encoding
 * (B3-K3-notes §7.3). No corpus vector reaches them.
 *
 * Oracle note: oracle-ts serves every name registered here through the
 * same registry (`differential/oracle/server.ts` `executeBound`), so
 * this registration IS the batch's oracle-surface extension (P3-2e
 * step 3). `transforms.transform_event`,
 * `bookmark_schema.get_root_model_for_bookmark_type` and
 * `bookmark_schema.validate_with_pydantic` have zero corpus vectors but
 * are bound for the gate's mechanical `oracle.call` probe and the
 * gate-flip straggler rule.
 *
 * @param implementations - The registry to extend.
 * @param codecs - The codec registry used to encode returned values.
 */
function registerBuilderBindings(
  implementations: ImplementationRegistry,
  codecs: CodecRegistry,
): void {
  const bindBuilder = (
    api: string,
    invoke: (context: InvocationContext) => unknown,
  ): void => {
    implementations.register(api, (context) =>
      toBuilderExpectOutput(runGuarded(codecs, () => invoke(context))),
    );
  };

  // ----- bookmark_builders (packet K2) -----

  bindBuilder("bookmark_builders.build_filter_entry", (context) =>
    buildFilterEntry(requireKwarg(context, "f") as Filter),
  );
  bindBuilder("bookmark_builders.build_filter_section", (context) =>
    buildFilterSection(
      requireKwarg(context, "where") as Parameters<
        typeof buildFilterSection
      >[0],
    ),
  );
  bindBuilder("bookmark_builders.build_frequency_filter_entry", (context) =>
    buildFrequencyFilterEntry(requireKwarg(context, "ff") as FrequencyFilter),
  );
  bindBuilder("bookmark_builders.build_group_section", (context) =>
    buildGroupSection(
      requireKwarg(context, "group_by") as Parameters<
        typeof buildGroupSection
      >[0],
      // Absent kwarg stays absent (R3.5); the TS default (`?? null`)
      // mirrors the Python kwonly default `data_group_id=None`.
      Object.hasOwn(context.kwargs, "data_group_id")
        ? { data_group_id: context.kwargs["data_group_id"] as number | null }
        : {},
    ),
  );
  bindBuilder("bookmark_builders.build_flow_property_filter", (context) =>
    buildFlowPropertyFilter(
      requireKwarg(context, "filters") as readonly Filter[],
    ),
  );
  bindBuilder("bookmark_builders.build_flow_cohort_filter", (context) =>
    buildFlowCohortFilter(
      requireKwarg(context, "where") as Parameters<
        typeof buildFlowCohortFilter
      >[0],
    ),
  );
  bindBuilder("bookmark_builders.build_date_range", (context) =>
    buildDateRange({
      from_date: requireKwarg(context, "from_date") as string | null,
      to_date: requireKwarg(context, "to_date") as string | null,
      last: requireKwarg(context, "last") as number,
    }),
  );
  bindBuilder("bookmark_builders.build_time_section", (context) =>
    buildTimeSection({
      from_date: requireKwarg(context, "from_date") as string | null,
      to_date: requireKwarg(context, "to_date") as string | null,
      last: requireKwarg(context, "last") as number,
      unit: requireKwarg(context, "unit") as Parameters<
        typeof buildTimeSection
      >[0]["unit"],
      // D1.4 clock seam (b3-packets §Binding shapes): the from-only
      // branch fills `to_date` with today(); the runner/oracle shims
      // freeze it at the record epoch (2026-01-15).
      today: (): string => context.shims.today(),
    }),
  );

  // ----- segfilter / expressions / transforms (packet K3) -----

  bindBuilder("segfilter.build_segfilter_entry", (context) =>
    buildSegfilterEntry(requireKwarg(context, "f") as Filter),
  );
  bindBuilder("expressions.normalize_on_expression", (context) =>
    normalizeOnExpression(requireKwarg(context, "on") as string),
  );
  bindBuilder("transforms.transform_event", (context) => {
    const transformed = transformEvent(
      requireKwarg(context, "event") as Readonly<Record<string, unknown>>,
      // D1.4 UUID seam: the deterministic counter stream
      // (`00000000-0000-4000-8000-{seq:012d}`), reset per vector/call on
      // both sides (`clock.py:30` ↔ `shims.ts:107-110`).
      { uuid: (): string => context.shims.uuid() },
    );
    return {
      ...transformed,
      // Python returns a datetime; the library twin returns Python
      // isoformat TEXT (B3-K3 design decision). Wrap it so encode emits
      // `{"$type": "datetime", "iso": ...}` byte-matching Python
      // `isoformat()` (`codecs.py:227-228`).
      event_time: new PyDatetime(transformed["event_time"] as string),
    };
  });
  bindBuilder("transforms.transform_profile", (context) =>
    transformProfile(
      requireKwarg(context, "profile") as Readonly<Record<string, unknown>>,
    ),
  );

  // ----- user_builders selector path (packet K4) -----

  bindBuilder("user_builders.filter_to_selector", (context) =>
    // `selector_str` codec twin: the returned string is emitted VERBATIM
    // (strings pass through the expect walk untouched; no trimming, no
    // normalization — watchlist #2, no canonicalizer rescue).
    filterToSelector(requireKwarg(context, "f") as Filter),
  );
  bindBuilder("user_builders.filters_to_selector", (context) =>
    filtersToSelector(requireKwarg(context, "filters") as readonly Filter[]),
  );
  bindBuilder("user_builders.extract_cohort_filter", (context) =>
    // Tuple twin: a 2-element JSON array — element 0 the remaining
    // Filters, element 1 the first cohort Filter or null. The SAME
    // decoded Filter instances flow through (identity semantics); the
    // expect walk serializes them to their Python-spelled `_`-field
    // dicts.
    extractCohortFilter(requireKwarg(context, "filters") as readonly Filter[]),
  );

  // ----- bookmark_schema (packet K1) -----

  bindBuilder("bookmark_schema.get_root_model_for_bookmark_type", (context) => {
    // `model_name` output codec twin (`codecs.py:780-784`): the root
    // model HANDLE serializes as its Python class name, `None` as null.
    const handle = getRootModelForBookmarkType(
      requireKwarg(context, "bookmark_type") as string,
    );
    return handle === null ? null : handle.name;
  });
  implementations.register(
    "bookmark_schema.validate_with_pydantic",
    (context) =>
      encodeValidationErrors(
        guardCompat(() => {
          // Mirror of the Python name-resolving adapter
          // (`conformance/record/adapters.py::validate_with_pydantic`,
          // b3-packets §"validate_with_pydantic — adapter retarget"):
          // resolve the model NAME over the fixed five-entry map and
          // forward with the DEFAULT code mapper.
          const modelName = requireKwarg(context, "model");
          if (typeof modelName !== "string") {
            throw new TypeError(
              "bookmark_schema.validate_with_pydantic expects model: str " +
                "per the Python adapter",
            );
          }
          const handle = BOOKMARK_MODEL_HANDLES.get(modelName);
          if (handle === undefined) {
            // Twin of the Python adapter's unknown-name ValueError (the
            // fuzz strategies draw the five mapped names only).
            throw new ValueError(
              `unknown bookmark_schema model ${JSON.stringify(modelName)}`,
            );
          }
          const prefix = context.kwargs["path_prefix"];
          return validateWithPydantic(
            handle.validate,
            requireKwarg(context, "value"),
            prefix === undefined ? {} : { path_prefix: prefix as string },
          );
        }),
      ),
  );
}

/**
 * Register the Phase-2 contract tag codecs (phase2-design C7 item 2).
 *
 * One call per Phase-2 packet's additions — the table itself lives in
 * `vector-codecs.ts` so the conformance runner
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
        } catch (error) {
          throw new UndecodableValueError(
            `could not reconstruct ${tag} from vector fields: ${String(error)}`,
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
  registerClientInternalsBindings(implementations);
  // B4 wire-client bindings (P3-2 b′ inline for a fable batch): C1
  // client core; later shards append their registrations in
  // wire-client.ts / sibling modules.
  registerApiClientCoreBindings(implementations);
  // B4-C2: query-host + engage + streaming/export wire bindings.
  registerQueryWireBindings(implementations);
  // B4-C3: dashboards + bookmarks-v2 + cohorts-app entity CRUD.
  registerEntityWireBindings(implementations);
  // B4-C4: flags + experiments + annotations + webhooks + alerts.
  registerLifecycleWireBindings(implementations);
  // B4-C5: data governance (schemas/lexicon/drop filters/custom
  // properties/lookup tables/custom events/enforcement/audit/
  // anomalies/deletion requests) + replays signing.
  registerGovernanceWireBindings(implementations);
  // B4-C6: pagination.paginate_all (the one `pagination.` corpus name).
  registerPaginationBindings(implementations);
  registerContractCodecs(codecs);
  // B5 (b′): the 44 workspace.<member> facade bindings + the replays
  // family (5 replays.* wire + 3 replay_labels.* + rrweb_analyzer.analyze
  // builders) — b5-packets.md §6. Since B6-BIND the same module also
  // registers the 11 B6-W1 lifecycle/me/business-context names —
  // binding workspace.me closes the P3-1 † dagger holdback
  // (b6-packets.md §11.2).
  registerWorkspaceBindings(implementations, codecs);
  // B6 (b′): the 143 W2–W8 workspace.<member> entity bindings
  // (b6-packets.md §11 — 154 B6 names total with the W1 group above).
  registerWorkspaceEntityBindings(implementations, codecs);
  registerReplaysBindings(implementations, codecs);
  registerQueryParamBindings(implementations, codecs);
  registerValidatorBindings(implementations);
  registerBuilderBindings(implementations, codecs);
  // B7-A2 (b′ inline): region_probe.probe_region (14 auth vectors) —
  // replays while `region_probe.` is still pending; the flip is the
  // B7 gate's (b7-packets.md §2.7, §4).
  registerAuthWireBindings(implementations);
  return { implementations, codecs, recordEpoch };
}
