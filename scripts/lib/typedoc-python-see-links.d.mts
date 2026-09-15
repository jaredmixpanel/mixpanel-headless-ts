import type { Application } from "typedoc";

export interface PythonReference {
  readonly url: string;
  readonly anchor: string;
  readonly exact: boolean;
}
export declare function resolvePythonReference(
  dotted: string,
): PythonReference | undefined;
export declare function load(app: Application): void;
