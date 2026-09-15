/**
 * Node env wiring — the live {@link ResolverEnv} bag over `process.env`.
 * Python reads `os.environ` inline at each site; core replaced those
 * reads with an injected bag, and this module supplies the real one.
 *
 * Every member reads `process.env` at call time, never at bag
 * construction and never at module load, so per-test env isolation
 * (the `monkeypatch.setenv` equivalent) keeps working. Values come back
 * raw: empty-string falsiness stays the resolver core's job.
 *
 * @see mixpanel_headless._internal.auth.resolver
 */

import {
  type EndpointOverrides,
  endpointOverridesFromEnv,
  type ResolverEnv,
} from "@mixpanel-headless/core";

/** The full env surface the auth effects consume (`AuthEffects.env`). */
export type NodeEnv = ResolverEnv & {
  /**
   * Read one environment variable — the generic `os.environ.get` twin
   * behind `token_env` indirection and login-type detection.
   *
   * @param name - Variable name.
   * @returns The raw value, or `undefined` when unset.
   */
  get: (name: string) => string | undefined;
};

/**
 * Build the live env bag over `process.env`.
 *
 * @returns A bag whose six `MP_*` getters and generic `get` all read
 *   `process.env` at call time.
 * @example
 * ```ts
 * const env = createNodeEnv();
 * process.env.MP_REGION = "eu";
 * env.MP_REGION; // "eu" — reflected immediately (call-time read)
 * ```
 */
export function createNodeEnv(): NodeEnv {
  const read = (name: string): string | undefined => process.env[name];
  return {
    get: read,
    /**
     * Read `MP_USERNAME`.
     *
     * @returns The value at call time.
     */
    get MP_USERNAME(): string | undefined {
      return read("MP_USERNAME");
    },
    /**
     * Read `MP_SECRET`.
     *
     * @returns The value at call time.
     */
    get MP_SECRET(): string | undefined {
      return read("MP_SECRET");
    },
    /**
     * Read `MP_PROJECT_ID`.
     *
     * @returns The value at call time.
     */
    get MP_PROJECT_ID(): string | undefined {
      return read("MP_PROJECT_ID");
    },
    /**
     * Read `MP_REGION`.
     *
     * @returns The value at call time.
     */
    get MP_REGION(): string | undefined {
      return read("MP_REGION");
    },
    /**
     * Read `MP_OAUTH_TOKEN`.
     *
     * @returns The value at call time.
     */
    get MP_OAUTH_TOKEN(): string | undefined {
      return read("MP_OAUTH_TOKEN");
    },
    /**
     * Read `MP_WORKSPACE_ID`.
     *
     * @returns The value at call time.
     */
    get MP_WORKSPACE_ID(): string | undefined {
      return read("MP_WORKSPACE_ID");
    },
  };
}

/**
 * Build the alternate-host override provider over `process.env` — the
 * node twin of Python's per-request `MP_API_BASE_URL` /
 * `MP_APP_BASE_URL` reads.
 *
 * @remarks
 * The returned provider reads both variables on every call (never at
 * construction, never at module load), so a value exported after the
 * client exists still redirects the next request and unsetting it
 * restores the live hosts, exactly as in Python. `createNodeWorkspace`
 * wires it into the client automatically; pass it yourself when
 * building a core client by hand.
 * @returns A per-call provider for `MixpanelClientOptions.endpointOverrides`.
 * @example
 * ```ts
 * process.env.MP_API_BASE_URL = "http://127.0.0.1:8080/";
 * const client = createMixpanelClient({
 *   session,
 *   endpointOverrides: createNodeEndpointOverrides(),
 * });
 * client.core.buildUrl("query", "/events/names");
 * // "http://127.0.0.1:8080/api/query/events/names"
 * ```
 * @see mixpanel_headless._internal.api_client._endpoints_for
 */
export function createNodeEndpointOverrides(): () => EndpointOverrides {
  return endpointOverridesFromEnv((name) => process.env[name]);
}
