/**
 * The `mp.session` namespace — TS port of
 * `mixpanel_headless/session.py` (whole file; B7-A1 packet §3.1,
 * `b7-packets.md`).
 *
 * Python builds a fresh `ConfigManager()` per call; the TS core
 * exports a FACTORY over the injected {@link AuthEffects} bag (R9.4).
 * B8 exports the ready-made `session` object bound to on-disk effects.
 */

import type { ActiveSession } from "../auth/session.js";
import { ParamValidationError } from "../errors.js";
import type { AuthEffects } from "./auth-effects.js";

/** Options bag of {@link SessionNamespace.use} (Python kwonly, R3.8). */
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

/** The `mp.session` surface (`session.py` `__all__`: show, use). */
export interface SessionNamespace {
  /**
   * Return the persisted `[active]` block (`show`, `session.py:24-32`).
   *
   * @returns The active session; project lives on the active account
   *   as `default_project`, not here.
   */
  show(): ActiveSession;

  /**
   * Update one or more axes in the persisted config (`use`,
   * `session.py:35-77`). All updates land in a SINGLE
   * `applySession` / `applyTarget` transaction (packet §3.3 atomicity
   * rule — never two effect calls where Python makes one).
   *
   * @param options - The axes (or a target).
   * @throws ParamValidationError - `target` combined with any axis
   *   kwarg (Python raises bare `ValueError`; R5 maps it to the
   *   EXISTING `WS1_TARGET_MUTUALLY_EXCLUSIVE` code, packet Caution
   *   #14).
   * @throws ConfigError - Unknown account/target, or `project` with no
   *   active account.
   */
  use(options?: SessionUseOptions): void;
}

/**
 * Build the `mp.session` namespace over an effect bag.
 *
 * @param effects - The injected effects (config writes).
 * @returns The namespace object.
 *
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
