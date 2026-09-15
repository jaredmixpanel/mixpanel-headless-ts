// Public-surface boundary of @mixpanel-headless/core, stated with the
// TypeScript checker since `stripInternal` is off (see tsconfig.lib.json):
// no `@internal` symbol is exported from src/index.ts, index.ts and
// internal.ts export disjoint name sets, and index.ts has no `export *`.
// Also locks the split between the types a consumer reaches through the
// public signatures (exported) and the option bags of the low-level
// client members (unexported; the members that take them are `@internal`
// so the generated reference omits them). Lives under tests/ because it
// needs node:path.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = resolve(REPO_ROOT, "packages/core");
const INDEX = resolve(CORE, "src/index.ts");
const INTERNAL = resolve(CORE, "src/internal.ts");
const NODE_INDEX = resolve(REPO_ROOT, "packages/node/src/index.ts");

/**
 * Types reachable from `Workspace*` options, results and the namespace
 * factories, plus the documented injection seams: a consumer names them,
 * so the public barrel exports them.
 */
const CONSUMER_FACING = [
  // Facade options, inputs, results
  "AnyTreeNode",
  "CountingType",
  "DayWeekMonth",
  "DiscoveryLogger",
  "EventsInput",
  "ExportEventsOptions",
  "ExportProfilesOptions",
  "FilterValueInput",
  "FilterWhereInput",
  "FlowGraph",
  "FlowGraphEdge",
  "FlowGraphNode",
  "FlowMode",
  "GroupByInput",
  "LiveActivityFeedOptions",
  "LiveQuerySavedReportOptions",
  "ModelDumpOptions",
  "ParamsDict",
  "ReplayActionLabel",
  "Row",
  "SavedReportBookmarkType",
  "SchemaGraph",
  "SchemaGraphEdge",
  "SchemaGraphNode",
  "SchemaGraphNodeKind",
  "StreamEventsOptions",
  "StreamProfilesOptions",
  "ToNativeJsonOptions",
  "WhereInput",
  // Accounts namespace option bags and callbacks
  "AccountsAddOptions",
  "AccountsLoginOptions",
  "AccountsUpdateOptions",
  "ExportBridgeOptions",
  "ProgressFactory",
  "ProgressHandle",
  "ProjectPicker",
  // CPython-twin errors public methods document throwing
  "KeyError",
  "OverflowError",
  "ValueError",
  // Injection seams
  "RandomSource",
  "ResolveProjectAxisArgs",
  "ResolverSeams",
  "ResolveSessionArgs",
  "RetryLogger",
  "TodayFn",
  "WarningSink",
] as const;

/** The node package's seams, exported from its own barrel. */
const NODE_SEAMS = [
  "AtomicWriteFsOps",
  "AtomicWriteOptions",
  "EnsureClientRegisteredOptions",
  "StartCallbackServerOptions",
  "StdinReadSync",
] as const;

/**
 * Per-endpoint option bags and transport plumbing that only the
 * low-level client members take. They stay off the public barrel; the
 * members that reference them carry `@internal`.
 */
const CLIENT_INTERNAL = [
  "ActivityFeedOptions",
  "AppRequestDeps",
  "DeleteSchemasOptions",
  "DownloadLookupTableOptions",
  "EngageStatsOptions",
  "EventCountsOptions",
  "ExportProfilesPageOptions",
  "FrequencyOptions",
  "FunnelOptions",
  "GetAlertCountOptions",
  "GetAlertHistoryOptions",
  "GetBookmarkHistoryOptions",
  "GetEventsOptions",
  "GetFlagHistoryOptions",
  "GetPropertyValuesOptions",
  "GetSchemaEnforcementOptions",
  "GetSchemasOptions",
  "GetTopEventsOptions",
  "InlineQueryOptions",
  "ListAlertsOptions",
  "ListAnnotationsOptions",
  "ListBlueprintTemplatesOptions",
  "ListBookmarksV2Options",
  "ListCohortsAppOptions",
  "ListDashboardsOptions",
  "ListDataVolumeAnomaliesOptions",
  "ListExperimentsOptions",
  "ListFeatureFlagsOptions",
  "ListLookupTablesOptions",
  "ListPropertyDefinitionsOptions",
  "ListSchemaRegistryOptions",
  "PropertyCountsOptions",
  "QuerySavedReportOptions",
  "RawFetchResult",
  "ReplayEnv",
  "RetentionOptions",
  "RetryExecutorDeps",
  "SegmentationNumericOptions",
  "SegmentationOptions",
  "TransportRequestOptions",
] as const;

/** Plumbing that stays on `/internal` (platform packages and rig only). */
const INTERNAL_PLUMBING = ["ClientCore", "EntityModel", "EntityModelStatics"];

/**
 * Type names written in a parameter's annotation. Read from the source
 * text rather than the checker's type, which flattens a literal-union
 * alias such as `ReplayEnv` into its members and loses the name.
 */
function annotatedTypeNames(parameter: ts.Symbol): string[] {
  const declaration = parameter.valueDeclaration;
  if (
    declaration === undefined ||
    !ts.isParameter(declaration) ||
    declaration.type === undefined
  ) {
    return [];
  }
  return declaration.type.getText().match(/\b[A-Z][A-Za-z0-9]*\b/g) ?? [];
}

function hasInternalTag(checker: ts.TypeChecker, symbol: ts.Symbol): boolean {
  return symbol.getJsDocTags(checker).some((tag) => tag.name === "internal");
}

/** Aliased (declaration) symbol for a module export. */
function declarationOf(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol {
  return symbol.flags & ts.SymbolFlags.Alias
    ? checker.getAliasedSymbol(symbol)
    : symbol;
}

function exportsOf(
  program: ts.Program,
  file: string,
): ReadonlyMap<string, ts.Symbol> {
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file);
  if (source === undefined) throw new Error(`not in program: ${file}`);
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (moduleSymbol === undefined) throw new Error(`no module symbol: ${file}`);
  return new Map(
    checker
      .getExportsOfModule(moduleSymbol)
      .map((s) => [s.name, declarationOf(checker, s)]),
  );
}

function coreProgram(): ts.Program {
  const configFile = ts.readConfigFile(
    resolve(CORE, "tsconfig.json"),
    ts.sys.readFile,
  );
  if (configFile.error) throw new Error("cannot read core tsconfig");
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, CORE);
  return ts.createProgram({
    rootNames: [INDEX, INTERNAL],
    options: {
      ...parsed.options,
      noEmit: true,
      composite: false,
      declaration: false,
      incremental: false,
    },
  });
}

describe("@mixpanel-headless/core public surface", () => {
  const program = coreProgram();
  const checker = program.getTypeChecker();
  const publicExports = exportsOf(program, INDEX);
  const internalExports = exportsOf(program, INTERNAL);

  it("exports nothing tagged @internal from the public barrel", () => {
    const tagged = [...publicExports]
      .filter(([, symbol]) =>
        symbol.getJsDocTags(checker).some((tag) => tag.name === "internal"),
      )
      .map(([name]) => name);
    expect(tagged).toStrictEqual([]);
  });

  it("keeps the public and internal barrels disjoint", () => {
    const both = [...publicExports.keys()].filter((name) =>
      internalExports.has(name),
    );
    expect(both).toStrictEqual([]);
  });

  it("lists the public surface explicitly (no `export *`)", () => {
    const text = readFileSync(INDEX, "utf8");
    expect(text).not.toMatch(/^export \* from/m);
    expect(publicExports.size).toBeGreaterThan(600);
  });

  it("exports every consumer-facing type and seam the public signatures name", () => {
    const missing = CONSUMER_FACING.filter((name) => !publicExports.has(name));
    expect(missing).toStrictEqual([]);
  });

  it("keeps the client-internal option bags off the public barrel", () => {
    const leaked = CLIENT_INTERNAL.filter((name) => publicExports.has(name));
    expect(leaked).toStrictEqual([]);
  });

  it("keeps the client core and the model base on the internal barrel", () => {
    const missing = INTERNAL_PLUMBING.filter(
      (name) => !internalExports.has(name),
    );
    expect(missing).toStrictEqual([]);
  });

  it("marks every MixpanelClient member that takes a client-internal type @internal", () => {
    const client = publicExports.get("MixpanelClient");
    if (client === undefined) throw new Error("MixpanelClient not exported");
    const clientType = checker.getDeclaredTypeOfSymbol(client);
    const internalNames = new Set<string>(CLIENT_INTERNAL);
    const unmarked: string[] = [];
    for (const member of checker.getPropertiesOfType(clientType)) {
      const memberType = checker.getTypeOfSymbol(member);
      const referenced = memberType
        .getCallSignatures()
        .flatMap((signature) => signature.getParameters())
        .flatMap((parameter) => annotatedTypeNames(parameter));
      const leaks = referenced.some((name) => internalNames.has(name));
      if (leaks && !hasInternalTag(checker, member)) unmarked.push(member.name);
    }
    expect(unmarked).toStrictEqual([]);
  });
});

describe("@mixpanel-headless/node public surface", () => {
  it("exports the node seams by name", () => {
    const text = readFileSync(NODE_INDEX, "utf8");
    const missing = NODE_SEAMS.filter(
      (name) => !new RegExp(String.raw`\b${name}\b`).test(text),
    );
    expect(missing).toStrictEqual([]);
  });
});
