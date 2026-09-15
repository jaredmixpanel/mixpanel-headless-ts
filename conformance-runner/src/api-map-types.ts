/**
 * Types for the generated api-map.
 *
 * `api-map.gen.ts` (written by `scripts/generate-api-map.mjs`) maps every
 * Python dotted `call.api` in the corpus `api-index.json` to its TS home;
 * this module holds the entry shape so the generated file stays pure data.
 */

/** Registry kind carried through from the corpus `api-index.json`. */
export type ApiEntryKind = "wire_api" | "wire_state" | "builder" | "validator";

/** One resolved api-map entry (Python entry point to TS home and signature). */
export interface ApiMapEntry {
  /** The Python dotted name exactly as vectors carry it (`call.api`). */
  readonly pythonApi: string;
  /** Source Python module import path (from api-index; the `UNPORTED` universe). */
  readonly pythonModule: string;
  /** TS module path, e.g. `core/query/segfilter`. */
  readonly tsModule: string;
  /** TS member name, e.g. `buildSegfilterEntry`. */
  readonly tsName: string;
  /** Registry kind (wire_api / wire_state / builder / validator). */
  readonly kind: ApiEntryKind;
  /** Corpus capability directory, e.g. `funnels`. */
  readonly capability: string;
  /** Positional parameter names, Python spelling and order. */
  readonly params: readonly string[];
  /** Keyword-only parameter names, Python spelling. */
  readonly kwonly: readonly string[];
}

/** SHA-256 provenance stamps for the four generation inputs. */
export interface ApiMapSourceHashes {
  /** sha256 of the snapshotted `typescript-port-api-map.json`. */
  readonly apiMapJson: string;
  /** sha256 of the corpus `api-index.json` sidecar. */
  readonly apiIndexJson: string;
  /** sha256 of `naming-exceptions.json`. */
  readonly namingExceptionsJson: string;
  /** sha256 of `authored-apis.json` (the hand-written `compat.*`/`wirestub.*` supplement). */
  readonly authoredApisJson: string;
}
