/**
 * `createNodeWorkspace()` — the parity twin of Python's zero-config
 * `Workspace()` construction (`workspace.py:424-513`).
 *
 * Python's constructor wires four on-disk collaborators implicitly:
 * the resolver sources (env / `~/.mp/config.toml` / bridge file, with
 * the bridge-token materialization side effect), the
 * `OnDiskTokenResolver` for oauth_browser bearer refresh, the per-account
 * on-disk `/me` cache (`MeCache`), and filesystem reads for
 * `uploadLookupTable`. The core `Workspace` takes all four as injected
 * seams (R9.4); this factory is the node-side composition that makes
 * `createNodeWorkspace()` behave like Python's `Workspace()`.
 *
 * Added post-Phase-3 (QA 2026-08-17): the pieces all shipped in B7/B8
 * but nothing composed them, so the documented
 * `new Workspace({ sources: createNodeWorkspaceSources() })` recipe
 * failed on the first OAuth query with `TokenResolver is required`.
 */

import { Workspace, type WorkspaceOptions } from "../../core/src/workspace.js";
import type { MixpanelClientOptions } from "../../core/src/client/client.js";
import {
  createNodeAuthEffects,
  type NodeAuthEffectsOptions,
} from "./auth-effects.js";
import { bridgeViewFromFile, loadBridgeForStartup } from "./auth/bridge.js";
import { nodeReadFile } from "./fs-seams.js";
import { MeCache } from "./me-cache.js";

/**
 * Options for {@link createNodeWorkspace} — the resolver axes of
 * `WorkspaceOptions` plus the node effects seams and client extras.
 */
export interface NodeWorkspaceOptions extends NodeAuthEffectsOptions {
  /** Named account from config (resolver axis, `workspace.py:427`). */
  readonly account?: string | null | undefined;
  /** Project ID override (resolver axis, digit string). */
  readonly project?: string | null | undefined;
  /** Workspace ID override (resolver axis, positive int). */
  readonly workspace?: number | null | undefined;
  /** Apply all three axes from `[targets.NAME]` (mutually exclusive). */
  readonly target?: string | null | undefined;
  /**
   * Extra client options (transport / timing seams). A caller-supplied
   * `tokenResolver` wins over the on-disk default this factory wires.
   */
  readonly clientOptions?: Omit<MixpanelClientOptions, "session"> | undefined;
}

/**
 * Build a fully wired node `Workspace` — config-file accounts, bridge
 * startup materialization, on-disk OAuth token refresh, on-disk `/me`
 * cache, and `node:fs` reads — exactly what Python's bare
 * `Workspace()` does.
 *
 * @param options - Resolver-axis overrides, node effects seams, and
 *   extra client options.
 * @returns The constructed facade.
 * @throws ConfigError - No resolvable account, or a malformed config /
 *   bridge file.
 *
 * @example
 * ```typescript
 * import { createNodeWorkspace } from "@mixpanel-headless/node";
 *
 * const ws = createNodeWorkspace();
 * const result = await ws.query("Purchase", { math: "unique", last: 30 });
 * ```
 */
export function createNodeWorkspace(
  options: NodeWorkspaceOptions = {},
): Workspace {
  const effectsOptions: NodeAuthEffectsOptions = {
    ...(options.configPath !== undefined
      ? { configPath: options.configPath }
      : {}),
    ...(options.fetchImpl !== undefined
      ? { fetchImpl: options.fetchImpl }
      : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.logger !== undefined ? { logger: options.logger } : {}),
    ...(options.flowSeams !== undefined
      ? { flowSeams: options.flowSeams }
      : {}),
  };
  const effects = createNodeAuthEffects(effectsOptions);
  // Startup bridge load WITH the token-materialization side effect
  // (`workspace.py:476-513`; the B8-ARB-A SEM-F1 composition).
  const bridge = loadBridgeForStartup();

  const workspaceOptions: WorkspaceOptions = {
    ...(options.account !== undefined ? { account: options.account } : {}),
    ...(options.project !== undefined ? { project: options.project } : {}),
    ...(options.workspace !== undefined
      ? { workspace: options.workspace }
      : {}),
    ...(options.target !== undefined ? { target: options.target } : {}),
    sources: {
      env: effects.env,
      config: effects.config,
      bridge: bridge === null ? null : bridgeViewFromFile(bridge),
    },
    clientOptions: {
      tokenResolver: effects.tokenResolver,
      ...options.clientOptions,
    },
    meCache: (accountName: string) => new MeCache({ accountName }),
    readFile: nodeReadFile,
  };
  return new Workspace(workspaceOptions);
}
