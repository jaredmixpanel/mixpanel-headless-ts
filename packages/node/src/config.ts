/**
 * On-disk TOML configuration manager — the public surface of `./config/`
 * (`manager.ts` owns the file + transaction, `blocks.ts` the block ↔
 * model conversions, `apply.ts` the in-place `_apply_*` mutators).
 */

export {
  type ManagerClearActive,
  type ManagerSetActive,
} from "./config/apply.js";
export { type RawConfig } from "./config/blocks.js";
export {
  ConfigManager,
  type ConfigManagerOptions,
  type ConfigWriteBytes,
  type CustomHeaderParams,
} from "./config/manager.js";
