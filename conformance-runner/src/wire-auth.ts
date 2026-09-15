/**
 * Auth wire bindings: `region_probe.probe_region` and
 * `oauth_flow.refresh_tokens`.
 *
 * The runner executes in a Node context, so `refresh_tokens` imports the
 * real `packages/node` `OAuthFlow` exactly as the wire bindings import
 * core. Both bindings call the real exported entry point
 * (`refreshTokens`; `probeRegion` with `probeClientFromFetch`) and never
 * POST, classify statuses or assemble attempts themselves; the
 * return-value walks below are output-codec twins of the recorder's
 * `_encode_common` only (see `wire-client.ts` for the shared honesty
 * rules). The probe's `$type: callback` kwarg is served by the shared
 * `RecordingCallback` stub, and its recorded scheme_host is
 * `https://test.invalid` on every vector (the Python fixture's `_client`
 * base_url). No sleep/random/now seams are needed on the probe path —
 * the timeout is not vector-observable.
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

/** The Python fixture's placeholder base URL (every recorded vector). */
const PROBE_SCHEME_HOST = "https://test.invalid";

/**
 * Rebuild the recorded `client_factory` callback: log the region on the
 * shared stub (diffed against `expect.callback_calls.client_factory`),
 * then hand back the real fetch-backed probe client.
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
 * Register the auth wire bindings.
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
      // Flow construction: region "us" (the recorded scheme_host is
      // `OAUTH_BASE_URLS.us` — no base-URL override), the frozen
      // record-epoch clock (drives the vector-locked Python-isoformat
      // `expires_at` text), and a tmp-dir storage stub that
      // `refreshTokens` never consults.
      const flow = new OAuthFlow({
        region: "us",
        fetchImpl,
        now: () => context.shims.now().getTime(),
        storage: new OAuthStorage({
          storageDir: join(tmpdir(), "b8-n2-refresh-unused"),
        }),
      });
      // Absent `account_name` stays absent (library default).
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
      // snake_case → camelCase kwarg mapping; absent kwargs stay absent
      // so the library defaults apply.
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
