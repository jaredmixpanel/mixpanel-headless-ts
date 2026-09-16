// Type-level half of the popup flow's option bag: `PopupLoginOptions` is
// camelCase like every constructor/config bag in the port, and — like
// `BeginLoginOptions` it extends — it cannot express a service account, so
// that ingress is excluded at compile time (the runtime paths are in
// popup-flow.test.ts).
import { describe, expectTypeOf, it } from "vitest";

import type { CredentialStore, OAuthTokens } from "@mixpanel-headless/core";

import {
  type BeginLoginOptions,
  loginInPopup,
  type PopupHost,
  type PopupLoginOptions,
  relayPopupReturn,
  type RelayPopupReturnOptions,
} from "../src/index.js";

declare const store: CredentialStore;
declare const host: PopupHost;

describe("PopupLoginOptions", () => {
  it("rejects snake_case keys", () => {
    const redirectUri: PopupLoginOptions = {
      region: "us",
      // @ts-expect-error -- the option is `redirectUri`, not the wire spelling
      redirect_uri: "https://app.example.com/oauth/callback",
      store,
    };
    expectTypeOf(redirectUri).toEqualTypeOf<PopupLoginOptions>();
    const timeoutMs: PopupLoginOptions = {
      region: "us",
      redirectUri: "https://app.example.com/oauth/callback",
      store,
      // @ts-expect-error -- the option is `timeoutMs`
      timeout_ms: 1_000,
    };
    expectTypeOf(timeoutMs).toEqualTypeOf<PopupLoginOptions>();
    const windowFeatures: PopupLoginOptions = {
      region: "us",
      redirectUri: "https://app.example.com/oauth/callback",
      store,
      // @ts-expect-error -- the option is `windowFeatures`
      window_features: "popup=yes",
    };
    expectTypeOf(windowFeatures).toEqualTypeOf<PopupLoginOptions>();
  });

  it("rejects a username/secret (service-account) shape", () => {
    const saShape = {
      username: "sa.user",
      secret: "hunter2",
      projectId: "12345",
      region: "us",
    } as const;
    // @ts-expect-error -- no `redirectUri` / `store`, and no place for a secret
    const options: PopupLoginOptions = saShape;
    expectTypeOf(options).toEqualTypeOf<PopupLoginOptions>();
  });

  it("extends BeginLoginOptions and accepts the full camelCase bag", () => {
    expectTypeOf<PopupLoginOptions>().toExtend<BeginLoginOptions>();
    expectTypeOf({
      region: "eu" as const,
      redirectUri: "https://app.example.com/oauth/callback",
      store,
      timeoutMs: 1_000,
      signal: new AbortController().signal,
      windowFeatures: "popup=yes",
      host,
      maxPendingAgeMs: 60_000,
    }).toExtend<PopupLoginOptions>();
    expectTypeOf<PopupLoginOptions["region"]>().toEqualTypeOf<
      "us" | "eu" | "in"
    >();
  });
});

describe("popup flow functions", () => {
  it("loginInPopup resolves core tokens; relayPopupReturn answers a boolean", () => {
    expectTypeOf(loginInPopup).returns.resolves.toEqualTypeOf<OAuthTokens>();
    expectTypeOf(relayPopupReturn).returns.toBeBoolean();
    expectTypeOf(relayPopupReturn)
      .parameter(0)
      .toEqualTypeOf<RelayPopupReturnOptions | undefined>();
    expectTypeOf<RelayPopupReturnOptions["window"]>().toEqualTypeOf<
      Pick<Window, "name" | "opener" | "location"> | undefined
    >();
  });
});
