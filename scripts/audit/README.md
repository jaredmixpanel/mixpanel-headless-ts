# scripts/audit

`comment-archaeology.mjs` finds comments and test titles that carry port-process
identifiers (batch/task/requirement ids, `foo.py:123` line references, shard and
packet vocabulary) instead of rationale, and can apply the purely mechanical
rewrites. It parses with the TypeScript compiler API, so strings, templates and
regex literals that merely look like comments never count.

- `npm run audit:comments` — report every hit as `file:line:col  token  text`,
  then per-token and per-directory counts. `-- --summary` prints counts only;
  `-- --json <path>` also writes the report as JSON; `-- --root <dir>` or
  positional paths narrow the scan.
- `npm run audit:comments:fix` — apply the three mechanical rules (id-only
  parentheticals, Python line ranges, ownership markers); paragraphs containing
  rationale words are never touched. Add `-- --dry-run` to preview.

Exit codes: `0` clean (or fix finished), `1` hits found, `2` bad usage or I/O.
To whitelist a form, add a `{ files, pattern }` row to `WHITELIST` in
`comment-archaeology-lib.mjs` (today: `// rule B<n>` labels in the
bookmark-validation files) and cover it in `tests/comment-archaeology.test.ts`.
