export declare const WORKSPACE_ALIASES: ReadonlyArray<
  readonly [specifier: string, sourcePath: string]
>;
export declare function esbuildAliases(): Record<string, string>;
export declare function vitestAliases(): Array<{
  find: RegExp;
  replacement: string;
}>;
