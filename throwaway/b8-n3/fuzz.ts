// B8-N3 R10.9 harness — fast-check surfaces (≥500 examples each) vs
// independent mini-models (b8-packets.md §4.5 rows 2, 4, 6).
// Run: npx vite-node throwaway/b8-n3/fuzz.ts
//
// Surfaces:
//   A (500) PKCE — random generations vs an independent
//     sha256/base64url mini-model + charset/length invariants
//     (row 2; the RFC 7636 vector row is locked in Layer-3,
//     pkce.test.ts).
//   B (500) parseQs/pythonUnquote — encode random (name, value) pairs
//     with a Python quote_plus mini-model, parse back → exact pairs.
//   C (500) parsePastedRedirect — random code/state through the three
//     accepted paste forms → parsed equality; a mutated state →
//     OAUTH_STATE_MISMATCH.
//   D (500) authorize-URL round-trip — random client_id/state through
//     the real login (injected seams) → fixed param order, S256
//     method, decoded state echo, challenge = S256(verifier posted to
//     the exchange body); secret sentinel never in thrown messages
//     (row 6 feed).

import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import fc from "fast-check";

import { OAuthError } from "../../packages/core/src/errors.js";
import type { OAuthClientInfo } from "../../packages/core/src/auth/token.js";
import { CallbackResult } from "../../packages/node/src/auth/callback-server.js";
import {
  OAuthFlow,
  parsePastedRedirect,
} from "../../packages/node/src/auth/flow.js";
import { PkceChallenge } from "../../packages/node/src/auth/pkce.js";
import {
  parseQs,
  pythonUnquote,
} from "../../packages/node/src/auth/query-params.js";
import { OAuthStorage } from "../../packages/node/src/auth/storage.js";

const SEED = 20260816;
const NUM_RUNS = 500;
const ROOT = mkdtempSync(join(tmpdir(), "mp-b8n3-fuzz-"));
{
  const home = resolve(homedir());
  if (ROOT === home || resolve(ROOT).startsWith(home + sep)) {
    throw new Error(`real-home guard: ${ROOT}`);
  }
}

const table: string[] = [];
let failures = 0;

/**
 * Run one fast-check surface and record the outcome row.
 *
 * @param name - Surface label for the RUN table.
 * @param property - The (async) property.
 */
async function surface(
  name: string,
  property: fc.IAsyncPropertyWithHooks<never> | fc.IPropertyWithHooks<never>,
): Promise<void> {
  const out = await fc.check(property as never, {
    seed: SEED,
    numRuns: NUM_RUNS,
  });
  if (out.failed) {
    failures += 1;
    table.push(
      `${name}: seed=${SEED} runs=${NUM_RUNS} DIVERGENT ` +
        `counterexample=${JSON.stringify(out.counterexample)}`,
    );
  } else {
    table.push(`${name}: seed=${SEED} runs=${NUM_RUNS} zero-divergence`);
  }
}

/** Python `urllib.parse.quote_plus` mini-model (b8-n2 harness twin). */
function pyQuotePlus(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = "";
  for (const byte of bytes) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9_.\-~]/.test(ch)) {
      out += ch;
    } else if (ch === " ") {
      out += "+";
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

// Surface A — PKCE vs mini-model.
await surface(
  "A pkce-vs-minimodel",
  fc.property(fc.integer(), () => {
    const pkce = PkceChallenge.generate();
    const model = createHash("sha256")
      .update(pkce.verifier, "ascii")
      .digest()
      .toString("base64url");
    return (
      pkce.verifier.length === 86 &&
      pkce.challenge.length === 43 &&
      /^[A-Za-z0-9_-]+$/.test(pkce.verifier) &&
      /^[A-Za-z0-9_-]+$/.test(pkce.challenge) &&
      pkce.challenge === model &&
      PkceChallenge.challengeFor(pkce.verifier) === model
    );
  }) as never,
);

// Surface B — parseQs round-trip over quote_plus-encoded pairs.
const KEY = fc.string({ minLength: 1, maxLength: 12 });
const VALUE = fc.oneof(
  fc.string({ minLength: 1, maxLength: 24 }),
  fc.string({ unit: "grapheme", minLength: 1, maxLength: 12 }),
  fc.constantFrom("a b", "a+b", "a&b", "a=b", "100%", "𝒳", "café"),
);
await surface(
  "B parseqs-roundtrip",
  fc.property(
    fc.array(fc.tuple(KEY, VALUE), { minLength: 1, maxLength: 6 }),
    (pairs) => {
      const query = pairs
        .map(([k, v]) => `${pyQuotePlus(k)}=${pyQuotePlus(v)}`)
        .join("&");
      const parsed = parseQs(query);
      const expected = new Map<string, string[]>();
      for (const [k, v] of pairs) {
        const list = expected.get(k);
        if (list) {
          list.push(v);
        } else {
          expected.set(k, [v]);
        }
      }
      if (parsed.size !== expected.size) {
        return false;
      }
      for (const [k, list] of expected) {
        if (JSON.stringify(parsed.get(k)) !== JSON.stringify(list)) {
          return false;
        }
      }
      // Spot invariant: unquote of a quote_plus value round-trips.
      const [k0, v0] = pairs[0] as [string, string];
      void k0;
      return pythonUnquote(pyQuotePlus(v0).replaceAll("+", " ")) === v0;
    },
  ) as never,
);

// Surface C — paste parser round-trip + CSRF rejection.
const URLSAFE = fc
  .array(
    fc.constantFrom(
      ..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
    ),
    { minLength: 1, maxLength: 43 },
  )
  .map((chars) => chars.join(""));
await surface(
  "C paste-parser",
  fc.property(
    URLSAFE,
    URLSAFE,
    fc.integer({ min: 0, max: 2 }),
    (code, state, form) => {
      const query = `code=${code}&state=${state}`;
      const line =
        form === 0
          ? `http://localhost:19284/callback?${query}`
          : form === 1
            ? `?${query}`
            : query;
      const parsed = parsePastedRedirect(`  ${line}\n`, {
        expectedState: state,
      });
      if (!(parsed instanceof CallbackResult) || parsed.code !== code) {
        return false;
      }
      try {
        parsePastedRedirect(line, { expectedState: `${state}X` });
        return false;
      } catch (exc) {
        return exc instanceof OAuthError && exc.code === "OAUTH_STATE_MISMATCH";
      }
    },
  ) as never,
);

// Surface D — authorize URL param order + challenge/verifier linkage
// through the real login with injected seams.
const SENTINEL = "SENTINEL-FUZZ-TOKEN";
await surface(
  "D authorize-url-roundtrip",
  fc.asyncProperty(
    fc.string({ minLength: 1, maxLength: 24 }),
    async (clientId) => {
      const opened: string[] = [];
      const exchanged: string[] = [];
      const fetchImpl = ((
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        void input;
        exchanged.push(typeof init?.body === "string" ? init.body : "");
        return Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: SENTINEL,
              expires_in: 3600,
              scope: "s",
              token_type: "Bearer",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }) as typeof fetch;
      const flow = new OAuthFlow({
        region: "us",
        storage: new OAuthStorage({
          storageDir: mkdtempSync(join(ROOT, "d-")),
        }),
        fetchImpl,
        openBrowser: (url: string): void => {
          opened.push(url);
        },
        findAvailablePort: () => Promise.resolve(19284),
        registerClient: (args): Promise<OAuthClientInfo> =>
          Promise.resolve({
            client_id: clientId,
            region: args.region,
            redirect_uri: args.redirectUri,
            scope: "s",
            created_at: "2026-01-01T00:00:00+00:00",
          }),
        startCallbackServer: (cb) =>
          Promise.resolve([
            new CallbackResult({ code: "K", state: cb.state }),
            19284,
          ] as const),
      });
      const tokens = await flow.login();
      const url = opened[0] ?? "";
      const query = url.split("?")[1] ?? "";
      const keys = query.split("&").map((kv) => kv.split("=")[0] ?? "");
      const params = parseQs(query);
      const challenge = params.get("code_challenge")?.[0] ?? "";
      const state = params.get("state")?.[0] ?? "";
      const verifier =
        parseQs(exchanged[0] ?? "").get("code_verifier")?.[0] ?? "";
      const echoedClient = params.get("client_id")?.[0] ?? "";
      return (
        JSON.stringify(keys) ===
          JSON.stringify([
            "response_type",
            "client_id",
            "redirect_uri",
            "state",
            "code_challenge",
            "code_challenge_method",
          ]) &&
        params.get("code_challenge_method")?.[0] === "S256" &&
        echoedClient === clientId &&
        state.length > 0 &&
        PkceChallenge.challengeFor(verifier) === challenge &&
        !JSON.stringify(tokens).includes(SENTINEL) &&
        tokens.access_token.reveal() === SENTINEL
      );
    },
  ) as never,
);

for (const line of table) {
  console.log(line);
}
rmSync(ROOT, { recursive: true, force: true });
console.log(`fuzz: ${table.length} surfaces, ${failures} divergent`);
if (failures > 0) {
  process.exitCode = 1;
}
