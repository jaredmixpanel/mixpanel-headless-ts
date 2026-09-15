/**
 * Auth wire bindings:
 *
 * - B7-A2: the `region_probe.probe_region` name (14 vectors,
 *   `corpus/auth/test_region_probe.jsonl`), registered inline in the
 *   shard commit per the P3-2 b′ fable-batch rule (`b7-packets.md`
 *   §2.7).
 * - B8-N2: the `oauth_flow.refresh_tokens` name (7 vectors,
 *   `corpus/auth/test_auth_flow.jsonl` — THE LAST pending corpus api;
 *   b8-packets.md §3.4). The runner executes in a node context, so the
 *   binding imports the REAL `packages/node` `OAuthFlow` exactly as
 *   wire bindings import core. Binding honesty (P3-5 §3): it calls the
 *   real exported `refreshTokens` — it never POSTs, never classifies
 *   statuses, never builds form bodies; the return-value walk below is
 *   the recorder's `_encode_common` output-codec twin only. NO
 *   batch-status flip here: `oauth_flow.` stays `pending` until the B8
 *   gate (bound-while-pending, the designed B4 pattern).
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

import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type ClientFactory,
  MixpanelHeadlessError,
  OAuthTokens,
  probeRegion,
  type Region,
} from "@mixpanel-headless/core";
import { probeClientFromFetch } from "@mixpanel-headless/core/internal";
import { OAuthFlow, OAuthStorage } from "@mixpanel-headless/node";

import { PyDatetime, RecordingCallback } from "./codecs.js";
import type { ImplementationRegistry, InvocationContext } from "./runner.js";
import { runWire, WireCoreError } from "./wire-client.js";

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
 * Register the auth wire bindings (2 names).
 *
 * @param implementations - The registry to extend.
 */
export function registerAuthWireBindings(
  implementations: ImplementationRegistry,
): void {
  implementations.register(
    "oauth_flow.refresh_tokens",
    async (context: InvocationContext) => {
      const fetchImpl = context.fetch;
      if (fetchImpl === undefined) {
        throw new Error(
          "oauth_flow.refresh_tokens vector provided no replay fetch harness",
        );
      }
      const tokens = context.kwargs["tokens"];
      if (!(tokens instanceof OAuthTokens)) {
        throw new Error(
          "oauth_flow.refresh_tokens vector is missing the $type:OAuthTokens kwarg",
        );
      }
      const clientId = context.kwargs["client_id"] as string;
      // Construction per packet §3.4: region "us" (the recorded
      // scheme_host is OAUTH_BASE_URLS.us — no base-URL override),
      // frozen record-epoch clock (D1.4; drives the vector-locked
      // Python-isoformat `expires_at` text), and a tmp-dir storage stub
      // that refresh_tokens never consults.
      const flow = new OAuthFlow({
        region: "us",
        fetchImpl,
        now: () => context.shims.now().getTime(),
        storage: new OAuthStorage({
          storageDir: join(tmpdir(), "b8-n2-refresh-unused"),
        }),
      });
      // Absent `account_name` stays absent (library default, R3.5).
      const options = Object.hasOwn(context.kwargs, "account_name")
        ? { accountName: context.kwargs["account_name"] as string }
        : {};
      try {
        const result = await flow.refreshTokens(tokens, clientId, options);
        // Output-codec twin of the recorder's `_encode_common` walk:
        // every declared field under its Python name; Secret /
        // datetime leaves stay rich for `encodeExpectValue`.
        return {
          access_token: result.access_token,
          refresh_token: result.refresh_token,
          expires_at: new PyDatetime(result.expires_at),
          scope: result.scope,
          token_type: result.token_type,
        };
      } catch (error) {
        if (error instanceof MixpanelHeadlessError) {
          throw new WireCoreError(error);
        }
        throw error;
      }
    },
  );
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
