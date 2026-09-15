/**
 * Factory for the `session` namespace (`show` / `use` over the persisted
 * `[active]` block). Python builds a fresh `ConfigManager()` per call;
 * core exports a factory over the injected {@link AuthEffects} bag and
 * `@mixpanel-headless/node` exports the ready-made `session` object
 * bound to on-disk effects.
 *
 * @see mixpanel_headless.session
 */

import type { ActiveSession } from "../auth/session.js";
import { ParamValidationError } from "../errors.js";
import type { AuthEffects } from "./auth-effects.js";

/**
 * Options bag of {@link SessionNamespace.use}; keys mirror the Python
 * keyword-only parameters. Every axis left `null` stays untouched.
 */
export interface SessionUseOptions {
  /**
   * New active account name.
   *
   * @defaultValue `null`
   */
  readonly account?: string | null | undefined;
  /**
   * New project ID (digit string) for the active account.
   *
   * @defaultValue `null`
   */
  readonly project?: string | null | undefined;
  /**
   * New active workspace ID.
   *
   * @defaultValue `null`
   */
  readonly workspace?: number | null | undefined;
  /**
   * Apply this target's three axes at once; mutually exclusive with the
   * other keys.
   *
   * @defaultValue `null`
   */
  readonly target?: string | null | undefined;
}

/**
 * The `session` namespace: `show` and `use` over the persisted `[active]`
 * block.
 *
 * @see mixpanel_headless.session
 */
export interface SessionNamespace {
  /**
   * Return the persisted `[active]` block.
   *
   * @returns The active session; the project lives on the active account
   *   as `default_project`, not here.
   * @see mixpanel_headless.session.show
   */
  show: () => ActiveSession;

  /**
   * Update one or more axes in the persisted config.
   *
   * @remarks
   * All updates land in a single `applySession` / `applyTarget`
   * transaction, never two effect calls where Python makes one.
   * @param options - The axes to change, or a `target` to apply.
   * @throws {@link ParamValidationError} - When `target` is combined with
   *   any axis option (code `WS1_TARGET_MUTUALLY_EXCLUSIVE`; Python
   *   raises a bare `ValueError`).
   * @throws {@link ConfigError} - When the account or target is unknown,
   *   or `project` is given with no active account.
   * @see mixpanel_headless.session.use
   */
  use: (options?: SessionUseOptions) => void;
}

/**
 * Build the `session` namespace over an effect bag.
 *
 * @param effects - The injected effects; only `config` is used.
 * @returns The namespace object.
 * @example
 * ```typescript
 * const session = createSessionNamespace(effects);
 * session.use({ account: "team", project: "3018488" });
 * session.show(); // { account: "team", workspace: null }
 * ```
 * @see mixpanel_headless.session
 */
export function createSessionNamespace(effects: AuthEffects): SessionNamespace {
  return {
    show: (): ActiveSession => effects.config.getActive(),
    use: (options: SessionUseOptions = {}): void => {
      const account = options.account ?? null;
      const project = options.project ?? null;
      const workspace = options.workspace ?? null;
      const target = options.target ?? null;
      if (
        target !== null &&
        (account !== null || project !== null || workspace !== null)
      ) {
        // Divergence: Python raises a bare `ValueError` here; the port
        // raises `ParamValidationError` with the code the `Workspace`
        // `target` guard already uses.
        throw new ParamValidationError(
          "`target=` is mutually exclusive with `account=`/`project=`/`workspace=`.",
          "WS1_TARGET_MUTUALLY_EXCLUSIVE",
        );
      }
      if (target !== null) {
        effects.config.applyTarget(target);
        return;
      }
      effects.config.applySession({ account, project, workspace });
    },
  };
}
