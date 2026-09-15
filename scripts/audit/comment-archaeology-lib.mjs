// comment-archaeology-lib.mjs — pure functions behind
// scripts/audit/comment-archaeology.mjs (the CLI). Kept separate so the unit
// tests in tests/comment-archaeology.test.ts can import the tokenizer and the
// rewrite rules without spawning the CLI.
//
// What lives here:
//   - BANNED_TOKENS: the process-identifier vocabulary that must not appear in
//     comments or test titles (batch/task/requirement ids, Python line
//     references, ownership vocabulary, ...), compiled as named regexes.
//   - extractComments / extractTestTitles: TypeScript-compiler-API based
//     extraction, so string literals, template literals and regex literals
//     that merely look like comments are never scanned.
//   - scanSource: comments + titles -> hits, with the two allowed exceptions
//     (dotted Python symbol segments, and the `rule B<n>` whitelist form).
//   - rewriteSource and the three per-line fix rules used by `--fix`.
import ts from "typescript";

// ---------------------------------------------------------------------------
// Banned tokens
// ---------------------------------------------------------------------------

/**
 * Named banned-token regexes. Each is compiled with the `g` flag (the scanner
 * resets `lastIndex` before every use). The prose words carry `i` so a
 * capitalised variant at the start of a sentence is not a loophole.
 */
export const BANNED_TOKENS = Object.freeze([
  {
    name: "batch-id",
    re: /\bB\d+(?:-[A-Z]\d+|-R\d+|-W\d+|-S\d+|-N\d+|-K\d+|-M\d+|-ARB|-BIND|-MAPFIX)?\b/g,
  },
  { name: "requirement-id", re: /\bR\d+\.\d+\b/g },
  { name: "packet-id", re: /\bP\d-\d+\b/g },
  { name: "task-id", re: /\bTS-\d+\b/g },
  { name: "design-id", re: /\bD1\d\b/g },
  { name: "linear-id", re: /\bAIE-\d+\b/g },
  { name: "qa-date", re: /\bQA 20\d\d/g },
  { name: "packets-doc", re: /packets?\.md/g },
  { name: "packet", re: /\bpacket\b/gi },
  { name: "shard", re: /\bshard\b/gi },
  { name: "arbiter", re: /\barbiter\b/gi },
  { name: "watchlist", re: /\bwatchlist\b/gi },
  { name: "phase", re: /\bphase-?[1-4]\b/gi },
  { name: "reviewB", re: /reviewB/g },
  { name: "review-resolution", re: /review-resolution/g },
  { name: "notes-doc", re: /notes\.md/g },
  { name: "ledger-row", re: /ledger row/gi },
  { name: "caution", re: /Caution #?\d+/gi },
  { name: "py-line", re: /\.py:\d+/g },
  { name: "bare-line", re: /\(:\d+/g },
  { name: "fb-id", re: /FB-\d+/g },
  { name: "sem-finding", re: /SEM-F\d+/g },
  { name: "cred-finding", re: /CRED-F\d+/g },
]);

/** Names of the tokens that are "ids" for the bare-parenthetical fix rule. */
const ID_ALTERNATION =
  String.raw`(?:B\d+(?:-[A-Z]\d+|-ARB|-BIND|-MAPFIX)?|R\d+\.\d+|P\d-\d+|TS-\d+` +
  String.raw`|D1\d|AIE-\d+|FB-\d+|SEM-F\d+|CRED-F\d+)`;

/**
 * Whitelisted forms. A token match that falls entirely inside a `pattern`
 * match is not a hit, but only in files whose repo-relative path matches
 * `files`. Today: the bookmark-validation rule labels (`// rule B<n>`).
 */
export const WHITELIST = Object.freeze([
  {
    name: "bookmark-rule-label",
    files: /(?:^|\/)validation-[\w-]*bookmark[\w-]*\.(?:test\.)?ts$/,
    pattern: /\brule B\d+\b/g,
  },
]);

/**
 * A paragraph containing any of these is never touched by `--fix`; it is a
 * candidate for carrying rationale that a human must reword.
 */
export const RATIONALE_RE =
  /\b(?:because|since|so that|otherwise|intentional(?:ly)?|deliberate(?:ly)?|must|avoid(?:s|ed|ing)?|prevent(?:s|ed|ing)?|rationale|why|note that|workaround|divergen(?:ce|ces|t)|caveat|trade-?offs?)\b/i;

export function hasRationale(text) {
  return RATIONALE_RE.test(text);
}

const WORD_CHAR = /\w/;

/**
 * True when `[start, end)` of `text` is one segment of a dotted symbol path
 * such as `mixpanel_headless.workspace.Workspace.list_dashboards` — i.e. it is
 * glued by a `.` to a word character on either side. Such segments are Python
 * provenance by symbol name, which the style guide allows.
 */
export function isDottedSegment(text, start, end) {
  const before =
    start >= 2 && text[start - 1] === "." && WORD_CHAR.test(text[start - 2]);
  const after =
    end + 1 < text.length && text[end] === "." && WORD_CHAR.test(text[end + 1]);
  return before || after;
}

/**
 * Find banned-token matches in one line of comment (or title) text.
 * Overlapping matches are reduced to the earliest-starting, longest one so a
 * line naming the packets document does not also count as the bare word. Returns
 * `{ token, index, length, match }` entries in ascending `index` order.
 */
export function findBannedTokens(line, options = {}) {
  const filePath = options.filePath ?? "";
  const raw = [];
  for (const { name, re } of BANNED_TOKENS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      raw.push({
        token: name,
        index: m.index,
        length: m[0].length,
        match: m[0],
      });
    }
  }
  raw.sort((a, b) => a.index - b.index || b.length - a.length);

  const whitelistRanges = [];
  for (const rule of WHITELIST) {
    if (!rule.files.test(filePath)) continue;
    rule.pattern.lastIndex = 0;
    let m;
    while ((m = rule.pattern.exec(line)) !== null) {
      whitelistRanges.push([m.index, m.index + m[0].length]);
      if (m[0].length === 0) rule.pattern.lastIndex++;
    }
  }

  const out = [];
  let lastEnd = -1;
  for (const hit of raw) {
    if (hit.index < lastEnd) continue;
    const end = hit.index + hit.length;
    if (isDottedSegment(line, hit.index, end)) continue;
    if (whitelistRanges.some(([s, e]) => hit.index >= s && end <= e)) continue;
    out.push(hit);
    lastEnd = end;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extraction (TypeScript compiler API)
// ---------------------------------------------------------------------------

/** Map a file extension to the ScriptKind the parser should use. */
export function scriptKindFor(filePath) {
  if (/\.(?:js|mjs|cjs)$/.test(filePath)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function parse(text, scriptKind) {
  return ts.createSourceFile(
    "input.ts",
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKind ?? ts.ScriptKind.TS,
  );
}

function commentKind(text, range) {
  if (range.kind === ts.SyntaxKind.SingleLineCommentTrivia) return "line";
  return text.startsWith("/**", range.pos) ? "jsdoc" : "block";
}

/**
 * Every comment in `text` as `{ pos, end, kind, text }`, in source order.
 * Walks the full token tree (`getChildren`) so comments inside otherwise
 * empty blocks and before the end-of-file token are found too.
 */
export function extractComments(text, scriptKind) {
  const sf = parse(text, scriptKind);
  return extractCommentsFrom(sf, text);
}

function extractCommentsFrom(sf, text) {
  const seen = new Set();
  const out = [];
  const collect = (pos, trailing = false) => {
    const ranges = trailing
      ? ts.getTrailingCommentRanges(text, pos)
      : ts.getLeadingCommentRanges(text, pos);
    if (!ranges) return;
    for (const r of ranges) {
      if (seen.has(r.pos)) continue;
      seen.add(r.pos);
      out.push({
        pos: r.pos,
        end: r.end,
        kind: commentKind(text, r),
        text: text.slice(r.pos, r.end),
      });
    }
  };
  // Same-line comments after a token are "trailing" to the TypeScript
  // scanner and never appear in the next token's leading ranges.
  const visit = (node) => {
    for (const child of node.getChildren(sf)) {
      collect(child.getFullStart());
      collect(child.getEnd(), true);
      visit(child);
    }
  };
  collect(0);
  visit(sf);
  out.sort((a, b) => a.pos - b.pos);
  return out;
}

const TITLE_CALLEES = new Set(["describe", "it", "test"]);

function rootIdentifier(expr) {
  let e = expr;
  for (;;) {
    if (ts.isPropertyAccessExpression(e)) {
      e = e.expression;
    } else if (ts.isCallExpression(e)) {
      e = e.expression;
    } else {
      break;
    }
  }
  return ts.isIdentifier(e) ? e.text : undefined;
}

function literalTitle(arg) {
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
    return arg.text;
  }
  if (ts.isTemplateExpression(arg)) {
    return [arg.head.text, ...arg.templateSpans.map((s) => s.literal.text)]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }
  return undefined;
}

/**
 * First string argument of every `describe(` / `it(` / `test(` call
 * (including `.skip`/`.only`/`.each(...)` chains), as
 * `{ pos, end, text }` where `pos` is the offset of the first title
 * character (inside the quote).
 */
export function extractTestTitles(text, scriptKind) {
  const sf = parse(text, scriptKind);
  return extractTitlesFrom(sf);
}

function extractTitlesFrom(sf) {
  const out = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const callee = rootIdentifier(node.expression);
      if (callee !== undefined && TITLE_CALLEES.has(callee)) {
        const arg = node.arguments[0];
        const title = literalTitle(arg);
        if (title !== undefined) {
          out.push({
            pos: arg.getStart(sf) + 1,
            end: arg.getEnd(),
            text: title,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

function* linesWithOffsets(text) {
  let offset = 0;
  for (const line of text.split("\n")) {
    yield { line, offset };
    offset += line.length + 1;
  }
}

/**
 * Scan one source text. Returns `{ hits, comments, titles }` where each hit is
 * `{ line, col, token, kind, text, pos }` (1-based line/col; `kind` is
 * `line` | `block` | `jsdoc` | `title`; `text` is the trimmed comment line or
 * title). Hits are in source order.
 */
export function scanSource(text, options = {}) {
  const filePath = options.filePath ?? "";
  const scriptKind = options.scriptKind ?? scriptKindFor(filePath);
  const sf = parse(text, scriptKind);
  const comments = extractCommentsFrom(sf, text);
  const titles = extractTitlesFrom(sf);
  const hits = [];
  const locate = (pos) => {
    const lc = ts.getLineAndCharacterOfPosition(sf, pos);
    return { line: lc.line + 1, col: lc.character + 1 };
  };

  for (const c of comments) {
    for (const { line, offset } of linesWithOffsets(c.text)) {
      for (const m of findBannedTokens(line, { filePath })) {
        const pos = c.pos + offset + m.index;
        hits.push({
          ...locate(pos),
          token: m.token,
          kind: c.kind,
          text: line.trim(),
          pos,
        });
      }
    }
  }
  for (const t of titles) {
    for (const m of findBannedTokens(t.text, { filePath })) {
      const pos = t.pos + m.index;
      hits.push({
        ...locate(pos),
        token: m.token,
        kind: "title",
        text: t.text,
        pos,
      });
    }
  }
  hits.sort((a, b) => a.pos - b.pos);
  return { hits, comments, titles };
}

// ---------------------------------------------------------------------------
// Fix rules (pure, per line of comment content)
// ---------------------------------------------------------------------------

/**
 * Remove `[start, end)` from `line` together with one adjacent space:
 * the preceding one when present, else the following one.
 */
function spliceOut(line, start, end) {
  let s = start;
  let e = end;
  if (s > 0 && line[s - 1] === " ") {
    s -= 1;
  } else if (line[e] === " ") {
    e += 1;
  }
  return line.slice(0, s) + line.slice(e);
}

const BARE_ID_PAREN_RE = new RegExp(
  String.raw`\(\s*${ID_ALTERNATION}(?:(?:\s*[,/;+&]\s*|\s+and\s+)${ID_ALTERNATION})*\s*\)`,
  "g",
);

/**
 * Rule `bare-id-parenthetical`: delete `(R<n>.<m>)`, `(TS-<n>)`, `(B<n>-W<n>)`,
 * `(R<n>.<m>/R<n>.<m>)`, `(B<n>, R<n>.<m>)` ... — parentheticals holding
 * nothing but process ids. Returns `{ line, count }`.
 */
export function fixBareIdParentheticals(line) {
  BARE_ID_PAREN_RE.lastIndex = 0;
  const matches = [];
  let m;
  while ((m = BARE_ID_PAREN_RE.exec(line)) !== null) {
    matches.push([m.index, m.index + m[0].length]);
  }
  let out = line;
  for (let i = matches.length - 1; i >= 0; i--) {
    const [s, e] = matches[i];
    out = spliceOut(out, s, e);
  }
  return { line: out, count: matches.length };
}

const PY_PAREN_RE = /\((`?)([\w./-]+\.py):\d+(?:[-–]\d+)?(`?)\)(?=$|[^\w`])/g;
const PY_BARE_RE = /(`?)([\w./-]+\.py):\d+(?:[-–]\d+)?(`?)/g;
const BARE_LINE_PAREN_RE = /\(:\d+(?:[-–]\d+)?\)/g;
/** A following `, 153` / `, :153` / `` `:153` `` means an orphan list — human territory. */
const ORPHAN_TAIL_RE = /^\s*[,/;]\s*`?:?\d+/;
const ORPHAN_ANYWHERE_RE = /`:\d+|[,/;]\s*:\d+/;
// A backticked identifier, a snake_case call, or a dotted path with at least
// two characters per segment (so "e.g." / "i.e." do not count as symbols).
const SYMBOL_NEARBY_RE =
  /`[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\(\))?`|\b[A-Za-z_]\w*_\w*\(|\b[A-Za-z_]\w+\.(?!py\b|md\b|json\b|ts\b|mjs\b|js\b)[A-Za-z_]\w+\b/;

function hasSymbolNearby(text) {
  return SYMBOL_NEARBY_RE.test(text);
}

/**
 * Rule `py-line-ref`: drop Python line ranges.
 *   - `(\`workspace.py:<from>-<to>\`)` -> removed entirely when a symbol name
 *     is nearby on the line, else `(\`workspace.py\`)`.
 *   - bare `workspace.py:<from>-<to>` -> `workspace.py`.
 *   - `(:<from>-<to>)` -> removed.
 * Lines carrying orphan line lists (`types.py:<n>, <m>` / `` `:<n>` ``) are
 * left alone. Returns `{ line, count }`.
 */
export function fixPyLineRefs(line) {
  if (ORPHAN_ANYWHERE_RE.test(line)) return { line, count: 0 };
  let count = 0;
  let out = line;

  // Parenthetical form first.
  PY_PAREN_RE.lastIndex = 0;
  const parens = [];
  let m;
  while ((m = PY_PAREN_RE.exec(out)) !== null) {
    if (ORPHAN_TAIL_RE.test(out.slice(m.index + m[0].length))) continue;
    parens.push({
      start: m.index,
      end: m.index + m[0].length,
      tick: m[1],
      module: m[2],
    });
  }
  for (let i = parens.length - 1; i >= 0; i--) {
    const p = parens[i];
    const rest = out.slice(0, p.start) + out.slice(p.end);
    if (hasSymbolNearby(rest)) {
      out = spliceOut(out, p.start, p.end);
    } else {
      out = `${out.slice(0, p.start)}(${p.tick}${p.module}${p.tick})${out.slice(p.end)}`;
    }
    count++;
  }

  // Bare form.
  PY_BARE_RE.lastIndex = 0;
  const bares = [];
  while ((m = PY_BARE_RE.exec(out)) !== null) {
    if (ORPHAN_TAIL_RE.test(out.slice(m.index + m[0].length))) continue;
    bares.push({
      start: m.index,
      end: m.index + m[0].length,
      replacement: `${m[1]}${m[2]}${m[3]}`,
    });
  }
  for (let i = bares.length - 1; i >= 0; i--) {
    const b = bares[i];
    out = out.slice(0, b.start) + b.replacement + out.slice(b.end);
    count++;
  }

  // Line-only parenthetical `(:<from>-<to>)`.
  BARE_LINE_PAREN_RE.lastIndex = 0;
  const lineOnly = [];
  while ((m = BARE_LINE_PAREN_RE.exec(out)) !== null) {
    lineOnly.push([m.index, m.index + m[0].length]);
  }
  for (let i = lineOnly.length - 1; i >= 0; i--) {
    const [s, e] = lineOnly[i];
    out = spliceOut(out, s, e);
    count++;
  }
  return { line: out, count };
}

const MARKER_RE = /^(\s*)\/\/\s*(?:={3,}|-{3,})\s*(.*?)\s*(?:={3,}|-{3,})\s*$/;
const OWNERSHIP_PART_RE = new RegExp(
  String.raw`^(?:\S+\s+owns|owns|append-only|read-only|owned by \S+|${ID_ALTERNATION})$`,
  "i",
);

function isOwnershipParenthetical(inner) {
  return inner
    .split(/[;,]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .every((p) => OWNERSHIP_PART_RE.test(p));
}

/**
 * Rule `ownership-marker`: a standalone `// === B<n>-W<n> dashboard members
 * (W<n> owns; append-only) ===` line becomes `// --- Dashboard members ---`, or is
 * deleted when nothing but ids remains. Lines whose parentheticals say more
 * than ownership are left for humans. Returns
 * `{ line, changed, deleted }` where `line` is `null` when deleted.
 */
export function fixOwnershipMarker(line) {
  const m = MARKER_RE.exec(line);
  if (!m) return { line, changed: false, deleted: false };
  const [, indent, inner] = m;
  if (findBannedTokens(inner).length === 0) {
    return { line, changed: false, deleted: false };
  }
  let label = inner;
  const parentheticals = [...label.matchAll(/\(([^()]*)\)/g)];
  for (const p of parentheticals) {
    if (!isOwnershipParenthetical(p[1])) {
      return { line, changed: false, deleted: false };
    }
  }
  label = label.replace(/\([^()]*\)/g, " ");
  for (const hit of findBannedTokens(label).reverse()) {
    label = `${label.slice(0, hit.index)} ${label.slice(hit.index + hit.length)}`;
  }
  label = label
    .replace(/\s+/g, " ")
    .replace(/^[\s:;,\-–—]+|[\s:;,\-–—]+$/g, "")
    .trim();
  if (!/[A-Za-z]/.test(label)) {
    return { line: null, changed: true, deleted: true };
  }
  const capitalised = label.charAt(0).toUpperCase() + label.slice(1);
  return {
    line: `${indent}// --- ${capitalised} ---`,
    changed: true,
    deleted: false,
  };
}

// ---------------------------------------------------------------------------
// Whole-file rewrite
// ---------------------------------------------------------------------------

export const FIX_RULES = Object.freeze([
  "ownership-marker",
  "py-line-ref",
  "bare-id-parenthetical",
]);

function emptyCounts() {
  const c = {};
  for (const r of FIX_RULES) c[r] = 0;
  return c;
}

/** Content of a comment line with the comment syntax stripped. */
function lineContent(line, kind) {
  if (kind === "line") return line.replace(/^\s*\/\/\s?/, "");
  return line
    .replace(/^\s*\/\*\*?\s?/, "")
    .replace(/\*\/\s*$/, "")
    .replace(/^\s*\*\s?/, "")
    .trim();
}

function isBlankContent(line, kind) {
  return lineContent(line, kind).trim().length === 0;
}

/**
 * Split an ordered list of `{ line }` records into paragraphs: blank comment
 * lines, `@tag` lines and marker lines each start a new paragraph.
 */
function paragraphsOf(records, kind) {
  const groups = [];
  let current = [];
  const flush = () => {
    if (current.length > 0) groups.push(current);
    current = [];
  };
  for (const rec of records) {
    const blank = isBlankContent(rec.line, kind);
    const marker = kind === "line" && MARKER_RE.test(rec.line);
    const tag = /^\s*@\w+/.test(lineContent(rec.line, kind));
    if (blank || marker || tag) flush();
    current.push(rec);
    if (blank || marker) flush();
  }
  flush();
  return groups;
}

/**
 * Apply the fix rules to one paragraph (array of `{ line }` records, mutated
 * in place: `line` becomes the rewritten text or `null` for a deleted line).
 */
function fixParagraph(records, kind, counts) {
  const joined = records.map((r) => lineContent(r.line, kind)).join("\n");
  if (hasRationale(joined)) return;
  for (const rec of records) {
    if (kind === "line") {
      const marker = fixOwnershipMarker(rec.line);
      if (marker.changed) {
        counts["ownership-marker"]++;
        rec.line = marker.line;
        continue;
      }
    }
    const py = fixPyLineRefs(rec.line);
    const ids = fixBareIdParentheticals(py.line);
    if (ids.line === rec.line) continue;
    if (looksBroken(rec.line, ids.line, kind)) continue; // leave for humans
    counts["py-line-ref"] += py.count;
    counts["bare-id-parenthetical"] += ids.count;
    rec.line = ids.line;
  }
}

const STRANDED_PUNCT_RE = / [,.;:](?=\s|$)/g;

/**
 * A rewrite that strands punctuation (`*, and the ...`, `foo , bar`) is not
 * mechanical any more; the line is reverted and left in the report.
 */
export function looksBroken(before, after, kind) {
  const content = lineContent(after, kind).trim();
  if (/^[,.;:)]/.test(content)) return true;
  const strandedBefore = (before.match(STRANDED_PUNCT_RE) ?? []).length;
  const strandedAfter = (after.match(STRANDED_PUNCT_RE) ?? []).length;
  return strandedAfter > strandedBefore;
}

/**
 * After rewriting, drop lines that the fixes emptied and collapse the blank
 * comment lines that removal exposed (double blanks, blanks at either end).
 * Only groups where something was emptied are touched.
 */
function tidyEmptied(records, kind, originals) {
  const emptied = records.some(
    (r, i) =>
      r.line !== null &&
      r.line !== originals[i] &&
      isBlankContent(r.line, kind) &&
      !isBlankContent(originals[i], kind),
  );
  const deleted = records.some((r) => r.line === null);
  if (!emptied && !deleted) return records;
  const kept = records.filter(
    (r, i) =>
      r.line !== null &&
      (r.line === originals[i] ||
        !isBlankContent(r.line, kind) ||
        isBlankContent(originals[i], kind)),
  );
  const out = [];
  for (const rec of kept) {
    const blank = isBlankContent(rec.line, kind);
    const prevBlank =
      out.length > 0 && isBlankContent(out[out.length - 1].line, kind);
    if (blank && (out.length === 0 || prevBlank)) continue;
    out.push(rec);
  }
  while (out.length > 0 && isBlankContent(out[out.length - 1].line, kind)) {
    out.pop();
  }
  return out;
}

function lineStartOf(text, pos) {
  const nl = text.lastIndexOf("\n", pos - 1);
  return nl === -1 ? 0 : nl + 1;
}

function lineEndOf(text, pos) {
  const nl = text.indexOf("\n", pos);
  return nl === -1 ? text.length : nl;
}

function isWhitespace(s) {
  return /^[ \t]*$/.test(s);
}

/**
 * Rewrite `text` with the mechanical fixes. Returns
 * `{ text, counts, changes }` where `changes` is a list of
 * `{ line, before, after }` (1-based line; `after` is `null` for a deleted
 * line) suitable for a dry-run listing.
 */
export function rewriteSource(text, options = {}) {
  const filePath = options.filePath ?? "";
  const scriptKind = options.scriptKind ?? scriptKindFor(filePath);
  const sf = parse(text, scriptKind);
  const comments = extractCommentsFrom(sf, text);
  const counts = emptyCounts();
  const edits = [];
  const lineNumber = (pos) =>
    ts.getLineAndCharacterOfPosition(sf, pos).line + 1;

  // Group standalone line comments on consecutive lines.
  const groups = [];
  let current = null;
  for (const c of comments) {
    const ls = lineStartOf(text, c.pos);
    const le = lineEndOf(text, c.end);
    const standalone =
      isWhitespace(text.slice(ls, c.pos)) &&
      isWhitespace(text.slice(c.end, le));
    const startLine = lineNumber(c.pos);
    if (c.kind === "line" && standalone) {
      if (
        current &&
        current.kind === "line" &&
        current.lastLine === startLine - 1
      ) {
        current.items.push(c);
        current.lastLine = startLine;
        continue;
      }
      current = {
        kind: "line",
        standalone: true,
        items: [c],
        lastLine: startLine,
      };
      groups.push(current);
    } else {
      current = {
        kind: c.kind,
        standalone,
        items: [c],
        lastLine: lineNumber(c.end),
      };
      groups.push(current);
    }
  }

  for (const g of groups) {
    if (g.kind === "line") {
      const records = g.items.map((c) => ({ line: c.text }));
      const originals = records.map((r) => r.line);
      const before = JSON.stringify(originals);
      for (const para of paragraphsOf(records, "line"))
        fixParagraph(para, "line", counts);
      if (JSON.stringify(records.map((r) => r.line)) === before) continue;
      if (g.standalone) {
        const kept = tidyEmptied(records, "line", originals);
        const first = g.items[0];
        const last = g.items[g.items.length - 1];
        const start = lineStartOf(text, first.pos);
        let end = lineEndOf(text, last.end);
        const hasNewline = end < text.length;
        if (hasNewline) end += 1;
        const indentOf = (c) => text.slice(lineStartOf(text, c.pos), c.pos);
        const keptLines = kept.map(
          (r) => `${indentOf(g.items[records.indexOf(r)])}${r.line}`,
        );
        const replacement =
          keptLines.length === 0
            ? ""
            : keptLines.join("\n") + (hasNewline ? "\n" : "");
        const changes = [];
        for (const [i, record] of records.entries()) {
          const after = kept.includes(record) ? record.line : null;
          if (after !== originals[i]) {
            changes.push({
              line: lineNumber(g.items[i].pos),
              before: originals[i],
              after,
            });
          }
        }
        edits.push({ start, end, replacement, changes });
      } else {
        // Trailing comment after code on the same line.
        const c = g.items[0];
        const rec = records[0];
        let start = c.pos;
        let replacement = rec.line;
        if (isBlankContent(rec.line, "line")) {
          replacement = "";
          while (
            start > 0 &&
            (text[start - 1] === " " || text[start - 1] === "\t")
          )
            start--;
        }
        edits.push({
          start,
          end: c.end,
          replacement,
          changes: [
            {
              line: lineNumber(c.pos),
              before: c.text,
              after: replacement || null,
            },
          ],
        });
      }
      continue;
    }

    // Block / JSDoc comment: rewrite inner lines in place.
    const c = g.items[0];
    const lines = c.text.split("\n");
    const records = lines.map((line) => ({ line }));
    const originals = records.map((r) => r.line);
    for (const para of paragraphsOf(records, c.kind))
      fixParagraph(para, c.kind, counts);
    if (records.every((r, i) => r.line === originals[i])) continue;

    let kept;
    if (lines.length === 1) {
      kept = records;
    } else {
      // Keep the opener and closer lines fixed; tidy the interior.
      const interior = records.slice(1, -1);
      const interiorOriginals = originals.slice(1, -1);
      const tidied = tidyEmptied(interior, c.kind, interiorOriginals);
      kept = [records[0], ...tidied, records[records.length - 1]];
    }
    let replacement = kept.map((r) => r.line).join("\n");
    const contentLeft = kept.some((r) => !isBlankContent(r.line, c.kind));
    const baseLine = lineNumber(c.pos);
    const changes = [];
    for (const [i, record] of records.entries()) {
      const after = kept.includes(record) ? record.line : null;
      if (after !== originals[i]) {
        changes.push({ line: baseLine + i, before: originals[i], after });
      }
    }
    if (!contentLeft) {
      for (const ch of changes) ch.after = null;
      if (g.standalone) {
        const start = lineStartOf(text, c.pos);
        let end = lineEndOf(text, c.end);
        if (end < text.length) end += 1;
        edits.push({ start, end, replacement: "", changes });
      } else {
        let start = c.pos;
        let end = c.end;
        if (start > 0 && text[start - 1] === " ") start--;
        else if (text[end] === " ") end++;
        edits.push({ start, end, replacement: "", changes });
      }
      continue;
    }
    if (lines.length > 1 && kept.length === 2) {
      // Everything between opener and closer vanished but the opener/closer
      // still carry text (e.g. `/** foo (TS-<n>)` ... `*/`): join them.
      replacement = `${kept[0].line}\n${kept[1].line}`;
    }
    edits.push({ start: c.pos, end: c.end, replacement, changes });
  }

  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  const changes = [];
  for (const e of edits) {
    if (e.start < cursor) continue; // overlapping edit: skip defensively
    out += text.slice(cursor, e.start) + e.replacement;
    cursor = e.end;
    if (e.changes) changes.push(...e.changes);
  }
  out += text.slice(cursor);
  changes.sort((a, b) => a.line - b.line);
  return { text: out, counts, changes };
}
