/**
 * B7-A1 R10.9 harness (1/2) — namespace error-branch enumeration +
 * login_unified state-machine sweep + mandatory edge set + the
 * secret-redaction sweep, per `b7-packets.md` §3.6 items 1-4.
 *
 * Auth has NO oracle surface (playbook Risk 7), so this is branch
 * enumeration with sentinel-secret leak checks folded into EVERY error
 * row (§3.6 item 4 feeds review pair B).
 *
 * Run: `npx vite-node throwaway/b7-a1/namespace-branches.ts`
 *
 * THROWAWAY: deleted at the B7 gate; the RUN record survives in
 * `context/phase3/notes/B7-A1-notes.md`.
 */

import {
  createAccountsNamespace,
  createSessionNamespace,
  createTargetsNamespace,
  defaultAuthEffects,
  loginUnified,
  resolverSeamsFromEffects,
  slugify,
  defaultAccountName,
  UNPORTED_AUTH_SEAMS,
} from "../../packages/core/src/accounts/index.js";
import type { AuthEffects } from "../../packages/core/src/accounts/index.js";
import { OAuthTokens } from "../../packages/core/src/auth/token.js";
import { MeResponse } from "../../packages/core/src/client/me.js";
import {
  AccountExistsError,
  AccountInUseError,
  ConfigError,
  InvalidArgumentError,
  MixpanelHeadlessError,
  ParamTypeError,
  ParamValidationError,
  ProjectNotFoundError,
} from "../../packages/core/src/errors.js";
import { Secret } from "../../packages/core/src/secret.js";
import { Workspace } from "../../packages/core/src/workspace.js";
import {
  makeEffects,
  meFetch,
  setEnv,
  type EffectsBundle,
} from "../../packages/core/test/accounts/fake-auth-effects.js";

let checks = 0;
let failures = 0;

/** The pair-B sentinel — must never appear in any error surface. */
const SENTINEL = "ZZ-SENTINEL-SECRET-99";

/** Every error captured during the run (leak-swept at the end). */
const capturedErrors: unknown[] = [];

/**
 * Assert a condition.
 *
 * @param label - Row label.
 * @param ok - The outcome.
 */
function check(label: string, ok: boolean): void {
  checks += 1;
  if (!ok) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  }
}

/**
 * Run a thunk, expect a specific error class (and optional code),
 * capture the error for the leak sweep.
 *
 * @param label - Row label.
 * @param fn - The thunk (sync or async).
 * @param cls - Expected class.
 * @param code - Expected `code`, if any.
 */
async function expectError(
  label: string,
  fn: () => unknown,
  cls: abstract new (...args: never[]) => unknown,
  code?: string,
): Promise<void> {
  try {
    await fn();
    check(`${label} (threw)`, false);
  } catch (exc) {
    capturedErrors.push(exc);
    check(`${label} class`, exc instanceof cls);
    if (code !== undefined) {
      check(
        `${label} code`,
        exc instanceof MixpanelHeadlessError && exc.code === code,
      );
    }
  }
}

/** Fresh browser tokens for flow stubs. */
function tokens(access = "brw-tok"): OAuthTokens {
  return new OAuthTokens({
    access_token: new Secret(access),
    refresh_token: new Secret("brw-refresh"),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    scope: "read:project",
    token_type: "Bearer",
  });
}

/** Standard /me payload. */
function mePayload(
  projects: Record<string, unknown> = {
    "42": { name: "Demo", organization_id: 100 },
  },
): Record<string, unknown> {
  return {
    user_id: 1,
    user_email: "u@example.com",
    organizations: { "100": { id: 100, name: "Acme" } },
    projects,
  };
}

/** Seed one SA account with a SENTINEL secret. */
async function seeded(bundle: EffectsBundle): Promise<void> {
  const accounts = createAccountsNamespace(bundle.effects);
  await accounts.add("team", {
    type: "service_account",
    region: "us",
    default_project: "3713224",
    username: "u",
    secret: new Secret(SENTINEL),
  });
}

/** §3.6 item 1 — every A1-local error branch. */
async function errorBranches(): Promise<void> {
  {
    const bundle = makeEffects();
    const accounts = createAccountsNamespace(bundle.effects);
    await seeded(bundle);
    // Unknown account (show / update / remove / use / login / token).
    await expectError(
      "show unknown",
      () => accounts.show("ghost"),
      ConfigError,
    );
    await expectError(
      "update unknown",
      () => accounts.update("ghost", { default_project: "1" }),
      ConfigError,
    );
    await expectError(
      "remove unknown",
      () => accounts.remove("ghost"),
      ConfigError,
    );
    await expectError("use unknown", () => accounts.use("ghost"), ConfigError);
    await expectError(
      "login unknown",
      () => accounts.login("ghost"),
      ConfigError,
    );
    await expectError(
      "token unknown",
      () => accounts.token("ghost"),
      ConfigError,
    );
    // Duplicate add.
    await expectError(
      "duplicate add",
      () =>
        accounts.add("team", {
          type: "service_account",
          region: "us",
          username: "u",
          secret: new Secret(SENTINEL),
        }),
      AccountExistsError,
      "ACCOUNT_EXISTS",
    );
    // add TypeError twins.
    await expectError(
      "derive_name + name",
      () =>
        accounts.add("x", {
          type: "service_account",
          region: "us",
          derive_name: true,
        }),
      ParamTypeError,
    );
    await expectError(
      "no name no derive",
      () => accounts.add(null, { type: "service_account", region: "us" }),
      ParamTypeError,
    );
    // add missing-region refusals.
    await expectError(
      "SA region null",
      () =>
        accounts.add("y", {
          type: "service_account",
          username: "u",
          secret: new Secret(SENTINEL),
        }),
      ConfigError,
    );
    await expectError(
      "derive for browser",
      () =>
        accounts.add(null, {
          type: "oauth_browser",
          region: "us",
          derive_name: true,
        }),
      ConfigError,
    );
    // derive missing credentials.
    await expectError(
      "derive SA no secret",
      () =>
        accounts.add(null, {
          type: "service_account",
          region: "us",
          username: "u",
          derive_name: true,
        }),
      ConfigError,
    );
    await expectError(
      "derive OT no token",
      () =>
        accounts.add(null, {
          type: "oauth_token",
          region: "us",
          derive_name: true,
        }),
      ConfigError,
    );
    // update type-incompatible fields.
    await expectError(
      "update SA token",
      () => accounts.update("team", { token: new Secret(SENTINEL) }),
      ConfigError,
    );
    // login on non-browser.
    await expectError("login on SA", () => accounts.login("team"), ConfigError);
    // remove-active guard / force.
    const targets = createTargetsNamespace(bundle.effects);
    targets.add("ecom", { account: "team", project: "3018488" });
    await expectError(
      "remove referenced",
      () => accounts.remove("team"),
      AccountInUseError,
      "ACCOUNT_IN_USE",
    );
    const orphans = accounts.remove("team", { force: true });
    check("force remove orphans", JSON.stringify(orphans) === '["ecom"]');
    check(
      "active cleared after removing active account",
      (bundle.config.getActive().account ?? null) === null,
    );
    // Unknown target / target with deleted account.
    await expectError(
      "targets.use unknown",
      () => targets.use("ghost"),
      ConfigError,
    );
    await expectError(
      "target with deleted account",
      () => targets.use("ecom"),
      ConfigError,
    );
    // session.use / targets guard.
    const session = createSessionNamespace(bundle.effects);
    await expectError(
      "session.use target+axis",
      () => session.use({ target: "ecom", workspace: 1 }),
      ParamValidationError,
      "WS1_TARGET_MUTUALLY_EXCLUSIVE",
    );
  }

  // Region mismatch E-2 with a sentinel-bearing flow.
  {
    const bundle = makeEffects({
      oauthFlow: { login: () => Promise.resolve(tokens(SENTINEL)) },
      fetchImpl: meFetch({
        user_id: 7,
        user_email: "a@b.c",
        projects: {
          "12345": {
            name: "Demo",
            organization_id: 1,
            domain: "eu.mixpanel.com",
          },
        },
      }),
    });
    const accounts = createAccountsNamespace(bundle.effects);
    await accounts.add("personal", { type: "oauth_browser", region: "us" });
    await expectError(
      "region mismatch E-2",
      () => accounts.login("personal"),
      ConfigError,
    );
    check("E-2 leaves no tokens", !bundle.tokenStore.written.has("personal"));
  }

  // login_unified flag-validation matrix.
  {
    const bundle = makeEffects();
    await expectError(
      "flags: sa+token_env",
      () =>
        loginUnified(bundle.effects, {
          service_account: true,
          token_env: "T",
        }),
      InvalidArgumentError,
      "INVALID_ARGUMENT",
    );
    await expectError(
      "flags: sa flag vs oauth_token",
      () =>
        loginUnified(bundle.effects, {
          service_account: true,
          account_type: "oauth_token",
        }),
      InvalidArgumentError,
    );
    await expectError(
      "flags: no_browser misuse",
      () =>
        loginUnified(bundle.effects, {
          service_account: true,
          no_browser: true,
        }),
      InvalidArgumentError,
    );
    await expectError(
      "flags: secret_stdin misuse",
      () =>
        loginUnified(bundle.effects, {
          token_env: "T",
          secret_stdin: true,
        }),
      InvalidArgumentError,
    );
    // Missing env credentials.
    await expectError(
      "SA missing MP_USERNAME",
      () =>
        loginUnified(bundle.effects, {
          account_type: "service_account",
          region: "us",
        }),
      ConfigError,
    );
    await expectError(
      "OT missing bearer env",
      () =>
        loginUnified(bundle.effects, {
          account_type: "oauth_token",
          region: "us",
        }),
      ConfigError,
    );
  }

  // Relogin refusals E-3 / E-4 + stale MP_PROJECT_ID + E-8 no picker
  // + explicit project not visible (E-6).
  {
    const bundle = makeEffects({
      env: { MP_USERNAME: "u", MP_SECRET: SENTINEL },
      fetchImpl: meFetch(
        mePayload({
          "1": { name: "a", organization_id: 100 },
          "2": { name: "b", organization_id: 100 },
        }),
      ),
    });
    await seeded(bundle);
    await expectError(
      "relogin type change E-4",
      () =>
        loginUnified(bundle.effects, {
          name: "team",
          account_type: "oauth_browser",
        }),
      ConfigError,
    );
    await expectError(
      "relogin region change E-3",
      () =>
        loginUnified(bundle.effects, {
          name: "team",
          account_type: "service_account",
          region: "eu",
        }),
      ConfigError,
    );
    await expectError(
      "E-6 explicit project not visible",
      () =>
        loginUnified(bundle.effects, {
          account_type: "service_account",
          region: "us",
          name: "n1",
          project: "999",
        }),
      ProjectNotFoundError,
      "PROJECT_NOT_FOUND",
    );
    await expectError(
      "E-8 multi-project no picker",
      () =>
        loginUnified(bundle.effects, {
          account_type: "service_account",
          region: "us",
          name: "n2",
        }),
      ConfigError,
    );
    setEnv(bundle, "MP_PROJECT_ID", "31337");
    await expectError(
      "stale MP_PROJECT_ID hard-fails",
      () =>
        loginUnified(bundle.effects, {
          account_type: "service_account",
          region: "us",
          name: "n3",
        }),
      ConfigError,
    );
  }

  // Every UNPORTED_AUTH_SEAM default (call each stubbed member).
  {
    const stub: AuthEffects = defaultAuthEffects();
    const seamCalls: Array<readonly [string, () => unknown]> = [
      ["config.getAccount", () => stub.config.getAccount("x")],
      ["config.getActive", () => stub.config.getActive()],
      ["config.getTarget", () => stub.config.getTarget("x")],
      ["config.getCustomHeader", () => stub.config.getCustomHeader()],
      [
        "config.addAccount",
        () =>
          stub.config.addAccount("x", { type: "oauth_browser", region: "us" }),
      ],
      ["config.updateAccount", () => stub.config.updateAccount("x", {})],
      ["config.removeAccount", () => stub.config.removeAccount("x")],
      ["config.listAccounts", () => stub.config.listAccounts()],
      ["config.setActive", () => stub.config.setActive({})],
      ["config.applySession", () => stub.config.applySession({})],
      ["config.applyTarget", () => stub.config.applyTarget("x")],
      [
        "config.addTarget",
        () => stub.config.addTarget("x", { account: "a", project: "1" }),
      ],
      ["config.removeTarget", () => stub.config.removeTarget("x")],
      ["config.listTargets", () => stub.config.listTargets()],
      ["env.get", () => stub.env.get("MP_REGION")],
      ["env.MP_USERNAME", () => stub.env.MP_USERNAME],
      ["env.MP_SECRET", () => stub.env.MP_SECRET],
      ["env.MP_PROJECT_ID", () => stub.env.MP_PROJECT_ID],
      ["env.MP_REGION", () => stub.env.MP_REGION],
      ["env.MP_OAUTH_TOKEN", () => stub.env.MP_OAUTH_TOKEN],
      ["env.MP_WORKSPACE_ID", () => stub.env.MP_WORKSPACE_ID],
      ["tokenStore.readTokens", () => stub.tokenStore.readTokens("x")],
      [
        "tokenStore.writeTokens",
        () => stub.tokenStore.writeTokens("x", tokens()),
      ],
      ["tokenStore.removeTokens", () => stub.tokenStore.removeTokens("x")],
      [
        "tokenStore.removeAccountDir",
        () => stub.tokenStore.removeAccountDir("x"),
      ],
      ["tokenStore.clientInfoPath", () => stub.tokenStore.clientInfoPath("us")],
      [
        "tokenResolver.getBrowserToken",
        () => stub.tokenResolver.getBrowserToken("x", "us"),
      ],
      [
        "tokenResolver.getStaticToken",
        () =>
          stub.tokenResolver.getStaticToken({
            type: "oauth_token",
            name: "x",
            region: "us",
            token: new Secret("t"),
          }),
      ],
      [
        "oauthFlow.login",
        () => stub.oauthFlow.login("us", { openBrowser: false }),
      ],
      ["bridge.load", () => stub.bridge.load()],
      [
        "bridge.export",
        () =>
          stub.bridge.export({
            account: {
              type: "oauth_token",
              name: "x",
              region: "us",
              token: new Secret("t"),
            },
            to: "/tmp/x",
            project: null,
            workspace: null,
            headers: null,
            tokenResolver: stub.tokenResolver,
          }),
      ],
      ["bridge.remove", () => stub.bridge.remove(null)],
      ["meCache.put", () => stub.meCache.put("x", new MeResponse({}))],
      [
        "persistActive",
        () =>
          stub.persistActive({
            account: {
              type: "oauth_token",
              name: "x",
              region: "us",
              token: new Secret("t"),
            },
            project: { id: "1" },
            workspace: null,
            headers: new Map(),
          }),
      ],
      ["readSecretStdin", () => stub.readSecretStdin()],
    ];
    for (const [name, fn] of seamCalls) {
      try {
        fn();
        check(`seam ${name} throws`, false);
      } catch (exc) {
        capturedErrors.push(exc);
        check(
          `seam ${name} coded`,
          exc instanceof MixpanelHeadlessError &&
            exc.code === "UNPORTED_AUTH_SEAM" &&
            typeof exc.details["seam"] === "string",
        );
      }
    }
    // narrate is a documented NO-OP default (not in the list).
    stub.narrate("x");
    check("narrate default is a no-op", true);
    check(
      "UNPORTED_AUTH_SEAMS names committed",
      UNPORTED_AUTH_SEAMS.includes("persistActive") &&
        UNPORTED_AUTH_SEAMS.includes("readSecretStdin"),
    );
  }

  // The ONE remaining UNPORTED path through the REAL seams:
  // persistActive when B8 is absent (`b7-packets.md` §3.6 item 1).
  {
    const bundle = makeEffects();
    await seeded(bundle);
    const stubbed: AuthEffects = {
      ...bundle.effects,
      persistActive: defaultAuthEffects().persistActive,
    };
    const ws = new Workspace({
      session: {
        account: bundle.config.getAccount("team"),
        project: { id: "3713224" },
        workspace: null,
        headers: new Map(),
      },
      seams: resolverSeamsFromEffects(stubbed),
    });
    await expectError(
      "persistActive stays stubbed",
      () => ws.use({ project: "9999999", persist: true }),
      MixpanelHeadlessError,
      "UNPORTED_AUTH_SEAM",
    );
    await ws.close();
  }
}

/** §3.6 item 2 — the login_unified state-machine sweep. */
async function stateMachineSweep(): Promise<void> {
  type Detect = "sa" | "ot" | "browser";
  const detects: Detect[] = ["sa", "ot", "browser"];
  const regions = ["explicit", "probed"] as const;
  const projects = ["explicit", "picked", "single", "none"] as const;

  for (const detect of detects) {
    for (const regionMode of regions) {
      for (const projectMode of projects) {
        const label = `sweep ${detect}/${regionMode}/${projectMode}`;
        const projectsPayload: Record<string, unknown> =
          projectMode === "none"
            ? {}
            : projectMode === "single"
              ? { "42": { name: "Demo", organization_id: 100 } }
              : {
                  "42": { name: "Demo", organization_id: 100 },
                  "43": { name: "Other", organization_id: 100 },
                };
        const payload = mePayload(projectsPayload);
        // Probed region: us rejects, eu accepts (both the probe GET and
        // the subsequent /me client call hit the fake fetch).
        const fetchImpl = (async (
          input: string | URL | Request,
        ): Promise<Response> => {
          const url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
          const isEu = url.includes("eu.mixpanel.com");
          // The browser path never probes (region defaults to us), so
          // the 401-until-eu ladder applies to SA/OT only.
          if (regionMode === "probed" && detect !== "browser" && !isEu) {
            return new Response("{}", { status: 401 });
          }
          return new Response(JSON.stringify({ results: payload }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }) as typeof fetch;

        const env: Record<string, string> = {};
        if (detect === "sa") {
          env["MP_USERNAME"] = "svc";
          env["MP_SECRET"] = SENTINEL;
        } else if (detect === "ot") {
          env["MP_OAUTH_TOKEN"] = SENTINEL;
        }
        const bundle = makeEffects({
          env,
          fetchImpl,
          oauthFlow: { login: () => Promise.resolve(tokens(SENTINEL)) },
        });
        const expectedRegion = regionMode === "explicit" ? "us" : "eu";
        const picked: string[] = [];
        try {
          const summary = await loginUnified(bundle.effects, {
            name: "acct",
            ...(regionMode === "explicit" ? { region: "us" } : {}),
            ...(projectMode === "explicit" ? { project: "42" } : {}),
            ...(projectMode === "picked"
              ? {
                  project_picker: (_me, sorted) => {
                    picked.push("called");
                    return (sorted[0] as readonly [string, unknown])[0];
                  },
                }
              : {}),
            ...(detect === "browser" ? { no_browser: true } : {}),
          });
          // Browser region: probing never applies — defaults to us.
          const wantRegion =
            detect === "browser"
              ? regionMode === "explicit"
                ? "us"
                : "us"
              : expectedRegion;
          check(`${label} region`, summary.region === wantRegion);
          check(
            `${label} active`,
            bundle.config.getActive().account === "acct",
          );
          check(`${label} meCache`, bundle.meCachePuts.has("acct"));
          if (projectMode === "none") {
            check(`${label} project null`, summary.project_id === null);
          } else {
            check(
              `${label} project set`,
              summary.project_id !== null && summary.project_id !== "",
            );
          }
          if (projectMode === "picked") {
            check(`${label} picker called`, picked.length === 1);
          }
          if (detect === "browser") {
            check(
              `${label} tokens written`,
              bundle.tokenStore.written.has("acct"),
            );
          }
        } catch (exc) {
          capturedErrors.push(exc);
          // Browser + probed region: the browser path never probes and
          // authenticates to us; every combo here should SUCCEED.
          check(`${label} unexpected error: ${String(exc)}`, false);
        }
      }
    }
  }

  // Relogin arms: SA rotate / OT env-mode preservation / browser re-PKCE.
  {
    const bundle = makeEffects({
      env: { MP_USERNAME: "u2", MP_SECRET: "rotated" },
      fetchImpl: meFetch(mePayload()),
    });
    await seeded(bundle);
    const summary = await loginUnified(bundle.effects, {
      name: "team",
      account_type: "service_account",
      region: "us",
    });
    check("relogin SA summary", summary.name === "team");
    const account = bundle.config.getAccount("team");
    check(
      "relogin SA rotated secret persisted",
      account.type === "service_account" &&
        account.secret.reveal() === "rotated" &&
        account.username === "u2",
    );
    check("relogin activates", bundle.config.getActive().account === "team");
    check("relogin project note absent", bundle.narrations.length === 0);
  }
  {
    // OT relogin preserves env-ref mode; --project narrates the E-5 note.
    const bundle = makeEffects({
      env: { MY_VAR: "bearer-x" },
      fetchImpl: meFetch(mePayload()),
    });
    const accounts = createAccountsNamespace(bundle.effects);
    await accounts.add("ci", {
      type: "oauth_token",
      region: "us",
      token_env: "MY_VAR",
    });
    await loginUnified(bundle.effects, {
      name: "ci",
      account_type: "oauth_token",
      project: "42",
    });
    const account = bundle.config.getAccount("ci");
    check(
      "relogin OT keeps env-ref mode",
      account.type === "oauth_token" &&
        (account.token_env ?? null) === "MY_VAR" &&
        (account.token ?? null) === null,
    );
    check(
      "relogin E-5 note narrated",
      bundle.narrations.some((line) => line.includes("--project ignored")),
    );
  }
  {
    // Browser relogin re-runs PKCE and persists fresh tokens.
    const bundle = makeEffects({
      fetchImpl: meFetch(mePayload()),
      oauthFlow: { login: () => Promise.resolve(tokens("fresh")) },
    });
    const accounts = createAccountsNamespace(bundle.effects);
    await accounts.add("personal", {
      type: "oauth_browser",
      region: "us",
      default_project: "42",
    });
    await loginUnified(bundle.effects, { name: "personal", no_browser: true });
    check(
      "browser relogin persists fresh tokens",
      bundle.tokenStore.written.get("personal")?.access_token.reveal() ===
        "fresh",
    );
  }
}

/** §3.6 item 3 — the mandatory edge set through admitting params. */
async function edgeSet(): Promise<void> {
  // slugify / defaultAccountName over the edge strings.
  check('slugify("") edge', slugify("") === "");
  // "𝒳" (U+1D4B3) is a COMPATIBILITY character: NFKD folds it to "X"
  // → "x" (verified against CPython 2026-08-16: slugify("𝒳") == "x").
  check('slugify("𝒳") edge (NFKD compat fold)', slugify("𝒳") === "x");
  // A non-compat astral char ("🎉") has no NFKD decomposition → "".
  check('slugify("🎉") edge', slugify("🎉") === "");
  check("slugify(18.0-ish string)", slugify("18.0") === "18-0");
  const meAstral = new MeResponse({
    organizations: { "7": { id: 7, name: "🎉" } },
  });
  check(
    "defaultAccountName astral fallback",
    defaultAccountName(meAstral, new Set()) === "org-7",
  );

  const bundle = makeEffects();
  await seeded(bundle);
  const accounts = createAccountsNamespace(bundle.effects);
  const targets = createTargetsNamespace(bundle.effects);

  // Account-name boundaries 1 / 64 / 65 / astral / empty — consistency
  // with the Phase-2 parseAccount contract (coded errors only).
  const okShort = await accounts.add("a", {
    type: "oauth_browser",
    region: "us",
  });
  check("1-char name ok", okShort.name === "a");
  const name64 = "b".repeat(64);
  const ok64 = await accounts.add(name64, {
    type: "oauth_browser",
    region: "us",
  });
  check("64-char name ok", ok64.name === name64);
  for (const bad of ["", "𝒳", "c".repeat(65)]) {
    try {
      await accounts.add(bad, { type: "oauth_browser", region: "us" });
      // Only acceptable if the underlying account model accepts it too
      // (65-char names: the Phase-2 name pattern has no upper bound in
      // parseAccount — record, don't fail).
      check(
        `edge name ${JSON.stringify(bad).slice(0, 12)} accepted-consistently`,
        bad === "c".repeat(65),
      );
    } catch (exc) {
      capturedErrors.push(exc);
      check(
        `edge name ${JSON.stringify(bad).slice(0, 12)} coded`,
        exc instanceof MixpanelHeadlessError,
      );
    }
  }

  // Workspace ids: 18.0 (integral float) / 1.5 / "" via targets.add.
  const t18 = targets.add("t18", {
    account: "team",
    project: "1",
    workspace: 18.0,
  });
  check("workspace 18.0 → 18", t18.workspace === 18);
  await expectError(
    "workspace 1.5 rejected",
    () => targets.add("t15", { account: "team", project: "1", workspace: 1.5 }),
    ConfigError,
  );
  // Empty-string project.
  await expectError(
    "empty project rejected",
    () => targets.add("tp", { account: "team", project: "" }),
    ConfigError,
  );
}

/** §3.6 item 4 — the secret-redaction sweep over EVERYTHING captured. */
function leakSweep(): void {
  for (const exc of capturedErrors) {
    const message = exc instanceof Error ? exc.message : String(exc);
    check("no sentinel in message", !message.includes(SENTINEL));
    if (exc instanceof MixpanelHeadlessError) {
      check(
        "no sentinel in details JSON",
        !JSON.stringify(exc.toDict()).includes(SENTINEL),
      );
    }
  }
}

const bundles: EffectsBundle[] = [];
void bundles;

await errorBranches();
await stateMachineSweep();
await edgeSet();
leakSweep();

console.log(
  `namespace-branches: checks ${String(checks)}  failures ${String(failures)}  captured-errors ${String(capturedErrors.length)}`,
);
if (failures > 0) {
  process.exitCode = 1;
}
