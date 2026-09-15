/**
 * Factory for the `targets` namespace. Targets are saved
 * (account, project, workspace?) triples used as named cursor
 * positions; `use(name)` writes all three axes to `[active]` in a
 * single config save. Core exports the factory over the injected
 * {@link AuthEffects} bag; `@mixpanel-headless/node` exports the
 * ready-made object bound to on-disk effects.
 *
 * @see mixpanel_headless.targets
 */

import type { Target } from "../types/entities/accounts.js";
import type { AuthEffects } from "./auth-effects.js";

/** Options bag of {@link TargetsNamespace.add} (Python keyword-only parameters). */
export interface TargetsAddOptions {
  /** Referenced account name (must exist). */
  readonly account: string;
  /** Project ID (digit string). */
  readonly project: string;
  /** Optional workspace ID. */
  readonly workspace?: number | null | undefined;
}

/** The `targets` surface (Python `__all__`). */
export interface TargetsNamespace {
  /**
   * Return all configured targets sorted by name (Python `list`).
   *
   * @returns Sorted target records.
   */
  list: () => Target[];

  /**
   * Add a new target block (Python `add`).
   *
   * @param name - Target name (block key).
   * @param options - account / project / optional workspace.
   * @returns The constructed target.
   * @throws ConfigError - Duplicate name, missing account, or
   *   validation failure.
   */
  add: (name: string, options: TargetsAddOptions) => Target;

  /**
   * Remove a target block (Python `remove`).
   *
   * @param name - Target to remove.
   * @throws ConfigError - Target does not exist.
   */
  remove: (name: string) => void;

  /**
   * Apply the target — write all three axes to `[active]` atomically
   * (Python `use`; one `applyTarget` transaction).
   *
   * @param name - Target to apply.
   * @throws ConfigError - Target does not exist, or its referenced
   *   account is gone.
   */
  use: (name: string) => void;

  /**
   * Return the named target (Python `show`).
   *
   * @param name - Target name.
   * @returns The target record.
   * @throws ConfigError - Target does not exist.
   */
  show: (name: string) => Target;
}

/**
 * Build the `targets` namespace over an effect bag.
 *
 * @param effects - The injected effects (config writes).
 * @returns The namespace object.
 * @example
 * ```typescript
 * const targets = createTargetsNamespace(effects);
 * targets.add("ecom", { account: "team", project: "3018488" });
 * targets.use("ecom");
 * ```
 */
export function createTargetsNamespace(effects: AuthEffects): TargetsNamespace {
  return {
    list: (): Target[] => effects.config.listTargets(),
    add: (name: string, options: TargetsAddOptions): Target =>
      effects.config.addTarget(name, {
        account: options.account,
        project: options.project,
        workspace: options.workspace ?? null,
      }),
    remove: (name: string): void => {
      effects.config.removeTarget(name);
    },
    use: (name: string): void => {
      effects.config.applyTarget(name);
    },
    show: (name: string): Target => effects.config.getTarget(name),
  };
}
