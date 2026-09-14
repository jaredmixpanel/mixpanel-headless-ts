// Layer-3 browser-contract suite — NO Python twin exists for the
// CredentialStore surface (new browser code). Contract arbiter:
// rulebook R9.3 ("injectable `CredentialStore`; default in-memory;
// documented localStorage adapter with security warning") +
// b9-packets.md §2.1 (the pasted interface contract + design notes) —
// the phase2-audit A2 header style, cited in lieu of a Python file.

import { describe, expect, it } from "vitest";

import localStorageAdapterSource from "../src/credential-store.ts?raw";
import {
  CREDENTIAL_KEYS,
  InMemoryCredentialStore,
  LocalStorageCredentialStore,
  type CredentialStore,
} from "../src/index.js";
import { OAuthError } from "@mixpanel-headless/core";
import { fakeStorage } from "./helpers.js";

describe("CREDENTIAL_KEYS (b9-packets.md §2.1 — the namespace table)", () => {
  it("keys are per-region and library-namespaced", () => {
    expect(CREDENTIAL_KEYS.tokens("us")).toBe("mp.tokens.us");
    expect(CREDENTIAL_KEYS.clientInfo("eu")).toBe("mp.oauth_client.eu");
    expect(CREDENTIAL_KEYS.pendingLogin("in")).toBe("mp.pending_login.in");
  });
});

// ONE shared contract suite over both implementations (§2.6 row 1).
describe.each<[string, () => CredentialStore]>([
  [
    "InMemoryCredentialStore",
    (): CredentialStore => new InMemoryCredentialStore(),
  ],
  [
    "LocalStorageCredentialStore",
    (): CredentialStore =>
      new LocalStorageCredentialStore(fakeStorage().storage),
  ],
])("CredentialStore contract — %s", (_name, makeStore) => {
  it("get of an absent key returns null (never undefined — R3.9)", async () => {
    const store = makeStore();
    expect(await store.get("mp.tokens.us")).toBeNull();
  });

  it("set/get round-trip", async () => {
    const store = makeStore();
    await store.set("mp.tokens.us", '{"access_token":"abc"}');
    expect(await store.get("mp.tokens.us")).toBe('{"access_token":"abc"}');
  });

  it("delete removes the key (get returns null afterwards)", async () => {
    const store = makeStore();
    await store.set("mp.tokens.us", "value");
    await store.delete("mp.tokens.us");
    expect(await store.get("mp.tokens.us")).toBeNull();
  });

  it("delete of an absent key is a no-op (no throw)", async () => {
    const store = makeStore();
    await store.delete("mp.tokens.us");
    expect(await store.get("mp.tokens.us")).toBeNull();
  });

  it("overwrite replaces the prior value", async () => {
    const store = makeStore();
    await store.set("mp.tokens.us", "first");
    await store.set("mp.tokens.us", "second");
    expect(await store.get("mp.tokens.us")).toBe("second");
  });

  it("key isolation — regions do not bleed", async () => {
    const store = makeStore();
    await store.set(CREDENTIAL_KEYS.tokens("us"), "us-tokens");
    await store.set(CREDENTIAL_KEYS.tokens("eu"), "eu-tokens");
    await store.set(CREDENTIAL_KEYS.clientInfo("us"), "us-client");
    expect(await store.get(CREDENTIAL_KEYS.tokens("us"))).toBe("us-tokens");
    expect(await store.get(CREDENTIAL_KEYS.tokens("eu"))).toBe("eu-tokens");
    expect(await store.get(CREDENTIAL_KEYS.clientInfo("us"))).toBe("us-client");
    await store.delete(CREDENTIAL_KEYS.tokens("us"));
    expect(await store.get(CREDENTIAL_KEYS.tokens("us"))).toBeNull();
    expect(await store.get(CREDENTIAL_KEYS.tokens("eu"))).toBe("eu-tokens");
  });

  it("non-ASCII (non-BMP) keys and values survive verbatim", async () => {
    const store = makeStore();
    await store.set("mp.tokens.𝒳", "value-𝒳");
    expect(await store.get("mp.tokens.𝒳")).toBe("value-𝒳");
  });

  it("empty-string value round-trips as '' (distinct from absent/null)", async () => {
    const store = makeStore();
    await store.set("mp.tokens.us", "");
    expect(await store.get("mp.tokens.us")).toBe("");
  });
});

describe("LocalStorageCredentialStore specifics (§2.1 / §2.6)", () => {
  it("uses ONLY the injected StorageLike — no global touch", async () => {
    const { storage, map } = fakeStorage();
    const store = new LocalStorageCredentialStore(storage);
    await store.set("mp.tokens.us", "injected");
    expect(map.get("mp.tokens.us")).toBe("injected");
    expect(await store.get("mp.tokens.us")).toBe("injected");
    await store.delete("mp.tokens.us");
    expect(map.has("mp.tokens.us")).toBe(false);
  });

  it("missing globalThis.localStorage without injection → coded OAUTH_CONFIG_ERROR", () => {
    const holder = globalThis as { localStorage?: unknown };
    const saved = holder.localStorage;
    delete holder.localStorage;
    try {
      let thrown: unknown;
      try {
        new LocalStorageCredentialStore();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(OAuthError);
      expect((thrown as OAuthError).code).toBe("OAUTH_CONFIG_ERROR");
    } finally {
      if (saved !== undefined) {
        holder.localStorage = saved;
      }
    }
  });

  it("security warning EXISTS in the adapter JSDoc and covers XSS / origin scope / persistence (R9.3 REQUIREMENT — §2.6 source-text grep)", () => {
    // R9.3: "documented localStorage adapter with security warning".
    // §2.1: the warning must state that localStorage is origin-scoped,
    // XSS-readable, survives logout unless deleted, that bearer tokens
    // are readable by any script on the origin, and that the in-memory
    // default is the recommended posture (re-login on reload).
    const source = localStorageAdapterSource;
    expect(source).toMatch(/XSS/);
    expect(source).toMatch(/origin/i);
    expect(source).toMatch(/survives?\s.*logout/i);
    expect(source).toMatch(/readable by any script/i);
    expect(source).toMatch(/in-memory/i);
    expect(source).toMatch(/re-?login/i);
  });

  it("FB-9 (pair-B): the warning names ALL persisted payload families and the bulk-clear helper", () => {
    // b9-reviewB-threat.md F6: the store also persists the PKCE
    // verifier + CSRF state (pending login) and the DCR registration —
    // the warning must say so, and the logout instruction must point
    // at a supported enumeration (CREDENTIAL_KEYS.all).
    const source = localStorageAdapterSource;
    expect(source).toMatch(/verifier/i);
    expect(source).toMatch(/pending[- ]login/i);
    expect(source).toMatch(/DCR|client registration/i);
    expect(source).toMatch(/CREDENTIAL_KEYS\.all/);
  });

  it("FB-9 (pair-B): CREDENTIAL_KEYS.all(region) enumerates every key family for a region", () => {
    expect(CREDENTIAL_KEYS.all("us")).toEqual([
      "mp.tokens.us",
      "mp.oauth_client.us",
      "mp.pending_login.us",
    ]);
    expect(CREDENTIAL_KEYS.all("eu")).toEqual([
      CREDENTIAL_KEYS.tokens("eu"),
      CREDENTIAL_KEYS.clientInfo("eu"),
      CREDENTIAL_KEYS.pendingLogin("eu"),
    ]);
  });

  it("FB-11 (pair-B): backend failures re-throw as coded OAUTH_CONFIG_ERROR (never a bare DOMException)", async () => {
    // b9-reviewB-e2e.md F5: Safari-private/quota failures escaped as
    // uncoded DOMExceptions, inconsistent with R5 and with the
    // constructor's own OAUTH_CONFIG_ERROR posture.
    const quotaError = new Error("quota exceeded");
    quotaError.name = "QuotaExceededError";
    const store = new LocalStorageCredentialStore({
      getItem: (): string | null => {
        throw quotaError;
      },
      setItem: (): void => {
        throw quotaError;
      },
      removeItem: (): void => {
        throw quotaError;
      },
    });
    for (const op of [
      (): unknown => store.get("mp.tokens.us"),
      (): unknown => store.set("mp.tokens.us", "{}"),
      (): unknown => store.delete("mp.tokens.us"),
    ]) {
      let thrown: unknown;
      try {
        op();
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(OAuthError);
      expect((thrown as OAuthError).code).toBe("OAUTH_CONFIG_ERROR");
      expect((thrown as OAuthError).cause).toBe(quotaError);
    }
  });
});
