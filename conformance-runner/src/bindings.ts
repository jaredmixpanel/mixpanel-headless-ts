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
import { CONTRACT_TAG_CODECS } from "../../packages/core/src/types/vector-codecs.js";
import { CodecRegistry, UndecodableValueError } from "./codecs.js";
import type { JsonValue } from "./json-value.js";
import { JsonNumber } from "./json-value.js";
import type { InvocationContext, RunnerDeps } from "./runner.js";
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
  return { implementations, codecs, recordEpoch };
}
