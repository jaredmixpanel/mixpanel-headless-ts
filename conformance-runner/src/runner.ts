/**
 * Vector replay engine: kind dispatch, `call.setup[]` execution, verdicts
 * (design D12, mirroring the Python runner's D7 execution model).
 *
 * Execution per kind:
 * - `builder` / `validation-error`: decode `call.input` through the codec
 *   table, invoke the bound TS implementation, canonicalize the returned
 *   value (or the structured error) and diff against `expect.output` /
 *   `expect.error`.
 * - `wire`: build a {@link createVectorFetch} harness from
 *   `expect.interactions[]`, execute `call.setup[]` entries in order, then
 *   the measured call; diff (a) every captured request against the
 *   recorded sequence (multiset semantics inside `unordered_group`s), (b)
 *   the returned/raised value against `expect.result` / `expect.error`,
 *   and (c) recorded-callback call logs against `expect.callback_calls`.
 * - `parse`: same as wire but only the result side is diffed (D7).
 *
 * Verdict resolution (see `verdicts.ts` for the taxonomy): API names that
 * resolve to no mapping source are `UNMAPPED_API` (fail-fast); mapped or
 * module-known names without a bound TS implementation are `UNPORTED`
 * (counted, never failing) — UNLESS the name's port batch is declared
 * `'done'` in `batch-status.ts`, in which case the missing binding is a
 * straggler and the verdict is `FAIL_ERROR` (R10.5 — no silent skips);
 * request-side divergence is `FAIL_REQUEST`; error-contract divergence is
 * `FAIL_ERROR`; value divergence is `FAIL_OUTPUT` — unless the ONLY
 * divergence is double-rounding of integer tokens above 2^53, which is the
 * distinct `PRECISION_LOSS` verdict (D6).
 */

import { resolveApi } from "./api-map.js";
import {
  BATCH_STATUS,
  type BatchStatus,
  batchStatusFor,
} from "./batch-status.js";
import {
  CanonicalizationError,
  canonicalize,
  canonicalizeError,
} from "./canonical.js";
import {
  type CodecRegistry,
  encodeExpectValue,
  RecordingCallback,
} from "./codecs.js";
import { parseInteractions } from "./interactions.js";
import { isExpectErrorConvertible } from "./internal/guards.js";
import { JsonNumber, type JsonValue } from "./json-value.js";
import { diffRequestTraffic } from "./request-diff.js";
import { createShims, type RunnerShims } from "./shims.js";
import { createVectorFetch } from "./vector-fetch.js";
import type { ConformanceVector, Corpus } from "./vector-types.js";
import type { VectorResult, Verdict } from "./verdicts.js";

/**
 * Everything one entry-point invocation receives from the runner.
 *
 * The `state` map is shared across a vector's `call.setup[]` entries and
 * its measured call, so state-mutating setup calls (`set_workspace_id`,
 * `workspace.use`, ...) can build/configure the client instance the
 * measured call then uses — the D2 replay model re-executes public calls,
 * never snapshots private attributes.
 */
export interface InvocationContext {
  /** The Python dotted api name being invoked. */
  readonly api: string;
  /** Decoded keyword arguments (codec-reconstructed rich values). */
  readonly kwargs: Readonly<Record<string, unknown>>;
  /**
   * The UNDECODED `call.input` values (lossless-loaded, `JsonNumber`
   * tokens intact).
   *
   * Needed where Python-side argument TYPE information survives only in
   * the raw JSON token: `18.0` and `18` both decode to the JS number
   * `18`, but a binding whose Python contract branches on float-vs-int
   * (the D13 `compat.python_str` gate slice) must consult the token.
   */
  readonly rawInput: Readonly<Record<string, JsonValue>>;
  /** Per-vector clock/UUID/virtual-sleep shims (D1.4/D12). */
  readonly shims: RunnerShims;
  /** The injected replay fetch (wire/parse vectors only). */
  readonly fetch?: typeof fetch;
  /** The raw `call.session` object, when recorded (D5.1). */
  readonly session?: JsonValue;
  /** The raw `call.workspace_session` object, when recorded (D5.1). */
  readonly workspaceSession?: JsonValue;
  /**
   * The raw `call.client_options` object, when recorded (schema
   * extension 12 — non-default client constructor kwargs such as
   * `max_retries`; mirror of the Python runner's
   * `execute.py:529` plumb into `make_api_client`).
   */
  readonly clientOptions?: JsonValue;
  /** Mutable per-vector state shared across setup + measured calls. */
  readonly state: Map<string, unknown>;
}

/** A bound TS entry point: invoked with the context, returns the output. */
export type Implementation = (context: InvocationContext) => unknown;

/**
 * The bindings from Python dotted api names to TS implementations.
 *
 * Empty at TS-5 time (no modules with corpus presence are ported); each
 * port batch registers its entry points, flipping those vectors from
 * `UNPORTED` to live replay.
 */
export class ImplementationRegistry {
  /** Bound implementations, keyed by the Python dotted api name. */
  private readonly bindings = new Map<string, Implementation>();

  /**
   * Bind one entry point.
   *
   * @param pythonApi - The Python dotted name exactly as vectors carry it.
   * @param implementation - The invoker.
   * @throws Error - On duplicate registration (a batch wiring bug).
   */
  register(pythonApi: string, implementation: Implementation): void {
    if (this.bindings.has(pythonApi)) {
      throw new Error(
        `duplicate implementation binding for ${JSON.stringify(pythonApi)}`,
      );
    }
    this.bindings.set(pythonApi, implementation);
  }

  /**
   * Whether an api name has a binding.
   *
   * @param pythonApi - The Python dotted name.
   * @returns `true` when bound.
   */
  has(pythonApi: string): boolean {
    return this.bindings.has(pythonApi);
  }

  /**
   * Look up a binding.
   *
   * @param pythonApi - The Python dotted name.
   * @returns The implementation, or `undefined` when unbound.
   */
  get(pythonApi: string): Implementation | undefined {
    return this.bindings.get(pythonApi);
  }
}

/** Dependencies for {@link runVector} / {@link runCorpus}. */
export interface RunnerDeps {
  /** The api-name → TS-implementation bindings. */
  readonly implementations: ImplementationRegistry;
  /** The `$type` codec table (rich tags registered per port batch). */
  readonly codecs: CodecRegistry;
  /** The frozen record instant (corpus manifest `record_epoch`). */
  readonly recordEpoch: string;
  /**
   * The api-prefix → batch-status table (defaults to the shipped
   * {@link BATCH_STATUS}). Injectable so tests can exercise the
   * `UNPORTED` gate path with a SYNTHETIC pending table now that the
   * shipped table is terminal — zero pending entries after the B8 gate
   * flip (b8-packets.md §5.3 UNPORTED-probe re-anchor).
   */
  readonly batchStatuses?: ReadonlyMap<string, BatchStatus>;
}

/**
 * Derive a vector's capability (explicit field, else its id prefix).
 *
 * @param vector - The vector.
 * @returns The capability directory name.
 */
export function vectorCapability(vector: ConformanceVector): string {
  if (vector.capability !== undefined) {
    return vector.capability;
  }
  const slash = vector.id.indexOf("/");
  return slash > 0 ? vector.id.slice(0, slash) : vector.id;
}

/**
 * Replace every unsafe integer token (|value| > 2^53) with its
 * double-rounded native number.
 *
 * Used by the `PRECISION_LOSS` check: when re-canonicalizing the expected
 * value after this rounding makes it equal to the live output, the ONLY
 * divergence was precision (D6).
 *
 * @param value - The expected value tree (lossless-loaded).
 * @returns The rounded tree and whether any unsafe token was found.
 */
function roundUnsafeIntegers(value: JsonValue): {
  rounded: JsonValue;
  found: boolean;
} {
  if (value instanceof JsonNumber) {
    if (value.isUnsafeInteger()) {
      return { rounded: value.toNumber(), found: true };
    }
    return { rounded: value, found: false };
  }
  if (Array.isArray(value)) {
    let found = false;
    const rounded = value.map((item) => {
      const result = roundUnsafeIntegers(item);
      found ||= result.found;
      return result.rounded;
    });
    return { rounded, found };
  }
  if (typeof value === "object" && value !== null) {
    let found = false;
    const rounded: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
      const result = roundUnsafeIntegers(item);
      found ||= result.found;
      rounded[key] = result.rounded;
    }
    return { rounded, found };
  }
  return { rounded: value, found: false };
}

/**
 * Diff a returned value against an expected value tree.
 *
 * @param returned - The live TS return value.
 * @param expected - The vector's `expect.output` / `expect.result`.
 * @returns `null` on a match, else the failing verdict and diff text
 *   (`FAIL_OUTPUT`, or `PRECISION_LOSS` when rounding unsafe integer
 *   tokens in `expected` fully explains the divergence).
 */
function diffReturnedValue(
  returned: unknown,
  expected: JsonValue,
): { verdict: Verdict; diff: string } | null {
  const actualCanonical = canonicalize(encodeExpectValue(returned));
  const expectedCanonical = canonicalize(expected);
  if (actualCanonical === expectedCanonical) {
    return null;
  }
  const { rounded, found } = roundUnsafeIntegers(expected);
  if (found && canonicalize(rounded) === actualCanonical) {
    return {
      verdict: "PRECISION_LOSS",
      diff:
        `output matches only after rounding >2^53 integer tokens: ` +
        `expected ${expectedCanonical}`,
    };
  }
  return {
    verdict: "FAIL_OUTPUT",
    diff: `output ${actualCanonical} != expected ${expectedCanonical}`,
  };
}

/**
 * Diff recorded-callback call logs against `expect.callback_calls` (D4.4).
 *
 * @param kwargs - The measured call's decoded kwargs (recording stubs
 *   in place of `$type: callback` values).
 * @param callbackCalls - The raw `expect.callback_calls` object, if any.
 * @returns Divergence strings (empty when all logs match).
 */
function diffCallbackCalls(
  kwargs: Readonly<Record<string, unknown>>,
  callbackCalls: JsonValue | undefined,
): string[] {
  const problems: string[] = [];
  const expectedMap: Record<string, JsonValue> =
    typeof callbackCalls === "object" &&
    callbackCalls !== null &&
    !Array.isArray(callbackCalls) &&
    !(callbackCalls instanceof JsonNumber)
      ? callbackCalls
      : {};
  const stubs = new Map<string, RecordingCallback>();
  for (const value of Object.values(kwargs)) {
    if (value instanceof RecordingCallback) {
      stubs.set(value.name, value);
    }
  }
  const names = new Set([...stubs.keys(), ...Object.keys(expectedMap)]);
  for (const name of names) {
    const stub = stubs.get(name);
    const actual: JsonValue = stub === undefined ? [] : stub.calls;
    const expected: JsonValue = expectedMap[name] ?? [];
    const actualCanonical = canonicalize(actual);
    const expectedCanonical = canonicalize(expected);
    if (actualCanonical !== expectedCanonical) {
      problems.push(
        `callback ${JSON.stringify(name)} call log ${actualCanonical} != expected ${expectedCanonical}`,
      );
    }
  }
  return problems;
}

/**
 * Diff a thrown error against `expect.error` (R5.2/R5.4, D6 rule 6).
 *
 * @param thrown - The thrown value.
 * @param expectedError - The vector's `expect.error` object.
 * @returns `null` on a match, else the diff text.
 */
function diffThrownError(
  thrown: unknown,
  expectedError: JsonValue,
): string | null {
  if (!isExpectErrorConvertible(thrown)) {
    return `raised a non-conformance error: ${String(thrown)}`;
  }
  const actualCanonical = canonicalizeError(thrown.toExpectError());
  const expectedCanonical = canonicalizeError(expectedError);
  if (actualCanonical !== expectedCanonical) {
    return `error ${actualCanonical} != expected ${expectedCanonical}`;
  }
  return null;
}

/**
 * The verdict for a mapped api name that has no bound implementation.
 *
 * Consults the declarative batch table (`batch-status.ts`): a name whose
 * port batch is declared `'done'` is a straggler and FAILS — `UNPORTED`
 * is only admissible while the batch is `'pending'` (R10.5, phase2-design
 * C7 item 4).
 *
 * @param api - The unbound Python dotted api name.
 * @param statuses - The batch-status table (shipped table by default;
 *   injectable via {@link RunnerDeps.batchStatuses} for the synthetic
 *   pending-table tests — the shipped table is terminal post-B8).
 * @returns The short-circuit gate result.
 */
function unboundVerdict(
  api: string,
  statuses: ReadonlyMap<string, BatchStatus>,
): { verdict: Verdict; diff?: string } {
  if (batchStatusFor(api, statuses) === "done") {
    return {
      verdict: "FAIL_ERROR",
      diff:
        `api ${JSON.stringify(api)} has no bound implementation but its ` +
        `batch is declared done (batch-status.ts, R10.5)`,
    };
  }
  return { verdict: "UNPORTED" };
}

/**
 * Resolve the replay verdict gate for a vector's api names (measured +
 * every setup entry).
 *
 * @param vector - The vector.
 * @param implementations - The current bindings.
 * @param statuses - The batch-status table (see {@link unboundVerdict}).
 * @returns `null` when every name is bound (replay proceeds), else the
 *   short-circuit result (`UNMAPPED_API` fail-fast before the unbound
 *   gate, which yields `UNPORTED` for pending batches and `FAIL_ERROR`
 *   for declared-done batches — see {@link unboundVerdict}).
 */
function gateApis(
  vector: ConformanceVector,
  implementations: ImplementationRegistry,
  statuses: ReadonlyMap<string, BatchStatus>,
): { verdict: Verdict; diff?: string } | null {
  const apis = [...vector.setup.map((entry) => entry.api), vector.api];
  for (const api of apis) {
    if (resolveApi(api).status === "unmapped") {
      return {
        verdict: "UNMAPPED_API",
        diff: `api ${JSON.stringify(api)} is in no mapping source (naming-map §4)`,
      };
    }
  }
  for (const api of apis) {
    if (!implementations.has(api)) {
      return unboundVerdict(api, statuses);
    }
  }
  return null;
}

/**
 * Replay one vector and produce its verdict (design D12).
 *
 * @param vector - The loaded vector.
 * @param deps - Implementations, codecs, and the record epoch.
 * @returns The vector result; never throws — infrastructure failures
 *   (codec gaps, malformed interactions, canonicalization violations)
 *   surface as `FAIL_ERROR` with a `runner:`-prefixed diff.
 * @example
 * ```typescript
 * const result = await runVector(vector, deps);
 * // { id: vector.id, capability: "compat", verdict: "PASS" }
 * ```
 */
export async function runVector(
  vector: ConformanceVector,
  deps: RunnerDeps,
): Promise<VectorResult> {
  const capability = vectorCapability(vector);
  const gated = gateApis(
    vector,
    deps.implementations,
    deps.batchStatuses ?? BATCH_STATUS,
  );
  if (gated !== null) {
    return {
      id: vector.id,
      capability,
      verdict: gated.verdict,
      ...(gated.diff === undefined ? {} : { diff: gated.diff }),
    };
  }
  try {
    return await replayVector(vector, capability, deps);
  } catch (error) {
    return {
      id: vector.id,
      capability,
      verdict: "FAIL_ERROR",
      diff: `runner: ${String(error)}`,
    };
  }
}

/**
 * The post-gate replay body of {@link runVector}.
 *
 * @param vector - The loaded vector.
 * @param capability - The precomputed capability.
 * @param deps - Runner dependencies.
 * @returns The vector result.
 * @throws Error - Infrastructure failures (caught by {@link runVector}).
 */
// eslint-disable-next-line complexity, max-lines-per-function -- branch-for-branch port of one Python function (see the docblock); splitting it would scatter the guard order the corpus pins
async function replayVector(
  vector: ConformanceVector,
  capability: string,
  deps: RunnerDeps,
): Promise<VectorResult> {
  const isWireLike = vector.kind === "wire" || vector.kind === "parse";
  const shims = createShims(deps.recordEpoch);
  const state = new Map<string, unknown>();
  const interactions = isWireLike
    ? parseInteractions(vector.expect["interactions"], vector.id)
    : [];
  const harness = isWireLike ? createVectorFetch(interactions) : undefined;

  const contextFor = (
    api: string,
    callKwargs: Record<string, unknown>,
    rawInput: Readonly<Record<string, JsonValue>>,
  ): InvocationContext => ({
    api,
    kwargs: callKwargs,
    rawInput,
    shims,
    ...(harness === undefined ? {} : { fetch: harness.fetch }),
    ...(vector.call["session"] === undefined
      ? {}
      : { session: vector.call["session"] }),
    ...(vector.call["workspace_session"] === undefined
      ? {}
      : { workspaceSession: vector.call["workspace_session"] }),
    ...(vector.call["client_options"] === undefined
      ? {}
      : { clientOptions: vector.call["client_options"] }),
    state,
  });

  const fail = (verdict: Verdict, diff: string): VectorResult => ({
    id: vector.id,
    capability,
    verdict,
    diff,
  });

  // Execute call.setup[] in order (D2): state mutators and prerequisite
  // calls whose transport traffic is part of expect.interactions[].
  for (const entry of vector.setup) {
    const setupImplementation = deps.implementations.get(entry.api);
    if (setupImplementation === undefined) {
      // Defensive: gateApis already short-circuited unbound names.
      const gated = unboundVerdict(
        entry.api,
        deps.batchStatuses ?? BATCH_STATUS,
      );
      return {
        id: vector.id,
        capability,
        verdict: gated.verdict,
        ...(gated.diff === undefined ? {} : { diff: gated.diff }),
      };
    }
    const setupKwargs = deps.codecs.decodeInputKwargs(entry.input);
    try {
      await setupImplementation(
        contextFor(entry.api, setupKwargs, entry.input),
      );
    } catch {
      // Setup returns/raises are NOT diffed (design D2 logged
      // limitation, Python runner execute.py:532-541): earlier test
      // calls may have raised under pytest.raises at record time too.
      // Their request sides stay fully diffed via interactions[];
      // divergence surfaces there (found by the first B4-C2 replay —
      // a recorded 400 on a get_event_properties SETUP call).
      continue;
    }
  }

  // The measured call.
  const implementation = deps.implementations.get(vector.api) as Implementation;
  const kwargs = deps.codecs.decodeInputKwargs(vector.input);
  let returned: unknown;
  let thrown: unknown;
  let didThrow = false;
  try {
    returned = await implementation(
      contextFor(vector.api, kwargs, vector.input),
    );
  } catch (error) {
    thrown = error;
    didThrow = true;
  }

  // (a) Request-side diff — wire only; parse vectors diff the result only
  // (D7: their request side is a fixed synthetic GET).
  if (vector.kind === "wire" && harness !== undefined) {
    const problems = diffRequestTraffic(
      interactions,
      harness.captures,
      harness.violations,
      harness.unservedSlots(),
    );
    if (problems.length > 0) {
      return fail("FAIL_REQUEST", problems.join("; "));
    }
  }

  // (b) Result / error diff.
  const hasError = Object.hasOwn(vector.expect, "error");
  const expectedValueKey =
    vector.kind === "builder" || vector.kind === "validation-error"
      ? "output"
      : "result";
  const hasValue = Object.hasOwn(vector.expect, expectedValueKey);
  if (didThrow) {
    if (!hasError) {
      const rendered = isExpectErrorConvertible(thrown)
        ? canonicalizeError(thrown.toExpectError())
        : String(thrown);
      return fail("FAIL_ERROR", `unexpected raise: ${rendered}`);
    }
    const errorDiff = diffThrownError(
      thrown,
      vector.expect["error"] as JsonValue,
    );
    if (errorDiff !== null) {
      return fail("FAIL_ERROR", errorDiff);
    }
  } else {
    if (hasError) {
      return fail(
        "FAIL_ERROR",
        `expected raise ${canonicalizeError(vector.expect["error"] as JsonValue)} but the call returned`,
      );
    }
    if (hasValue) {
      let valueDiff: { verdict: Verdict; diff: string } | null;
      try {
        valueDiff = diffReturnedValue(
          returned,
          vector.expect[expectedValueKey] as JsonValue,
        );
      } catch (error) {
        if (error instanceof CanonicalizationError) {
          return fail(
            "FAIL_OUTPUT",
            `output not canonicalizable: ${error.message}`,
          );
        }
        throw error;
      }
      if (valueDiff !== null) {
        return fail(valueDiff.verdict, valueDiff.diff);
      }
    }
  }

  // (c) Recorded-callback call logs (D4.4).
  const callbackProblems = diffCallbackCalls(
    kwargs,
    vector.expect["callback_calls"],
  );
  if (callbackProblems.length > 0) {
    return fail("FAIL_OUTPUT", callbackProblems.join("; "));
  }

  return { id: vector.id, capability, verdict: "PASS" };
}

/**
 * Replay every corpus vector, optionally filtered by id substring.
 *
 * @param corpus - The loaded corpus snapshot.
 * @param deps - Runner dependencies.
 * @param filter - Optional id filter: vectors whose id includes this
 *   substring are replayed (mirror of the Python CLI's `--filter`).
 * @returns Per-vector results in corpus order.
 * @example
 * ```typescript
 * const results = await runCorpus(corpus, deps, "compat/");
 * ```
 */
export async function runCorpus(
  corpus: Corpus,
  deps: RunnerDeps,
  filter?: string,
): Promise<VectorResult[]> {
  const results: VectorResult[] = [];
  for (const vector of corpus.vectors) {
    if (filter !== undefined && !vector.id.includes(filter)) {
      continue;
    }
    results.push(await runVector(vector, deps));
  }
  return results;
}
