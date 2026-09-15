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

/** Options bag of {@link SessionNamespace.use} (Python keyword-only parameters). */
export interface SessionUseOptions {
  /** New active account name. */
  readonly account?: string | null | undefined;
  /** New project ID (digit string) for the active account. */
  readonly project?: string | null | undefined;
  /** New active workspace ID. */
  readonly workspace?: number | null | undefined;
  /** Apply this target's three axes atomically (mutually exclusive). */
  readonly target?: string | null | undefined;
}

/** The `session` surface (Python `__all__`: `show`, `use`). */
export interface SessionNamespace {
  /**
   * Return the persisted `[active]` block (Python `show`).
   *
   * @returns The active session; project lives on the active account
   *   as `default_project`, not here.
   */
  show: () => ActiveSession;

  /**
   * Update one or more axes in the persisted config (Python `use`). All
   * updates land in a single `applySession` / `applyTarget` transaction
   * — never two effect calls where Python makes one.
   *
   * @param options - The axes (or a target).
   * @throws ParamValidationError - `target` combined with any axis
   *   option (Python raises a bare `ValueError`; the port reuses the
   *   `WS1_TARGET_MUTUALLY_EXCLUSIVE` code).
   * @throws ConfigError - Unknown account/target, or `project` with no
   *   active account.
   */
  use: (options?: SessionUseOptions) => void;
}

/**
 * Build the `session` namespace over an effect bag.
 *
 * @param effects - The injected effects (config writes).
 * @returns The namespace object.
 * @example
 * ```typescript
 * const session = createSessionNamespace(effects);
 * session.use({ account: "team" });
 * ```
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
