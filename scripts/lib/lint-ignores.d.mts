export interface IgnoredPath {
  readonly path: string;
  readonly why: string;
}
export declare const FROZEN_PATHS: readonly IgnoredPath[];
export declare const LOCAL_PATHS: readonly IgnoredPath[];
export declare function eslintIgnorePatterns(): string[];
