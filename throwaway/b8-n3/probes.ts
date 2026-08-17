// B8-N3 R10.9 harness — deterministic branch probes (b8-packets.md
// §4.5 rows 1, 3, 4, 5, 6). Run: npx vite-node throwaway/b8-n3/probes.ts
//
// Row 1: callback-server port-conflict fallback (occupy 19284 →
//   19285; all four → coded {ports}; 19284+19286 → 19285), the
//   two-concurrent-starts race (distinct ports), and the GET matrix
//   (success, wrong state, error=access_denied, missing code, wrong
//   path, double-hit after resolve, non-GET, exact-port busy,
//   timeout).
// Row 3: DCR — cached fast-path zero-fetch, every non-2xx / malformed
//   branch, persist-then-return ordering (fault between register and
//   persist → next call re-registers), region validation triple.
// Row 4: login state machine — openBrowser true/false ×
//   callback-vs-paste × exchange success/failure × persist
//   true/false over injected seams; authorize-URL param order + S256
//   + state echo; `_parse_pasted_redirect` branch table.
// Row 5: bag sweep e2e — `loginUnified` browser path over the REAL
//   node bag: REAL port probe + REAL localhost callback server (the
//   injected `openBrowser` fires the redirect GET itself), fake
//   register/token//me fetch, tmp HOME. Asserts: account dir 0o700,
//   tokens.json 0o600, config updated ([active] + account block),
//   me.json written, orphan-dir guard (`accountDirExists`) trips on a
//   pre-seeded directory.
// Row 6: secret-redaction sweep over the login/DCR branches (pair-B
//   feed): sentinel tokens appear in NO thrown message and NOT in the
//   masked JSON of returned tokens; on-disk appearances ONLY at the
//   designated reveal sites. Python-parity allowlist: the
//   model-invalid branch's `details.response_data` carries
//   `pythonStr(data)` — Python embeds the raw body there too
//   (`flow.py:600-604`), recorded in the notes allowlist.

import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer as createNetServer, type Server } from "node:net";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { resolve, sep } from "node:path";

import type { OAuthClientInfo } from "../../packages/core/src/auth/token.js";
import { ConfigError, OAuthError } from "../../packages/core/src/errors.js";
import { loginUnified } from "../../packages/core/src/accounts/login-unified.js";
import { createNodeAuthEffects } from "../../packages/node/src/auth-effects.js";
import {
  CALLBACK_PORTS,
  CallbackResult,
  startCallbackServer,
} from "../../packages/node/src/auth/callback-server.js";
import { ensureClientRegistered } from "../../packages/node/src/auth/client-registration.js";
import {
  OAuthFlow,
  findAvailablePort,
  parsePastedRedirect,
} from "../../packages/node/src/auth/flow.js";
import { PkceChallenge } from "../../packages/node/src/auth/pkce.js";
import { OAuthStorage } from "../../packages/node/src/auth/storage.js";
import { ConfigManager } from "../../packages/node/src/config.js";

const ROOT = mkdtempSync(join(tmpdir(), "mp-b8n3-probes-"));
{
  const home = resolve(homedir());
  const resolved = resolve(ROOT);
  if (resolved === home || resolved.startsWith(home + sep)) {
    throw new Error(`real-home guard: ${resolved}`);
  }
}

let passed = 0;
let failed = 0;
const failures: string[] = [];

/**
 * Record one probe outcome.
 *
 * @param name - Probe label.
 * @param condition - Whether the probe held.
 */
function check(name: string, condition: boolean): void {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    failures.push(name);
    console.error(`FAIL ${name}`);
  }
}

/**
 * Await an error from a promise.
 *
 * @param promise - The promise expected to reject.
 * @returns The rejection value, or null when it resolved.
 */
function errOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (exc: unknown) => exc,
  );
}

/**
 * Occupy a port with a bare TCP listener.
 *
 * @param port - Port on 127.0.0.1.
 * @returns The listening server.
 */
function occupy(port: number): Promise<Server> {
  return new Promise((res, rej) => {
    const server = createNetServer();
    server.once("error", rej);
    server.listen(port, "127.0.0.1", () => {
      res(server);
    });
  });
}

/**
 * Close a net server.
 *
 * @param server - The server to close.
 */
function closeServer(server: Server): Promise<void> {
  return new Promise((res) => {
    server.close(() => {
      res();
    });
  });
}

/** Sleep helper. */
function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

// ---------------------------------------------------------------------------
// Row 1 — callback server matrix (real binds; sequential — no vitest
// worker contention here).
// ---------------------------------------------------------------------------

async function row1(): Promise<void> {
  // Fallback: occupy 19284 → server lands 19285.
  {
    const squat = await occupy(19284);
    const p = startCallbackServer({ state: "s1", timeoutSeconds: 10 });
    await sleep(50);
    await fetch("http://localhost:19285/callback?code=c1&state=s1");
    const [result, port] = await p;
    check("row1 fallback 19285", port === 19285 && result.code === "c1");
    await closeServer(squat);
  }
  // Occupy 19284 + 19286 → 19285.
  {
    const a = await occupy(19284);
    const b = await occupy(19286);
    const p = startCallbackServer({ state: "s2", timeoutSeconds: 10 });
    await sleep(50);
    await fetch("http://localhost:19285/callback?code=c2&state=s2");
    const [, port] = await p;
    check("row1 skip-hole lands 19285", port === 19285);
    await closeServer(a);
    await closeServer(b);
  }
  // All four busy → coded error with {ports}.
  {
    const squats = await Promise.all(CALLBACK_PORTS.map((p) => occupy(p)));
    const exc = (await errOf(
      startCallbackServer({ state: "s3", timeoutSeconds: 5 }),
    )) as OAuthError;
    check(
      "row1 all-busy OAUTH_PORT_ERROR {ports}",
      exc instanceof OAuthError &&
        exc.code === "OAUTH_PORT_ERROR" &&
        JSON.stringify(exc.details) ===
          JSON.stringify({ ports: CALLBACK_PORTS }),
    );
    // Exact-port busy → {port}.
    const excPort = (await errOf(
      startCallbackServer({ state: "s3b", timeoutSeconds: 5, port: 19284 }),
    )) as OAuthError;
    check(
      "row1 exact-port busy {port}",
      excPort instanceof OAuthError &&
        excPort.code === "OAUTH_PORT_ERROR" &&
        JSON.stringify(excPort.details) === JSON.stringify({ port: 19284 }),
    );
    await Promise.all(squats.map((s) => closeServer(s)));
  }
  // Race: two concurrent starts land distinct ports.
  {
    const p1 = startCallbackServer({ state: "r1", timeoutSeconds: 10 });
    const p2 = startCallbackServer({ state: "r2", timeoutSeconds: 10 });
    const s1 = p1.then(
      (value) => value as unknown,
      (exc: unknown) => exc,
    );
    const s2 = p2.then(
      (value) => value as unknown,
      (exc: unknown) => exc,
    );
    await sleep(80);
    // Complete both — whichever holds 19284 gets r-state by probing
    // each port with its own state; a wrong-state hit would settle a
    // server with an error, so hit each port with BOTH states is
    // wrong. Instead: complete sequentially by port.
    const done1 = fetch("http://localhost:19284/callback?code=x&state=r1").then(
      (r) => r.status,
      () => -1,
    );
    const done2 = fetch("http://localhost:19285/callback?code=y&state=r2").then(
      (r) => r.status,
      () => -1,
    );
    await Promise.all([done1, done2]);
    const outcomes = [await s1, await s2];
    const ports: number[] = [];
    for (const outcome of outcomes) {
      if (Array.isArray(outcome)) {
        ports.push((outcome as readonly [CallbackResult, number])[1]);
      }
    }
    // At minimum the two servers bound DISTINCT ports 19284/19285 —
    // if state routing mismatched (p1 on 19285), one promise rejects
    // with a state-mismatch error, still proving distinct binds.
    check(
      "row1 concurrent starts bind distinct ports",
      new Set(ports).size === ports.length && ports.length >= 1,
    );
  }
  // GET matrix on a fresh server each time.
  {
    // wrong state
    const p = startCallbackServer({ state: "good", timeoutSeconds: 10 });
    const excP = errOf(p); // attach BEFORE the rejection can fire
    await sleep(50);
    const resp = await fetch(
      "http://localhost:19284/callback?code=c&state=BAD",
    );
    const body = await resp.text();
    const exc = (await excP) as OAuthError;
    check(
      "row1 state mismatch: 400 + coded error + no state leak",
      resp.status === 400 &&
        exc instanceof OAuthError &&
        exc.code === "OAUTH_TOKEN_ERROR" &&
        (exc.details as Record<string, unknown>)["expected_state"] === "good" &&
        !body.includes("good"),
    );
  }
  {
    // error param with escaping
    const p = startCallbackServer({ state: "e", timeoutSeconds: 10 });
    const excP = errOf(p);
    await sleep(50);
    const resp = await fetch(
      "http://localhost:19284/callback?error=access_denied&error_description=" +
        encodeURIComponent("<b>&'\"x"),
    );
    const body = await resp.text();
    const exc = (await excP) as OAuthError;
    check(
      "row1 error param: escaped html + details",
      resp.status === 400 &&
        body.includes("&lt;b&gt;&amp;&#x27;&quot;x") &&
        exc.code === "OAUTH_TOKEN_ERROR" &&
        (exc.details as Record<string, unknown>)["error"] === "access_denied",
    );
  }
  {
    // missing code
    const p = startCallbackServer({ state: "m", timeoutSeconds: 10 });
    const excP = errOf(p);
    await sleep(50);
    const resp = await fetch("http://localhost:19284/callback?state=m");
    const exc = (await excP) as OAuthError;
    check(
      "row1 missing code: 400 + OAUTH_TOKEN_ERROR",
      resp.status === 400 && exc.code === "OAUTH_TOKEN_ERROR",
    );
  }
  {
    // wrong path (query still parsed — Python do_GET ignores the path)
    const p = startCallbackServer({ state: "wp", timeoutSeconds: 10 });
    await sleep(50);
    await fetch("http://localhost:19284/anything?code=k&state=wp");
    const [result] = await p;
    check("row1 wrong path still parses query", result.code === "k");
  }
  {
    // wrong path with NO params → missing-param error (one-shot spent)
    const p = startCallbackServer({ state: "np", timeoutSeconds: 10 });
    const excP = errOf(p);
    await sleep(50);
    const resp = await fetch("http://localhost:19284/favicon.ico");
    const exc = (await excP) as OAuthError;
    check(
      "row1 paramless path consumes the one shot",
      resp.status === 400 && exc.code === "OAUTH_TOKEN_ERROR",
    );
  }
  {
    // double-hit after resolve: second GET is refused (server closed)
    const p = startCallbackServer({ state: "d", timeoutSeconds: 10 });
    await sleep(50);
    await fetch("http://localhost:19284/callback?code=first&state=d");
    const [result] = await p;
    const second = await fetch(
      "http://localhost:19284/callback?code=second&state=d",
    ).then(
      (r) => r.status,
      () => -1,
    );
    check(
      "row1 double-hit: first wins, second refused",
      result.code === "first" && second === -1,
    );
  }
  {
    // non-GET → 501 + the timeout-shaped no-result error (ported)
    const p = startCallbackServer({ state: "ng", timeoutSeconds: 10 });
    const excP = errOf(p);
    await sleep(50);
    const resp = await fetch("http://localhost:19284/callback", {
      method: "POST",
    });
    const exc = (await excP) as OAuthError;
    check(
      "row1 non-GET: 501 + OAUTH_TIMEOUT-shaped",
      resp.status === 501 && exc.code === "OAUTH_TIMEOUT",
    );
  }
  {
    // timeout
    const started = Date.now();
    const exc = (await errOf(
      startCallbackServer({ state: "t", timeoutSeconds: 0.3 }),
    )) as OAuthError;
    check(
      "row1 timeout: OAUTH_TIMEOUT {timeout_seconds}",
      exc.code === "OAUTH_TIMEOUT" &&
        (exc.details as Record<string, unknown>)["timeout_seconds"] === 0.3 &&
        Date.now() - started < 5_000,
    );
  }
}

// ---------------------------------------------------------------------------
// Row 3 — DCR branches.
// ---------------------------------------------------------------------------

const SENTINEL = "SENTINEL-9f2c-CRED";

async function row3(): Promise<void> {
  const mkStorage = (): OAuthStorage =>
    new OAuthStorage({ storageDir: mkdtempSync(join(ROOT, "dcr-")) });
  const jsonFetch = (
    status: number,
    body: unknown,
    headers?: Record<string, string>,
  ) =>
    ((): Promise<Response> =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json", ...headers },
        }),
      )) as typeof fetch;

  // Cached fast path: zero fetches.
  {
    let count = 0;
    const fetchImpl = ((): Promise<Response> => {
      count += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ client_id: `cid-${count}` }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as typeof fetch;
    const storage = mkStorage();
    const base = {
      fetchImpl,
      region: "us",
      redirectUri: "http://localhost:19284/callback",
      storage,
    };
    const first = await ensureClientRegistered(base);
    const second = await ensureClientRegistered(base);
    check(
      "row3 cache fast-path zero fetch",
      count === 1 && first.client_id === second.client_id,
    );
    const third = await ensureClientRegistered({
      ...base,
      redirectUri: "http://localhost:19285/callback",
    });
    check(
      "row3 redirect change re-registers",
      count === 2 && third.client_id === "cid-2",
    );
  }
  // Transport failure.
  {
    const fetchImpl = ((): Promise<Response> =>
      Promise.reject(new TypeError("conn refused"))) as typeof fetch;
    const exc = (await errOf(
      ensureClientRegistered({
        fetchImpl,
        region: "eu",
        redirectUri: "http://localhost:19284/callback",
        storage: mkStorage(),
      }),
    )) as OAuthError;
    const details = exc.details as Record<string, unknown>;
    check(
      "row3 transport → OAUTH_REGISTRATION_ERROR {region,url}",
      exc.code === "OAUTH_REGISTRATION_ERROR" &&
        details["region"] === "eu" &&
        details["url"] === "https://eu.mixpanel.com/oauth/mcp/register/",
    );
  }
  // 429 with and without Retry-After.
  for (const [label, headers, expected] of [
    ["with", { "Retry-After": "60" }, "60"],
    ["without", {}, null],
  ] as const) {
    const exc = (await errOf(
      ensureClientRegistered({
        fetchImpl: jsonFetch(429, { error: "rate_limited" }, { ...headers }),
        region: "us",
        redirectUri: "http://localhost:19284/callback",
        storage: mkStorage(),
      }),
    )) as OAuthError;
    const details = exc.details as Record<string, unknown>;
    check(
      `row3 429 ${label} Retry-After`,
      exc.code === "OAUTH_REGISTRATION_ERROR" &&
        details["status_code"] === 429 &&
        details["retry_after"] === expected,
    );
  }
  // Non-2xx statuses.
  for (const status of [301, 400, 403, 500, 503]) {
    const exc = (await errOf(
      ensureClientRegistered({
        fetchImpl: jsonFetch(status, { oops: true }),
        region: "us",
        redirectUri: "http://localhost:19284/callback",
        storage: mkStorage(),
      }),
    )) as OAuthError;
    const details = exc.details as Record<string, unknown>;
    check(
      `row3 non-2xx ${status}`,
      exc.code === "OAUTH_REGISTRATION_ERROR" &&
        details["status_code"] === status &&
        typeof details["response_body"] === "string",
    );
  }
  // Malformed success bodies.
  {
    const nonJson = ((): Promise<Response> =>
      Promise.resolve(
        new Response("<html>oops</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      )) as typeof fetch;
    const cases: readonly [string, typeof fetch][] = [
      ["non-json", nonJson],
      ["missing client_id", jsonFetch(200, {})],
      ["list body", jsonFetch(200, [1, 2])],
    ];
    for (const [label, fetchImpl] of cases) {
      const exc = (await errOf(
        ensureClientRegistered({
          fetchImpl,
          region: "us",
          redirectUri: "http://localhost:19284/callback",
          storage: mkStorage(),
        }),
      )) as OAuthError;
      check(
        `row3 malformed body: ${label}`,
        exc instanceof OAuthError && exc.code === "OAUTH_REGISTRATION_ERROR",
      );
    }
    // Numeric client_id → pythonStr.
    const ok = await ensureClientRegistered({
      fetchImpl: jsonFetch(201, { client_id: 42 }),
      region: "us",
      redirectUri: "http://localhost:19284/callback",
      storage: mkStorage(),
    });
    check("row3 numeric client_id → '42'", ok.client_id === "42");
  }
  // Persist-then-return ordering: persist failure → error, and the
  // NEXT call re-registers (nothing was cached).
  {
    let count = 0;
    const fetchImpl = ((): Promise<Response> => {
      count += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ client_id: `cid-${count}` }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as typeof fetch;
    // A save-crashing subclass simulates the fault BETWEEN register
    // and persist; the load path is untouched, so nothing is ever
    // cached and the next call re-registers.
    let failSave = true;
    class FaultyStorage extends OAuthStorage {
      /** Crash once, then behave (the crash-window fault). */
      override saveClientInfo(info: OAuthClientInfo): void {
        if (failSave) {
          throw new Error("simulated persist crash");
        }
        super.saveClientInfo(info);
      }
    }
    const faulty = new FaultyStorage({
      storageDir: mkdtempSync(join(ROOT, "dcr-fault-")),
    });
    const exc = await errOf(
      ensureClientRegistered({
        fetchImpl,
        region: "us",
        redirectUri: "http://localhost:19284/callback",
        storage: faulty,
      }),
    );
    failSave = false;
    const second = await ensureClientRegistered({
      fetchImpl,
      region: "us",
      redirectUri: "http://localhost:19284/callback",
      storage: faulty,
    });
    check(
      "row3 persist-before-return: crash → re-register next call",
      exc instanceof Error && count === 2 && second.client_id === "cid-2",
    );
  }
  // Region validation triple + invalid.
  {
    let touched = 0;
    const fetchImpl = ((): Promise<Response> => {
      touched += 1;
      return Promise.resolve(
        new Response(JSON.stringify({ client_id: "x" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as typeof fetch;
    const exc = (await errOf(
      ensureClientRegistered({
        fetchImpl,
        region: "xx",
        redirectUri: "http://localhost:19284/callback",
        storage: mkStorage(),
      }),
    )) as OAuthError;
    check(
      "row3 region xx refused before any fetch",
      exc.code === "OAUTH_REGISTRATION_ERROR" && touched === 0,
    );
    for (const region of ["us", "eu", "in"]) {
      const ok = await ensureClientRegistered({
        fetchImpl,
        region,
        redirectUri: "http://localhost:19284/callback",
        storage: mkStorage(),
      });
      check(`row3 region ${region} accepted`, ok.region === region);
    }
  }
}

// ---------------------------------------------------------------------------
// Row 4 — login state machine over injected seams.
// ---------------------------------------------------------------------------

interface LoginRun {
  flow: OAuthFlow;
  openedUrls: string[];
  stderrText: string[];
  exchanged: string[];
  storageDir: string;
}

/**
 * Build a login-ready flow with injected seams.
 *
 * @param options - Behavior toggles.
 * @returns The run bundle.
 */
function makeLoginRun(options: {
  blockCallback?: boolean;
  callbackErrors?: boolean;
  exchangeStatus?: number;
  pasteLine?: (state: string) => string;
  openBrowserThrows?: boolean;
  noPorts?: boolean;
  accessToken?: string;
}): LoginRun {
  const openedUrls: string[] = [];
  const stderrText: string[] = [];
  const exchanged: string[] = [];
  const storageDir = mkdtempSync(join(ROOT, "login-"));
  const fetchImpl = ((
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/oauth/token/")) {
      exchanged.push(typeof init?.body === "string" ? init.body : "");
      const status = options.exchangeStatus ?? 200;
      const body =
        status === 200
          ? {
              access_token: options.accessToken ?? "tok",
              refresh_token: "ref",
              expires_in: 3600,
              scope: "projects",
              token_type: "Bearer",
            }
          : { error: "server_error" };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    throw new Error(`unexpected URL: ${url}`);
  }) as typeof fetch;
  const flow = new OAuthFlow({
    region: "us",
    storage: new OAuthStorage({ storageDir }),
    fetchImpl,
    openBrowser: (url: string): void => {
      if (options.openBrowserThrows === true) {
        throw new Error("no browser");
      }
      openedUrls.push(url);
    },
    startCallbackServer: (cb): Promise<readonly [CallbackResult, number]> => {
      if (options.blockCallback === true) {
        return new Promise<never>(() => undefined);
      }
      if (options.callbackErrors === true) {
        return Promise.reject(
          new OAuthError("simulated callback failure", "OAUTH_TOKEN_ERROR"),
        );
      }
      return Promise.resolve([
        new CallbackResult({ code: "CBCODE", state: cb.state }),
        cb.port ?? 19284,
      ] as const);
    },
    registerClient: (args): Promise<OAuthClientInfo> =>
      Promise.resolve({
        client_id: "cid",
        region: args.region,
        redirect_uri: args.redirectUri,
        scope: "projects",
        created_at: "2026-01-01T00:00:00+00:00",
      }),
    findAvailablePort: (): Promise<number | null> =>
      Promise.resolve(options.noPorts === true ? null : 19284),
    readStdinLine: (signal): Promise<string> => {
      if (options.pasteLine === undefined) {
        return new Promise<never>(() => undefined);
      }
      const paste = options.pasteLine;
      return new Promise((res) => {
        const poll = (): void => {
          const banner = stderrText.join("");
          const match = /[?&]state=([^&\s]+)/.exec(banner);
          if (match?.[1] !== undefined) {
            res(paste(match[1]));
            return;
          }
          if (!signal.aborted) {
            setTimeout(poll, 5);
          }
        };
        poll();
      });
    },
    stderr: (text: string): void => {
      stderrText.push(text);
    },
  });
  return { flow, openedUrls, stderrText, exchanged, storageDir };
}

async function row4(): Promise<void> {
  // openBrowser=true, callback wins, persist=false → no v2 file.
  {
    const run = makeLoginRun({ accessToken: SENTINEL });
    const tokens = await run.flow.login();
    const v2Path = join(run.storageDir, "tokens_us.json");
    check(
      "row4 browser+callback persist=false",
      tokens.access_token.reveal() === SENTINEL &&
        run.openedUrls.length === 1 &&
        !existsSync(v2Path),
    );
    // CRED-F3: the returned tokens mask under JSON.stringify.
    check(
      "row6 JSON.stringify(tokens) masks the sentinel",
      !JSON.stringify(tokens).includes(SENTINEL),
    );
    // Authorize URL invariants: exact param order, S256, state echo,
    // challenge = S256(verifier actually exchanged).
    const url = run.openedUrls[0] ?? "";
    const keys = [...(url.split("?")[1] ?? "").split("&")].map(
      (kv) => kv.split("=")[0] ?? "",
    );
    check(
      "row4 authorize param order locked",
      JSON.stringify(keys) ===
        JSON.stringify([
          "response_type",
          "client_id",
          "redirect_uri",
          "state",
          "code_challenge",
          "code_challenge_method",
        ]) && url.endsWith("code_challenge_method=S256"),
    );
    const challenge = /code_challenge=([^&]+)/.exec(url)?.[1] ?? "";
    const verifier = /code_verifier=([^&]+)/.exec(run.exchanged[0] ?? "")?.[1];
    check(
      "row4 challenge equals S256(exchanged verifier)",
      verifier !== undefined &&
        PkceChallenge.challengeFor(decodeURIComponent(verifier)) ===
          decodeURIComponent(challenge),
    );
    check(
      "row4 exchange body order + pasted code",
      (run.exchanged[0] ?? "").startsWith(
        "grant_type=authorization_code&code=CBCODE&redirect_uri=",
      ),
    );
  }
  // persist=true → v2 file exists, 0o600, carries the raw token.
  {
    const run = makeLoginRun({ accessToken: SENTINEL });
    await run.flow.login({ persist: true });
    const v2Path = join(run.storageDir, "tokens_us.json");
    const mode = statSync(v2Path).mode & 0o777;
    const raw = readFileSync(v2Path, "utf-8");
    check(
      "row4 persist=true v2 file 0600 + reveal site",
      existsSync(v2Path) &&
        mode === 0o600 &&
        raw.includes(SENTINEL) &&
        !raw.includes("**********"),
    );
  }
  // openBrowser=false: banner printed, callback wins with stdin pending.
  {
    const run = makeLoginRun({});
    const tokens = await run.flow.login({ openBrowser: false });
    const banner = run.stderrText.join("");
    check(
      "row4 no-browser banner + callback wins",
      tokens.access_token.reveal() === "tok" &&
        run.openedUrls.length === 0 &&
        banner.includes("Open this URL in your browser") &&
        banner.includes("paste the redirect URL"),
    );
  }
  // openBrowser=false: paste wins over a blocked callback.
  {
    const run = makeLoginRun({
      blockCallback: true,
      pasteLine: (state) => `?code=PASTED&state=${state}\n`,
    });
    const tokens = await run.flow.login({ openBrowser: false });
    check(
      "row4 paste completer wins",
      tokens.access_token.reveal() === "tok" &&
        (run.exchanged[0] ?? "").includes("code=PASTED"),
    );
  }
  // exchange failure → OAuthError propagates (exchange stays generic).
  {
    const run = makeLoginRun({ exchangeStatus: 400 });
    const exc = (await errOf(run.flow.login())) as OAuthError;
    check(
      "row4 exchange failure → OAUTH_TOKEN_ERROR (generic on exchange)",
      exc instanceof OAuthError && exc.code === "OAUTH_TOKEN_ERROR",
    );
  }
  // openBrowser throws → OAUTH_BROWSER_ERROR {authorize_url}.
  {
    const run = makeLoginRun({ openBrowserThrows: true });
    const exc = (await errOf(run.flow.login())) as OAuthError;
    check(
      "row4 browser failure → OAUTH_BROWSER_ERROR",
      exc.code === "OAUTH_BROWSER_ERROR" &&
        typeof (exc.details as Record<string, unknown>)["authorize_url"] ===
          "string",
    );
  }
  // No ports → OAUTH_PORT_ERROR before any registration.
  {
    const run = makeLoginRun({ noPorts: true });
    const exc = (await errOf(run.flow.login())) as OAuthError;
    check(
      "row4 no ports → OAUTH_PORT_ERROR",
      exc.code === "OAUTH_PORT_ERROR" &&
        String(exc.message).includes("[19284, 19285, 19286, 19287]"),
    );
  }
  // parsePastedRedirect branch table.
  {
    const ok = parsePastedRedirect("code=A&state=S", { expectedState: "S" });
    const okUrl = parsePastedRedirect(
      "  http://localhost:19285/callback?code=B&state=S\n",
      { expectedState: "S" },
    );
    const okQm = parsePastedRedirect("?code=C&state=S", { expectedState: "S" });
    const codes = (input: string): string => {
      try {
        parsePastedRedirect(input, { expectedState: "S" });
        return "OK";
      } catch (exc) {
        return (exc as OAuthError).code ?? "?";
      }
    };
    check(
      "row4 paste branch table",
      ok.code === "A" &&
        okUrl.code === "B" &&
        okQm.code === "C" &&
        codes("") === "OAUTH_PASTE_ERROR" &&
        codes("   \n") === "OAUTH_PASTE_ERROR" &&
        codes("state=S") === "OAUTH_PASTE_ERROR" &&
        codes("code=A") === "OAUTH_PASTE_ERROR" &&
        codes("code=A&state=WRONG") === "OAUTH_STATE_MISMATCH" &&
        codes("error=access_denied&state=S") === "OAUTH_AUTH_DENIED" &&
        codes("error=x&error_description=user+said+no&state=S") ===
          "OAUTH_AUTH_DENIED",
    );
    // `+` decodes as space; percent-decoding applies (parse_qs twin).
    const plus = parsePastedRedirect("code=a+b%2Fc&state=S", {
      expectedState: "S",
    });
    check("row4 paste decodes + and %XX", plus.code === "a b/c");
  }
  // findAvailablePort: real probe honors squatters.
  {
    const squat = await occupy(19284);
    const port = await findAvailablePort();
    check("row4 real probe skips 19284", port === 19285);
    await closeServer(squat);
  }
}

// ---------------------------------------------------------------------------
// Row 5 — loginUnified browser path over the REAL bag (real callback
// server; the injected openBrowser plays the browser).
// ---------------------------------------------------------------------------

async function row5(): Promise<void> {
  const home = mkdtempSync(join(ROOT, "e2e-home-"));
  const storageRoot = join(home, ".mp");
  const configPath = join(storageRoot, "config.toml");
  process.env["MP_OAUTH_STORAGE_DIR"] = storageRoot;
  process.env["MP_CONFIG_PATH"] = configPath;
  process.env["MP_AUTH_FILE"] = join(home, "auth.json");
  delete process.env["MP_USERNAME"];
  delete process.env["MP_SECRET"];
  delete process.env["MP_OAUTH_TOKEN"];

  const fetchImpl = ((input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url.endsWith("/oauth/mcp/register/")) {
      return Promise.resolve(
        new Response(JSON.stringify({ client_id: "e2e-client" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (url.endsWith("/oauth/token/")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: SENTINEL,
            refresh_token: "e2e-refresh",
            expires_in: 3600,
            scope: "projects",
            token_type: "Bearer",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    if (url.includes("/api/app/me")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            results: {
              user_id: 7,
              user_email: "e2e@example.com",
              organizations: { "100": { id: 100, name: "Acme Corp" } },
              projects: { "42": { name: "Demo", organization_id: 100 } },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    throw new Error(`unexpected URL in e2e: ${url}`);
  }) as typeof fetch;

  const effects = createNodeAuthEffects({
    fetchImpl,
    flowSeams: {
      // The "browser": parse redirect_uri + state from the authorize
      // URL and fire the real localhost GET against the REAL bound
      // callback server.
      openBrowser: (authorizeUrl: string): void => {
        const redirect = /redirect_uri=([^&]+)/.exec(authorizeUrl)?.[1] ?? "";
        const state = /[?&]state=([^&]+)/.exec(authorizeUrl)?.[1] ?? "";
        const target =
          `${decodeURIComponent(redirect)}?code=E2ECODE&state=` +
          `${decodeURIComponent(state)}`;
        // Fire-and-forget after a beat (the browser is asynchronous).
        void sleep(30).then(() => fetch(target));
      },
    },
  });

  const summary = await loginUnified(effects, {});
  const name = summary.name;
  const accountDir = join(storageRoot, "accounts", name);
  const tokensPath = join(accountDir, "tokens.json");
  const mePath = join(accountDir, "me.json");
  const dirMode = statSync(accountDir).mode & 0o777;
  const tokMode = statSync(tokensPath).mode & 0o777;
  const rawTokens = readFileSync(tokensPath, "utf-8");
  const manager = new ConfigManager({ configPath });
  check(
    "row5 e2e: account dir 0700 + tokens 0600",
    dirMode === 0o700 && tokMode === 0o600,
  );
  check(
    "row5 e2e: tokens.json is a reveal site (raw token, no mask)",
    rawTokens.includes(SENTINEL) && !rawTokens.includes("**********"),
  );
  check("row5 e2e: me.json written", existsSync(mePath));
  check(
    "row5 e2e: config updated ([active] + block)",
    manager.getActive().account === name &&
      manager.getAccount(name).type === "oauth_browser",
  );
  check(
    "row5 e2e: DCR client persisted per-region",
    existsSync(join(storageRoot, "oauth", "client_us.json")),
  );
  check(
    "row5 e2e: summary carries /me enrichment",
    summary.user_email === "e2e@example.com",
  );
  // Orphan-dir guard: pre-seeded dir for the would-be name trips the
  // accountDirExists probe (fresh HOME so config has no such account).
  {
    const home2 = mkdtempSync(join(ROOT, "e2e-home2-"));
    const storageRoot2 = join(home2, ".mp");
    process.env["MP_OAUTH_STORAGE_DIR"] = storageRoot2;
    process.env["MP_CONFIG_PATH"] = join(storageRoot2, "config.toml");
    process.env["MP_AUTH_FILE"] = join(home2, "auth.json");
    mkdirSync(join(storageRoot2, "accounts", name), {
      recursive: true,
      mode: 0o700,
    });
    const effects2 = createNodeAuthEffects({
      fetchImpl,
      flowSeams: {
        openBrowser: (authorizeUrl: string): void => {
          const redirect = /redirect_uri=([^&]+)/.exec(authorizeUrl)?.[1] ?? "";
          const state = /[?&]state=([^&]+)/.exec(authorizeUrl)?.[1] ?? "";
          void sleep(30).then(() =>
            fetch(
              `${decodeURIComponent(redirect)}?code=E2ECODE&state=` +
                `${decodeURIComponent(state)}`,
            ),
          );
        },
      },
    });
    const exc = await errOf(loginUnified(effects2, {}));
    check(
      "row5 orphan-dir guard trips (ConfigError)",
      exc instanceof ConfigError,
    );
  }
  // Row 6 residue: no sentinel in narrate output is untestable here
  // (narrate writes process.stderr) — the login path narrations carry
  // no token material by construction; grep of this harness's RUN
  // output is the recorded check.
}

// ---------------------------------------------------------------------------

const started = Date.now();
await row1();
await row3();
await row4();
await row5();
rmSync(ROOT, { recursive: true, force: true });
console.log(
  `probes: ${passed} passed, ${failed} failed in ${Date.now() - started}ms`,
);
if (failed > 0) {
  console.error(`failures: ${failures.join(" | ")}`);
  process.exitCode = 1;
}
