/**
 * B5 (b′) binding module — the replays family (b5-packets.md §6.3):
 * five `replays.*` wire names bound to a REAL `ReplaysService` over the
 * shared vector client + the harness fetch as the CDN seam (mirroring
 * `conformance/runner/targets.py::make_replays_service`), and the four
 * builder names (`replay_labels.*` ×3 + `rrweb_analyzer.analyze`) bound
 * to the real public helpers — the oracle-servable subset.
 *
 * Binding honesty (P3-5 rule 3): every wire binding calls the service
 * method by name; `selector_label_fn` mirrors the recorder's flattening
 * adapter (`conformance/record/adapters.py:65-87` — `(attr, action) →
 * label`, the closure applied immediately); `rrweb_analyzer.analyze`
 * mirrors `adapters.py::analyze_rrweb` (`RrwebAnalyzer().analyze`).
 */

import {
  defaultLabelFn,
  MixpanelHeadlessError,
  pythonFloatStr,
  selectorLabelFn,
  type SignedReplay,
  urlNormalizer,
  type UserAction,
} from "@mixpanel-headless/core";
import {
  type DiscoverOptions,
  type EventsForOptions,
  ReplaysService,
  RrwebAnalyzer,
  type WalkCdnOptions,
} from "@mixpanel-headless/core/internal";

import { type CodecRegistry, PyFloat } from "../codecs.js";
import { JsonNumber, type JsonValue } from "../json-value.js";
import type { ImplementationRegistry, InvocationContext } from "../runner.js";
import { requireWireKwarg, WireCoreError } from "../wire-client.js";
import { clientForContext, encodeFacadeValue } from "../wire-workspace.js";

/**
 * A replays-path core error with the recorder's float-detail spelling:
 * `signed_at` / `expired_at` details are Python `float`s
 * (`time.time()` at `replays.py:207` and `+300` arithmetic at
 * `_build_expired_error`), so the recorded `details_contain` carries
 * raw float tokens (`1716810000.0`) that the base encoding's native
 * numbers would miss.
 */
class ReplaysWireError extends WireCoreError {
  /**
   * Encode with the float-typed detail keys re-tokenized.
   *
   * @returns The `expect.error` encoding with `signed_at`/`expired_at`
   *   rendered as raw float tokens when they are finite numbers.
   */
  override toExpectError(): JsonValue {
    const encoded = super.toExpectError();
    if (
      typeof encoded === "object" &&
      encoded !== null &&
      !Array.isArray(encoded) &&
      !(encoded instanceof JsonNumber)
    ) {
      const details = (encoded as Record<string, JsonValue>)["details_contain"];
      if (
        typeof details === "object" &&
        details !== null &&
        !Array.isArray(details) &&
        !(details instanceof JsonNumber)
      ) {
        const record = details as Record<string, JsonValue>;
        for (const key of ["signed_at", "expired_at"]) {
          const value = record[key];
          if (typeof value === "number" && Number.isFinite(value)) {
            record[key] = new JsonNumber(pythonFloatStr(value));
          }
        }
      }
    }
    return encoded;
  }
}

/**
 * Construct the replay `ReplaysService` for one call — the
 * `targets.py::make_replays_service` twin (a FRESH service per call,
 * exactly like the Python dispatch at `execute.py:484-486`; the CLIENT
 * stays the vector-shared instance). The CDN seam is the vector
 * harness fetch (R2.4/R6.4); the `time.time()` seam is the frozen
 * shims clock (the Python runner freezes it via freezegun, D1.4).
 *
 * @param context - The invocation context.
 * @returns The service with both seams bound.
 * @throws Error - When invoked without a fetch (replays.* vectors are
 *   wire-kind by construction).
 */
function replaysServiceFor(context: InvocationContext): ReplaysService {
  if (context.fetch === undefined) {
    throw new Error(
      `${context.api}: replays wire binding invoked without an injected fetch`,
    );
  }
  return new ReplaysService(clientForContext(context), {
    fetchImpl: context.fetch,
    now: (): number => context.shims.now().getTime() / 1000,
  });
}

/**
 * Invoke a replays service method, encode the result, and wrap coded
 * library errors with the float-detail twin.
 *
 * @param codecs - The codec registry.
 * @param invoke - Thunk performing the real service call.
 * @returns The expect-encoded result.
 * @throws ReplaysWireError - When the call raises a core exception.
 * @throws unknown - Anything else, unchanged.
 */
async function runReplays(
  codecs: CodecRegistry,
  invoke: () => Promise<unknown>,
): Promise<JsonValue> {
  try {
    return encodeFacadeValue(codecs, await invoke());
  } catch (error) {
    if (error instanceof MixpanelHeadlessError) {
      throw new ReplaysWireError(error);
    }
    throw error;
  }
}

/**
 * Build the `WalkCdnOptions` bag from the Python kwarg spellings
 * (`retention_days` required; `max_files`/`concurrency`/
 * `re_sign_on_expiry` optional — absent stays absent, R3.5).
 *
 * @param context - The invocation context.
 * @returns The camelCase options bag.
 */
function walkOptions(context: InvocationContext): WalkCdnOptions {
  const maxFiles = context.kwargs["max_files"];
  const concurrency = context.kwargs["concurrency"];
  const reSign = context.kwargs["re_sign_on_expiry"];
  return {
    retentionDays: requireWireKwarg(context, "retention_days") as number,
    ...(maxFiles === undefined ? {} : { maxFiles: maxFiles as number }),
    ...(concurrency === undefined
      ? {}
      : { concurrency: concurrency as number }),
    ...(reSign === undefined ? {} : { reSignOnExpiry: reSign as boolean }),
  };
}

/**
 * Register the replays-family bindings (b5-packets.md §6.3): the five
 * registered `replays.*` wire names (only `fetch_files` has vectors at
 * this pin — the rest bind for the straggler ratchet) plus the four
 * oracle-servable builder names.
 *
 * @param implementations - The registry to extend.
 * @param codecs - The codec registry (rich inputs + output encoding).
 */
export function registerReplaysBindings(
  implementations: ImplementationRegistry,
  codecs: CodecRegistry,
): void {
  implementations.register("replays.sign", async (context) => {
    const service = replaysServiceFor(context);
    const env = context.kwargs["env"];
    return runReplays(codecs, () =>
      service.sign(
        requireWireKwarg(context, "replay_ids") as readonly string[],
        ...(env === undefined ? [] : [env as "prod" | "dev"]),
      ),
    );
  });

  implementations.register("replays.fetch_files", async (context) => {
    const service = replaysServiceFor(context);
    return runReplays(codecs, () =>
      service.fetchFiles(
        requireWireKwarg(context, "signed") as SignedReplay,
        walkOptions(context),
      ),
    );
  });

  implementations.register("replays.walk_cdn_async", async (context) => {
    const service = replaysServiceFor(context);
    // Generator members replay as their item list (the Python runner's
    // `isinstance(result, Iterator)` branch, `execute.py:553-555`).
    return runReplays(codecs, async () => {
      const items: unknown[] = [];
      for await (const item of service.walkCdnAsync(
        requireWireKwarg(context, "signed") as SignedReplay,
        walkOptions(context),
      )) {
        items.push(item);
      }
      return items;
    });
  });

  implementations.register("replays.discover", async (context) => {
    const service = replaysServiceFor(context);
    const distinctId = context.kwargs["distinct_id"];
    const replayIds = context.kwargs["replay_ids"];
    const fromDate = context.kwargs["from_date"];
    const toDate = context.kwargs["to_date"];
    const limit = context.kwargs["limit"];
    const options: DiscoverOptions = {
      ...(distinctId === undefined
        ? {}
        : { distinctId: distinctId as string | null }),
      ...(replayIds === undefined
        ? {}
        : { replayIds: replayIds as readonly string[] | null }),
      ...(fromDate === undefined
        ? {}
        : { fromDate: fromDate as string | null }),
      ...(toDate === undefined ? {} : { toDate: toDate as string | null }),
      ...(limit === undefined ? {} : { limit: limit as number }),
    };
    // targets.py::make_replays_service binds NO query_fn — `discover`
    // replays the RuntimeError-twin branch unless a future recorder
    // change adopts one; port that construction verbatim.
    return runReplays(codecs, () => service.discover(options));
  });

  implementations.register("replays.events_for", async (context) => {
    const service = replaysServiceFor(context);
    const eventProperties = context.kwargs["event_properties"];
    const fromDate = context.kwargs["from_date"];
    const toDate = context.kwargs["to_date"];
    const options: EventsForOptions = {
      ...(eventProperties === undefined
        ? {}
        : { eventProperties: eventProperties as readonly string[] | null }),
      ...(fromDate === undefined
        ? {}
        : { fromDate: fromDate as string | null }),
      ...(toDate === undefined ? {} : { toDate: toDate as string | null }),
    };
    return runReplays(codecs, () =>
      service.eventsFor(
        requireWireKwarg(context, "replay_ids") as readonly string[],
        options,
      ),
    );
  });

  // -------------------------------------------------------------------
  // Builder names (oracle-servable — the §7.3 probe subset). Coded
  // library errors wrap as {@link WireCoreError} so the oracle/runner
  // error diff sees `{class, code}` — a raw `MixpanelHeadlessError`
  // would encode as bare class only (the UA1 constructor guards inside
  // the analyzer are reachable from these entry points).
  // -------------------------------------------------------------------

  implementations.register("replay_labels.url_normalizer", (context) =>
    runBuilder(() => urlNormalizer(requireWireKwarg(context, "url") as string)),
  );

  implementations.register("replay_labels.default_label_fn", (context) =>
    runBuilder(() =>
      defaultLabelFn(requireWireKwarg(context, "action") as UserAction),
    ),
  );

  implementations.register("replay_labels.selector_label_fn", (context) =>
    // The recorder flattens the closure factory to `(attr, action) →
    // label` (`adapters.py:65-87`); the binding mirrors that adapter
    // over the REAL public factory.
    runBuilder(() =>
      selectorLabelFn(requireWireKwarg(context, "attr") as string)(
        requireWireKwarg(context, "action") as UserAction,
      ),
    ),
  );

  implementations.register("rrweb_analyzer.analyze", (context) => {
    // adapters.py::analyze_rrweb twin: RrwebAnalyzer().analyze(events),
    // AnalyzerResult encoded to its plain to-dict shape. The events
    // tree is Python-side plain `json.loads` data — the oracle's
    // integral-float input re-tag (executeBound `tagIntegralFloatTokens`,
    // a fidelity mechanism for CARRIER-AWARE modules) is unwound back to
    // natives here, matching the runner's own decode of the recorded
    // rrweb-seed vectors (raw tokens → native numbers). Behaviorally
    // safe: the analyzer consumes timestamps through the CPython `int()`
    // ladder and never stringifies non-str payload members (S3 R10.9
    // record, 520 cases).
    const events = unwrapCarriersDeep(
      requireWireKwarg(context, "events"),
    ) as ReadonlyArray<Record<string, unknown>>;
    return runBuilder(() =>
      encodeFacadeValue(codecs, new RrwebAnalyzer().analyze(events)),
    );
  });
}

/**
 * Recursively replace decoded `PyFloat` carriers with native numbers
 * (plain-JSON input trees only — see the `rrweb_analyzer.analyze`
 * registration note).
 *
 * @param value - The decoded kwarg tree.
 * @returns The tree with carriers unwrapped.
 */
function unwrapCarriersDeep(value: unknown): unknown {
  if (value instanceof PyFloat) {
    return Number(value.spelling);
  }
  if (Array.isArray(value)) {
    return value.map((item) => unwrapCarriersDeep(item));
  }
  if (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const out: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value)) {
      out[key] = unwrapCarriersDeep(member);
    }
    return out;
  }
  return value;
}

/**
 * Invoke a synchronous builder entry point, wrapping coded library
 * errors for the runner/oracle error diff.
 *
 * @param invoke - Thunk performing the real library call.
 * @returns The thunk's value.
 * @throws WireCoreError - When the call raises a core exception.
 * @throws unknown - Anything else, unchanged.
 */
function runBuilder<T>(invoke: () => T): T {
  try {
    return invoke();
  } catch (error) {
    if (error instanceof MixpanelHeadlessError) {
      throw new WireCoreError(error);
    }
    throw error;
  }
}
