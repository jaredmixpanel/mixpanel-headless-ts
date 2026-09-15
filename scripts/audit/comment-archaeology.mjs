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

/**
 * Print the usage line (after an optional error) and exit with code 2.
 *
 * @param {string} [message] - The error to print first.
 */
function usage(message) {
  if (message) process.stderr.write(`comment-archaeology: ${message}\n`);
  process.stderr.write(
    "usage: comment-archaeology.mjs [--report|--summary|--fix [--dry-run]] " +
      "[--json <path>] [--root <dir>] [paths...]\n",
  );
  process.exit(2);
}

/**
 * Parse the CLI arguments.
 *
 * @param {string[]} argv - Arguments after the script path.
 * @returns {{ mode: "report" | "summary" | "fix", dryRun: boolean, json: string | undefined, root: string, paths: string[] }} The options; `paths` are absolute.
 */
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

/**
 * Whether a path is an existing directory.
 *
 * @param {string} p - Path to test.
 * @returns {boolean} False when it does not exist.
 */
function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Return the file extension of `name` (with the dot), or "" when there is none.
 *
 * @param {string} name - File name or path.
 * @returns {string} The extension.
 */
function extensionOf(name) {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot);
}

/**
 * Whether a file is scanned: a supported extension and not a generated `.gen.ts`.
 *
 * @param {string} name - File name or path.
 * @returns {boolean} True when the file should be scanned.
 */
function wantedFile(name) {
  if (!EXTENSIONS.has(extensionOf(name))) return false;
  if (name.endsWith(".gen.ts")) return false;
  return true;
}

/**
 * Append every wanted file under `dir` to `out`, skipping `SKIP_DIRS`.
 *
 * @param {string} dir - Directory to walk; unreadable directories are ignored.
 * @param {string[]} out - Accumulator of absolute paths.
 */
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

/**
 * Expand one scan-root pattern (`*` matches one directory level) under `root`.
 *
 * @param {string} root - Repository root.
 * @param {string} pattern - Slash-separated pattern from `SCAN_ROOTS`.
 * @returns {string[]} The existing directories the pattern denotes.
 */
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

/**
 * Absolute paths of every file to scan, sorted, deduplicated.
 *
 * @param {{ root: string, paths: string[] }} opts - Parsed options; explicit `paths` replace the default scan roots.
 * @returns {string[]} The files to scan.
 */
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

/**
 * Repo-relative POSIX path of a file.
 *
 * @param {string} root - Repository root.
 * @param {string} file - Absolute path.
 * @returns {string} The relative path with forward slashes.
 */
function relPath(root, file) {
  return relative(root, file).split(sep).join("/");
}

/**
 * Per-directory bucket: `packages/<pkg>/<src|test>`, `<ws>/<sub>`, or top dir.
 *
 * @param {string} rel - Repo-relative POSIX path.
 * @returns {string} The bucket key.
 */
function dirKey(rel) {
  const parts = rel.split("/");
  if (parts[0] === "packages") return parts.slice(0, 3).join("/");
  if (parts[0] === "conformance-runner" || parts[0] === "differential") {
    return parts.slice(0, Math.min(2, parts.length - 1)).join("/") || parts[0];
  }
  return parts[0];
}

/**
 * Scan every file and aggregate the hits per file, token and directory.
 *
 * @param {{ root: string }} opts - Parsed options.
 * @param {string[]} files - Absolute paths to scan.
 * @returns {{ perFile: object[], byToken: Record<string, number>, byDirectory: Record<string, number>, total: number, filesScanned: number }} The scan result.
 */
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

/**
 * Left-align a value in a field of `n` characters.
 *
 * @param {unknown} s - Value to print.
 * @param {number} n - Field width.
 * @returns {string} The padded string.
 */
function pad(s, n) {
  return String(s).padEnd(n);
}

/**
 * Print the per-token and per-directory tables and the total.
 *
 * @param {{ perFile: object[], byToken: Record<string, number>, byDirectory: Record<string, number>, total: number, filesScanned: number }} result - The scan result.
 */
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

/**
 * Cut a string to `n` characters, ending it with an ellipsis when cut.
 *
 * @param {string} s - The string.
 * @param {number} n - Maximum length.
 * @returns {string} The possibly shortened string.
 */
function truncate(s, n) {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/**
 * Print every hit with its location, then the count tables.
 *
 * @param {{ perFile: Array<{ file: string, hits: object[] }>, byToken: Record<string, number>, byDirectory: Record<string, number>, total: number, filesScanned: number }} result - The scan result.
 */
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

/**
 * Run `--report` / `--summary`, optionally writing the JSON payload.
 *
 * @param {{ mode: string, json: string | undefined, root: string, paths: string[] }} opts - Parsed options.
 * @returns {number} Exit code: 0 when clean, 1 when hits were found.
 */
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

/**
 * Run `--fix`, rewriting files in place or listing the changes for `--dry-run`.
 *
 * @param {{ dryRun: boolean, root: string, paths: string[] }} opts - Parsed options.
 * @returns {number} Exit code, always 0.
 */
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

/** Parse the arguments, dispatch the mode and exit with its code. */
function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!isDir(opts.root)) usage(`--root is not a directory: ${opts.root}`);
  const code = opts.mode === "fix" ? runFix(opts) : runScan(opts);
  process.exit(code);
}

main();
