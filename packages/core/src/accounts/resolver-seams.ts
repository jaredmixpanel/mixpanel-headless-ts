/**
 * Real `ResolverSeams` implementations over the A2 resolver + the
 * effect bag — the B6-W1 outbound deferral (`b6-packets.md:1025`;
 * B7-A1 packet §3.2).
 *
 * Four of the five W1-D1 seams become REAL here:
 *
 * | seam                | implementation                                  |
 * |---------------------|-------------------------------------------------|
 * | `resolveSession`    | A2 `resolveSession({target}, sources)`          |
 * | `getAccount`        | `effects.config.getAccount`                     |
 * | `resolveProjectAxis`| A2 `resolveProjectAxis` over env + bridge       |
 * | `envWorkspaceId`    | A2 `envWorkspaceId(effects.env)`                |
 * | `persistActive`     | ROUTED to `effects.persistActive` — the member's |
 * |                     | default still throws (B8-owned,                 |
 * |                     | `b6-packets.md:1026`)                           |
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
 * an effect bag (the Python `config=ConfigManager()` /
 * `bridge=load_bridge()` defaults, `resolver.py`, made
 * explicit per R9.4).
 *
 * The bridge is loaded AT CALL TIME (Python loads it per resolution),
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
 * Build the full W1-D1 seam bag over an effect bag — `Workspace`
 * construction accepts it via the existing `WorkspaceOptions.seams`
 * bag (no facade signature change; the B6 tests that stub seams keep
 * working).
 *
 * @param effects - The effect bag.
 * @returns The five seams (four REAL; `persistActive` routed to the
 *   still-stubbed effect member).
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
 * The documented `persistActive` ROUTING — the
 * `Workspace._persist_active` composition
 * over a config-write surface: all three axes land in ONE
 * `applySession` transaction, with `clear_workspace` set when the
 * in-session workspace was cleared (so a stale `[active].workspace`
 * never survives an account swap).
 *
 * B7 ships this routing; B8 binds it to the on-disk `ConfigManager`
 * when implementing the `persistActive` effect (packet §3.2 — the
 * effect's DEFAULT still throws `UNPORTED_AUTH_SEAM`). Tests wire it
 * to the in-memory config fake.
 *
 * @param config - The config-write surface.
 * @param session - The post-swap session to persist.
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
