/**
 * The `mp.targets` namespace — TS port of
 * `mixpanel_headless/targets.py` (whole file; B7-A1 packet §3.1,
 * `b7-packets.md`).
 *
 * Targets are saved (account, project, workspace?) triples used as
 * named cursor positions; `use(name)` writes all three axes to
 * `[active]` in a single config save. Factory over the injected
 * {@link AuthEffects} bag (R9.4); B8 exports the ready-made object.
 */

import type { Target } from "../types/entities/accounts.js";
import type { AuthEffects } from "./auth-effects.js";

/** Options bag of {@link TargetsNamespace.add} (Python kwonly, R3.8). */
export interface TargetsAddOptions {
  /** Referenced account name (must exist). */
  readonly account: string;
  /** Project ID (digit string). */
  readonly project: string;
  /** Optional workspace ID. */
  readonly workspace?: number | null | undefined;
}

/** The `mp.targets` surface (`targets.py` `__all__`). */
export interface TargetsNamespace {
  /**
   * Return all configured targets sorted by name (`list`,
   * `targets.py:25-31`).
   *
   * @returns Sorted target records.
   */
  list(): Target[];

  /**
   * Add a new target block (`add`, `targets.py:34-57`).
   *
   * @param name - Target name (block key).
   * @param options - account / project / optional workspace.
   * @returns The constructed target.
   * @throws ConfigError - Duplicate name, missing account, or
   *   validation failure.
   */
  add(name: string, options: TargetsAddOptions): Target;

  /**
   * Remove a target block (`remove`, `targets.py:60-69`).
   *
   * @param name - Target to remove.
   * @throws ConfigError - Target does not exist.
   */
  remove(name: string): void;

  /**
   * Apply the target — write all three axes to `[active]` atomically
   * (`use`, `targets.py:72-81`; ONE `applyTarget` transaction, packet
   * §3.3).
   *
   * @param name - Target to apply.
   * @throws ConfigError - Target does not exist OR its referenced
   *   account is gone.
   */
  use(name: string): void;

  /**
   * Return the named target (`show`, `targets.py:84-96`).
   *
   * @param name - Target name.
   * @returns The target record.
   * @throws ConfigError - Target does not exist.
   */
  show(name: string): Target;
}

/**
 * Build the `mp.targets` namespace over an effect bag.
 *
 * @param effects - The injected effects (config writes).
 * @returns The namespace object.
 *
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
