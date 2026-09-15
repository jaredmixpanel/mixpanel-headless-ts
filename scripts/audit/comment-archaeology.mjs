#!/usr/bin/env node
// comment-archaeology.mjs — report (and mechanically rewrite) comments and
// test titles that carry process identifiers instead of rationale.
//
// Usage:
//   node scripts/audit/comment-archaeology.mjs [--report] [--json <path>]
//   node scripts/audit/comment-archaeology.mjs --summary
//   node scripts/audit/comment-archaeology.mjs --fix [--dry-run]
//   ... [--root <dir>] [paths...]
//
// Exit codes: 0 clean (or --fix finished), 1 banned tokens found, 2 usage or
// I/O error. The token list, the allowed exceptions and the fix rules live in
// ./comment-archaeology-lib.mjs; see ./README.md for how to whitelist.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { compareStrings } from "../lib/compare-strings.mjs";
import {
  BANNED_TOKENS,
  FIX_RULES,
  rewriteSource,
  scanSource,
} from "./comment-archaeology-lib.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Scan roots, relative to the repository root. Globs are one level deep. */
const SCAN_ROOTS = [
  "packages/*/src",
  "packages/*/test",
  "conformance-runner/src",
  "conformance-runner/test",
  "differential",
  "scripts",
  "tests",
];
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "corpus",
  "vendor",
  "docs",
  "generated",
  "coverage",
]);
const EXTENSIONS = new Set([".ts", ".mts", ".js", ".mjs"]);

function usage(message) {
  if (message) process.stderr.write(`comment-archaeology: ${message}\n`);
  process.stderr.write(
    "usage: comment-archaeology.mjs [--report|--summary|--fix [--dry-run]] " +
      "[--json <path>] [--root <dir>] [paths...]\n",
  );
  process.exit(2);
}

function parseArgs(argv) {
  const opts = {
    mode: "report",
    dryRun: false,
    json: undefined,
    root: REPO_ROOT,
    paths: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--report": {
        opts.mode = "report";
        break;
      }
      case "--summary": {
        opts.mode = "summary";
        break;
      }
      case "--fix": {
        opts.mode = "fix";
        break;
      }
      case "--dry-run": {
        opts.dryRun = true;
        break;
      }
      case "--json": {
        if (i + 1 >= argv.length) usage("--json needs a path");
        opts.json = resolve(argv[++i]);

        break;
      }
      case "--root": {
        if (i + 1 >= argv.length) usage("--root needs a directory");
        opts.root = resolve(argv[++i]);

        break;
      }
      case "--help":
      case "-h": {
        usage();
        break;
      }
      default: {
        if (a.startsWith("-")) usage(`unknown option ${a}`);
        else opts.paths.push(resolve(a));
      }
    }
  }
  if (opts.dryRun && opts.mode !== "fix")
    usage("--dry-run only applies to --fix");
  return opts;
}

function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function extensionOf(name) {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot);
}

function wantedFile(name) {
  if (!EXTENSIONS.has(extensionOf(name))) return false;
  if (name.endsWith(".gen.ts")) return false;
  return true;
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => compareStrings(a.name, b.name));
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, out);
    } else if (e.isFile() && wantedFile(e.name)) {
      out.push(full);
    }
  }
}

function expandRoot(root, pattern) {
  const parts = pattern.split("/");
  let dirs = [root];
  for (const part of parts) {
    const next = [];
    for (const d of dirs) {
      if (part === "*") {
        let entries;
        try {
          entries = readdirSync(d, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const e of entries) {
          if (e.isDirectory() && !SKIP_DIRS.has(e.name))
            next.push(join(d, e.name));
        }
      } else {
        const candidate = join(d, part);
        if (isDir(candidate)) next.push(candidate);
      }
    }
    dirs = next;
  }
  return dirs;
}

/** Absolute paths of every file to scan, sorted, deduplicated. */
function collectFiles(opts) {
  const out = [];
  if (opts.paths.length > 0) {
    for (const p of opts.paths) {
      if (isDir(p)) walk(p, out);
      else if (wantedFile(p)) out.push(p);
    }
  } else {
    for (const pattern of SCAN_ROOTS) {
      for (const dir of expandRoot(opts.root, pattern)) walk(dir, out);
    }
  }
  const unique = [...new Set(out)];
  unique.sort();
  // Files under a skipped directory can still arrive via explicit paths.
  return unique.filter((f) => {
    const rel = relative(opts.root, f).split(sep);
    return rel.every((seg) => !SKIP_DIRS.has(seg));
  });
}

function relPath(root, file) {
  return relative(root, file).split(sep).join("/");
}

/** Per-directory bucket: packages/<pkg>/<src|test>, <ws>/<sub>, or top dir. */
function dirKey(rel) {
  const parts = rel.split("/");
  if (parts[0] === "packages") return parts.slice(0, 3).join("/");
  if (parts[0] === "conformance-runner" || parts[0] === "differential") {
    return parts.slice(0, Math.min(2, parts.length - 1)).join("/") || parts[0];
  }
  return parts[0];
}

function scanAll(opts, files) {
  const perFile = [];
  const byToken = {};
  const byDirectory = {};
  for (const t of BANNED_TOKENS) byToken[t.name] = 0;
  let total = 0;
  for (const file of files) {
    const rel = relPath(opts.root, file);
    const text = readFileSync(file, "utf8");
    const { hits } = scanSource(text, { filePath: rel });
    if (hits.length === 0) continue;
    perFile.push({
      file: rel,
      hits: hits.map((h) => ({
        line: h.line,
        col: h.col,
        token: h.token,
        kind: h.kind,
        text: h.text,
      })),
    });
    const dir = dirKey(rel);
    byDirectory[dir] = (byDirectory[dir] ?? 0) + hits.length;
    for (const h of hits) byToken[h.token] += 1;
    total += hits.length;
  }
  return { perFile, byToken, byDirectory, total, filesScanned: files.length };
}

function pad(s, n) {
  return String(s).padEnd(n);
}

function printCounts(result) {
  const tokenRows = Object.entries(result.byToken)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const dirRows = Object.entries(result.byDirectory).sort((a, b) =>
    a[0] < b[0] ? -1 : 1,
  );
  const w1 = Math.max(12, ...tokenRows.map(([k]) => k.length));
  process.stdout.write("Per token:\n");
  for (const [k, n] of tokenRows) {
    process.stdout.write(`  ${pad(k, w1)}  ${String(n).padStart(6)}\n`);
  }
  if (tokenRows.length === 0) process.stdout.write("  (none)\n");
  const w2 = Math.max(12, ...dirRows.map(([k]) => k.length));
  process.stdout.write("Per directory:\n");
  for (const [k, n] of dirRows) {
    process.stdout.write(`  ${pad(k, w2)}  ${String(n).padStart(6)}\n`);
  }
  if (dirRows.length === 0) process.stdout.write("  (none)\n");
  process.stdout.write(
    `Total: ${result.total} hit(s) in ${result.perFile.length} file(s) ` +
      `(${result.filesScanned} scanned)\n`,
  );
}

function truncate(s, n) {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function printReport(result) {
  for (const entry of result.perFile) {
    process.stdout.write(`${entry.file}\n`);
    for (const h of entry.hits) {
      const label = h.kind === "title" ? `${h.token} [title]` : h.token;
      process.stdout.write(
        `  ${entry.file}:${h.line}:${h.col}  ${label}  ${truncate(h.text, 140)}\n`,
      );
    }
  }
  if (result.perFile.length > 0) process.stdout.write("\n");
  printCounts(result);
}

function runScan(opts) {
  const files = collectFiles(opts);
  const result = scanAll(opts, files);
  if (opts.json) {
    const payload = {
      generatedBy: "scripts/audit/comment-archaeology.mjs",
      root: opts.root,
      total: result.total,
      filesScanned: result.filesScanned,
      byToken: result.byToken,
      byDirectory: result.byDirectory,
      files: result.perFile,
    };
    writeFileSync(opts.json, `${JSON.stringify(payload, null, 2)}\n`);
  }
  if (opts.mode === "summary") printCounts(result);
  else printReport(result);
  return result.total === 0 ? 0 : 1;
}

function runFix(opts) {
  const files = collectFiles(opts);
  const counts = {};
  for (const r of FIX_RULES) counts[r] = 0;
  let filesChanged = 0;
  let linesRewritten = 0;
  for (const file of files) {
    const rel = relPath(opts.root, file);
    const text = readFileSync(file, "utf8");
    const {
      text: next,
      counts: c,
      changes,
    } = rewriteSource(text, {
      filePath: rel,
    });
    if (next === text) continue;
    filesChanged += 1;
    linesRewritten += changes.length;
    for (const r of FIX_RULES) counts[r] += c[r];
    if (opts.dryRun) {
      process.stdout.write(`${rel}\n`);
      for (const ch of changes) {
        process.stdout.write(`  ${rel}:${ch.line}\n`);
        process.stdout.write(`    - ${ch.before}\n`);
        process.stdout.write(
          `    + ${ch.after === null ? "(deleted)" : ch.after}\n`,
        );
      }
    } else {
      writeFileSync(file, next);
    }
  }
  const verb = opts.dryRun ? "would rewrite" : "rewrote";
  process.stdout.write(`Rewrites per rule (${verb}):\n`);
  for (const r of FIX_RULES) {
    process.stdout.write(`  ${pad(r, 24)}  ${String(counts[r]).padStart(6)}\n`);
  }
  process.stdout.write(
    `${opts.dryRun ? "Would rewrite" : "Rewrote"} ${linesRewritten} line(s) ` +
      `in ${filesChanged} file(s); run --report for the residue.\n`,
  );
  return 0;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!isDir(opts.root)) usage(`--root is not a directory: ${opts.root}`);
  const code = opts.mode === "fix" ? runFix(opts) : runScan(opts);
  process.exit(code);
}

main();
