// Type-level half of the service-account refusal (§2.3 path 2; the runtime
// paths are in sa-refusal.test.ts): a browser session cannot even EXPRESS a
// service account, because `BrowserSessionOptions` carries only `token`.
import { describe, expectTypeOf, it } from "vitest";

import type { Session, Workspace } from "@mixpanel-headless/core";

import {
  browserSession,
  type BrowserSessionOptions,
  createBrowserWorkspace,
  createBrowserWorkspaceFromStore,
} from "../src/index.js";

describe("BrowserSessionOptions", () => {
  it("rejects a username/secret (service-account) shape", () => {
    const saShape = {
      username: "sa.user",
      secret: "hunter2",
      projectId: "12345",
      region: "us",
    } as const;
    // @ts-expect-error -- only `token` credentials exist here; an SA shape has no `token`
    const options: BrowserSessionOptions = saShape;
    expectTypeOf(options).toEqualTypeOf<BrowserSessionOptions>();
  });

  it("accepts the token shape and pins the region union", () => {
    expectTypeOf({
      token: "t",
      projectId: "12345",
      region: "us" as const,
    }).toExtend<BrowserSessionOptions>();
    expectTypeOf<BrowserSessionOptions["region"]>().toEqualTypeOf<
      "us" | "eu" | "in"
    >();
    expectTypeOf<BrowserSessionOptions["token"]>().toBeString();
  });
});

describe("factories", () => {
  it("browserSession builds a core Session; the workspace factories a core Workspace", () => {
    expectTypeOf(browserSession).returns.toEqualTypeOf<Session>();
    expectTypeOf(createBrowserWorkspace).returns.toEqualTypeOf<Workspace>();
    expectTypeOf(
      createBrowserWorkspaceFromStore,
    ).returns.resolves.toEqualTypeOf<Workspace>();
  });
});
