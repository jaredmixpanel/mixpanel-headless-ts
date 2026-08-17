// Flow set R7: adversarial / realistic return-URL shapes on the return
// page, plus the persist-failure tail of completeLogin.
import {
  CREDENTIAL_KEYS,
  InMemoryCredentialStore,
  LocalStorageCredentialStore,
  beginLogin,
  completeLogin,
} from "../../packages/browser/src/index.js";
import type { StorageLike } from "../../packages/browser/src/credential-store.js";
import { capture, record, recordingFetch, summary } from "./harness.js";
import type { CannedResponse, RecordedRequest } from "./harness.js";

const T0 = Date.parse("2026-01-15T12:00:00Z");
const NOW = (): number => T0;

function idp(req: RecordedRequest): CannedResponse {
  if (req.url.endsWith("mcp/register/")) {
    return { status: 201, body: JSON.stringify({ client_id: "cid-1" }) };
  }
  return {
    status: 200,
    body: JSON.stringify({
      access_token: "at-1",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "projects",
    }),
  };
}

async function begin(store: InMemoryCredentialStore, f: typeof fetch) {
  return beginLogin({
    region: "us",
    redirectUri: "https://app.example.com/cb",
    store,
    fetch: f,
    now: NOW,
  });
}

async function main(): Promise<void> {
  // --- R7a: SPA hash route appended by the router ------------------------
  {
    const store = new InMemoryCredentialStore();
    const f = recordingFetch(idp);
    const b = await begin(store, f.fetch);
    const err = await capture(() =>
      completeLogin({
        region: "us",
        returnUrl: `https://app.example.com/cb?code=C1&state=${b.state}#/dashboard`,
        store,
        fetch: f.fetch,
        now: NOW,
      }),
    );
    record(
      "R7a location.href with a hash route",
      err === null,
      JSON.stringify(err),
    );
  }

  // --- R7b: duplicate code params (parameter pollution) ------------------
  {
    const store = new InMemoryCredentialStore();
    const f = recordingFetch(idp);
    const b = await begin(store, f.fetch);
    await completeLogin({
      region: "us",
      returnUrl: `https://app.example.com/cb?code=GOOD&code=EVIL&state=${b.state}`,
      store,
      fetch: f.fetch,
      now: NOW,
    });
    const body = new URLSearchParams(
      f.requests.find((r) => r.url.endsWith("token/"))?.body ?? "",
    );
    record(
      "R7b duplicate code → first wins (parse_qs parity)",
      body.get("code") === "GOOD",
      String(body.get("code")),
    );
  }

  // --- R7c: state carrying a '+' (parse_qs plus-decoding) ----------------
  {
    const store = new InMemoryCredentialStore();
    const f = recordingFetch(idp);
    const b = await begin(store, f.fetch);
    const err = await capture(() =>
      completeLogin({
        region: "us",
        returnUrl: `https://app.example.com/cb?code=A+B&state=${b.state}`,
        store,
        fetch: f.fetch,
        now: NOW,
      }),
    );
    const body = new URLSearchParams(
      f.requests.find((r) => r.url.endsWith("token/"))?.body ?? "",
    );
    record(
      "R7c '+' in code decodes to space (parse_qs parity)",
      err === null && body.get("code") === "A B",
      JSON.stringify({ err, code: body.get("code") }),
    );
  }

  // --- R7d: empty return URL --------------------------------------------
  {
    const store = new InMemoryCredentialStore();
    const f = recordingFetch(idp);
    await begin(store, f.fetch);
    const err = await capture(() =>
      completeLogin({
        region: "us",
        returnUrl: "   ",
        store,
        fetch: f.fetch,
        now: NOW,
      }),
    );
    record(
      "R7d blank return URL → OAUTH_PASTE_ERROR",
      err?.code === "OAUTH_PASTE_ERROR",
      JSON.stringify(err),
    );
  }

  // --- R7e: forged state with no pending record --------------------------
  {
    const store = new InMemoryCredentialStore();
    const f = recordingFetch(idp);
    const err = await capture(() =>
      completeLogin({
        region: "us",
        returnUrl: "https://app.example.com/cb?code=EVIL&state=FORGED",
        store,
        fetch: f.fetch,
        now: NOW,
      }),
    );
    record(
      "R7e forged return, no pending → BROWSER_NO_PENDING_LOGIN, no POST",
      err?.code === "BROWSER_NO_PENDING_LOGIN" &&
        f.requests.filter((r) => r.url.endsWith("token/")).length === 0,
      JSON.stringify(err),
    );
  }

  // --- R7f: corrupted pending record --------------------------------------
  {
    const store = new InMemoryCredentialStore();
    const f = recordingFetch(idp);
    const b = await begin(store, f.fetch);
    store.set(CREDENTIAL_KEYS.pendingLogin("us"), "{not json");
    const err = await capture(() =>
      completeLogin({
        region: "us",
        returnUrl: `https://app.example.com/cb?code=C&state=${b.state}`,
        store,
        fetch: f.fetch,
        now: NOW,
      }),
    );
    record(
      "R7f corrupted pending record → BROWSER_NO_PENDING_LOGIN",
      err?.code === "BROWSER_NO_PENDING_LOGIN",
      JSON.stringify(err),
    );
  }

  // --- R7g: stale pending record from an old tab (no TTL check) ----------
  {
    const store = new InMemoryCredentialStore();
    const f = recordingFetch(idp);
    const b = await begin(store, f.fetch);
    const raw = JSON.parse(
      String(await store.get(CREDENTIAL_KEYS.pendingLogin("us"))),
    ) as Record<string, unknown>;
    raw["created_at"] = "2020-01-01T00:00:00+00:00";
    store.set(CREDENTIAL_KEYS.pendingLogin("us"), JSON.stringify(raw));
    const err = await capture(() =>
      completeLogin({
        region: "us",
        returnUrl: `https://app.example.com/cb?code=C&state=${b.state}`,
        store,
        fetch: f.fetch,
        now: () => Date.parse("2026-06-01T00:00:00Z"),
      }),
    );
    record(
      "R7g 6-year-old pending record still accepted (created_at unread)",
      err === null,
      JSON.stringify(err),
    );
  }

  // --- R7h: persist failure AFTER a successful exchange ------------------
  {
    const backing = new Map<string, string>();
    const flaky: StorageLike = {
      getItem: (k) => backing.get(k) ?? null,
      setItem: (k, v) => {
        if (k.startsWith("mp.tokens.")) {
          throw new DOMException("quota exceeded", "QuotaExceededError");
        }
        backing.set(k, v);
      },
      removeItem: (k) => {
        backing.delete(k);
      },
    };
    const store = new LocalStorageCredentialStore(flaky);
    const f = recordingFetch(idp);
    const b = await beginLogin({
      region: "us",
      redirectUri: "https://app.example.com/cb",
      store,
      fetch: f.fetch,
      now: NOW,
    });
    const err = await capture(() =>
      completeLogin({
        region: "us",
        returnUrl: `https://app.example.com/cb?code=C&state=${b.state}`,
        store,
        fetch: f.fetch,
        now: NOW,
      }),
    );
    record(
      "R7h persist failure after exchange: coded error + tokens returned?",
      err === null || err.code !== null,
      JSON.stringify({
        err,
        tokenPosts: f.requests.filter((r) => r.url.endsWith("token/")).length,
      }),
    );
  }

  summary();
}

await main();
