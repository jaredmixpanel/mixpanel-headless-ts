// Unit tests for scripts/audit/comment-archaeology-lib.mjs (the tokenizer and
// the mechanical rewrite rules) plus one end-to-end pass through the CLI on a
// throwaway tree. The fixtures below are string literals on purpose: the tool
// only scans comments and test titles, so the ids inside these strings are
// invisible to it when it audits this file.

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

import {
  BANNED_TOKENS,
  extractComments,
  extractTestTitles,
  findBannedTokens,
  fixBareIdParentheticals,
  fixOwnershipMarker,
  fixPyLineRefs,
  hasRationale,
  looksBroken,
  rewriteSource,
  scanSource,
} from "../scripts/audit/comment-archaeology-lib.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO_ROOT, "scripts", "audit", "comment-archaeology.mjs");

const tokensOf = (line: string, filePath?: string) =>
  findBannedTokens(line, filePath === undefined ? {} : { filePath }).map(
    (m) => m.token,
  );

describe("banned-token table", () => {
  it("compiles every token as a named global regex", () => {
    expect(BANNED_TOKENS.length).toBeGreaterThan(20);
    for (const t of BANNED_TOKENS) {
      expect(t.name).toMatch(/^[a-zA-Z-]+$/);
      expect(t.re.global).toBe(true);
    }
    expect(new Set(BANNED_TOKENS.map((t) => t.name)).size).toBe(
      BANNED_TOKENS.length,
    );
  });
});

describe("findBannedTokens", () => {
  it("flags the id families and the process vocabulary", () => {
    expect(tokensOf("// (R4.10) and TS-5 per D12, see B6-W2")).toEqual([
      "requirement-id",
      "task-id",
      "design-id",
      "batch-id",
    ]);
    expect(tokensOf("* per b9-packets.md §0.4 (P2-4, AIE-926)")).toEqual([
      "packets-doc",
      "packet-id",
      "linear-id",
    ]);
    expect(tokensOf("// the shard arbiter watchlist, phase-3 packet")).toEqual([
      "shard",
      "arbiter",
      "watchlist",
      "phase",
      "packet",
    ]);
    expect(tokensOf("// see workspace.py:4506-4536 and (:12)")).toEqual([
      "py-line",
      "bare-line",
    ]);
    expect(
      tokensOf("// QA 2026-08-17, Caution #9, FB-3, SEM-F2, CRED-F1"),
    ).toEqual(["qa-date", "caution", "fb-id", "sem-finding", "cred-finding"]);
    expect(
      tokensOf("// reviewB, review-resolution, notes.md, ledger row"),
    ).toEqual(["reviewB", "review-resolution", "notes-doc", "ledger-row"]);
  });

  it("reports the column of each match", () => {
    const [hit] = findBannedTokens("// x (R4.10)");
    expect(hit).toMatchObject({
      token: "requirement-id",
      index: 6,
      match: "R4.10",
    });
  });

  it("keeps ordinary prose and code-looking text clean", () => {
    expect(tokensOf("// Return the dashboard list sorted by name.")).toEqual(
      [],
    );
    expect(tokensOf("// B2B customers; phase 3 of the rollout; D100")).toEqual(
      [],
    );
    expect(tokensOf("// a1b2c3 hash, ISO-8601, RFC 7231")).toEqual([]);
  });

  it("allows the dotted Python symbol form", () => {
    expect(
      tokensOf("* @see mixpanel_headless.workspace.Workspace.list_dashboards"),
    ).toEqual([]);
    expect(tokensOf("// twin of tests.test_b6.B6Cases.test_x")).toEqual([]);
    expect(tokensOf("// see `helpers.D12.build()`")).toEqual([]);
    // A line reference glued to a module path is still a hit.
    expect(tokensOf("// mixpanel_headless/workspace.py:4506")).toEqual([
      "py-line",
    ]);
  });

  it("whitelists the bookmark rule-label form only in the validation files", () => {
    const line = "// rule B19: event behaviours need a name";
    expect(
      tokensOf(line, "packages/core/src/query/validation-bookmark.ts"),
    ).toEqual([]);
    expect(
      tokensOf(
        line,
        "packages/core/test/query/validation-cohort-bookmark.test.ts",
      ),
    ).toEqual([]);
    expect(tokensOf(line, "packages/core/src/workspace.ts")).toEqual([
      "batch-id",
    ]);
    // The bare label without the `rule` prefix stays a hit even there.
    expect(
      tokensOf(
        "// B19: event behaviours",
        "packages/core/src/query/validation-bookmark.ts",
      ),
    ).toEqual(["batch-id"]);
  });
});

describe("extraction", () => {
  it("finds line, block and jsdoc comments but not string or regex look-alikes", () => {
    const src = [
      "// top",
      "/** doc */",
      "const a = '// not a comment'; /* block */",
      "const b = `/* also not */ ${a} // nope`;",
      String.raw`const r = /\/\/ regex/;`,
      "function f() {",
      "  // inside empty block",
      "}",
      "f(); // trailing",
    ].join("\n");
    const comments = extractComments(src);
    expect(comments.map((c) => [c.kind, c.text])).toEqual([
      ["line", "// top"],
      ["jsdoc", "/** doc */"],
      ["block", "/* block */"],
      ["line", "// inside empty block"],
      ["line", "// trailing"],
    ]);
  });

  it("collects describe/it/test titles including modifier chains", () => {
    const src = [
      'describe("suite", () => {',
      '  it("plain", () => {});',
      '  it.skip("skipped", () => {});',
      "  test.only(`template ${x} tail`, () => {});",
      '  it.each([1])("each %s", () => {});',
      '  other("ignored", () => {});',
      "});",
    ].join("\n");
    expect(extractTestTitles(src).map((t) => t.text)).toEqual([
      "suite",
      "plain",
      "skipped",
      "template tail",
      "each %s",
    ]);
  });

  it("reports title hits with kind `title` and 1-based positions", () => {
    const src =
      'describe("x", () => {\n  it("mirrors B6-W2 (R4.10)", () => {});\n});\n';
    const { hits } = scanSource(src, {
      filePath: "packages/core/test/x.test.ts",
    });
    expect(hits.map((h) => [h.kind, h.token, h.line, h.col])).toEqual([
      ["title", "batch-id", 2, 15],
      ["title", "requirement-id", 2, 22],
    ]);
  });

  it("parses .mjs sources as JavaScript", () => {
    const src =
      "#!/usr/bin/env node\n// shebang file (TS-5)\nexport const x = 1;\n";
    const { hits } = scanSource(src, { filePath: "scripts/x.mjs" });
    expect(hits.map((h) => [h.token, h.line])).toEqual([["task-id", 2]]);
  });
});

describe("rationale detection", () => {
  it("recognises the rationale vocabulary case-insensitively", () => {
    expect(hasRationale("Because the API rejects it.")).toBe(true);
    expect(hasRationale("kept so that callers can retry")).toBe(true);
    expect(hasRationale("a known trade-off")).toBe(true);
    expect(hasRationale("Return the sorted list.")).toBe(false);
  });
});

describe("fix rule: bare id parentheticals", () => {
  it("deletes id-only parentheticals and the adjacent space", () => {
    expect(fixBareIdParentheticals("// Sort by name (R4.10).")).toEqual({
      line: "// Sort by name.",
      count: 1,
    });
    expect(fixBareIdParentheticals(" * (TS-5) Placeholder.")).toEqual({
      line: " * Placeholder.",
      count: 1,
    });
    expect(
      fixBareIdParentheticals("// a (R3.3/R7.6) b (B4, R10.8) c (AIE-926)"),
    ).toEqual({
      line: "// a b c",
      count: 3,
    });
  });

  it("leaves parentheticals that say anything else", () => {
    const line = "// compose (R10.8 — never re-implement) here";
    expect(fixBareIdParentheticals(line)).toEqual({ line, count: 0 });
  });
});

describe("fix rule: python line references", () => {
  it("drops the range and keeps the module when no symbol is nearby", () => {
    expect(
      fixPyLineRefs(" * Mirrors the Python loop (`workspace.py:100-120`)."),
    ).toEqual({
      line: " * Mirrors the Python loop (`workspace.py`).",
      count: 1,
    });
    expect(fixPyLineRefs("// see test_x.py:56")).toEqual({
      line: "// see test_x.py",
      count: 1,
    });
  });

  it("removes the whole parenthetical when a symbol name is nearby", () => {
    expect(
      fixPyLineRefs(" * `build_time_section` (`bookmark_builders.py:72-127`)."),
    ).toEqual({ line: " * `build_time_section`.", count: 1 });
    expect(
      fixPyLineRefs("// Workspace.list_dashboards (workspace.py:4506)"),
    ).toEqual({
      line: "// Workspace.list_dashboards",
      count: 1,
    });
  });

  it("removes bare line-only parentheticals", () => {
    expect(fixPyLineRefs("// `TestResolverEdgeCases` (:325-393) twin")).toEqual(
      {
        line: "// `TestResolverEdgeCases` twin",
        count: 1,
      },
    );
  });

  it("leaves orphan line lists for humans", () => {
    const list = "// Python counterparts: types.py:9116, 9153, 7129";
    expect(fixPyLineRefs(list)).toEqual({ line: list, count: 0 });
    const ticks = "// (`workspace.py:7266`, `:7325`) vs the plain path";
    expect(fixPyLineRefs(ticks)).toEqual({ line: ticks, count: 0 });
  });
});

describe("fix rule: ownership markers", () => {
  it("turns an ownership marker into a plain section divider", () => {
    expect(
      fixOwnershipMarker(
        "  // === B6-W2 dashboard members (W2 owns; append-only) ===",
      ),
    ).toEqual({
      line: "  // --- Dashboard members ---",
      changed: true,
      deleted: false,
    });
  });

  it("deletes a marker that names nothing but ids", () => {
    expect(fixOwnershipMarker("// === B6-W2 ===")).toEqual({
      line: null,
      changed: true,
      deleted: true,
    });
  });

  it("ignores plain dividers and markers whose parenthetical says more", () => {
    const plain = "// --- Dashboards ---";
    expect(fixOwnershipMarker(plain)).toEqual({
      line: plain,
      changed: false,
      deleted: false,
    });
    const rich =
      "// --- B6-W7 seams (W7 owns; see `WorkspaceOptions.readFile`) ---";
    expect(fixOwnershipMarker(rich)).toEqual({
      line: rich,
      changed: false,
      deleted: false,
    });
  });
});

describe("looksBroken", () => {
  it("rejects rewrites that strand punctuation", () => {
    expect(
      looksBroken(
        " * (`x.py:1`), and the encoder",
        " *, and the encoder",
        "jsdoc",
      ),
    ).toBe(true);
    expect(looksBroken("// a (R4.10) , b", "// a , b", "line")).toBe(false);
    expect(looksBroken("// a (R4.10) b", "// a b", "line")).toBe(false);
  });
});

describe("rewriteSource", () => {
  it("rewrites comments in place and preserves jsdoc structure", () => {
    const src = [
      "/**",
      " * Sort dashboards by name (R4.10).",
      " *",
      " * (TS-5)",
      " *",
      " * @param items - the raw list (`workspace.py:4506-4536`)",
      " */",
      "export function sort(items: string[]): string[] {",
      "  // === B6-W2 dashboard members (W2 owns; append-only) ===",
      "  return items; // twin of `Workspace.sort` (workspace.py:10)",
      "}",
      "",
    ].join("\n");
    const out = rewriteSource(src, { filePath: "packages/core/src/x.ts" });
    expect(out.text).toBe(
      [
        "/**",
        " * Sort dashboards by name.",
        " *",
        " * @param items - the raw list (`workspace.py`)",
        " */",
        "export function sort(items: string[]): string[] {",
        "  // --- Dashboard members ---",
        "  return items; // twin of `Workspace.sort`",
        "}",
        "",
      ].join("\n"),
    );
    expect(out.counts).toEqual({
      "ownership-marker": 1,
      "py-line-ref": 2,
      "bare-id-parenthetical": 2,
    });
    expect(out.changes.map((c) => c.line)).toEqual([2, 4, 5, 6, 9, 10]);
  });

  it("deletes a comment that becomes empty and the line it stood on", () => {
    const src =
      "const a = 1;\n// (R4.10)\nconst b = 2; // (TS-5)\n/** (D12) */\nconst c = 3;\n";
    const out = rewriteSource(src, { filePath: "packages/core/src/x.ts" });
    expect(out.text).toBe("const a = 1;\nconst b = 2;\nconst c = 3;\n");
    expect(out.changes.map((c) => c.after)).toEqual([null, null, null]);
  });

  it("never touches a paragraph that carries rationale words", () => {
    const src = [
      "// Kept because the API rejects it (R4.10).",
      "//",
      "// Plain follow-up (R4.10).",
      "const a = 1;",
      "",
    ].join("\n");
    const out = rewriteSource(src, { filePath: "packages/core/src/x.ts" });
    expect(out.text).toBe(
      [
        "// Kept because the API rejects it (R4.10).",
        "//",
        "// Plain follow-up.",
        "const a = 1;",
        "",
      ].join("\n"),
    );
  });

  it("leaves test titles alone", () => {
    const src = 'it("mirrors (R4.10)", () => {});\n';
    expect(
      rewriteSource(src, { filePath: "packages/core/test/x.test.ts" }).text,
    ).toBe(src);
  });
});

describe("CLI", () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });

  const run = (args: string[], cwd: string) => {
    try {
      const stdout = execFileSync(process.execPath, [CLI, ...args], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { code: 0, stdout };
    } catch (error) {
      const e = error as { status: number; stdout: string };
      return { code: e.status, stdout: e.stdout };
    }
  };

  const makeTree = () => {
    const root = mkdtempSync(join(tmpdir(), "comment-archaeology-"));
    roots.push(root);
    mkdirSync(join(root, "packages", "core", "src"), { recursive: true });
    mkdirSync(join(root, "packages", "core", "src", "dist"), {
      recursive: true,
    });
    mkdirSync(join(root, "scripts"), { recursive: true });
    writeFileSync(
      join(root, "packages", "core", "src", "a.ts"),
      "// Sort by name (R4.10).\nexport const a = 1; // owned by the B6-W2 shard\n",
    );
    writeFileSync(
      join(root, "packages", "core", "src", "b.gen.ts"),
      "// (TS-5)\n",
    );
    writeFileSync(
      join(root, "packages", "core", "src", "dist", "c.ts"),
      "// (TS-5)\n",
    );
    writeFileSync(
      join(root, "scripts", "d.mjs"),
      "// clean\nexport const d = 1;\n",
    );
    return root;
  };

  it("reports grouped hits with counts and exits 1; --json mirrors the report", () => {
    const root = makeTree();
    const jsonPath = join(root, "out.json");
    const res = run(["--root", root, "--json", jsonPath], root);
    expect(res.code).toBe(1);
    expect(res.stdout).toContain(
      "packages/core/src/a.ts:1:18  requirement-id  // Sort by name (R4.10).",
    );
    expect(res.stdout).toContain("packages/core/src/a.ts:2:37  batch-id");
    expect(res.stdout).toContain("packages/core/src/a.ts:2:43  shard");
    expect(res.stdout).not.toContain("b.gen.ts");
    expect(res.stdout).not.toContain("dist/");
    expect(res.stdout).toContain("Total: 3 hit(s) in 1 file(s) (2 scanned)");
    const json = JSON.parse(readFileSync(jsonPath, "utf8")) as {
      total: number;
      byToken: Record<string, number>;
      byDirectory: Record<string, number>;
      files: Array<{ file: string; hits: unknown[] }>;
    };
    expect(json.total).toBe(3);
    expect(json.byToken["requirement-id"]).toBe(1);
    expect(json.byDirectory).toEqual({ "packages/core/src": 3 });
    expect(json.files.map((f) => f.file)).toEqual(["packages/core/src/a.ts"]);
  });

  it("--summary prints only counts", () => {
    const root = makeTree();
    const res = run(["--root", root, "--summary"], root);
    expect(res.code).toBe(1);
    expect(res.stdout).not.toContain("a.ts:1");
    expect(res.stdout).toMatch(/requirement-id\s+1/);
    expect(res.stdout).toMatch(/packages\/core\/src\s+3/);
  });

  it("--fix --dry-run lists rewrites without writing; --fix writes and leaves the residue", () => {
    const root = makeTree();
    const file = join(root, "packages", "core", "src", "a.ts");
    const before = readFileSync(file, "utf8");
    const dry = run(["--root", root, "--fix", "--dry-run"], root);
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain("- // Sort by name (R4.10).");
    expect(dry.stdout).toContain("+ // Sort by name.");
    expect(dry.stdout).toMatch(/bare-id-parenthetical\s+1/);
    expect(dry.stdout).toContain("Would rewrite 1 line(s) in 1 file(s)");
    expect(readFileSync(file, "utf8")).toBe(before);

    const fix = run(["--root", root, "--fix"], root);
    expect(fix.code).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(
      "// Sort by name.\nexport const a = 1; // owned by the B6-W2 shard\n",
    );
    const after = run(["--root", root, "--summary"], root);
    expect(after.code).toBe(1);
    expect(after.stdout).toContain("Total: 2 hit(s)");
  });

  it("exits 0 on a clean tree", () => {
    const root = makeTree();
    rmSync(join(root, "packages"), { recursive: true, force: true });
    const res = run(["--root", root], root);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("Total: 0 hit(s)");
  });
});
