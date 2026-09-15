// Runner: kind dispatch, call.setup[] execution and the full verdict
// taxonomy. Stubs are bound to real corpus api names so the api-map gate
// exercises the production resolution path.

import { describe, expect, it } from "vitest";

import { createRunnerDeps, registerContractCodecs } from "../src/bindings.js";
import { CodecRegistry, type RecordingCallback } from "../src/codecs.js";
import type { JsonValue } from "../src/json-value.js";
import { parseLossless } from "../src/lossless-json.js";
import {
  ImplementationRegistry,
  type InvocationContext,
  type RunnerDeps,
  runVector,
} from "../src/runner.js";
import type { ConformanceVector } from "../src/vector-types.js";

const RECORD_EPOCH = "2026-01-15T12:00:00Z";

/**
 * Parse JSON text into a raw object tree (lossless numbers).
 *
 * @param json - JSON text.
 * @returns The parsed object.
 */
function obj(json: string): Record<string, JsonValue> {
  return parseLossless(json) as Record<string, JsonValue>;
}

/**
 * Build a synthetic vector.
 *
 * @param overrides - Vector fields (id/kind/api default to a builder).
 * @returns The vector.
 */
function makeVector(overrides: {
  id?: string;
  kind?: ConformanceVector["kind"];
  api?: string;
  input?: string;
  setup?: Array<{ api: string; input: string }>;
  call?: string;
  expect: string;
}): ConformanceVector {
  const input = obj(overrides.input ?? "{}");
  const call: Record<string, JsonValue> = {
    api: overrides.api ?? "workspace.build_funnel_params",
    input,
    ...obj(overrides.call ?? "{}"),
  };
  return {
    id: overrides.id ?? "filters/test/test_synthetic",
    kind: overrides.kind ?? "builder",
    api: overrides.api ?? "workspace.build_funnel_params",
    input,
    setup: (overrides.setup ?? []).map((entry) => ({
      api: entry.api,
      input: obj(entry.input),
    })),
    call,
    expect: obj(overrides.expect),
    bundlePath: "synthetic.jsonl",
  };
}

/**
 * Build deps with stub bindings over a FRESH (empty) implementation
 * registry — synthetic stub tests must stay independent of the REAL
 * port-batch bindings, which grow every batch and would otherwise
 * collide on the corpus api names the stubs borrow (first hit: the
 * B4-C1 `api_client.set_workspace_id` binding). The contract codecs are
 * still registered so decode behavior matches production.
 *
 * @param bind - Api-name → stub pairs to register.
 * @returns Runner deps.
 */
function depsWith(
  bind: Record<string, (ctx: InvocationContext) => unknown>,
): RunnerDeps {
  const implementations = new ImplementationRegistry();
  const codecs = new CodecRegistry();
  registerContractCodecs(codecs);
  const deps: RunnerDeps = {
    implementations,
    codecs,
    recordEpoch: RECORD_EPOCH,
  };
  for (const [api, impl] of Object.entries(bind)) {
    deps.implementations.register(api, impl);
  }
  return deps;
}

/** A conformance-shaped error stub carrying its own expect encoding. */
class StubConformanceError extends Error {
  /** The encoded expect.error payload. */
  private readonly payload: JsonValue;

  /**
   * Create the stub error.
   *
   * @param payload - What `toExpectError` returns.
   */
  constructor(payload: JsonValue) {
    super("stub");
    this.payload = payload;
  }

  /**
   * Encode for the runner's structural diff.
   *
   * @returns The payload.
   */
  toExpectError(): JsonValue {
    return this.payload;
  }
}

describe("runVector — api gating", () => {
  it("returns UNMAPPED_API for a name in no mapping source", async () => {
    const vector = makeVector({
      api: "mystery.call",
      expect: '{"output": null}',
    });
    const result = await runVector(vector, createRunnerDeps(RECORD_EPOCH));
    expect(result.verdict).toBe("UNMAPPED_API");
    expect(result.diff).toContain("mystery.call");
  });

  it("returns UNPORTED for a mapped name with no bound implementation", async () => {
    // Probe name must be a mapped-but-unbound api: C1 used
    // api_client.activity_feed (bound at B4-C2), C2 used
    // api_client.list_dashboards (bound at B4-C3), C5 left
    // pagination.paginate_all (bound at B4-C6), then
    // workspace.list_dashboards (bound at B6-BIND — every workspace
    // name is now bound), then region_probe.probe_region (bound at
    // B7-A2), then oauth_flow.refresh_tokens (bound at B8-N2 — the
    // LAST corpus name). TERMINAL RE-ANCHOR (B8 gate, b8-packets.md
    // §5.3a, b6-packets.md:1033): the shipped table has zero pending
    // entries, so the probe keeps the NON-CORPUS module-known name
    // oauth_flow.build_authorize_url AND injects a synthetic pending
    // table through the `RunnerDeps.batchStatuses` seam — the pattern
    // is fully detached from corpus/shipped-table state.
    const vector = makeVector({
      api: "oauth_flow.build_authorize_url",
      kind: "wire",
      expect: '{"result": null}',
    });
    const deps = {
      ...createRunnerDeps(RECORD_EPOCH),
      batchStatuses: new Map([["oauth_flow.", "pending" as const]]),
    };
    const result = await runVector(vector, deps);
    expect(result.verdict).toBe("UNPORTED");
  });

  it("gates on setup apis too (pending unbound setup entry → UNPORTED)", async () => {
    // Post-B4-flip the setup probe must come from a still-pending batch
    // (`api_client.set_workspace_id` is done+bound now). `workspace.me`
    // played the P3-1 † carried-vector shape until the B6 gate flipped
    // the whole `workspace.` prefix to done; `region_probe.probe_region`
    // held the anchor until B7-A2 bound it; `oauth_flow.refresh_tokens`
    // until B8-N2 bound it. TERMINAL RE-ANCHOR (B8 gate, b8-packets.md
    // §5.3a): the NON-CORPUS module-known
    // `oauth_flow.build_authorize_url` stays the setup probe, with a
    // synthetic pending table injected via `batchStatuses` — the
    // shipped table is terminal (zero pending entries).
    const vector = makeVector({
      api: "api_client.activity_feed",
      kind: "wire",
      setup: [{ api: "oauth_flow.build_authorize_url", input: "{}" }],
      expect: '{"result": null}',
    });
    const deps = {
      ...depsWith({ "api_client.activity_feed": () => null }),
      batchStatuses: new Map([["oauth_flow.", "pending" as const]]),
    };
    const result = await runVector(vector, deps);
    expect(result.verdict).toBe("UNPORTED");
  });

  it("fails fast with UNMAPPED_API on an unmapped setup api", async () => {
    const vector = makeVector({
      api: "api_client.activity_feed",
      kind: "wire",
      setup: [{ api: "mystery.setup", input: "{}" }],
      expect: '{"result": null}',
    });
    const result = await runVector(vector, createRunnerDeps(RECORD_EPOCH));
    expect(result.verdict).toBe("UNMAPPED_API");
  });
});

describe("runVector — builder kind", () => {
  it("PASS when the canonical output matches (raw-token float contract)", async () => {
    const vector = makeVector({
      expect: '{"output": {"limit": 18.0, "name": "funnel"}}',
    });
    const deps = depsWith({
      "workspace.build_funnel_params": () => ({ name: "funnel", limit: 18.0 }),
    });
    // Native 18.0 collapses to integer 18 — the raw token 18.0 is the
    // contract, so this is a genuine mismatch...
    const collapsed = await runVector(vector, deps);
    expect(collapsed.verdict).toBe("FAIL_OUTPUT");
    // ...and a port that preserves the float marker passes by returning
    // the encoded canonical form (JsonNumber passthrough).
    const preserved = await runVector(vector, {
      ...deps,
      implementations: depsWith({
        "workspace.build_funnel_params": () =>
          obj('{"limit": 18.0, "name": "funnel"}'),
      }).implementations,
    });
    expect(preserved.verdict).toBe("PASS");
  });

  it("PASS is key-order independent", async () => {
    const vector = makeVector({
      expect: '{"output": {"a": 1, "b": [true, null]}}',
    });
    const deps = depsWith({
      "workspace.build_funnel_params": () => ({ b: [true, null], a: 1 }),
    });
    expect((await runVector(vector, deps)).verdict).toBe("PASS");
  });

  it("FAIL_OUTPUT carries both canonical forms in the diff", async () => {
    const vector = makeVector({ expect: '{"output": {"a": 1}}' });
    const deps = depsWith({
      "workspace.build_funnel_params": () => ({ a: 2 }),
    });
    const result = await runVector(vector, deps);
    expect(result.verdict).toBe("FAIL_OUTPUT");
    expect(result.diff).toContain('{"a":2}');
    expect(result.diff).toContain('{"a":1}');
  });

  it("FAIL_ERROR on an unexpected raise", async () => {
    const vector = makeVector({ expect: '{"output": {}}' });
    const deps = depsWith({
      "workspace.build_funnel_params": () => {
        throw new Error("boom");
      },
    });
    const result = await runVector(vector, deps);
    expect(result.verdict).toBe("FAIL_ERROR");
    expect(result.diff).toContain("unexpected raise");
  });

  it("passes decoded kwargs and shims through the invocation context", async () => {
    const vector = makeVector({
      input: '{"count": 3, "when": {"$type": "date", "iso": "2026-01-15"}}',
      expect:
        '{"output": {"count": 3, "today": "2026-01-15", ' +
        '"uuid": "00000000-0000-4000-8000-000000000000"}}',
    });
    const deps = depsWith({
      "workspace.build_funnel_params": (ctx) => ({
        count: ctx.kwargs["count"],
        today: ctx.shims.today(),
        uuid: ctx.shims.uuid(),
      }),
    });
    expect((await runVector(vector, deps)).verdict).toBe("PASS");
  });
});

describe("runVector — PRECISION_LOSS", () => {
  const EXPECT = '{"output": {"id": 9007199254740993}}'; // 2^53 + 1

  it("flags a double-rounded >2^53 integer as PRECISION_LOSS, not FAIL_OUTPUT", async () => {
    const deps = depsWith({
      "workspace.build_funnel_params": () => ({ id: 9007199254740992 }),
    });
    const result = await runVector(makeVector({ expect: EXPECT }), deps);
    expect(result.verdict).toBe("PRECISION_LOSS");
  });

  it("PASS when the port preserves the exact integer (bigint)", async () => {
    const deps = depsWith({
      "workspace.build_funnel_params": () => ({ id: 9007199254740993n }),
    });
    const result = await runVector(makeVector({ expect: EXPECT }), deps);
    expect(result.verdict).toBe("PASS");
  });

  it("a genuine mismatch near 2^53 stays FAIL_OUTPUT", async () => {
    const deps = depsWith({
      "workspace.build_funnel_params": () => ({ id: 12345 }),
    });
    const result = await runVector(makeVector({ expect: EXPECT }), deps);
    expect(result.verdict).toBe("FAIL_OUTPUT");
  });
});

describe("runVector — validation-error kind", () => {
  const EXPECT_ERROR =
    '{"error": {"class": "BookmarkValidationError", ' +
    '"code": "BOOKMARK_VALIDATION_ERROR", ' +
    '"errors": [{"path": "$.events[0]", "code": "B1_MISSING_EVENTS", "severity": "error"}]}}';

  it("PASS on a structural error match with messages stripped", async () => {
    const vector = makeVector({
      kind: "validation-error",
      expect: EXPECT_ERROR,
    });
    const deps = depsWith({
      "workspace.build_funnel_params": () => {
        throw new StubConformanceError({
          class: "BookmarkValidationError",
          code: "BOOKMARK_VALIDATION_ERROR",
          message: "human text that must be ignored",
          errors: [
            {
              path: "$.events[0]",
              code: "B1_MISSING_EVENTS",
              severity: "error",
              message: "also ignored",
              suggestion: "and this",
            },
          ],
        });
      },
    });
    expect((await runVector(vector, deps)).verdict).toBe("PASS");
  });

  it("FAIL_ERROR when the code or severity differs", async () => {
    const vector = makeVector({
      kind: "validation-error",
      expect: EXPECT_ERROR,
    });
    const deps = depsWith({
      "workspace.build_funnel_params": () => {
        throw new StubConformanceError({
          class: "BookmarkValidationError",
          code: "BOOKMARK_VALIDATION_ERROR",
          errors: [
            {
              path: "$.events[0]",
              code: "B1_MISSING_EVENTS",
              severity: "warning",
            },
          ],
        });
      },
    });
    expect((await runVector(vector, deps)).verdict).toBe("FAIL_ERROR");
  });

  it("FAIL_ERROR when the call returns instead of raising", async () => {
    const vector = makeVector({
      kind: "validation-error",
      expect: EXPECT_ERROR,
    });
    const deps = depsWith({
      "workspace.build_funnel_params": () => ({ fine: true }),
    });
    const result = await runVector(vector, deps);
    expect(result.verdict).toBe("FAIL_ERROR");
    expect(result.diff).toContain("expected raise");
  });
});

describe("runVector — wire kind", () => {
  const WIRE_EXPECT = `{
    "interactions": [
      {"request": {"method": "GET", "path": "/api/query/segmentation",
                   "params": {"event": "Login", "unit": "day"},
                   "headers_contain": {"authorization": {"pattern": "^Basic dGVzdA==$"}},
                   "params_absent": ["interval"]},
       "response": {"status": 200, "body": {"data": 42}}}
    ],
    "result": {"data": 42}
  }`;

  /**
   * A faithful stub client for the WIRE_EXPECT vector.
   *
   * @param query - The query string to send.
   * @returns The stub implementation.
   */
  function faithfulClient(query: string) {
    return async (ctx: InvocationContext): Promise<unknown> => {
      const fetchImpl = ctx.fetch!;
      const response = await fetchImpl(
        `https://mixpanel.com/api/query/segmentation?${query}`,
        { headers: { authorization: "Basic dGVzdA==" } },
      );
      return parseLossless(await response.text());
    };
  }

  it("PASS on a faithful replay (request + result)", async () => {
    const vector = makeVector({
      kind: "wire",
      api: "api_client.get_events",
      expect: WIRE_EXPECT,
    });
    const deps = depsWith({
      "api_client.get_events": faithfulClient("event=Login&unit=day"),
    });
    expect((await runVector(vector, deps)).verdict).toBe("PASS");
  });

  it("FAIL_REQUEST on a dropped query param", async () => {
    const vector = makeVector({
      kind: "wire",
      api: "api_client.get_events",
      expect: WIRE_EXPECT,
    });
    const deps = depsWith({
      "api_client.get_events": faithfulClient("event=Login"),
    });
    const result = await runVector(vector, deps);
    expect(result.verdict).toBe("FAIL_REQUEST");
    expect(result.diff).toContain("params");
  });

  it("FAIL_REQUEST on a params_absent violation", async () => {
    const vector = makeVector({
      kind: "wire",
      api: "api_client.get_events",
      expect: WIRE_EXPECT,
    });
    const deps = depsWith({
      "api_client.get_events": faithfulClient(
        "event=Login&unit=day&interval=7",
      ),
    });
    const result = await runVector(vector, deps);
    expect(result.verdict).toBe("FAIL_REQUEST");
  });

  it("FAIL_REQUEST on an authorization pattern mismatch", async () => {
    const vector = makeVector({
      kind: "wire",
      api: "api_client.get_events",
      expect: WIRE_EXPECT,
    });
    const deps = depsWith({
      "api_client.get_events": async (ctx) => {
        const fetchImpl = ctx.fetch!;
        const response = await fetchImpl(
          "https://mixpanel.com/api/query/segmentation?event=Login&unit=day",
          { headers: { authorization: "Bearer wrong-scheme" } },
        );
        return parseLossless(await response.text());
      },
    });
    const result = await runVector(vector, deps);
    expect(result.verdict).toBe("FAIL_REQUEST");
    expect(result.diff).toContain("authorization");
  });

  it("FAIL_REQUEST when a recorded interaction is never requested", async () => {
    const vector = makeVector({
      kind: "wire",
      api: "api_client.get_events",
      expect:
        '{"interactions": [{"request": {"method": "GET", "path": "/x"}, ' +
        '"response": {"status": 200, "body": {}}}], "result": null}',
    });
    const deps = depsWith({ "api_client.get_events": () => null });
    const result = await runVector(vector, deps);
    expect(result.verdict).toBe("FAIL_REQUEST");
    expect(result.diff).toContain("never requested");
  });

  it("FAIL_REQUEST takes precedence over a result mismatch", async () => {
    const vector = makeVector({
      kind: "wire",
      api: "api_client.get_events",
      expect: WIRE_EXPECT,
    });
    const deps = depsWith({
      "api_client.get_events": async (ctx) => {
        const fetchImpl = ctx.fetch!;
        await fetchImpl(
          "https://mixpanel.com/api/query/segmentation?event=Wrong",
          {
            headers: { authorization: "Basic dGVzdA==" },
          },
        );
        return { data: "also wrong" };
      },
    });
    expect((await runVector(vector, deps)).verdict).toBe("FAIL_REQUEST");
  });

  it("executes call.setup[] in order, sharing state with the measured call", async () => {
    const vector = makeVector({
      kind: "wire",
      api: "api_client.get_events",
      setup: [
        {
          api: "api_client.set_workspace_id",
          input: '{"workspace_id": "777"}',
        },
      ],
      expect: `{
        "interactions": [
          {"request": {"method": "GET", "path": "/api/workspace/777"},
           "response": {"status": 200, "body": {"ok": true}}}
        ],
        "result": {"ok": true}
      }`,
    });
    const deps = depsWith({
      "api_client.set_workspace_id": (ctx) => {
        ctx.state.set("workspace_id", ctx.kwargs["workspace_id"]);
      },
      "api_client.get_events": async (ctx) => {
        const fetchImpl = ctx.fetch!;
        const workspace = ctx.state.get("workspace_id") as string;
        const response = await fetchImpl(
          `https://mixpanel.com/api/workspace/${workspace}`,
        );
        return parseLossless(await response.text());
      },
    });
    expect((await runVector(vector, deps)).verdict).toBe("PASS");
  });

  it("swallows a raising setup call, as the Python executor does", async () => {
    // The Python runner deliberately ignores setup returns/raises —
    // earlier test calls may have raised under pytest.raises at record
    // time too (e.g. a recorded 400 on a get_event_properties setup).
    // Their request sides stay diffed via interactions[]; the vector
    // proceeds to the measured call (adjusted at B4-C2 to mirror the
    // Python semantics; previously locked FAIL_ERROR).
    const vector = makeVector({
      kind: "wire",
      api: "api_client.get_events",
      setup: [{ api: "api_client.set_workspace_id", input: "{}" }],
      expect: '{"result": null}',
    });
    const deps = depsWith({
      "api_client.set_workspace_id": () => {
        throw new Error("setup exploded");
      },
      "api_client.get_events": () => null,
    });
    const result = await runVector(vector, deps);
    expect(result.verdict).toBe("PASS");
  });

  it("surfaces a transport error the port wraps into its taxonomy", async () => {
    const vector = makeVector({
      kind: "wire",
      api: "api_client.get_events",
      expect: `{
        "interactions": [
          {"request": {"method": "GET", "path": "/flaky"},
           "response": {"transport_error": "ConnectError"}}
        ],
        "error": {"class": "MixpanelConnectionError", "code": "CONNECTION_ERROR"}
      }`,
    });
    const deps = depsWith({
      "api_client.get_events": async (ctx) => {
        const fetchImpl = ctx.fetch!;
        try {
          await fetchImpl("https://mixpanel.com/flaky");
        } catch (error) {
          // The stub port classifies the NATIVE TypeError itself — the
          // seam must not hand it a pre-mapped library error.
          if (error instanceof TypeError) {
            throw new StubConformanceError({
              class: "MixpanelConnectionError",
              code: "CONNECTION_ERROR",
            });
          }
          throw error;
        }
        return null;
      },
    });
    expect((await runVector(vector, deps)).verdict).toBe("PASS");
  });

  it("diffs callback call logs against expect.callback_calls", async () => {
    const input = '{"on_batch": {"$type": "callback", "name": "on_batch"}}';
    const expectJson = `{
      "interactions": [
        {"request": {"method": "GET", "path": "/export"},
         "response": {"status": 200, "body": [1, 2]}}
      ],
      "result": null,
      "callback_calls": {"on_batch": [[1], [2]]}
    }`;
    const goodDeps = depsWith({
      "api_client.get_events": async (ctx) => {
        const fetchImpl = ctx.fetch!;
        await fetchImpl("https://mixpanel.com/export");
        const onBatch = ctx.kwargs["on_batch"] as RecordingCallback;
        onBatch.fn(1);
        onBatch.fn(2);
        return null;
      },
    });
    const good = await runVector(
      makeVector({
        kind: "wire",
        api: "api_client.get_events",
        input,
        expect: expectJson,
      }),
      goodDeps,
    );
    expect(good.verdict).toBe("PASS");

    const badDeps = depsWith({
      "api_client.get_events": async (ctx) => {
        const fetchImpl = ctx.fetch!;
        await fetchImpl("https://mixpanel.com/export");
        (ctx.kwargs["on_batch"] as RecordingCallback).fn(1);
        return null;
      },
    });
    const bad = await runVector(
      makeVector({
        kind: "wire",
        api: "api_client.get_events",
        input,
        expect: expectJson,
      }),
      badDeps,
    );
    expect(bad.verdict).toBe("FAIL_OUTPUT");
    expect(bad.diff).toContain("on_batch");
  });

  it("exposes call.session on the invocation context", async () => {
    const vector = makeVector({
      kind: "wire",
      api: "api_client.get_events",
      call:
        '{"session": {"type": "service_account", "region": "us", ' +
        '"project_id": "12345", "username": "test_user", "secret": "test_secret"}}',
      expect: '{"result": {"region": "us", "username": "test_user"}}',
    });
    const deps = depsWith({
      "api_client.get_events": (ctx) => {
        const session = ctx.session as Record<string, JsonValue>;
        return { region: session["region"], username: session["username"] };
      },
    });
    expect((await runVector(vector, deps)).verdict).toBe("PASS");
  });
});

describe("runVector — parse kind", () => {
  it("diffs only the result side (the request path is synthetic)", async () => {
    const vector = makeVector({
      kind: "parse",
      api: "api_client.get_events",
      expect: `{
        "interactions": [
          {"request": {"method": "GET", "path": "/synthetic"},
           "response": {"status": 200, "body": {"value": 7}}}
        ],
        "result": {"value": 7}
      }`,
    });
    const deps = depsWith({
      "api_client.get_events": async (ctx) => {
        const fetchImpl = ctx.fetch!;
        // Deliberately different path: parse vectors must not diff requests.
        const response = await fetchImpl("https://anything.example/other");
        return parseLossless(await response.text());
      },
    });
    expect((await runVector(vector, deps)).verdict).toBe("PASS");
  });
});
