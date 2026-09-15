/**
 * Central wiring of ported TS entry points into the conformance runner.
 *
 * Every binding module registers here: one {@link ImplementationRegistry}
 * entry per Python dotted api name and one {@link CodecRegistry} decoder
 * per rich `$type` tag the bound signatures consume. Both the vitest
 * corpus harness and the standalone `npm run conformance` CLI build their
 * dependencies through {@link createRunnerDeps}, so the two entry points
 * cannot disagree about what is ported.
 *
 * The binding tables themselves live in `bindings/` (compat, wire
 * stubs, `types.*` constructors, validators, builders, replays) and the
 * `wire-*.ts` modules; this façade only assembles them.
 */

import { registerBuilderBindings } from "./bindings/builders.js";
import { registerCompatBindings } from "./bindings/compat.js";
import { registerReplaysBindings } from "./bindings/replays.js";
import { registerQueryParamBindings } from "./bindings/types.js";
import { registerValidatorBindings } from "./bindings/validators.js";
import {
  registerClientInternalsBindings,
  registerWireStubBindings,
} from "./bindings/wire.js";
import { CodecRegistry, UndecodableValueError } from "./codecs.js";
import type { JsonValue } from "./json-value.js";
import { ImplementationRegistry, type RunnerDeps } from "./runner.js";
import { CONTRACT_TAG_CODECS } from "./vector-codecs.js";
import { registerAuthWireBindings } from "./wire-auth.js";
import { registerApiClientCoreBindings } from "./wire-client.js";
import { registerEntityWireBindings } from "./wire-entities.js";
import { registerGovernanceWireBindings } from "./wire-governance.js";
import { registerLifecycleWireBindings } from "./wire-lifecycle.js";
import { registerPaginationBindings } from "./wire-pagination.js";
import { registerQueryWireBindings } from "./wire-queries.js";
import { registerWorkspaceBindings } from "./wire-workspace.js";
import { registerWorkspaceEntityBindings } from "./wire-workspace-entities.js";

export { CoreLibraryError } from "./bindings/shared.js";

/**
 * Register the contract tag codecs.
 *
 * The table itself lives in `vector-codecs.ts` so the conformance runner
 * and the differential oracle can never disagree about how a tag
 * decodes. Decode failures wrap into {@link UndecodableValueError},
 * mirroring Python `_decode_model` (a committed vector that fails decode
 * is a codec-table or vector bug and must fail loudly).
 *
 * @param codecs - The registry to extend.
 */
export function registerContractCodecs(codecs: CodecRegistry): void {
  for (const [tag, codec] of CONTRACT_TAG_CODECS) {
    codecs.registerTagCodec(
      tag,
      (payload, decodeField) => {
        try {
          return codec.decode(payload, (value) =>
            decodeField(value as JsonValue),
          );
        } catch (error) {
          throw new UndecodableValueError(
            `could not reconstruct ${tag} from vector fields: ${String(error)}`,
          );
        }
      },
      {
        matches: (value) => codec.matches(value),
        // The core encode walk produces vector-JSON by construction
        // (children pass through encodeChild); the assertion re-types
        // the structurally generic core return for the runner.
        encode: (value, encodeChild) =>
          codec.encode(value, encodeChild) as JsonValue,
      },
    );
  }
}

/**
 * Build the runner dependencies with every registered binding.
 *
 * @param recordEpoch - The frozen record instant (corpus config /
 *   manifest `record_epoch`).
 * @returns Fresh {@link RunnerDeps} carrying all registered bindings.
 * @example
 * ```typescript
 * const deps = createRunnerDeps("2026-01-15T12:00:00Z");
 * const results = await runCorpus(corpus, deps);
 * ```
 */
export function createRunnerDeps(recordEpoch: string): RunnerDeps {
  const implementations = new ImplementationRegistry();
  const codecs = new CodecRegistry();
  registerCompatBindings(implementations);
  registerWireStubBindings(implementations);
  registerClientInternalsBindings(implementations);
  // api_client.* wire bindings: client core, then query-host + engage +
  // streaming/export, dashboards + bookmarks + cohorts CRUD, flags +
  // experiments + annotations + webhooks + alerts, data governance +
  // replays signing, and pagination.paginate_all.
  registerApiClientCoreBindings(implementations);
  registerQueryWireBindings(implementations);
  registerEntityWireBindings(implementations);
  registerLifecycleWireBindings(implementations);
  registerGovernanceWireBindings(implementations);
  registerPaginationBindings(implementations);
  registerContractCodecs(codecs);
  // workspace.<member> facade bindings (queries, lifecycle, me, business
  // context) and the entity members; then the replays family
  // (`replays.*` wire + `replay_labels.*` + `rrweb_analyzer.analyze`).
  registerWorkspaceBindings(implementations, codecs);
  registerWorkspaceEntityBindings(implementations, codecs);
  registerReplaysBindings(implementations, codecs);
  registerQueryParamBindings(implementations, codecs);
  registerValidatorBindings(implementations);
  registerBuilderBindings(implementations, codecs);
  // region_probe.probe_region + the OAuth flow wire vectors.
  registerAuthWireBindings(implementations);
  return { implementations, codecs, recordEpoch };
}
