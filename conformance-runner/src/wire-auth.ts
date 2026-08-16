/**
 * B7-A2 wire bindings — the single `region_probe.probe_region` name
 * (14 vectors, `corpus/auth/test_region_probe.jsonl`), registered
 * inline in the shard commit per the P3-2 b′ fable-batch rule
 * (`b7-packets.md` §2.7).
 *
 * Binding honesty (P3-5 §3): the binding calls the REAL exported
 * `probeRegion` with the REAL `probeClientFromFetch` — it never issues
 * fetches itself, never classifies errors itself, never assembles
 * attempts. The `$type: callback` kwarg is served by the shared
 * `RecordingCallback` stub; the recorded scheme_host is
 * `https://test.invalid` on all 14 vectors (mirrors the Python fixture
 * `_client` base_url, `test_region_probe.py:44-47`).
 *
 * Determinism seams: none needed — no sleep/random/now in the probe
 * path (timeout is not vector-observable). NO batch-status flip here:
 * `region_probe.` stays `pending` until the B7 gate (§4) —
 * bound-name-while-pending is the designed B4 pattern.
 */

import type { Region } from "../../packages/core/src/auth/account.js";
import {
  probeClientFromFetch,
  probeRegion,
  type ClientFactory,
} from "../../packages/core/src/auth/region-probe.js";
import { RecordingCallback } from "./codecs.js";
import type { ImplementationRegistry, InvocationContext } from "./runner.js";
import { runWire } from "./wire-client.js";

/** The Python fixture's placeholder base URL (all 14 vectors). */
const PROBE_SCHEME_HOST = "https://test.invalid";

/**
 * Rebuild the recorded `client_factory` callback: log the region on the
 * shared stub (diffed against `expect.callback_calls.client_factory`),
 * then hand back the REAL fetch-backed probe client.
 *
 * @param context - The invocation context (carries the replay fetch).
 * @returns The composed client factory.
 * @throws Error - When the vector carries no callback stub or fetch
 *   (malformed vector — never the library's fault).
 */
function rebuildClientFactory(context: InvocationContext): ClientFactory {
  const stub = context.kwargs["client_factory"];
  if (!(stub instanceof RecordingCallback)) {
    throw new Error(
      "region_probe.probe_region vector is missing the client_factory callback stub",
    );
  }
  const fetchImpl = context.fetch;
  if (fetchImpl === undefined) {
    throw new Error(
      "region_probe.probe_region vector provided no replay fetch harness",
    );
  }
  return (region: Region) => {
    stub.fn(region);
    return probeClientFromFetch(fetchImpl, PROBE_SCHEME_HOST);
  };
}

/**
 * Register the B7-A2 binding (1 name).
 *
 * @param implementations - The registry to extend.
 */
export function registerAuthWireBindings(
  implementations: ImplementationRegistry,
): void {
  implementations.register("region_probe.probe_region", (context) =>
    runWire(async () => {
      const factory = rebuildClientFactory(context);
      const headers = context.kwargs["headers"] as Record<string, string>;
      // Standard snake→camel kwarg mapping (packet §2.7): absent kwargs
      // stay absent so the library defaults apply (R3.5).
      const options: {
        timeoutSeconds?: number;
        order?: readonly Region[];
      } = {};
      if (Object.hasOwn(context.kwargs, "timeout_seconds")) {
        options.timeoutSeconds = context.kwargs["timeout_seconds"] as number;
      }
      if (Object.hasOwn(context.kwargs, "order")) {
        options.order = context.kwargs["order"] as readonly Region[];
      }
      const result = await probeRegion(factory, headers, options);
      // The recorder encodes the RegionProbeResult dataclass as
      // {region, attempts} with attempts as arrays (tuple encoding).
      return {
        region: result.region,
        attempts: result.attempts.map((attempt) => [...attempt]),
      };
    }),
  );
}
