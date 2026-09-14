/**
 * Node env wiring — the live `ResolverEnv & {get}` bag (b8-packets.md
 * §2.1 row 3, §0.5). There is no single Python source file: Python
 * reads `os.environ` inline at each site; the B7 core replaced those
 * reads with the injected {@link ResolverEnv} bag, and THIS module
 * supplies the real one over `process.env`.
 *
 * Every member reads `process.env` AT CALL TIME — never at bag
 * construction and never at module load (packet §0.4 / §7 caution 16:
 * a load-time capture would break the `monkeypatch.setenv`-equivalent
 * test isolation and the `TestNoEnvMutation` lock). Values are
 * returned RAW: empty-string falsiness stays the resolver core's job
 * (`resolver.ts` owns the `=== ""` rungs; watchlist #6).
 */

import type { ResolverEnv } from "@mixpanel-headless/core";
import {
  endpointOverridesFromEnv,
  type EndpointOverrides,
} from "@mixpanel-headless/core";

/** The full env surface the auth effects consume (`AuthEffects.env`). */
export type NodeEnv = ResolverEnv & {
  /**
   * Read one environment variable (the generic `os.environ.get` twin
   * used by `token_env` indirection and login-type detection,
   * `accounts.py:1409`, `region_probe.py:252`).
   *
   * @param name - Variable name.
   * @returns The raw value, or `undefined` when unset.
   */
  get(name: string): string | undefined;
};

/**
 * Build the live env bag over `process.env`.
 *
 * @returns A bag whose six `MP_*` getters and generic `get` all read
 *   `process.env` at call time.
 *
 * @example
 * ```typescript
 * const env = createNodeEnv();
 * process.env.MP_REGION = "eu";
 * env.MP_REGION; // "eu" — reflected immediately (call-time read)
 * ```
 */
export function createNodeEnv(): NodeEnv {
  const read = (name: string): string | undefined => process.env[name];
  return {
    get: read,
    /** @returns `MP_USERNAME` at call time. */
    get MP_USERNAME(): string | undefined {
      return read("MP_USERNAME");
    },
    /** @returns `MP_SECRET` at call time. */
    get MP_SECRET(): string | undefined {
      return read("MP_SECRET");
    },
    /** @returns `MP_PROJECT_ID` at call time. */
    get MP_PROJECT_ID(): string | undefined {
      return read("MP_PROJECT_ID");
    },
    /** @returns `MP_REGION` at call time. */
    get MP_REGION(): string | undefined {
      return read("MP_REGION");
    },
    /** @returns `MP_OAUTH_TOKEN` at call time. */
    get MP_OAUTH_TOKEN(): string | undefined {
      return read("MP_OAUTH_TOKEN");
    },
    /** @returns `MP_WORKSPACE_ID` at call time. */
    get MP_WORKSPACE_ID(): string | undefined {
      return read("MP_WORKSPACE_ID");
    },
  };
}

/**
 * The alternate-host override provider over `process.env` — the node
 * twin of Python PR #235's per-request `os.environ.get("MP_API_BASE_URL")`
 * / `os.environ.get("MP_APP_BASE_URL")` reads (`api_client._endpoints_for`).
 *
 * The returned provider reads BOTH variables on every call (never at
 * construction, never at module load), so a value exported after the
 * client exists still redirects the next request and unsetting it
 * restores the live hosts — exactly Python's semantics.
 * {@link createNodeWorkspace} wires it into the client automatically; pass
 * it yourself when building a core client by hand.
 *
 * @returns A per-call provider for `MixpanelClientOptions.endpointOverrides`.
 *
 * @example
 * ```typescript
 * process.env.MP_API_BASE_URL = "http://127.0.0.1:8080/";
 * const client = createMixpanelClient({
 *   session,
 *   endpointOverrides: createNodeEndpointOverrides(),
 * });
 * client.core.buildUrl("query", "/events/names");
 * // "http://127.0.0.1:8080/api/query/events/names"
 * ```
 */
export function createNodeEndpointOverrides(): () => EndpointOverrides {
  return endpointOverridesFromEnv((name) => process.env[name]);
}
