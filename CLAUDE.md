# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A TypeScript port of the Python `mixpanel_headless` library (checkout expected at
`../mixpanel-headless`), built around a verification rig rather than a from-scratch
rewrite: a conformance corpus extracted from the Python implementation is replayed
against the TS port, a cross-language differential oracle is fuzzed against the
Python one, and vendored JSON-schema referees check payload shapes.

The **spec of record lives in-repo under `context/`** (relocated from the Python
repo, where the port was executed, at the end of Phase 3): the master plan,
rulebook, api-map, and per-phase design docs / task packets are under
`context/phase{1,2,3,4}/` (e.g. `context/phase1/design/phase1-design.md` sections
D11–D16 define this repo; later phases use packet files like
`context/phase3/design/b9-packets.md`). Commit messages reference those
packet/requirement IDs (TS-5, P2-4, B9, R9.1, …). Gate-run records are committed
in `conformance-runner/GATE.md` and `differential/oracle/RUN.md`. The Python repo
keeps the conformance corpus (`conformance/` — the extraction tooling lives
there) and the Python-side bug reports; a pointer README remains at its
`context/`. Remote: `github.com/jaredmixpanel/mixpanel-headless-ts` (private);
CI (`.github/workflows/ci.yml`) mirrors `npm run check`.

## Commands

Node >= 22.12 required (`engines` + `.node-version`; the conformance rig's
request-side float twin uses `JSON.rawJSON`, absent before Node 21; CI runs 24).
Install with `npm ci` (lockfile-exact).

- `npm run check` — **the repo gate**: `tsc -b` (root solution file — this is
  also the build), `pack:check` (publint + attw on each package's `npm pack`
  tarball), knip, eslint, `prettier --check`, full vitest run (including
  `tests/package-consumption.test.ts`, which packs and installs the three
  tarballs — `MP_SKIP_PACK_TEST=1` skips it locally), browser-bundle smoke.
  Run before committing.
- `npm run build` / `npm run typecheck` — both `tsc -b` over the root
  `tsconfig.json` solution file: builds the three packages into their `dist/`
  (gitignored) and type-checks every test, rig and script project.
  `npm run clean` = `tsc -b --clean`. After toggling a flag in
  `tsconfig.lib.json`, run `npx tsc -b --force` once — incremental builds have
  been seen to miss `isolatedDeclarations` diagnostics.
- `npm run knip` — unused files/deps/exports. Unused exports/types are
  _warnings_ until Phase 6's un-export sweep (`knip.jsonc` `rules`).
- `npm run lint` — `eslint . --max-warnings 0` (typed, ~20 s). `eslint.config.js`
  is the exhaustive Phase 4 config (CLEANUP-PLAN.md §8): every rule is `error`
  or `off` with a reason, never `warn` (asserted at load). Rules whose fixes
  are still being hand-applied are configured in full but parked `off` in the
  delimited `// --- Phase 4 lane L<n>` blocks near the end; landing a lane =
  deleting its block. `MP_LINT_UNPARK=L2` (or `all`) drops a block for one
  run so a lane can see its own errors (`MP_LINT_UNPARK=L2 npx eslint . --fix`
  applies that lane's fixers). The generated/vendored ignore list lives once in
  `scripts/lib/lint-ignores.mjs`; `tests/ignore-lists.test.ts` keeps
  `.prettierignore` in sync with it. Custom TSDoc tags are declared in
  `tsdoc.json`.
- `npm test` — vitest across all workspaces (config in root `vitest.config.ts`).
- Single test file: `npx vitest run conformance-runner/test/runner.test.ts`
- Conformance replay CLI: `npm run conformance -- --report json --filter "compat/"`
  (filter matches vector id prefixes; omit for the full corpus).
- `npm run oracle` — starts oracle-ts (stdin/stdout line protocol); normally
  spawned by the Python fuzz harness as `--right "node .../scripts/run-oracle.mjs"`.
- `npm run fmt` / `npm run fmt:check` — Prettier owns all formatting.
- `npm run sync:corpus` — re-snapshot the conformance corpus from the Python repo.
- `npm run vendor:drift` — verify `vendor/mixpanel-contracts` sha256 integrity and
  (if the analytics checkout is mounted) byte-diff against source.
- Generators (see "Generated files" below): `npm run generate:error-codes`,
  `npm run generate:api-map`.

## Layout (npm workspaces)

| Workspace            | Purpose                                                                              |
| -------------------- | ------------------------------------------------------------------------------------ |
| `packages/core`      | Isomorphic port — zero Node deps (R9.1)                                              |
| `packages/node`      | Node-only surface (config files, env, OAuth callback, fs seams)                      |
| `packages/browser`   | Browser-only surface (CredentialStore, redirect PKCE) — same purity boundary as core |
| `conformance-runner` | Replays the Python-extracted vector corpus (D12/D13)                                 |
| `differential`       | oracle-ts stdio bridge (D14) + ajv bookmark-schema referee (D15a)                    |

Cross-workspace imports use the bare specifiers `@mixpanel-headless/core`,
`@mixpanel-headless/core/internal` (rig/platform-package plumbing, **not
semver-stable**), `@mixpanel-headless/node` and — from `differential` —
`@mixpanel-headless/conformance-runner`. Never import another workspace by
relative path (the only sanctioned exception: node/browser _tests_ reach
`packages/core/test-support/` relatively). `scripts/codemods/rewrite-workspace-imports.mjs`
is the idempotent codemod that produced/maintains this (`--check` to audit).

The three packages' `exports` maps point at `dist/` (what `tsc -b` project
references and any consumer see). Everything that executes TypeScript from
source — vitest, the two esbuild CLIs (`scripts/run-conformance.mjs`,
`scripts/run-oracle.mjs`), the browser smoke and the vendoring recipe — maps
the bare specifiers back to `src/` through the one alias table in
`scripts/lib/workspace-aliases.mjs`, so a stale `dist/` can never shadow the
code under test. `conformance-runner` is private and exports `./src/index.ts`
directly.

Public-API curation: `packages/core/src/index.ts` is an explicit, sectioned
named list (no `export *`; ~720 names) and `src/internal.ts` holds what the
platform packages and the rig need beyond it; `tests/core-public-surface.test.ts`
locks "nothing `@internal` reachable from `.`", disjoint barrels, no
`export *`. `stripInternal` is deliberately off (see `tsconfig.lib.json`).

tsconfig layout: `tsconfig.base.json` (shared strict flags) ← `tsconfig.lib.json`
(composite library build: `declaration`, `declarationMap`, `sourceMap`,
`isolatedDeclarations`) ← `packages/*/tsconfig.json` (`rootDir: src`, `outDir:
dist`); each package also has `tsconfig.test.json` (`noEmit`, includes `test` —
plus `test-support/` for core — and references the package build). `conformance-runner`, `differential`, `scripts`
(`allowJs`) and the root `tsconfig.tests.json` (`tests/`) are `noEmit` projects
referencing the packages they import. Core/browser configs add the DOM libs;
Node-side projects use `types: ["node"]`.

## Core-purity boundary (R9.1 / R9.3)

`packages/core` and `packages/browser` must not import Node built-ins (`node:*`,
`fs`, `path`, `os`) or `undici`, and must not read the `process` global —
configuration is injected instead (e.g. browser storage arrives as an injected
Storage-shaped parameter). Enforced twice: eslint `no-restricted-imports`/`globals`
rules in `eslint.config.js`, and `scripts/browser-smoke.mjs`, which esbuild-bundles
both entry points for `platform: "browser"` and fails on any Node dependency in the
graph. Node-specific code belongs in `packages/node`.

## Conformance rig

- The corpus (`conformance-runner/corpus/`) is a **committed snapshot** of the
  Python repo's `conformance/vectors/**` plus contract artifacts, pinned by
  `sourceCommit` in `conformance-runner/corpus.config.json`. The sync script aborts
  on pin mismatch; a corpus refresh = update the pin, run `npm run sync:corpus`,
  commit. Never hand-edit corpus files.
- `conformance-runner/src/runner.ts` dispatches vectors to implementations
  registered in `src/bindings.ts` (wire vectors go through `src/wire-*.ts` +
  `vector-fetch.ts`, which serves recorded HTTP interactions and diffs the
  requests the port actually makes). Verdicts: `PASS`, `FAIL_OUTPUT`,
  `FAIL_REQUEST`, `FAIL_ERROR`, `PRECISION_LOSS`, `UNPORTED` (mapped but not yet
  bound), `UNMAPPED_API`. The whole corpus also runs as vitest
  (`conformance-runner/test/corpus.test.ts`), skipping `UNPORTED` vectors.
- Python↔TS API naming is resolved through the generated `src/api-map.gen.ts`;
  authored-only apis (compat._, wirestub._) live in `src/authored-apis.json`,
  naming exceptions in `src/naming-exceptions.json`. The generator fails hard on
  names with no exception row — no fuzzy matching.
- Python-parity semantics (`str()` rendering, `zfill`, float formatting) live in
  `packages/core/src/compat/`, including a CPython-pinned Unicode printability
  table so results don't depend on the host JS engine's Unicode version.
- Cross-language equality goes through the shared canonicalizer
  (`conformance-runner/src/canonical.ts`) and a lossless, order-preserving JSON
  model (`lossless-json.ts`) — plain `JSON.parse` reorders integer-like keys and
  loses float-ness of tokens like `18.0`, both of which matter here.

## Generated files — never hand-edit

Each has a generator and a byte-exact freshness test; regenerate instead of editing:

- `conformance-runner/src/api-map.gen.ts` ← `npm run generate:api-map`
- `packages/core/src/errors-codes.gen.ts` ← `npm run generate:error-codes`
- `packages/core/src/compat/non-printable.gen.ts` ← `scripts/generate-non-printable.py`
- `vendor/**` — vendored verbatim with sha256 provenance (`PROVENANCE.json`); re-vendor, don't patch.

## Conventions

- tsconfig is strict everywhere (`tsconfig.base.json`): `strict`,
  `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `noPropertyAccessFromIndexSignature` (use `obj["key"]` for index-signature
  reads), `noUnusedLocals`/`noUnusedParameters`, `noImplicitOverride`,
  `noImplicitReturns`, `erasableSyntaxOnly` (no `enum`/`namespace` — use
  `as const` objects + literal unions), `verbatimModuleSyntax`, NodeNext modules,
  target/lib `es2023`. Library builds additionally require `isolatedDeclarations`
  (every exported binding needs an explicit type unless trivially inferable).
- Naming (D1): identifiers, private members and constructor/config option
  bags are camelCase; snake_case only for names that mirror Python or the wire
  (entity/result/param fields, bookmark params, error `details`, on-disk
  records) and for query-option bags that mirror Python keyword arguments 1:1.
  Object-literal keys are unconstrained. Enforced by `namingConvention()` in
  `eslint.config.js` (snake_case scopes are listed there by file) and
  `tests/naming-config-bags.test.ts`; README "Naming" is the user-facing rule.
- Task-scoped scratch notes go in `.notes/` (see `.notes/ts5-scratch.md` for the
  pattern); durable run records go in `GATE.md` / `RUN.md`.
- Environment overrides for scripts: `MP_PYTHON_REPO` (Python checkout path),
  `MP_RIG_BRANCH` (corpus sync branch), `ANALYTICS_ROOT` (vendor drift source,
  read-only).
