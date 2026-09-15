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

/**
 * Options bag of {@link TargetsNamespace.add}; keys mirror the Python
 * keyword-only parameters.
 */
export interface TargetsAddOptions {
  /** Referenced account name; must exist. */
  readonly account: string;
  /** Project ID (digit string). */
  readonly project: string;
  /**
   * Workspace ID (positive integer) pinned by the target.
   *
   * @defaultValue `null`
   */
  readonly workspace?: number | null | undefined;
}

/**
 * The `targets` namespace: named (account, project, workspace?) triples
 * applied to `[active]` in one write.
 *
 * @see mixpanel_headless.targets
 */
export interface TargetsNamespace {
  /**
   * Return every configured target, sorted by name.
   *
   * @returns The target records.
   * @see mixpanel_headless.targets.list
   */
  list: () => Target[];

  /**
   * Add a new target block.
   *
   * @param name - Target name (the config block key).
   * @param options - The referenced `account`, the `project` and an
   *   optional `workspace`.
   * @returns The constructed target.
   * @throws {@link ConfigError} - When the name is taken, the account is
   *   missing, or validation fails.
   * @see mixpanel_headless.targets.add
   */
  add: (name: string, options: TargetsAddOptions) => Target;

  /**
   * Remove a target block.
   *
   * @param name - Target to remove.
   * @throws {@link ConfigError} - When the target does not exist.
   * @see mixpanel_headless.targets.remove
   */
  remove: (name: string) => void;

  /**
   * Apply a target: write all three axes to `[active]` in one
   * `applyTarget` transaction.
   *
   * @param name - Target to apply.
   * @throws {@link ConfigError} - When the target does not exist, or its
   *   referenced account is gone.
   * @see mixpanel_headless.targets.use
   */
  use: (name: string) => void;

  /**
   * Return the named target.
   *
   * @param name - Target name.
   * @returns The target record.
   * @throws {@link ConfigError} - When the target does not exist.
   * @see mixpanel_headless.targets.show
   */
  show: (name: string) => Target;
}

/**
 * Build the `targets` namespace over an effect bag.
 *
 * @param effects - The injected effects; only `config` is used.
 * @returns The namespace object.
 * @example
 * ```typescript
 * const targets = createTargetsNamespace(effects);
 * targets.add("ecom", { account: "team", project: "3018488" });
 * targets.use("ecom"); // [active] now points at team / 3018488
 * ```
 * @see mixpanel_headless.targets
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
