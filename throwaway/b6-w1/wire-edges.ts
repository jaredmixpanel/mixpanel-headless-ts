/**
 * B6-W1 R10.9 harness — the facade wire/edge set (packet §3 "R10.9
 * harness spec — `throwaway/b6-w1/`").
 *
 * The W1 members are facade delegations with no oracle-call surface, so
 * the harness runs them through the injected-fetch seam with hand-built
 * interactions and asserts four things:
 *
 *   (i)   delegation equivalence — facade result === direct
 *         client/service result over the SAME canned interaction set;
 *   (ii)  wire status branches — `me` (200/401/403),
 *         `set_business_context` (200/400/429-exhausted),
 *         `list_workspaces` (200-empty/500);
 *   (iii) the mandatory edge set (18.0, 1.5, true, null, [], "", "𝒳")
 *         pushed through `use()` kwargs + business-context params where
 *         the declared annotation admits them (Discrepancy #8 boundary);
 *   (iv)  EVERY W1-local error branch — `WS1_TARGET_MUTUALLY_EXCLUSIVE`,
 *         all five `UNPORTED_RESOLVER_SEAM` defaults, the me()
 *         401/403 → ConfigError paths, and close-idempotency.
 *
 *     npx vite-node throwaway/b6-w1/wire-edges.ts
 *
 * THROWAWAY: deleted at the B6 gate; the RUN record lives in
 * `context/phase3/notes/B6-W1-notes.md` §R10.9.
 */

import {
  createMockClient,
  makeSession,
  type CannedResponse,
  type CapturedFetchRequest,
} from "../../packages/core/test/client/client-test-helpers.js";
import { Workspace } from "../../packages/core/src/workspace.js";
import {
  MeService,
  inMemoryMeCache,
} from "../../packages/core/src/services/me.js";
import type { Account } from "../../packages/core/src/auth/account.js";
import { Secret } from "../../packages/core/src/secret.js";

let checks = 0;
let failures = 0;

/**
 * Record one expectation.
 *
 * @param label - What is being checked.
 * @param actual - The observed value (JSON-compared).
 * @param expected - The expected value.
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

/**
 * Run a thunk and return `[className, code]` of the thrown error.
 *
 * @param fn - The thunk.
 * @returns The class name and code, or `null` when it resolved.
 */
async function thrown(
  fn: () => Promise<unknown>,
): Promise<[string, string] | null> {
  try {
    await fn();
    return null;
  } catch (error) {
    const err = error as Error & { code?: string };
    return [err.constructor.name, err.code ?? "<none>"];
  }
}

/**
 * Build a facade over a canned handler plus its request log.
 *
 * @param handler - The canned-response handler.
 * @returns The facade and the captured requests.
 */
function facade(handler: (r: CapturedFetchRequest) => CannedResponse): {
  ws: Workspace;
  captures: readonly CapturedFetchRequest[];
  client: ReturnType<typeof createMockClient>["client"];
} {
  const session = makeSession({ projectId: "12345" });
  const { client, transport } = createMockClient(session, handler);
  return {
    ws: new Workspace({ session, client }),
    captures: transport.captures,
    client,
  };
}

/** `{status: "ok", results: …}` App-API envelope. */
function ok(results: unknown): CannedResponse {
  return { status: 200, json: { status: "ok", results } };
}

const OTHER_ACCOUNT: Account = {
  type: "service_account",
  name: "other",
  region: "eu",
  username: "other.sa",
  secret: new Secret("other-secret"),
  default_project: "3713224",
};

/** The mandated edge set (packet §0 / R10.9). */
const EDGE_SET: readonly unknown[] = [18.0, 1.5, true, null, [], "", "𝒳"];

async function main(): Promise<void> {
  // ---------------------------------------------------------------
  // (i) delegation equivalence
  // ---------------------------------------------------------------

  {
    const payload = [
      {
        id: 7,
        name: "All Project Data",
        project_id: 12345,
        is_default: true,
        is_global: true,
      },
      { id: 8, name: "Console", project_id: 12345, is_default: false },
    ];
    const { ws, client } = facade(() => ok(payload));
    const viaFacade = await ws.listWorkspaces();
    const viaClient = await client.listWorkspaces();
    check(
      "equiv/list_workspaces",
      viaFacade.map((w) => w.toJSON()),
      viaClient.map((w) => w.toJSON()),
    );
  }

  {
    // A pinned session short-circuits both paths identically.
    const pinned = makeSession({ projectId: "12345", workspaceId: 4242 });
    const { client } = createMockClient(pinned, () => ok([]));
    const ws = new Workspace({ session: pinned, client });
    check(
      "equiv/resolve_workspace_id (pinned)",
      await ws.resolveWorkspaceId(),
      await client.resolveWorkspaceId(),
    );
    // …and through the /me resolver the facade installs (the dagger
    // path: cached /me answers WITHOUT a /workspaces/public call).
    const raw = {
      projects: { "12345": { name: "P", organization_id: 1 } },
      workspaces: {
        "9": { id: 9, name: "W", project_id: 12345, is_default: true },
      },
    };
    let calls = 0;
    const unpinned = makeSession({ projectId: "12345" });
    const { client: c2 } = createMockClient(unpinned, () => {
      calls += 1;
      return ok(raw);
    });
    const ws2 = new Workspace({ session: unpinned, client: c2 });
    await ws2.me(); // warm the cache (1 call)
    check(
      "equiv/resolve_workspace_id (me-resolver)",
      await ws2.resolveWorkspaceId(),
      9,
    );
    check("equiv/resolve_workspace_id no extra wire call", calls, 1);
  }

  {
    const raw = {
      user_id: 42,
      user_email: "a@b.c",
      projects: { "12345": { name: "P", organization_id: 100 } },
      workspaces: {
        "9": { id: 9, name: "W", project_id: 12345, is_default: true },
      },
      organizations: { "100": { id: 100, name: "Org" } },
    };
    const { ws, client } = facade(() => ok(raw));
    const direct = new MeService(client, inMemoryMeCache("test_account"), "us");
    check(
      "equiv/me",
      (await ws.me()).toJSON(),
      (await direct.fetch()).toJSON(),
    );
  }

  {
    const { ws, client } = facade(() => ok({ content: "# X" }));
    const viaFacade = await ws.getBusinessContext();
    const viaClient = await client.getBusinessContext();
    check(
      "equiv/get_business_context.content",
      viaFacade.content,
      viaClient["content"],
    );
    check("equiv/get_business_context.level", viaFacade.level, "project");
    check(
      "equiv/get_business_context.project_id",
      viaFacade.project_id,
      "12345",
    );
  }

  {
    const { ws, client } = facade((r) => ok(JSON.parse(r.bodyText)));
    const viaFacade = await ws.setBusinessContext("# S");
    const viaClient = await client.setBusinessContext("# S");
    check(
      "equiv/set_business_context",
      viaFacade.content,
      viaClient["content"],
    );
  }

  {
    const { ws } = facade(() => ok({ content: "" }));
    const cleared = await ws.clearBusinessContext();
    check(
      "equiv/clear_business_context",
      [cleared.content, cleared.is_empty],
      ["", true],
    );
  }

  {
    const { ws, client } = facade(() =>
      ok({ org_context: "o", project_context: "p" }),
    );
    const viaFacade = await ws.getBusinessContextChain();
    const viaClient = await client.getBusinessContextChain();
    check(
      "equiv/get_business_context_chain",
      [viaFacade.organization.content, viaFacade.project.content],
      [viaClient["org_context"], viaClient["project_context"]],
    );
    check(
      "equiv/chain.cold-cache-org-id",
      viaFacade.organization.organization_id,
      null,
    );
  }

  // ---------------------------------------------------------------
  // (ii) wire status branches
  // ---------------------------------------------------------------

  {
    const { ws } = facade(() => ok({ user_id: 1 }));
    check("wire/me 200", (await ws.me()).user_id, 1);
  }
  {
    const { ws } = facade(() => ({ status: 401, json: { error: "bad" } }));
    check("wire/me 401", await thrown(() => ws.me()), [
      "ConfigError",
      "CONFIG_ERROR",
    ]);
  }
  {
    const { ws } = facade(() => ({ status: 403, json: { error: "nope" } }));
    check("wire/me 403", await thrown(() => ws.me()), [
      "ConfigError",
      "CONFIG_ERROR",
    ]);
  }
  {
    // 403 wording branches on the account type (me.py:735-757).
    const { ws } = facade(() => ({ status: 403, json: { error: "nope" } }));
    let message = "";
    try {
      await ws.me();
    } catch (error) {
      message = (error as Error).message;
    }
    check("wire/me 403 SA wording", message.includes("user_details"), true);
  }
  {
    const { ws, captures } = facade((r) => ok(JSON.parse(r.bodyText)));
    check(
      "wire/set_business_context 200",
      (await ws.setBusinessContext("x")).content,
      "x",
    );
    check("wire/set_business_context 200 calls", captures.length, 1);
  }
  {
    const { ws } = facade(() => ({ status: 400, json: { error: "too long" } }));
    check(
      "wire/set_business_context 400",
      await thrown(() => ws.setBusinessContext("x")),
      ["QueryError", "QUERY_FAILED"],
    );
  }
  {
    let calls = 0;
    const { ws } = facade(() => {
      calls += 1;
      return { status: 429, json: { error: "slow down" } };
    });
    const outcome = await thrown(() => ws.setBusinessContext("x"));
    check("wire/set_business_context 429-exhausted", outcome, [
      "RateLimitError",
      "RATE_LIMITED",
    ]);
    check("wire/set_business_context 429 retried", calls > 1, true);
  }
  {
    const { ws } = facade(() => ok([]));
    check("wire/list_workspaces 200-empty", await ws.listWorkspaces(), []);
  }
  {
    const { ws } = facade(() => ({ status: 500, json: { error: "boom" } }));
    check("wire/list_workspaces 500", await thrown(() => ws.listWorkspaces()), [
      "ServerError",
      "SERVER_ERROR",
    ]);
  }

  // ---------------------------------------------------------------
  // (iii) the mandatory edge set
  // ---------------------------------------------------------------

  for (const value of EDGE_SET) {
    // `use(workspace=)` is annotated `int | None` — only the numeric and
    // null members are in-annotation (#8); the rest are recorded as
    // out-of-contract inputs whose only requirement is "no crash inside
    // the facade before the client sees them".
    const { ws } = facade(() => ok([]));
    const label = JSON.stringify(value) ?? "undefined";
    const outcome = await thrown(() =>
      ws.use({ workspace: value as number | null }),
    );
    const pinned = ws.workspace?.id ?? null;
    if (value === null || value === undefined) {
      check(
        `edge/use workspace=${label} clears`,
        [outcome, pinned],
        [null, null],
      );
    } else if (typeof value === "number") {
      check(
        `edge/use workspace=${label} pins`,
        [outcome, pinned],
        [null, value],
      );
    } else {
      // Out-of-annotation: the facade forwards verbatim (no coercion,
      // no crash) — the client owns whatever the wire makes of it.
      check(`edge/use workspace=${label} forwarded`, outcome, null);
    }
  }

  for (const value of EDGE_SET) {
    // `set_business_context(content: str)` — in-annotation members are
    // "" and "𝒳"; the others are the #8 boundary.
    const { ws } = facade((r) => ok(JSON.parse(r.bodyText)));
    const label = JSON.stringify(value) ?? "undefined";
    const outcome = await thrown(() => ws.setBusinessContext(value as string));
    if (typeof value === "string") {
      check(`edge/set_business_context ${label}`, outcome, null);
    } else {
      // Non-str input reaches `codepointLength` — record the class so
      // the review pair can see it is a TypeError-shaped crash, exactly
      // as CPython's `len(18.0)` would be (out of contract, #8).
      check(
        `edge/set_business_context ${label} non-str`,
        outcome !== null,
        true,
      );
    }
  }

  for (const value of EDGE_SET) {
    // `get_business_context(organization_id: int | None)`.
    const { ws, captures } = facade(() => ok({ content: "" }));
    const label = JSON.stringify(value) ?? "undefined";
    const outcome = await thrown(() =>
      ws.getBusinessContext({
        level: "organization",
        organization_id: value as number | null,
      }),
    );
    if (value === null) {
      // No explicit id → resolution runs (/me on a cold cache).
      check(`edge/org_id ${label} resolves`, outcome !== null, true);
    } else if (typeof value === "number" && Number.isInteger(value)) {
      // In-annotation (`int`): 18.0 arrives as the integral 18.
      check(
        `edge/org_id ${label} path`,
        [
          outcome,
          captures[0]?.url.includes(`/organizations/${String(value)}/`) ??
            false,
        ],
        [null, true],
      );
    } else {
      // Out of annotation (#8): the org id reaches the `int` field of
      // `BusinessContext`, which raises exactly as pydantic's
      // `ValidationError` does for the same input. Recorded, not
      // contract.
      check(
        `edge/org_id ${label} out-of-annotation raises`,
        outcome?.[0],
        "ResponseValidationError",
      );
    }
  }

  // ---------------------------------------------------------------
  // (iv) every W1-local error branch
  // ---------------------------------------------------------------

  {
    const { ws } = facade(() => ok([]));
    check(
      "err/WS1 target+account",
      await thrown(() => ws.use({ target: "t", account: "a" })),
      ["ParamValidationError", "WS1_TARGET_MUTUALLY_EXCLUSIVE"],
    );
    check(
      "err/WS1 target+project",
      await thrown(() => ws.use({ target: "t", project: "9" })),
      ["ParamValidationError", "WS1_TARGET_MUTUALLY_EXCLUSIVE"],
    );
    check(
      "err/WS1 target+workspace",
      await thrown(() => ws.use({ target: "t", workspace: 1 })),
      ["ParamValidationError", "WS1_TARGET_MUTUALLY_EXCLUSIVE"],
    );
  }

  {
    const { ws } = facade(() => ok([]));
    check(
      "err/seam resolveSession",
      await thrown(() => ws.use({ target: "t" })),
      ["MixpanelHeadlessError", "UNPORTED_RESOLVER_SEAM"],
    );
    check("err/seam getAccount", await thrown(() => ws.use({ account: "a" })), [
      "MixpanelHeadlessError",
      "UNPORTED_RESOLVER_SEAM",
    ]);
  }
  {
    const session = makeSession({ projectId: "12345" });
    const { client } = createMockClient(session, () => ok([]));
    const ws = new Workspace({
      session,
      client,
      seams: { getAccount: () => Promise.resolve(OTHER_ACCOUNT) },
    });
    check(
      "err/seam resolveProjectAxis",
      await thrown(() => ws.use({ account: "other" })),
      ["MixpanelHeadlessError", "UNPORTED_RESOLVER_SEAM"],
    );
  }
  {
    const session = makeSession({ projectId: "12345" });
    const { client } = createMockClient(session, () => ok([]));
    const ws = new Workspace({
      session,
      client,
      seams: {
        getAccount: () => Promise.resolve(OTHER_ACCOUNT),
        resolveProjectAxis: () => Promise.resolve("3713224"),
      },
    });
    check(
      "err/seam envWorkspaceId",
      await thrown(() => ws.use({ account: "other" })),
      ["MixpanelHeadlessError", "UNPORTED_RESOLVER_SEAM"],
    );
  }
  {
    const { ws } = facade(() => ok([]));
    check(
      "err/seam persistActive",
      await thrown(() => ws.use({ project: "9", persist: true })),
      ["MixpanelHeadlessError", "UNPORTED_RESOLVER_SEAM"],
    );
  }
  {
    const session = makeSession({ projectId: "12345" });
    const { client } = createMockClient(session, () => ok([]));
    const ws = new Workspace({
      session,
      client,
      seams: {
        getAccount: () => Promise.resolve(OTHER_ACCOUNT),
        resolveProjectAxis: () => Promise.resolve(null),
      },
    });
    check(
      "err/no-project ConfigError",
      await thrown(() => ws.use({ account: "other" })),
      ["ConfigError", "CONFIG_ERROR"],
    );
  }
  {
    const { ws } = facade(() => ({ status: 403, json: { error: "no" } }));
    check(
      "err/business-context org resolution through me() 403",
      await thrown(() => ws.getBusinessContext({ level: "organization" })),
      ["ConfigError", "CONFIG_ERROR"],
    );
  }
  {
    const { ws } = facade(() => ok({ unexpected: 1 }));
    check(
      "err/require_str_field missing",
      await thrown(() => ws.getBusinessContext()),
      ["MixpanelHeadlessError", "UNKNOWN_ERROR"],
    );
  }
  {
    const { ws } = facade(() => ok({ content: 5 }));
    check(
      "err/require_str_field wrong type",
      await thrown(() => ws.getBusinessContext()),
      ["MixpanelHeadlessError", "UNKNOWN_ERROR"],
    );
  }
  {
    const { ws } = facade(() => ok({ content: "" }));
    check(
      "err/WS2 invalid level",
      await thrown(() =>
        ws.getBusinessContext({ level: "org" as "organization" }),
      ),
      ["ParamValidationError", "WS2_INVALID_LEVEL"],
    );
  }
  {
    const { ws } = facade(() => ok({ content: "" }));
    check(
      "err/BUSINESS_CONTEXT_TOO_LONG",
      await thrown(() => ws.setBusinessContext("x".repeat(50_001))),
      ["BusinessContextValidationError", "BUSINESS_CONTEXT_TOO_LONG"],
    );
  }
  {
    const { ws, client } = facade(() => ok([]));
    await ws.close();
    await ws.close();
    check("err/close idempotent", client.isHttpOpen(), false);
    // A post-close call still works (W1-D2: the pool re-opens).
    check("err/close then reuse", (await ws.listWorkspaces()).length, 0);
  }
  {
    // R6.2: the client instance survives every switch.
    const session = makeSession({ projectId: "12345" });
    const { client } = createMockClient(session, () => ok([]));
    const ws = new Workspace({ session, client });
    const before = ws.client;
    await ws.use({ workspace: 11 });
    await ws.use({ project: "999" });
    check("r6.2/client identity", ws.client === before, true);
  }

  console.log(`\nchecks ${String(checks)}   failures ${String(failures)}`);
  if (failures > 0) {
    process.exitCode = 1;
  }
}

await main();
