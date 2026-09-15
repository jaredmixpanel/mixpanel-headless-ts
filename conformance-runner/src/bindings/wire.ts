/**
 * The replay-pipeline gate bindings: `wirestub.*` over the stateless
 * {@link WireStubClient} test double, and the shared-client-internal
 * `api_client._iter_jsonl_lines` over the authored chunk vectors.
 */

import { iterJsonlLines } from "@mixpanel-headless/core/internal";

import {
  isArrayOf,
  isInstanceOf,
  isPlainObject,
  isString,
} from "../internal/guards.js";
import { kwarg, optionalKwargAs, requireFetch } from "../internal/kwargs.js";
import type { ImplementationRegistry } from "../runner.js";
import { WireStubClient, type WireStubRequestOptions } from "../wirestub.js";
import { type BindingTable, registerTable } from "./shared.js";

/**
 * Convert one decoded `wirestub.*` request kwarg set into client options.
 *
 * Maps the Python keyword spellings (`params`/`headers`/`json_body`) onto
 * {@link WireStubRequestOptions}; absent kwargs stay absent (omitting
 * `params` entirely is the `params_absent` case under test).
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
 * The `wirestub.*` table. Each invocation builds a fresh
 * {@link WireStubClient} over the vector's injected fetch — the stub is
 * stateless by design; only the replay pipeline itself is under test.
 */
const WIRE_STUB_BINDINGS: BindingTable = [
  [
    "wirestub.request",
    async (context) =>
      new WireStubClient({ fetch: requireFetch(context) }).request(
        kwarg(context, "method", isString, "str"),
        kwarg(context, "path", isString, "str"),
        toRequestOptions(context.kwargs),
      ),
  ],
  [
    "wirestub.request_sequence",
    async (context) =>
      new WireStubClient({ fetch: requireFetch(context) }).requestSequence(
        kwarg(context, "requests", isArrayOf(isPlainObject), "list[dict]").map(
          (entry) => ({
            method: entry["method"] as string,
            path: entry["path"] as string,
            options: toRequestOptions(entry),
          }),
        ),
      ),
  ],
  [
    "wirestub.stream_chunks",
    async (context) => {
      const headers = optionalKwargAs<Readonly<Record<string, string>> | null>(
        context,
        "headers",
      );
      return new WireStubClient({ fetch: requireFetch(context) }).streamChunks(
        kwarg(context, "method", isString, "str"),
        kwarg(context, "path", isString, "str"),
        headers === undefined || headers === null ? {} : { headers },
      );
    },
  ],
];

/**
 * The `api_client._iter_jsonl_lines` binding — mirrors the Python
 * recorder adapter (`conformance.record.adapters.iter_jsonl_lines`):
 * rebuild a boundary-preserving byte stream from the explicit chunks —
 * decompressing when the vector's response headers say
 * `content-encoding: gzip`, exactly as httpx decodes before
 * `iter_bytes()` — and collect the lines the REAL `iterJsonlLines`
 * yields (the library entry point does all the work; the binding only
 * adds the transport shape).
 */
const CLIENT_INTERNALS_BINDINGS: BindingTable = [
  [
    "api_client._iter_jsonl_lines",
    async (context) => {
      const chunks = kwarg(
        context,
        "chunks",
        isArrayOf(isInstanceOf(Uint8Array)),
        "list[bytes]",
      );
      const headers =
        optionalKwargAs<Readonly<Record<string, string>> | null>(
          context,
          "headers",
        ) ?? {};
      const contentEncoding = Object.entries(headers).find(
        ([name]) => name.toLowerCase() === "content-encoding",
      )?.[1];
      const chunkStream = (): ReadableStream<Uint8Array> =>
        new ReadableStream<Uint8Array>({
          start(controller): void {
            for (const chunk of chunks) {
              controller.enqueue(chunk);
            }
            controller.close();
          },
        });
      const source: AsyncIterable<Uint8Array> =
        contentEncoding?.toLowerCase() === "gzip"
          ? // Transport-layer decompression (httpx does this inside the
            // response; fetch runtimes do it inside the body stream).
            chunkStream().pipeThrough(
              // Platform-typing shim: @types/node's DecompressionStream is
              // not declared as a ReadableWritablePair; the runtime object
              // is one.
              new DecompressionStream(
                "gzip",
              ) as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
            )
          : chunkStream();
      const lines: string[] = [];
      for await (const line of iterJsonlLines(source)) {
        lines.push(line);
      }
      return lines;
    },
  ],
];

/**
 * Register the `wirestub.*` gate bindings.
 *
 * @param implementations - The registry to extend.
 */
export function registerWireStubBindings(
  implementations: ImplementationRegistry,
): void {
  registerTable(implementations, WIRE_STUB_BINDINGS);
}

/**
 * Register the shared-client-internal binding.
 *
 * @param implementations - The registry to extend.
 */
export function registerClientInternalsBindings(
  implementations: ImplementationRegistry,
): void {
  registerTable(implementations, CLIENT_INTERNALS_BINDINGS);
}
