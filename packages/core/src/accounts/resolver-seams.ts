/**
 * The real `ResolverSeams` a `Workspace` uses, built over the resolver
 * and an {@link AuthEffects} bag: `resolveSession`, `getAccount`,
 * `resolveProjectAxis` and `envWorkspaceId` route to `auth/resolver.ts`
 * and `effects.config`; `persistActive` routes to
 * `effects.persistActive`, whose default throws until a host package
 * (`@mixpanel-headless/node`) wires the config write.
 *
 * @see mixpanel_headless._internal.auth.resolver.resolve_session
 */

import {
  envWorkspaceId,
  resolveProjectAxis,
  type ResolverSources,
  resolveSession,
} from "../auth/resolver.js";
import type { Session } from "../auth/session.js";
import type { ResolverSeams } from "../workspace-members/lifecycle.js";
import type { AuthEffects, ConfigWrites } from "./auth-effects.js";

/**
 * Build the {@link ResolverSources} bag `resolveSession` consumes from
 * an effect bag — the `config=ConfigManager()` / `bridge=load_bridge()`
 * defaults Python builds inline, made explicit because core does no I/O.
 *
 * The bridge is loaded at call time (Python loads it per resolution),
 * so call this next to each `resolveSession` use rather than caching
 * the result.
 *
 * @param effects - The effect bag.
 * @returns The injected-source bag.
 */
export function resolverSourcesFromEffects(
  effects: AuthEffects,
): ResolverSources {
  return {
    env: effects.env,
    config: effects.config,
    bridge: effects.bridge.load(),
  };
}

/**
 * Build the full seam bag over an effect bag — `Workspace` construction
 * accepts it through `WorkspaceOptions.seams`.
 *
 * @param effects - The effect bag.
 * @returns The five seams; `persistActive` routes to the effect member,
 *   which throws until a host package wires it.
 * @example
 * ```typescript
 * const ws = new Workspace({
 *   session,
 *   seams: resolverSeamsFromEffects(effects),
 * });
 * await ws.use({ account: "other" });
 * ```
 */
export function resolverSeamsFromEffects(effects: AuthEffects): ResolverSeams {
  return {
    resolveSession: ({ target }): Promise<Session> =>
      Promise.resolve(
        resolveSession({ target }, resolverSourcesFromEffects(effects)),
      ),
    getAccount: (name) => Promise.resolve(effects.config.getAccount(name)),
    resolveProjectAxis: (args) =>
      Promise.resolve(
        resolveProjectAxis({
          explicit: args.explicit,
          target_project: args.target_project,
          bridge: effects.bridge.load(),
          account: args.account,
          env: effects.env,
        }),
      ),
    envWorkspaceId: () => envWorkspaceId(effects.env),
    persistActive: (session) => effects.persistActive(session),
  };
}

/**
 * The `persistActive` routing over a config-write surface: all three
 * axes land in one `applySession` transaction, with `clear_workspace`
 * set when the in-session workspace was cleared, so a stale
 * `[active].workspace` never survives an account swap.
 * `@mixpanel-headless/node` binds it to the on-disk `ConfigManager`
 * when implementing the `persistActive` effect; tests wire it to the
 * in-memory config fake.
 *
 * @param config - The config-write surface.
 * @param session - The post-swap session to persist.
 * @see mixpanel_headless.workspace.Workspace._persist_active
 */
export function persistActiveToConfig(
  config: ConfigWrites,
  session: Session,
): void {
  const workspace = session.workspace ?? null;
  config.applySession({
    account: session.account.name,
    project: session.project.id,
    ...(workspace === null
      ? { clear_workspace: true }
      : { workspace: workspace.id }),
  });
}
