// Public-surface boundary of @mixpanel-headless/core, stated with the
// TypeScript checker since `stripInternal` is off (see tsconfig.lib.json):
// no `@internal` symbol is exported from src/index.ts, index.ts and
// internal.ts export disjoint name sets, and index.ts has no `export *`.
// Lives under tests/ because it needs node:path.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = resolve(REPO_ROOT, "packages/core");
const INDEX = resolve(CORE, "src/index.ts");
const INTERNAL = resolve(CORE, "src/internal.ts");

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
});
