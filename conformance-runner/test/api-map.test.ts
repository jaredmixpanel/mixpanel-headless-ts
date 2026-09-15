// api-map tests (task TS-4, design D12 / naming-map §5):
//
// 1. Freshness + generator/runtime parity: every committed api-map.gen.ts
//    entry is recomputed from the three inputs through src/naming.ts; any
//    drift (stale generation, or scripts/generate-api-map.mjs disagreeing
//    with the runtime naming module) fails here.
// 2. Workspace authority: api-map.json member signatures must equal the
//    api-index sidecar's (two authorities agree or the snapshot is stale).
// 3. TS-4 done criterion: every call.api in the full corpus snapshot
//    (measured AND setup) resolves to a mapped name or UNPORTED without
//    throwing — never UNMAPPED_API.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  API_MAP,
  API_MAP_SOURCE_HASHES,
  KNOWN_PYTHON_MODULES,
} from "../src/api-map.gen.js";
import { resolveApi } from "../src/api-map.js";
import { loadCorpus, loadCorpusConfig } from "../src/loader.js";
import { type NamingExceptionRow, resolveTsApiName } from "../src/naming.js";

/** The conformance-runner package root. */
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** One api-index entry (corpus sidecar shape, design D4.4). */
interface ApiIndexEntry {
  readonly capability: string;
  readonly kind: string;
  readonly kwonly: readonly string[];
  readonly module: string;
  readonly params: readonly string[];
  readonly target: string;
}

/** One workspace member from typescript-port-api-map.json. */
interface WorkspaceMember {
  readonly name: string;
  readonly params: readonly string[];
  readonly kwonly: readonly string[];
}

/** Read a generation input and its sha256. */
function loadInput(path: string): {
  readonly text: string;
  readonly sha256: string;
} {
  const text = readFileSync(path, "utf8");
  return { text, sha256: createHash("sha256").update(text).digest("hex") };
}

const apiIndexInput = loadInput(
  resolve(PACKAGE_DIR, "corpus", "api-index.json"),
);
const apiMapJsonInput = loadInput(
  resolve(PACKAGE_DIR, "corpus", "typescript-port-api-map.json"),
);
const exceptionsInput = loadInput(
  resolve(PACKAGE_DIR, "src", "naming-exceptions.json"),
);
const authoredApisInput = loadInput(
  resolve(PACKAGE_DIR, "src", "authored-apis.json"),
);

const apiIndex = JSON.parse(apiIndexInput.text) as Record<
  string,
  ApiIndexEntry
>;
const authoredApis = JSON.parse(authoredApisInput.text) as {
  entries: Record<string, ApiIndexEntry>;
  known_modules: readonly string[];
};
/** The full mapping universe: api-index + the authored D13 supplement. */
const universe: Record<string, ApiIndexEntry> = {
  ...apiIndex,
  ...authoredApis.entries,
};
const exceptionRows = (
  JSON.parse(exceptionsInput.text) as { rows: readonly NamingExceptionRow[] }
).rows;
const workspaceMembers = new Map<string, WorkspaceMember>(
  (
    JSON.parse(apiMapJsonInput.text) as {
      workspace_members: readonly WorkspaceMember[];
    }
  ).workspace_members.map((member) => [member.name, member]),
);

describe("api-map.gen.ts freshness and parity (D12)", () => {
  it("stamps the sha256 of all four current inputs", () => {
    expect(API_MAP_SOURCE_HASHES.apiIndexJson).toBe(apiIndexInput.sha256);
    expect(API_MAP_SOURCE_HASHES.apiMapJson).toBe(apiMapJsonInput.sha256);
    expect(API_MAP_SOURCE_HASHES.namingExceptionsJson).toBe(
      exceptionsInput.sha256,
    );
    expect(API_MAP_SOURCE_HASHES.authoredApisJson).toBe(
      authoredApisInput.sha256,
    );
  });

  it("covers exactly the api-index + authored-supplement universe", () => {
    expect(Object.keys(API_MAP).sort()).toStrictEqual(
      Object.keys(universe).sort(),
    );
  });

  it("authored supplement never shadows an api-index entry (stale guard)", () => {
    for (const pythonApi of Object.keys(authoredApis.entries)) {
      expect(Object.hasOwn(apiIndex, pythonApi), pythonApi).toBe(false);
    }
  });

  it("agrees with src/naming.ts on every TS home (generator parity)", () => {
    for (const [pythonApi, entry] of Object.entries(API_MAP)) {
      const recomputed = resolveTsApiName(pythonApi, exceptionRows);
      expect(recomputed, pythonApi).toBeDefined();
      expect(
        { tsModule: entry.tsModule, tsName: entry.tsName },
        pythonApi,
      ).toStrictEqual(recomputed);
    }
  });

  it("carries api-index kind/capability/module/signature on every entry", () => {
    for (const [pythonApi, entry] of Object.entries(API_MAP)) {
      const indexEntry = universe[pythonApi] as ApiIndexEntry;
      expect(entry.kind, pythonApi).toBe(indexEntry.kind);
      expect(entry.capability, pythonApi).toBe(indexEntry.capability);
      expect(entry.pythonModule, pythonApi).toBe(indexEntry.module);
      expect(entry.params, pythonApi).toStrictEqual(indexEntry.params);
      expect(entry.kwonly, pythonApi).toStrictEqual(indexEntry.kwonly);
    }
  });

  it("KNOWN_PYTHON_MODULES is the sorted prefix set of the full universe", () => {
    const prefixes = [
      ...new Set([
        ...Object.keys(universe).map((api) => api.split(".", 1)[0] as string),
        ...authoredApis.known_modules,
      ]),
    ].sort();
    expect([...KNOWN_PYTHON_MODULES]).toStrictEqual(prefixes);
  });
});

describe("workspace member authority (D12 input 1)", () => {
  it("api-map.json signatures equal the api-index sidecar's", () => {
    for (const [pythonApi, indexEntry] of Object.entries(apiIndex)) {
      if (!pythonApi.startsWith("workspace.")) {
        continue;
      }
      const member = workspaceMembers.get(pythonApi.slice("workspace.".length));
      expect(member, pythonApi).toBeDefined();
      expect(member?.params, pythonApi).toStrictEqual(indexEntry.params);
      expect(member?.kwonly, pythonApi).toStrictEqual(indexEntry.kwonly);
    }
  });
});

describe("resolveApi verdict buckets (D12)", () => {
  it("maps names present in the generated map", () => {
    const resolution = resolveApi("workspace.build_funnel_params");
    expect(resolution).toMatchObject({
      status: "mapped",
      entry: { tsModule: "core/workspace", tsName: "buildFunnelParams" },
    });
  });

  it("classifies unmapped names in known modules as UNPORTED", () => {
    expect(resolveApi("api_client.some_future_method")).toStrictEqual({
      status: "unported",
      module: "api_client",
    });
  });

  it("classifies names in no source as UNMAPPED (fail-fast bucket)", () => {
    expect(resolveApi("mystery.call")).toStrictEqual({ status: "unmapped" });
    expect(resolveApi("nodots")).toStrictEqual({ status: "unmapped" });
  });
});

describe("TS-4 done criterion: full-corpus api resolution", () => {
  it("resolves every measured and setup call.api without UNMAPPED or throw", () => {
    const config = loadCorpusConfig(PACKAGE_DIR);
    const corpus = loadCorpus(
      resolve(PACKAGE_DIR, config.vectorsPath),
      config.sourceCommit,
      config.recordEpoch,
    );
    const statuses = new Map<string, number>();
    const apis = new Set<string>();
    for (const vector of corpus.vectors) {
      apis.add(vector.api);
      for (const setup of vector.setup) {
        apis.add(setup.api);
      }
    }
    expect(apis.size).toBeGreaterThanOrEqual(300);
    for (const api of apis) {
      const resolution = resolveApi(api);
      statuses.set(
        resolution.status,
        (statuses.get(resolution.status) ?? 0) + 1,
      );
      expect(resolution.status, api).not.toBe("unmapped");
    }
    // Every corpus name is either mapped (api-index / authored supplement)
    // or UNPORTED (authored vectors referencing apis the recorded-vector
    // api-index does not carry — workspace parse targets,
    // api_client._iter_jsonl_lines, rrweb_analyzer.analyze — stay in the
    // known-module UNPORTED bucket until their port batches land, R10.5).
    expect(
      (statuses.get("mapped") ?? 0) + (statuses.get("unported") ?? 0),
    ).toBe(apis.size);
    expect(statuses.get("mapped") ?? 0).toBeGreaterThanOrEqual(300);
  });
});
