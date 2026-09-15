// Option-bag casing (CLEANUP-PLAN §3 D1; Phase 4 lane L6).
//
// The rule: constructor/config option bags — options a constructor or factory
// consumes to configure behaviour — are camelCase; option bags that mirror a
// Python method's keyword arguments 1:1 keep snake_case. ESLint enforces
// camelCase for declared properties outside the snake_case contract scopes in
// eslint.config.js, but those scopes are granted by *file*, and several files
// hold both kinds of bag (`workspace.ts`, `accounts-ops.ts`, `region-probe.ts`,
// `errors.ts`). This test states the per-interface rule directly:
//
//   1. every listed config bag exists where listed, is exported, and has only
//      camelCase members;
//   2. every listed query bag still exists and still has at least one
//      snake_case member — so the classification cannot rot silently when a
//      bag is moved, renamed or converted.
//
// Purely syntactic (one `createSourceFile` per module): no program, no module
// resolution, so a stale `dist/` can never shadow the source under test.
// Lives under tests/ because it needs `node:fs`/`node:path`.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

type Bag = readonly [module: string, name: string];

/** Constructor / factory / transport configuration: camelCase members. */
const CONFIG_BAGS: readonly Bag[] = [
  ["packages/core/src/workspace.ts", "WorkspaceOptions"],
  ["packages/core/src/client/client.ts", "MixpanelClientOptions"],
  ["packages/core/src/client/client.ts", "ClientRequestOptions"],
  ["packages/core/src/client/client.ts", "ClientAppRequestOptions"],
  ["packages/core/src/client/client.ts", "QueryHostRequestOptions"],
  ["packages/core/src/client/internals.ts", "TransportRequestOptions"],
  ["packages/core/src/client/app-request.ts", "AppRequestOptions"],
  ["packages/core/src/client/json-value.ts", "ToNativeJsonOptions"],
  ["packages/core/src/client/lossless-json.ts", "ParseLosslessOptions"],
  ["packages/core/src/coerce.ts", "CoerceOptions"],
  ["packages/core/src/auth/resolver.ts", "ResolveSessionOptions"],
  ["packages/core/src/auth/token.ts", "TokenClockOptions"],
  ["packages/core/src/auth/oauth-http.ts", "RegisterClientOptions"],
  ["packages/core/src/auth/region-probe.ts", "ProbeRegionOptions"],
  ["packages/core/src/auth/account.ts", "ParseAccountOptions"],
  ["packages/core/src/auth/account.ts", "AccountAuthHeaderOptions"],
  ["packages/core/src/accounts/accounts-ops.ts", "FetchMeOptions"],
  ["packages/core/src/errors.ts", "APIErrorOptions"],
  ["packages/core/src/errors.ts", "InvalidArgumentErrorOptions"],
  ["packages/core/src/errors.ts", "AuthenticationErrorOptions"],
  ["packages/core/src/errors.ts", "RateLimitErrorOptions"],
  ["packages/core/src/errors.ts", "QueryErrorOptions"],
  ["packages/core/src/errors.ts", "ServerErrorOptions"],
  ["packages/core/src/errors.ts", "RegionProbeErrorOptions"],
  ["packages/core/src/errors.ts", "SessionReplayErrorOptions"],
  ["packages/core/src/errors.ts", "ReportLinkErrorOptions"],
  ["packages/node/src/workspace.ts", "NodeWorkspaceOptions"],
  ["packages/node/src/auth-effects.ts", "NodeAuthEffectsOptions"],
  ["packages/node/src/config-writes.ts", "NodeConfigSourceOptions"],
  ["packages/node/src/config.ts", "ConfigManagerOptions"],
  ["packages/node/src/me-cache.ts", "MeCacheOptions"],
  ["packages/node/src/auth/token-store.ts", "NodeTokenStoreOptions"],
  ["packages/node/src/auth/token-resolver.ts", "OnDiskTokenResolverOptions"],
  ["packages/node/src/auth/flow.ts", "OAuthFlowOptions"],
  ["packages/node/src/auth/flow.ts", "LoginOptions"],
  ["packages/node/src/auth/flow.ts", "RefreshTokensOptions"],
  ["packages/node/src/auth/storage.ts", "OAuthStorageOptions"],
  [
    "packages/node/src/auth/client-registration.ts",
    "EnsureClientRegisteredOptions",
  ],
  ["packages/node/src/auth/callback-server.ts", "StartCallbackServerOptions"],
  ["packages/node/src/io-utils.ts", "AtomicWriteOptions"],
  ["packages/node/src/io-utils.ts", "ReadCredentialTextOptions"],
  ["packages/node/src/io-utils.ts", "ReadSecretStdinOptions"],
  ["packages/browser/src/client.ts", "BrowserSessionOptions"],
  ["packages/browser/src/client.ts", "BrowserWorkspaceOptions"],
  ["packages/browser/src/client.ts", "BrowserWorkspaceFromStoreOptions"],
  [
    "packages/browser/src/registration.ts",
    "EnsureBrowserClientRegisteredOptions",
  ],
  ["packages/browser/src/redirect-flow.ts", "BeginLoginOptions"],
  ["packages/browser/src/redirect-flow.ts", "CompleteLoginOptions"],
];

/**
 * Mirrors of a Python method's keyword arguments: snake_case members (with
 * TypeScript-only seams such as `signal` / `onBatch` allowed in camelCase).
 */
const QUERY_BAGS: readonly Bag[] = [
  ["packages/core/src/workspace.ts", "WorkspaceQueryOptions"],
  ["packages/core/src/workspace.ts", "WorkspaceFunnelQueryOptions"],
  ["packages/core/src/workspace.ts", "WorkspaceRetentionQueryOptions"],
  ["packages/core/src/workspace.ts", "WorkspaceFlowQueryOptions"],
  ["packages/core/src/workspace.ts", "WorkspaceUserQueryOptions"],
  ["packages/core/src/workspace.ts", "WorkspaceFetchReplayOptions"],
  ["packages/core/src/workspace.ts", "WorkspaceStreamReplayOptions"],
  ["packages/core/src/services/discovery.ts", "ListEventsOptions"],
  ["packages/core/src/services/queries/streaming.ts", "ExportProfilesOptions"],
  ["packages/core/src/accounts/login-unified.ts", "LoginUnifiedOptions"],
  ["packages/core/src/accounts/accounts-ops.ts", "AccountsAddOptions"],
  ["packages/core/src/client/pagination.ts", "PaginateAllOptions"],
  ["packages/core/src/auth/region-probe.ts", "ProbeRegionForCredentialOptions"],
];

const CAMEL = /^[a-z][a-zA-Z0-9]*$/;
const SNAKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

interface BagShape {
  readonly exported: boolean;
  readonly members: readonly string[];
}

const sourceCache = new Map<string, ts.SourceFile>();
function sourceOf(module: string): ts.SourceFile {
  let cached = sourceCache.get(module);
  if (cached === undefined) {
    const path = resolve(REPO_ROOT, module);
    cached = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    sourceCache.set(module, cached);
  }
  return cached;
}

/** Own members of the top-level interface (or object-type alias) `name`. */
function shapeOf([module, name]: Bag): BagShape | undefined {
  const source = sourceOf(module);
  for (const statement of source.statements) {
    const decl =
      (ts.isInterfaceDeclaration(statement) ||
        (ts.isTypeAliasDeclaration(statement) &&
          ts.isTypeLiteralNode(statement.type))) &&
      statement.name.text === name
        ? statement
        : undefined;
    if (decl === undefined) {
      continue;
    }
    const members = ts.isInterfaceDeclaration(decl)
      ? decl.members
      : (decl.type as ts.TypeLiteralNode).members;
    const exported =
      (ts.getCombinedModifierFlags(decl) & ts.ModifierFlags.Export) !== 0;
    const names = members.flatMap((m) =>
      (ts.isPropertySignature(m) || ts.isMethodSignature(m)) &&
      (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name))
        ? [m.name.text]
        : [],
    );
    return { exported, members: names };
  }
  return undefined;
}

describe("option-bag casing (D1)", () => {
  it("lists distinct bags", () => {
    const keys = [...CONFIG_BAGS, ...QUERY_BAGS].map((b) => b.join("#"));
    expect(new Set(keys).size).toBe(keys.length);
  });

  describe("config bags are camelCase", () => {
    for (const bag of CONFIG_BAGS) {
      it(`${bag[1]} (${bag[0]})`, () => {
        const shape = shapeOf(bag);
        expect(shape, "interface must exist where listed").toBeDefined();
        expect(shape?.exported, "interface must be exported").toBe(true);
        const offenders = shape?.members.filter((m) => !CAMEL.test(m)) ?? [];
        expect(offenders).toStrictEqual([]);
      });
    }
  });

  describe("query bags still mirror Python keyword arguments", () => {
    for (const bag of QUERY_BAGS) {
      it(`${bag[1]} (${bag[0]})`, () => {
        const shape = shapeOf(bag);
        expect(shape, "interface must exist where listed").toBeDefined();
        expect(shape?.exported, "interface must be exported").toBe(true);
        const members = shape?.members ?? [];
        expect(
          members.some((m) => SNAKE.test(m)),
          "at least one snake_case member (else reclassify as a config bag)",
        ).toBe(true);
        const offenders = members.filter(
          (m) => !SNAKE.test(m) && !CAMEL.test(m),
        );
        expect(offenders).toStrictEqual([]);
      });
    }
  });
});
