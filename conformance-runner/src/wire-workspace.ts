/**
 * `workspace.<member>` facade bindings: the query, discovery/lexicon and
 * session-replay members plus the lifecycle, `/me` and business-context
 * members, together with the facade plumbing (`workspaceFromSession`,
 * `runFacade`, `optionsBag`, `encodeFacadeValue`) the entity sibling
 * `wire-workspace-entities.ts` shares.
 *
 * Mirrors the Python runner's `_ReplayContext.get_workspace` /
 * `make_workspace`:
 *
 * 1. `workspaceFromSession(context)` builds one facade instance per
 *    vector, memoized in `context.state` under {@link WORKSPACE_STATE_KEY}
 *    so `call.setup[]` entries and the measured call share it. The
 *    underlying client is the shared `clientFromSession` instance
 *    (memoized under `CLIENT_STATE_KEY`), so `api_client.*` setup
 *    entries mutate the same client the facade uses.
 * 2. The facade session is `call.workspace_session` when present, else
 *    `call.session`, else the synthetic builder session
 *    (`_DEFAULT_SESSION_VALUES`). Builder-kind vectors carry no session
 *    and no fetch — they get the synthetic session over an empty
 *    `VectorFetch`, so any accidental network attempt fails the vector
 *    loudly.
 * 3. Every binding calls the real `Workspace` member the recorder
 *    wrapped — never the underlying client method, never a re-derived
 *    transform. The only adaptations are kwarg plumbing, the `today`
 *    clock seam (`context.shims.today()` — the recorder ran under the
 *    frozen epoch), and the recorder output-codec twins below (see
 *    `wire-client.ts` for the shared client-construction and honesty
 *    rules).
 * 4. Results encode exactly like the recorder's `encode_expect_value`
 *    field walk: dataclass instances to their declared-field shape
 *    (`toVectorPayload()` where present), Python-`float`-typed fields as
 *    raw float tokens even when integral ({@link floatToken} — the
 *    recorder writes `1.0`, not `1`; the affected fields are cited at
 *    each twin), and `$type` tags for datetime members.
 *
 * @see conformance.runner.execute._ReplayContext.get_workspace
 */

import {
  type BookmarkType,
  type BusinessContextScopeOptions,
  createMixpanelClient,
  type EntityType,
  type FlowStep,
  type FunnelStep,
  JsonNumber as CoreJsonNumber,
  type MixpanelClient,
  MixpanelHeadlessError,
  pythonFloatStr,
  type RetentionEvent,
  Workspace,
  type WorkspaceEventCountsOptions,
  type WorkspaceEventsForReplayOptions,
  type WorkspaceEventsOptions,
  type WorkspaceFetchReplayOptions,
  type WorkspaceFetchReplaysOptions,
  type WorkspaceFlowQueryOptions,
  type WorkspaceFrequencyOptions,
  type WorkspaceFunnelOptions,
  type WorkspaceFunnelQueryOptions,
  type WorkspaceLexiconSchemasOptions,
  type WorkspaceListReplaysOptions,
  type WorkspaceMeOptions,
  type WorkspaceNumericOptions,
  type WorkspaceProjectsOptions,
  type WorkspacePropertyCountsOptions,
  type WorkspacePropertyValuesOptions,
  type WorkspaceQueryOptions,
  type WorkspaceReplaysForUserOptions,
  type WorkspaceRetentionOptions,
  type WorkspaceRetentionQueryOptions,
  type WorkspaceSchemaGraphOptions,
  type WorkspaceSegmentationNumericOptions,
  type WorkspaceSegmentationOptions,
  type WorkspaceSignReplayOptions,
  type WorkspaceStreamReplayOptions,
  type WorkspaceSubpropertiesOptions,
  type WorkspaceTopEventsOptions,
  type WorkspaceUseOptions,
  type WorkspaceUserQueryOptions,
  type WorkspaceWorkspacesOptions,
} from "@mixpanel-headless/core";
import type {
  EventsInput,
  LiveActivityFeedOptions,
} from "@mixpanel-headless/core/internal";

import {
  type CodecRegistry,
  PyDate,
  PyDatetime,
  PyFloat,
  UnencodableValueError,
} from "./codecs.js";
import { isPlainObject } from "./internal/guards.js";
import { JsonNumber, type JsonValue } from "./json-value.js";
import type { ImplementationRegistry, InvocationContext } from "./runner.js";
import { CONTRACT_TAG_CODECS } from "./vector-codecs.js";
import { createVectorFetch } from "./vector-fetch.js";
import {
  buildReplaySession,
  CLIENT_STATE_KEY,
  clientFromSession,
  requireWireKwarg,
  WireCoreError,
} from "./wire-client.js";

/** The well-known `context.state` key for the memoized facade. */
const WORKSPACE_STATE_KEY = "workspace";

/**
 * The synthetic session for builder-kind facade replays, mirroring
 * `conformance.runner.targets._DEFAULT_SESSION_VALUES` (builder vectors
 * carry no session; `Workspace` construction requires one; requests can
 * never escape because the client binds an empty `VectorFetch`).
 */
const DEFAULT_BUILDER_SESSION: JsonValue = {
  type: "service_account",
  region: "us",
  project_id: "12345",
  account_name: "conformance_replay",
  username: "replay_user",
  secret: "replay_secret",
};

/**
 * Return the vector's single client, building and memoizing it on first
 * use (the `_ReplayContext.get_client` twin).
 *
 * With a session present this is the shared `clientFromSession` path.
 * Without one, the synthetic builder session is used over the vector
 * fetch when one exists (wire vectors measured on session-free targets),
 * else over an empty `VectorFetch` (builder-kind: any network attempt
 * fails loudly).
 *
 * @param context - The invocation context.
 * @returns The vector's single `MixpanelClient` instance.
 */
export function clientForContext(context: InvocationContext): MixpanelClient {
  const existing = context.state.get(CLIENT_STATE_KEY);
  if (existing !== undefined) {
    return existing as MixpanelClient;
  }
  if (context.session !== undefined) {
    return clientFromSession(context);
  }
  const { session } = buildReplaySession(DEFAULT_BUILDER_SESSION);
  const client = createMixpanelClient({
    session,
    fetch: context.fetch ?? createVectorFetch([]).fetch,
    sleep: async (): Promise<void> => {
      /* zero-delay */
    },
    random: () => 0,
    now: (): Date => context.shims.now(),
  });
  context.state.set(CLIENT_STATE_KEY, client);
  return client;
}

/**
 * Return the vector's single `Workspace` facade, building and memoizing
 * it on first use (the `_ReplayContext.get_workspace` twin).
 *
 * @param context - The invocation context.
 * @returns The facade bound to the vector's shared client.
 */
export function workspaceFromSession(context: InvocationContext): Workspace {
  const existing = context.state.get(WORKSPACE_STATE_KEY);
  if (existing !== undefined) {
    return existing as Workspace;
  }
  const client = clientForContext(context);
  const facadeRaw =
    context.workspaceSession ?? context.session ?? DEFAULT_BUILDER_SESSION;
  const { session } = buildReplaySession(facadeRaw);
  const workspace = new Workspace({ session, client });
  context.state.set(WORKSPACE_STATE_KEY, workspace);
  return workspace;
}

/** Rich `$type` tags the Python expect encoder strips. */
const RICH_MODEL_TAGS: ReadonlySet<string> = new Set(
  CONTRACT_TAG_CODECS.keys(),
);

/**
 * Re-encode one already-encoded codec tree in Python's expect encoding
 * (a local twin of `toBuilderExpectOutput` in `bindings/builders.ts`,
 * kept here so the wire modules stay self-contained): rich model tags
 * drop, finite `$type: float` payloads become raw `JsonNumber` tokens,
 * non-finite spellings stay tagged.
 *
 * @param value - A vector-JSON tree from `CodecRegistry.encodeValue`.
 * @returns The expect-encoded tree.
 */
function stripRichTags(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => stripRichTags(item));
  }
  if (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof JsonNumber)
  ) {
    const record = value as Record<string, JsonValue>;
    if (record["$type"] === "float") {
      const spelling = record["value"];
      if (
        typeof spelling === "string" &&
        !["NaN", "Infinity", "-Infinity"].includes(spelling)
      ) {
        return new JsonNumber(spelling);
      }
    }
    const out: Record<string, JsonValue> = {};
    for (const [key, member] of Object.entries(record)) {
      if (
        key === "$type" &&
        typeof member === "string" &&
        RICH_MODEL_TAGS.has(member)
      ) {
        continue;
      }
      out[key] = stripRichTags(member);
    }
    return out;
  }
  return value;
}

/**
 * Encode a facade/service return value exactly as the Python recorder's
 * `encode_expect_value` walk does:
 *
 * - primitives pass through (the runner's own `encodeExpectValue`
 *   finishes the walk and rejects non-finite numbers);
 * - core `JsonNumber` tokens become runner tokens (raw spelling kept);
 * - `PyFloat` carriers become raw float tokens (expect position keeps
 *   the recorded `18.0` spelling);
 * - `Map`s become plain objects (Python `dict` results);
 * - instances with `toVectorPayload()` (the recorder twins on result
 *   dataclasses) encode through it; contract-tagged classes encode through the
 *   shared codec table with rich tags stripped; `toJSON()` is the last
 *   instance fallback.
 *
 * @param codecs - The codec registry (contract-class encoders).
 * @param value - The live library return value.
 * @returns The expect-encoded vector-JSON tree.
 * @throws Error - When a value has no encoding (a binding bug).
 * @example
 * ```ts
 * const result = await ws.funnel(funnelId, options);
 * const encoded = encodeFacadeValue(codecs, result);
 * // dataclass fields under their Python names, floats as raw tokens
 * ```
 */
// eslint-disable-next-line complexity -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
export function encodeFacadeValue(
  codecs: CodecRegistry,
  value: unknown,
): JsonValue {
  // Objects that re-encode through `toVectorPayload()` / `toJSON()` loop
  // back here with the projected value (no self-call).
  let current: unknown = value;
  for (;;) {
    if (current === null || current === undefined) {
      return null;
    }
    if (
      typeof current === "string" ||
      typeof current === "boolean" ||
      typeof current === "number" ||
      typeof current === "bigint"
    ) {
      return current;
    }
    if (current instanceof JsonNumber) {
      return current;
    }
    if (current instanceof CoreJsonNumber) {
      return new JsonNumber(current.raw);
    }
    if (current instanceof PyFloat) {
      if (["NaN", "Infinity", "-Infinity"].includes(current.spelling)) {
        return { $type: "float", value: current.spelling };
      }
      return new JsonNumber(current.spelling);
    }
    if (current instanceof PyDatetime) {
      return { $type: "datetime", iso: current.iso };
    }
    if (current instanceof PyDate) {
      return { $type: "date", iso: current.iso };
    }
    if (Array.isArray(current)) {
      return current.map((item) => encodeFacadeValue(codecs, item));
    }
    if (current instanceof Map) {
      const out: Record<string, JsonValue> = {};
      for (const [key, member] of current) {
        out[String(key)] = encodeFacadeValue(codecs, member);
      }
      return out;
    }
    if (typeof current === "object") {
      if (isPlainObject(current)) {
        const out: Record<string, JsonValue> = {};
        for (const [key, member] of Object.entries(current)) {
          // eslint-disable-next-line max-depth -- mirrors the Python nesting; flattening would reorder the guards
          if (member === undefined) {
            continue; // absent, not null
          }
          out[key] = encodeFacadeValue(codecs, member);
        }
        return out;
      }
      const withPayload = current as { toVectorPayload?: () => unknown };
      if (typeof withPayload.toVectorPayload === "function") {
        current = withPayload.toVectorPayload();
        continue;
      }
      try {
        return stripRichTags(codecs.encodeValue(current));
      } catch (error) {
        if (!(error instanceof UnencodableValueError)) {
          throw error;
        }
      }
      const withJson = current as { toJSON?: () => unknown };
      if (typeof withJson.toJSON === "function") {
        current = withJson.toJSON();
        continue;
      }
    }
    throw new Error(
      `wire-workspace: no expect encoding for ${typeof current === "object" ? current.constructor.name : typeof current}`,
    );
  }
}

/**
 * Render a Python-`float`-typed field as its recorded raw token
 * (`repr(float)` spelling — integral values keep the `.0` marker the
 * recorder wrote; non-numbers pass through untouched, matching the
 * passthrough fields whose float-ness rides the JSON body).
 *
 * @param value - The encoded field value.
 * @returns A raw float token for finite native numbers, else the input.
 */
function floatToken(value: JsonValue): JsonValue {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new JsonNumber(pythonFloatStr(value));
  }
  return value;
}

/**
 * Apply {@link floatToken} to one member of an encoded object, if it is
 * an object and the member is present.
 *
 * @param tree - The encoded tree.
 * @param key - The member name.
 */
function tagFloatMember(tree: JsonValue, key: string): void {
  if (
    typeof tree !== "object" ||
    tree === null ||
    Array.isArray(tree) ||
    tree instanceof JsonNumber
  ) {
    return;
  }

  const record = tree as Record<string, JsonValue>;
  const value = record[key];
  if (value !== undefined) {
    record[key] = floatToken(value);
  }
}

/**
 * Read the encoded member list at `key`, when the tree is an object and
 * the member is an array.
 *
 * @param tree - The encoded tree.
 * @param key - The member name.
 * @returns The array member, or `[]`.
 */
function arrayMember(tree: JsonValue, key: string): JsonValue[] {
  if (
    typeof tree === "object" &&
    tree !== null &&
    !Array.isArray(tree) &&
    !(tree instanceof JsonNumber)
  ) {
    const member = (tree as Record<string, JsonValue>)[key];
    if (Array.isArray(member)) {
      return member;
    }
  }
  return [];
}

/**
 * Apply {@link floatToken} to every value of an object-valued member
 * (the `results: dict[str, float]` shapes).
 *
 * @param tree - The encoded tree.
 * @param key - The member name.
 */
function tagFloatDictValues(tree: JsonValue, key: string): void {
  if (
    typeof tree !== "object" ||
    tree === null ||
    Array.isArray(tree) ||
    tree instanceof JsonNumber
  ) {
    return;
  }

  const member = (tree as Record<string, JsonValue>)[key];
  if (
    typeof member === "object" &&
    member !== null &&
    !Array.isArray(member) &&
    !(member instanceof JsonNumber)
  ) {
    const record = member as Record<string, JsonValue>;
    for (const [inner, memberValue] of Object.entries(record)) {
      record[inner] = floatToken(memberValue);
    }
  }
}

/**
 * Invoke a facade member, encode its return for the runner, and wrap
 * coded library errors as {@link WireCoreError} (whose `toExpectError`
 * carries the `BookmarkValidationError` `errors[]` triples).
 *
 * @param codecs - The codec registry.
 * @param invoke - Thunk performing the real facade call.
 * @returns The expect-encoded result.
 * @throws WireCoreError - When the call raises a core exception.
 * @throws unknown - Anything else, unchanged (harness sequence errors
 *   and runner/infra bugs must reach the runner intact).
 * @example
 * ```ts
 * const ws = workspaceFromSession(context);
 * return runFacade(codecs, () =>
 *   ws.propertyValues(propertyName, optionsBag(context, ["property_name"])),
 * );
 * ```
 */
export async function runFacade(
  codecs: CodecRegistry,
  invoke: () => Promise<unknown>,
): Promise<JsonValue> {
  try {
    return encodeFacadeValue(codecs, await invoke());
  } catch (error) {
    if (error instanceof MixpanelHeadlessError) {
      throw new WireCoreError(error);
    }
    throw error;
  }
}

/**
 * Build the options bag for a member: every decoded kwarg except the
 * positional names (Python kwonly names are the TS option keys), plus
 * the `today` clock seam when requested (the recorder and both oracles
 * run under the frozen record epoch).
 *
 * @param context - The invocation context.
 * @param positionals - Kwarg names consumed positionally.
 * @param withToday - Whether to inject `today` from the shims.
 * @returns The options bag, asserted to the member's option type (the
 *   recorder guarantees the kwarg names — a bad bag is a vector bug and
 *   surfaces as the member's own validation error).
 * @example
 * ```ts
 * // kwargs {event, unit, where} → positional `event` + {unit, where, today}
 * const options = optionsBag<WorkspaceQueryOptions>(context, ["event"], true);
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- a deliberate cast-in-disguise: the return-only T names the member's option type at each of the ~66 binding sites
export function optionsBag<T>(
  context: InvocationContext,
  positionals: readonly string[],
  withToday = false,
): T {
  const out: Record<string, unknown> = Object.fromEntries(
    Object.entries(context.kwargs).filter(
      ([name]) => !positionals.includes(name),
    ),
  );
  if (withToday) {
    out["today"] = (): string => context.shims.today();
  }
  return out as T;
}

/**
 * Register the `workspace.<member>` query, discovery, session-replay,
 * lifecycle, `/me` and business-context bindings.
 *
 * The five `build_*params` members are builder-kind (oracle-servable
 * through this same registry — the oracle server executes bound names
 * directly); `use`, `close` and `clear_discovery_cache` are wire_state
 * (`conformance.record.registry`; no return-shape contract); the rest
 * are wire_api. `workspace.me` must be bound here because the
 * `api_client.resolve_workspace_id` vector runs it as setup over the
 * shared `clientFromSession` client, whose workspace resolver is
 * installed at `Workspace` construction.
 *
 * @param implementations - The registry to extend.
 * @param codecs - The codec registry (output encoding + rich inputs).
 * @example
 * ```ts
 * const implementations = new ImplementationRegistry();
 * const codecs = new CodecRegistry();
 * registerWorkspaceBindings(implementations, codecs);
 * ```
 */
// eslint-disable-next-line max-lines-per-function -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
export function registerWorkspaceBindings(
  implementations: ImplementationRegistry,
  codecs: CodecRegistry,
): void {
  // --- Live-query / query-engine members ---

  implementations.register("workspace.segmentation", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.segmentation(
        requireWireKwarg(context, "event") as string,
        optionsBag<WorkspaceSegmentationOptions>(context, ["event"]),
      ),
    );
  });

  implementations.register("workspace.funnel", async (context) => {
    const ws = workspaceFromSession(context);
    const encoded = await runFacade(codecs, () =>
      ws.funnel(
        requireWireKwarg(context, "funnel_id") as number,
        optionsBag<WorkspaceFunnelOptions>(context, ["funnel_id"]),
      ),
    );
    // Recorder float twin: `FunnelResult.conversion_rate` and each
    // step's `conversion_rate` are Python `float`s (division / literal
    // 1.0; `mixpanel_headless.types.FunnelResult`).
    tagFloatMember(encoded, "conversion_rate");
    for (const step of arrayMember(encoded, "steps")) {
      tagFloatMember(step, "conversion_rate");
    }
    return encoded;
  });

  implementations.register("workspace.retention", async (context) => {
    const ws = workspaceFromSession(context);
    const encoded = await runFacade(codecs, () =>
      ws.retention(optionsBag<WorkspaceRetentionOptions>(context, [])),
    );
    // Recorder float twin: `RetentionCohort.retention` is `list[float]`
    // (rate division — `0.0` stays `0.0`).
    for (const cohort of arrayMember(encoded, "cohorts")) {
      if (
        typeof cohort !== "object" ||
        cohort === null ||
        Array.isArray(cohort) ||
        cohort instanceof JsonNumber
      ) {
        continue;
      }

      const record = cohort as Record<string, JsonValue>;
      const rates = record["retention"];
      if (Array.isArray(rates)) {
        record["retention"] = rates.map((rate) => floatToken(rate));
      }
    }
    return encoded;
  });

  implementations.register("workspace.event_counts", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.eventCounts(
        requireWireKwarg(context, "events") as readonly string[],
        optionsBag<WorkspaceEventCountsOptions>(context, ["events"]),
      ),
    );
  });

  implementations.register("workspace.property_counts", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.propertyCounts(
        requireWireKwarg(context, "event") as string,
        requireWireKwarg(context, "property_name") as string,
        optionsBag<WorkspacePropertyCountsOptions>(context, [
          "event",
          "property_name",
        ]),
      ),
    );
  });

  implementations.register("workspace.activity_feed", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.activityFeed(
        requireWireKwarg(context, "distinct_ids") as readonly string[],
        optionsBag<LiveActivityFeedOptions>(context, ["distinct_ids"]),
      ),
    );
  });

  implementations.register("workspace.query_saved_report", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.querySavedReport(
        requireWireKwarg(context, "bookmark_id") as number,
        optionsBag(context, ["bookmark_id"]),
      ),
    );
  });

  implementations.register("workspace.query_saved_flows", async (context) => {
    const ws = workspaceFromSession(context);
    const encoded = await runFacade(codecs, () =>
      ws.querySavedFlows(requireWireKwarg(context, "bookmark_id") as number),
    );
    // Recorder float twin: `FlowsResult.overall_conversion_rate` is a
    // Python float whenever the body carried a JSON number (or the 0.0
    // default); string bodies (`"NaN"`) pass through untouched.
    tagFloatMember(encoded, "overall_conversion_rate");
    return encoded;
  });

  implementations.register("workspace.frequency", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.frequency(optionsBag<WorkspaceFrequencyOptions>(context, [])),
    );
  });

  implementations.register(
    "workspace.segmentation_numeric",
    async (context) => {
      const ws = workspaceFromSession(context);
      return runFacade(codecs, () =>
        ws.segmentationNumeric(
          requireWireKwarg(context, "event") as string,
          optionsBag<WorkspaceSegmentationNumericOptions>(context, ["event"]),
        ),
      );
    },
  );

  implementations.register("workspace.segmentation_sum", async (context) => {
    const ws = workspaceFromSession(context);
    const encoded = await runFacade(codecs, () =>
      ws.segmentationSum(
        requireWireKwarg(context, "event") as string,
        optionsBag<WorkspaceNumericOptions>(context, ["event"]),
      ),
    );
    // Recorder float twin: `NumericSumResult.results` is
    // `dict[str, float]` — sum-endpoint values are Python floats
    // (`mixpanel_headless.types.NumericSumResult`; the recorded corpus
    // agrees).
    tagFloatDictValues(encoded, "results");
    return encoded;
  });

  implementations.register(
    "workspace.segmentation_average",
    async (context) => {
      const ws = workspaceFromSession(context);
      const encoded = await runFacade(codecs, () =>
        ws.segmentationAverage(
          requireWireKwarg(context, "event") as string,
          optionsBag<WorkspaceNumericOptions>(context, ["event"]),
        ),
      );
      // Same float twin as `segmentation_sum` (dict[str, float]).
      tagFloatDictValues(encoded, "results");
      return encoded;
    },
  );

  implementations.register("workspace.query", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.query(
        requireWireKwarg(context, "events") as EventsInput,
        optionsBag<WorkspaceQueryOptions>(context, ["events"], true),
      ),
    );
  });

  implementations.register("workspace.build_params", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.buildParams(
        requireWireKwarg(context, "events") as EventsInput,
        optionsBag<WorkspaceQueryOptions>(context, ["events"], true),
      ),
    );
  });

  implementations.register("workspace.query_funnel", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.queryFunnel(
        requireWireKwarg(context, "steps") as ReadonlyArray<
          string | FunnelStep
        >,
        optionsBag<WorkspaceFunnelQueryOptions>(context, ["steps"], true),
      ),
    );
  });

  implementations.register("workspace.build_funnel_params", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.buildFunnelParams(
        requireWireKwarg(context, "steps") as ReadonlyArray<
          string | FunnelStep
        >,
        optionsBag<WorkspaceFunnelQueryOptions>(context, ["steps"], true),
      ),
    );
  });

  implementations.register("workspace.query_flow", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.queryFlow(
        requireWireKwarg(context, "event") as
          string | FlowStep | ReadonlyArray<string | FlowStep>,
        optionsBag<WorkspaceFlowQueryOptions>(context, ["event"], true),
      ),
    );
  });

  implementations.register("workspace.build_flow_params", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.buildFlowParams(
        requireWireKwarg(context, "event") as
          string | FlowStep | ReadonlyArray<string | FlowStep>,
        optionsBag<WorkspaceFlowQueryOptions>(context, ["event"], true),
      ),
    );
  });

  implementations.register("workspace.query_retention", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.queryRetention(
        requireWireKwarg(context, "born_event") as string | RetentionEvent,
        requireWireKwarg(context, "return_event") as string | RetentionEvent,
        optionsBag<WorkspaceRetentionQueryOptions>(
          context,
          ["born_event", "return_event"],
          true,
        ),
      ),
    );
  });

  implementations.register(
    "workspace.build_retention_params",
    async (context) => {
      const ws = workspaceFromSession(context);
      return runFacade(codecs, () =>
        ws.buildRetentionParams(
          requireWireKwarg(context, "born_event") as string | RetentionEvent,
          requireWireKwarg(context, "return_event") as string | RetentionEvent,
          optionsBag<WorkspaceRetentionQueryOptions>(
            context,
            ["born_event", "return_event"],
            true,
          ),
        ),
      );
    },
  );

  implementations.register("workspace.query_user", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.queryUser(optionsBag<WorkspaceUserQueryOptions>(context, [], true)),
    );
  });

  implementations.register("workspace.build_user_params", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.buildUserParams(
        optionsBag<WorkspaceUserQueryOptions>(context, [], true),
      ),
    );
  });

  // --- Discovery / lexicon members ---

  implementations.register("workspace.events", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.events(optionsBag<WorkspaceEventsOptions>(context, [])),
    );
  });

  implementations.register("workspace.properties", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.properties(requireWireKwarg(context, "event") as string),
    );
  });

  implementations.register("workspace.property_values", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.propertyValues(
        requireWireKwarg(context, "property_name") as string,
        optionsBag<WorkspacePropertyValuesOptions>(context, ["property_name"]),
      ),
    );
  });

  implementations.register("workspace.subproperties", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.subproperties(
        requireWireKwarg(context, "property_name") as string,
        optionsBag<WorkspaceSubpropertiesOptions>(context, ["property_name"]),
      ),
    );
  });

  implementations.register("workspace.funnels", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () => ws.funnels());
  });

  implementations.register("workspace.cohorts", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () => ws.cohorts());
  });

  implementations.register("workspace.list_bookmarks", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.listBookmarks(
        (context.kwargs["bookmark_type"] ?? null) as BookmarkType | null,
      ),
    );
  });

  implementations.register("workspace.top_events", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.topEvents(optionsBag<WorkspaceTopEventsOptions>(context, [])),
    );
  });

  implementations.register(
    "workspace.clear_discovery_cache",
    async (context) => {
      const ws = workspaceFromSession(context);
      // wire_state: no return contract — replays as setup only.
      await ws.clearDiscoveryCache();
      return null;
    },
  );

  implementations.register("workspace.lexicon_schemas", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.lexiconSchemas(
        optionsBag<WorkspaceLexiconSchemasOptions>(context, []),
      ),
    );
  });

  implementations.register("workspace.lexicon_schema", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.lexiconSchema(
        requireWireKwarg(context, "entity_type") as EntityType,
        requireWireKwarg(context, "name") as string,
      ),
    );
  });

  implementations.register("workspace.schema_graph", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.schemaGraph(optionsBag<WorkspaceSchemaGraphOptions>(context, [])),
    );
  });

  // --- Session-replay members ---

  implementations.register("workspace.list_replays", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.listReplays(optionsBag<WorkspaceListReplaysOptions>(context, [])),
    );
  });

  implementations.register("workspace.events_for_replay", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.eventsForReplay(
        requireWireKwarg(context, "replay_id") as string,
        optionsBag<WorkspaceEventsForReplayOptions>(context, ["replay_id"]),
      ),
    );
  });

  implementations.register("workspace.events_for_replays", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.eventsForReplays(
        requireWireKwarg(context, "replay_ids") as readonly string[],
        optionsBag<WorkspaceEventsForReplayOptions>(context, ["replay_ids"]),
      ),
    );
  });

  implementations.register("workspace.sign_replay", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.signReplay(
        requireWireKwarg(context, "replay_id") as string,
        optionsBag<WorkspaceSignReplayOptions>(context, ["replay_id"]),
      ),
    );
  });

  implementations.register("workspace.sign_replays", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.signReplays(
        requireWireKwarg(context, "replay_ids") as readonly string[],
        optionsBag<WorkspaceSignReplayOptions>(context, ["replay_ids"]),
      ),
    );
  });

  implementations.register("workspace.fetch_replay", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.fetchReplay(
        requireWireKwarg(context, "replay_id") as string,
        optionsBag<WorkspaceFetchReplayOptions>(context, ["replay_id"]),
      ),
    );
  });

  implementations.register("workspace.stream_replay", async (context) => {
    const ws = workspaceFromSession(context);
    // Iterator members replay as their item list (the Python runner's
    // `isinstance(result, Iterator)` branch in `conformance.runner.execute`).
    return runFacade(codecs, async () => {
      const items: unknown[] = [];
      for await (const item of ws.streamReplay(
        requireWireKwarg(context, "replay_id") as string,
        optionsBag<WorkspaceStreamReplayOptions>(context, ["replay_id"]),
      )) {
        items.push(item);
      }
      return items;
    });
  });

  implementations.register("workspace.fetch_replays", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.fetchReplays(
        requireWireKwarg(context, "replay_ids") as readonly string[],
        optionsBag<WorkspaceFetchReplaysOptions>(context, ["replay_ids"]),
      ),
    );
  });

  implementations.register("workspace.replays_for_user", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.replaysForUser(
        requireWireKwarg(context, "distinct_id") as string,
        optionsBag<WorkspaceReplaysForUserOptions>(context, ["distinct_id"]),
      ),
    );
  });

  implementations.register("workspace.analyze_replay", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.analyzeReplay(requireWireKwarg(context, "replay_id") as string),
    );
  });

  // --- Lifecycle, /me and business context ---

  implementations.register("workspace.use", async (context) => {
    const ws = workspaceFromSession(context);
    // wire_state (`conformance.record.registry`): setup-only replay, no
    // return-shape contract — Python returns `self`, which has no
    // vector encoding (the `clear_discovery_cache` precedent).
    return runFacade(codecs, async () => {
      await ws.use(optionsBag<WorkspaceUseOptions>(context, []));
      return null;
    });
  });

  implementations.register("workspace.close", async (context) => {
    const ws = workspaceFromSession(context);
    // wire_state: no return contract (Python returns None anyway).
    return runFacade(codecs, async () => {
      await ws.close();
      return null;
    });
  });

  implementations.register("workspace.list_workspaces", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () => ws.listWorkspaces());
  });

  implementations.register(
    "workspace.resolve_workspace_id",
    async (context) => {
      const ws = workspaceFromSession(context);
      return runFacade(codecs, () => ws.resolveWorkspaceId());
    },
  );

  implementations.register("workspace.me", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.me(optionsBag<WorkspaceMeOptions>(context, [])),
    );
  });

  implementations.register("workspace.projects", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.projects(optionsBag<WorkspaceProjectsOptions>(context, [])),
    );
  });

  implementations.register("workspace.workspaces", async (context) => {
    const ws = workspaceFromSession(context);
    return runFacade(codecs, () =>
      ws.workspaces(optionsBag<WorkspaceWorkspacesOptions>(context, [])),
    );
  });

  implementations.register(
    "workspace.get_business_context",
    async (context) => {
      const ws = workspaceFromSession(context);
      return runFacade(codecs, () =>
        ws.getBusinessContext(
          optionsBag<BusinessContextScopeOptions>(context, []),
        ),
      );
    },
  );

  implementations.register(
    "workspace.set_business_context",
    async (context) => {
      const ws = workspaceFromSession(context);
      return runFacade(codecs, () =>
        ws.setBusinessContext(
          requireWireKwarg(context, "content") as string,
          optionsBag<BusinessContextScopeOptions>(context, ["content"]),
        ),
      );
    },
  );

  implementations.register(
    "workspace.clear_business_context",
    async (context) => {
      const ws = workspaceFromSession(context);
      return runFacade(codecs, () =>
        ws.clearBusinessContext(
          optionsBag<BusinessContextScopeOptions>(context, []),
        ),
      );
    },
  );

  implementations.register(
    "workspace.get_business_context_chain",
    async (context) => {
      const ws = workspaceFromSession(context);
      return runFacade(codecs, () => ws.getBusinessContextChain());
    },
  );
}
