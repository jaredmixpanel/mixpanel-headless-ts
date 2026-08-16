/**
 * B7-A2 R10.9 harness (2/2) — `probe_region` EVERY branch +
 * `probe_region_for_credential` branches + `probeBaseUrl` shapes +
 * fast-check fuzz vs an independent probe mini-model, per
 * `b7-packets.md` §2.6 items 1-10.
 *
 * Run: `npx vite-node throwaway/b7-a2/probe-branches.ts`
 *
 * THROWAWAY: deleted at the B7 gate; the RUN record survives in
 * `context/phase3/notes/B7-A2-notes.md`.
 */

import fc from "fast-check";
import {
  probeBaseUrl,
  probeClientFromFetch,
  probeRegion,
  probeRegionForCredential,
  type ClientFactory,
  type ProbeClient,
  type ProbeResponse,
  type Region,
} from "../../packages/core/src/auth/region-probe.js";
import { MixpanelHttpError } from "../../packages/core/src/client/internals.js";
import {
  ConfigError,
  RegionProbeError,
  RegionProbeNetworkError,
} from "../../packages/core/src/errors.js";
import { Secret } from "../../packages/core/src/secret.js";

let checks = 0;
let failures = 0;

/**
 * Record one expectation (JSON-compared).
 *
 * @param label - What is being checked.
 * @param actual - Observed value.
 * @param expected - Expected value.
 */
function check(label: string, actual: unknown, expected: unknown): void {
  checks += 1;
  const a = JSON.stringify(actual) ?? "undefined";
  const b = JSON.stringify(expected) ?? "undefined";
  if (a !== b) {
    failures += 1;
    console.log(`FAIL ${label}\n  actual   ${a}\n  expected ${b}`);
  }
}

/** One scripted per-invocation outcome. */
type Outcome =
  | { readonly kind: "status"; readonly status: number; readonly body: string }
  | { readonly kind: "network"; readonly message: string };

/**
 * Build the transport-normalized network rejection (the harness
 * ConnectError shape — `transport-errors.ts` row + R2.10 adapter).
 *
 * @param message - The failure message.
 * @returns The MixpanelHttpError with the undici-style cause chain.
 */
function netError(message: string): MixpanelHttpError {
  const inner = new Error(message) as Error & { code: string };
  inner.name = "Error";
  inner.code = "ECONNREFUSED";
  return new MixpanelHttpError(message, {
    cause: new TypeError("fetch failed", { cause: inner }),
  });
}

/** Instrumented factory: scripted outcomes + invocation/close logs. */
interface Rig {
  readonly factory: ClientFactory;
  readonly invocations: Region[];
  readonly closes: number[];
}

/**
 * Build an instrumented factory serving scripted outcomes in
 * invocation order (supports duplicate regions in `order`).
 *
 * @param outcomes - One outcome per expected factory invocation.
 * @returns The rig.
 */
function rigFor(outcomes: readonly Outcome[]): Rig {
  const invocations: Region[] = [];
  const closes: number[] = [];
  const factory: ClientFactory = (region) => {
    const index = invocations.length;
    invocations.push(region);
    closes.push(0);
    const outcome = outcomes[index];
    const client: ProbeClient = {
      get: (): Promise<ProbeResponse> => {
        if (outcome === undefined) {
          throw new Error("harness: outcome script exhausted");
        }
        if (outcome.kind === "network") {
          return Promise.reject(netError(outcome.message));
        }
        return Promise.resolve({
          status: outcome.status,
          text: outcome.body,
        });
      },
      close: () => {
        closes[index] = (closes[index] ?? 0) + 1;
      },
    };
    return client;
  };
  return { factory, invocations, closes };
}

/**
 * Await a probe and capture success/error structurally.
 *
 * @param promise - The probe promise.
 * @returns Encoded outcome.
 */
async function settle(
  promise: Promise<{ region: Region; attempts: unknown }>,
): Promise<Record<string, unknown>> {
  try {
    const result = await promise;
    return { region: result.region, attempts: result.attempts };
  } catch (error) {
    if (error instanceof RegionProbeError) {
      return {
        cls: error.constructor.name,
        code: error.code,
        attempts: error.attempts,
      };
    }
    return { cls: (error as Error).constructor.name };
  }
}

/** Independent codepoint slice (mini-model side — no library import). */
function cpSliceModel(text: string, end: number): string {
  return Array.from(text).slice(0, end).join("");
}

const HEADERS = { Authorization: "Basic xxx" };

/**
 * The harness entry (async so awaits stay flat).
 */
async function main(): Promise<void> {
  // ---- 1. success at position 1 / 2 / 3 + short-circuit counts ----------
  for (const pos of [0, 1, 2]) {
    const outcomes: Outcome[] = [];
    for (let i = 0; i < pos; i++) {
      outcomes.push({ kind: "status", status: 401, body: "no" });
    }
    outcomes.push({ kind: "status", status: 200, body: "{}" });
    const rig = rigFor(outcomes);
    const got = await settle(probeRegion(rig.factory, HEADERS));
    const expectedAttempts = [
      ...outcomes.slice(0, pos).map((_, i) => [["us", "eu", "in"][i], 401]),
      [["us", "eu", "in"][pos], 200],
    ];
    check(`success at position ${pos + 1}`, got, {
      region: ["us", "eu", "in"][pos],
      attempts: expectedAttempts,
    });
    check(
      `factory invocation count pos ${pos + 1}`,
      rig.invocations,
      ["us", "eu", "in"].slice(0, pos + 1),
    );
    check(
      `close() exactly once per client pos ${pos + 1}`,
      rig.closes,
      Array<number>(pos + 1).fill(1),
    );
  }

  // ---- 2. per-region non-200 (401/403/404/500) then success -------------
  // No per-status branching inside the probe: 403/404/500 flow exactly
  // like 401.
  for (const status of [401, 403, 404, 500]) {
    for (const pos of [0, 1, 2]) {
      // The probed status AT pos, success after (pos 2 has no
      // "after" slot inside the default order — the all-failed rows
      // below cover the terminal position).
      const outcomes: Outcome[] = [];
      for (let i = 0; i < pos; i++) {
        outcomes.push({ kind: "status", status: 401, body: "no" });
      }
      outcomes.push({ kind: "status", status, body: `body-${String(status)}` });
      if (pos + 1 < 3) {
        outcomes.push({ kind: "status", status: 200, body: "{}" });
        const rig = rigFor(outcomes);
        const got = await settle(probeRegion(rig.factory, HEADERS));
        const order = ["us", "eu", "in"];
        const expectedAttempts = [
          ...Array.from({ length: pos }, (_, i) => [order[i], 401]),
          [order[pos], status],
          [order[pos + 1], 200],
        ];
        check(
          `status ${String(status)} at pos ${String(pos)} then success`,
          got,
          {
            region: order[pos + 1],
            attempts: expectedAttempts,
          },
        );
      }
    }
  }

  // ---- 3. per-region network error then success --------------------------
  for (const pos of [0, 1]) {
    const outcomes: Outcome[] = [];
    for (let i = 0; i < pos; i++) {
      outcomes.push({ kind: "status", status: 401, body: "no" });
    }
    outcomes.push({ kind: "network", message: "DNS lookup failed" });
    outcomes.push({ kind: "status", status: 200, body: "{}" });
    const rig = rigFor(outcomes);
    const got = await settle(probeRegion(rig.factory, HEADERS));
    const order = ["us", "eu", "in"];
    check(`network error at pos ${String(pos)} then success`, got, {
      region: order[pos + 1],
      attempts: [
        ...Array.from({ length: pos }, (_, i) => [order[i], 401]),
        [order[pos], 0],
        [order[pos + 1], 200],
      ],
    });
    check(
      `close() on network-continue path pos ${String(pos)}`,
      rig.closes,
      Array<number>(pos + 2).fill(1),
    );
  }
  // Rendering: `[region, 0, "<class>: <msg>"]`.
  {
    const rig = rigFor([
      { kind: "network", message: "DNS lookup failed" },
      { kind: "status", status: 401, body: "no" },
      { kind: "status", status: 401, body: "no" },
    ]);
    const got = await settle(probeRegion(rig.factory, HEADERS));
    check(
      "network attempt rendered '<class>: <msg>'",
      (got["attempts"] as unknown[][])[0],
      ["us", 0, "ConnectError: DNS lookup failed"],
    );
  }

  // ---- 4./5./6. all-failed classification --------------------------------
  {
    const rig = rigFor([
      { kind: "status", status: 401, body: "a" },
      { kind: "status", status: 401, body: "b" },
      { kind: "status", status: 401, body: "c" },
    ]);
    const got = await settle(probeRegion(rig.factory, HEADERS));
    check("all-401 → RegionProbeError with bodies in order", got, {
      cls: "RegionProbeError",
      code: "OAUTH_REGION_PROBE_FAILED",
      attempts: [
        ["us", 401, "a"],
        ["eu", 401, "b"],
        ["in", 401, "c"],
      ],
    });
  }
  {
    const rig = rigFor([
      { kind: "network", message: "m1" },
      { kind: "network", message: "m2" },
      { kind: "network", message: "m3" },
    ]);
    const error = await probeRegion(rig.factory, HEADERS).then(
      () => null,
      (e: unknown) => e,
    );
    check(
      "all-network → RegionProbeNetworkError subclass-of RegionProbeError",
      [
        error instanceof RegionProbeNetworkError,
        error instanceof RegionProbeError,
        (error as RegionProbeNetworkError).code,
      ],
      [true, true, "OAUTH_NETWORK_UNREACHABLE"],
    );
  }
  // Mixed in BOTH arrangements → generic RegionProbeError.
  for (const [label, outcomes] of [
    [
      "net-then-http",
      [
        { kind: "network", message: "m" },
        { kind: "network", message: "m" },
        { kind: "status", status: 401, body: "no" },
      ],
    ],
    [
      "http-then-net",
      [
        { kind: "status", status: 401, body: "no" },
        { kind: "network", message: "m" },
        { kind: "network", message: "m" },
      ],
    ],
  ] as const) {
    const rig = rigFor(outcomes as readonly Outcome[]);
    const error = await probeRegion(rig.factory, HEADERS).then(
      () => null,
      (e: unknown) => e,
    );
    check(
      `mixed ${label} → generic RegionProbeError`,
      [
        error instanceof RegionProbeError,
        error instanceof RegionProbeNetworkError,
        (error as RegionProbeError).code,
      ],
      [true, false, "OAUTH_REGION_PROBE_FAILED"],
    );
  }

  // ---- 7. order semantics -------------------------------------------------
  {
    const rig = rigFor([{ kind: "status", status: 200, body: "{}" }]);
    const got = await settle(
      probeRegion(rig.factory, HEADERS, { order: ["eu", "us"] }),
    );
    check("custom order eu-first", got, {
      region: "eu",
      attempts: [["eu", 200]],
    });
  }
  {
    const rig = rigFor([{ kind: "status", status: 401, body: "no" }]);
    const got = await settle(
      probeRegion(rig.factory, HEADERS, { order: ["eu"] }),
    );
    check("single-region order no fall-through", got, {
      cls: "RegionProbeError",
      code: "OAUTH_REGION_PROBE_FAILED",
      attempts: [["eu", 401, "no"]],
    });
  }
  {
    // The `all([])` edge: empty order → RegionProbeNetworkError with
    // attempts: [] (packet Caution #9).
    const rig = rigFor([]);
    const got = await settle(probeRegion(rig.factory, HEADERS, { order: [] }));
    check("empty order → network subclass, attempts []", got, {
      cls: "RegionProbeNetworkError",
      code: "OAUTH_NETWORK_UNREACHABLE",
      attempts: [],
    });
    check("empty order → factory never invoked", rig.invocations, []);
  }
  {
    // Duplicate region: probed twice, factory called twice.
    const rig = rigFor([
      { kind: "status", status: 401, body: "first" },
      { kind: "status", status: 200, body: "{}" },
    ]);
    const got = await settle(
      probeRegion(rig.factory, HEADERS, { order: ["us", "us"] }),
    );
    check("duplicate region probed twice", got, {
      region: "us",
      attempts: [
        ["us", 401],
        ["us", 200],
      ],
    });
    check("duplicate region factory called twice", rig.invocations, [
      "us",
      "us",
    ]);
  }

  // ---- 8. body cap boundary ------------------------------------------------
  for (const length of [4095, 4096, 4097]) {
    const body = "x".repeat(length);
    const rig = rigFor([
      { kind: "status", status: 401, body },
      { kind: "status", status: 401, body },
      { kind: "status", status: 401, body },
    ]);
    const error = (await probeRegion(rig.factory, HEADERS).then(
      () => null,
      (e: unknown) => e,
    )) as RegionProbeError;
    check(
      `body cap length ${String(length)}`,
      error.attempts.map((a) => (a[2] as string).length),
      [Math.min(length, 4096), Math.min(length, 4096), Math.min(length, 4096)],
    );
  }
  {
    // Non-BMP codepoint straddling the 4096 cut: 4095 BMP chars + "𝒳"
    // → cpSlice keeps the WHOLE pair (codepoints, not UTF-16 units).
    const body = "x".repeat(4095) + "𝒳" + "tail";
    const rig = rigFor([
      { kind: "status", status: 401, body },
      { kind: "status", status: 401, body },
      { kind: "status", status: 401, body },
    ]);
    const error = (await probeRegion(rig.factory, HEADERS).then(
      () => null,
      (e: unknown) => e,
    )) as RegionProbeError;
    check(
      "surrogate straddle at 4096",
      error.attempts[0]?.[2],
      "x".repeat(4095) + "𝒳",
    );
  }
  // Empty body + the mandatory edge-set strings as bodies.
  for (const body of ["", "𝒳", "18.0", "1.5", "true", "null", "[]"]) {
    const rig = rigFor([
      { kind: "status", status: 401, body },
      { kind: "status", status: 401, body },
      { kind: "status", status: 401, body },
    ]);
    const error = (await probeRegion(rig.factory, HEADERS).then(
      () => null,
      (e: unknown) => e,
    )) as RegionProbeError;
    check(
      `edge-set body ${JSON.stringify(body)} verbatim`,
      error.attempts[0]?.[2],
      body,
    );
  }

  // ---- 9. header forwarding / path / timeout -------------------------------
  {
    const seen: unknown[] = [];
    const factory: ClientFactory = (region) => ({
      get: (path, opts) => {
        seen.push([region, path, opts.headers, opts.timeoutSeconds]);
        return Promise.resolve({ status: 200, text: "{}" });
      },
      close: () => {},
    });
    await probeRegion(factory, { A: "1", B: "𝒳" });
    check("headers forwarded verbatim + default timeout 5.0", seen, [
      ["us", "/api/app/me", { A: "1", B: "𝒳" }, 5],
    ]);
    seen.length = 0;
    await probeRegion(factory, {}, { timeoutSeconds: 2.5 });
    check("empty headers map + timeout 2.5 plumbed", seen, [
      ["us", "/api/app/me", {}, 2.5],
    ]);
    seen.length = 0;
    // Edge-set numeric timeouts: 18.0 (integral float) and 1.5.
    await probeRegion(factory, {}, { timeoutSeconds: 18.0 });
    await probeRegion(factory, {}, { timeoutSeconds: 1.5 });
    check(
      "timeout edge values 18.0 / 1.5",
      (seen as unknown[][]).map((s) => s[3]),
      [18, 1.5],
    );
  }

  // ---- 10. probe_region_for_credential branches -----------------------------

  /**
   * Recording fetch: serves scripted statuses per call, captures URL +
   * Authorization header.
   *
   * @param script - Statuses to serve in order.
   * @returns The fetch + captured request log.
   */
  function recordingFetch(script: readonly number[]): {
    fetchImpl: typeof fetch;
    seen: { url: string; auth: string | null }[];
  } {
    const seen: { url: string; auth: string | null }[] = [];
    const fetchImpl: typeof fetch = (input, init) => {
      const headers = new Headers(init?.headers);
      seen.push({ url: String(input), auth: headers.get("authorization") });
      const status = script[seen.length - 1] ?? 200;
      return Promise.resolve(new Response("body", { status }));
    };
    return { fetchImpl, seen };
  }

  // SA missing username / secret → ConfigError.
  for (const [label, username, secret] of [
    ["missing username", null, new Secret("s")],
    ["missing secret", "u", null],
    ["missing both", null, null],
  ] as const) {
    const got = await probeRegionForCredential({
      account_type: "service_account",
      username,
      secret,
      token: null,
      token_env: null,
      getEnv: () => undefined,
      fetchImpl: fetch,
    }).then(
      () => "ok",
      (e: unknown) => (e as ConfigError).constructor.name,
    );
    check(`SA ${label} → ConfigError`, got, "ConfigError");
  }

  // Basic header: UTF-8 bytes then base64 (independent manual encoder).
  {
    const { fetchImpl, seen } = recordingFetch([200]);
    await probeRegionForCredential({
      account_type: "service_account",
      username: "ü",
      secret: new Secret("ß𝒳"),
      token: null,
      token_env: null,
      getEnv: () => undefined,
      fetchImpl,
    });
    // Independent expected value: TextEncoder bytes → manual base64.
    const bytes = new TextEncoder().encode("ü:ß𝒳");
    let binary = "";
    for (const b of bytes) {
      binary += String.fromCharCode(b);
    }
    check(
      "SA Basic header = base64(UTF-8 bytes), non-ASCII lock",
      seen[0]?.auth,
      `Basic ${btoa(binary)}`,
    );
    check(
      "SA probe hits stripped host root + /api/app/me",
      seen[0]?.url,
      "https://mixpanel.com/api/app/me",
    );
  }

  // oauth_token: inline token wins.
  {
    const { fetchImpl, seen } = recordingFetch([200]);
    const region = await probeRegionForCredential({
      account_type: "oauth_token",
      username: null,
      secret: null,
      token: new Secret("inline-tok"),
      token_env: "SOME_VAR",
      getEnv: () => "env-tok",
      fetchImpl,
    });
    check(
      "inline token wins over token_env",
      [region, seen[0]?.auth],
      ["us", "Bearer inline-tok"],
    );
  }
  // token_env set + present.
  {
    const { fetchImpl, seen } = recordingFetch([401, 200]);
    const region = await probeRegionForCredential({
      account_type: "oauth_token",
      username: null,
      secret: null,
      token: null,
      token_env: "MY_VAR",
      getEnv: (name) => (name === "MY_VAR" ? "from-env" : undefined),
      fetchImpl,
    });
    check(
      "token_env present → Bearer from env; eu after us 401",
      [region, seen[0]?.auth, seen[1]?.url],
      ["eu", "Bearer from-env", "https://eu.mixpanel.com/api/app/me"],
    );
  }
  // token_env set + empty / set + unset → ConfigError.
  for (const [label, value] of [
    ["empty", ""],
    ["unset", undefined],
  ] as const) {
    const got = await probeRegionForCredential({
      account_type: "oauth_token",
      username: null,
      secret: null,
      token: null,
      token_env: "MY_VAR",
      getEnv: () => value,
      fetchImpl: fetch,
    }).then(
      () => "ok",
      (e: unknown) => (e as ConfigError).constructor.name,
    );
    check(`token_env ${label} → ConfigError`, got, "ConfigError");
  }
  // Neither token nor token_env → ConfigError.
  {
    const got = await probeRegionForCredential({
      account_type: "oauth_token",
      username: null,
      secret: null,
      token: null,
      token_env: null,
      getEnv: () => undefined,
      fetchImpl: fetch,
    }).then(
      () => "ok",
      (e: unknown) => (e as ConfigError).constructor.name,
    );
    check("oauth_token with no source → ConfigError", got, "ConfigError");
  }
  // Non-probeable account type → ConfigError.
  {
    const got = await probeRegionForCredential({
      account_type: "oauth_browser",
      username: null,
      secret: null,
      token: null,
      token_env: null,
      getEnv: () => undefined,
      fetchImpl: fetch,
    }).then(
      () => "ok",
      (e: unknown) => (e as ConfigError).constructor.name,
    );
    check("oauth_browser type → ConfigError", got, "ConfigError");
  }
  // narrate messages ported verbatim (out of contract, R5.4 — locked
  // here, not in Layer-3).
  {
    const { fetchImpl } = recordingFetch([401, 200]);
    const narrated: string[] = [];
    await probeRegionForCredential({
      account_type: "service_account",
      username: "u",
      secret: new Secret("s"),
      token: null,
      token_env: null,
      narrate: (msg) => narrated.push(msg),
      getEnv: () => undefined,
      fetchImpl,
    });
    check("narrate sequence", narrated, [
      "Probing regions for /me access ...",
      "  us: 401 ✗",
      "  eu: 200 ✓",
    ]);
  }

  // probeBaseUrl over the Layer-3 shapes + query/fragment/port variants.
  check(
    "probeBaseUrl shapes",
    [
      probeBaseUrl("https://mixpanel.com/api/app"),
      probeBaseUrl("https://mixpanel.com/api/app/"),
      probeBaseUrl("https://eu.mixpanel.com/api/app?x=1#frag"),
      probeBaseUrl("https://host:8443/api/app"),
      probeBaseUrl("https://mixpanel.com"),
      probeBaseUrl("http://in.mixpanel.com/api/v2/app"),
    ],
    [
      "https://mixpanel.com",
      "https://mixpanel.com",
      "https://eu.mixpanel.com",
      "https://host:8443",
      "https://mixpanel.com",
      "http://in.mixpanel.com",
    ],
  );

  // probeClientFromFetch transport integration: non-200 keeps body;
  // rejection normalizes through the adapter and renders via the
  // reverse table.
  {
    const rejectingFetch: typeof fetch = () =>
      Promise.reject(
        new TypeError("fetch failed", {
          cause: Object.assign(new Error("DNS lookup failed"), {
            code: "ECONNREFUSED",
          }),
        }),
      );
    const factory: ClientFactory = () =>
      probeClientFromFetch(rejectingFetch, "https://test.invalid");
    const got = await settle(probeRegion(factory, HEADERS, { order: ["us"] }));
    check("probeClientFromFetch network rendering", got, {
      cls: "RegionProbeNetworkError",
      code: "OAUTH_NETWORK_UNREACHABLE",
      attempts: [["us", 0, "ConnectError: DNS lookup failed"]],
    });
  }

  // ---- fast-check fuzz: interaction sequences vs mini-model -----------------
  const FUZZ_SEED = 20260817;
  const FUZZ_RUNS = 600;
  let fuzzDivergences = 0;

  const outcomeArb: fc.Arbitrary<Outcome> = fc.oneof(
    fc
      .tuple(
        fc.constantFrom(200, 401, 403, 404, 429, 500),
        fc.constantFrom("", "𝒳", "body", "x".repeat(5000), "18.0"),
      )
      .map(([status, body]) => ({ kind: "status" as const, status, body })),
    fc
      .constantFrom("DNS lookup failed", "boom", "")
      .map((message) => ({ kind: "network" as const, message })),
  );
  const caseArb = fc.record({
    order: fc.array(fc.constantFrom<Region>("us", "eu", "in"), {
      minLength: 0,
      maxLength: 4,
    }),
    outcomes: fc.array(outcomeArb, { minLength: 4, maxLength: 4 }),
  });

  /**
   * Independent probe mini-model.
   *
   * @param order - The probe order.
   * @param outcomes - Scripted per-invocation outcomes.
   * @returns Expected encoded outcome.
   */
  function probeModel(
    order: readonly Region[],
    outcomes: readonly Outcome[],
  ): Record<string, unknown> {
    const fails: (readonly [string, number, string])[] = [];
    for (let i = 0; i < order.length; i++) {
      const region = order[i] as Region;
      const outcome = outcomes[i] as Outcome;
      if (outcome.kind === "network") {
        fails.push([region, 0, `ConnectError: ${outcome.message}`]);
        continue;
      }
      if (outcome.status === 200) {
        return {
          region,
          attempts: [...fails.map(([r, s]) => [r, s]), [region, 200]],
        };
      }
      fails.push([region, outcome.status, cpSliceModel(outcome.body, 4096)]);
    }
    const allNet = fails.every(([, s]) => s === 0);
    return {
      cls: allNet ? "RegionProbeNetworkError" : "RegionProbeError",
      code: allNet ? "OAUTH_NETWORK_UNREACHABLE" : "OAUTH_REGION_PROBE_FAILED",
      attempts: fails,
    };
  }

  await fc.assert(
    fc.asyncProperty(caseArb, async ({ order, outcomes }) => {
      const rig = rigFor(outcomes);
      const got = await settle(probeRegion(rig.factory, HEADERS, { order }));
      const expected = probeModel(order, outcomes);
      // Invocation-count model: stop after the first 200.
      let expectedInvocations = order.length;
      for (let i = 0; i < order.length; i++) {
        const o = outcomes[i] as Outcome;
        if (o.kind === "status" && o.status === 200) {
          expectedInvocations = i + 1;
          break;
        }
      }
      const invocationsOk =
        JSON.stringify(rig.invocations) ===
        JSON.stringify(order.slice(0, expectedInvocations));
      const closesOk = rig.closes.every((n) => n === 1);
      if (
        JSON.stringify(got) !== JSON.stringify(expected) ||
        !invocationsOk ||
        !closesOk
      ) {
        fuzzDivergences += 1;
        console.log(
          `FUZZ DIVERGENCE order=${JSON.stringify(order)} outcomes=${JSON.stringify(outcomes)}\n  actual   ${JSON.stringify(got)}\n  expected ${JSON.stringify(expected)}\n  invocations ${JSON.stringify(rig.invocations)} closes ${JSON.stringify(rig.closes)}`,
        );
        return false;
      }
      return true;
    }),
    { seed: FUZZ_SEED, numRuns: FUZZ_RUNS },
  );
  checks += FUZZ_RUNS;

  console.log(
    `probe-branches: checks ${checks} (incl. ${FUZZ_RUNS} fuzz runs, seed ${FUZZ_SEED})  failures ${failures}  fuzz-divergences ${fuzzDivergences}`,
  );
  if (failures > 0 || fuzzDivergences > 0) {
    process.exitCode = 1;
  }
}

await main();
