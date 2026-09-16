# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A TypeScript port of the Python `mixpanel_headless` library (checkout expected at
`../mixpanel-headless`), built around a verification rig: a conformance corpus
extracted from the Python implementation is replayed against the port, and a
cross-language differential oracle is fuzzed against the Python one.

The human-facing documents are the source of truth; read them before changing anything non-trivial:

- `CONTRIBUTING.md` — toolchain pins, layout, the gate, generated files, corpus
  refresh, comment/docstring style, test and commit conventions, releasing.
- `PORTING.md` — the pinned Python revision, naming rules, every known
  behavioral divergence (with its TS symbol), what the corpus and oracle prove.
- `docs/history/` — the port's archived process record (frozen); its README has
  a reading order and a glossary of the identifiers (`R9.1`, `B6-W2`, `P2-4`,
  `TS-5`, `D11–D16`, `AIE-nnn`) older commits still cite. Never add new
  references to them; Python provenance is a dotted symbol name only.
- `conformance-runner/GATE.md` / `differential/oracle/RUN.md` — run records;
  `scripts/README.md` — every script, its inputs and npm alias.

Remote: `github.com/jaredmixpanel/mixpanel-headless-ts` (private). CI runs
`npm run check` on Node 22 and 24; `release.yml` runs Changesets on `main`
(publishing is a no-op while the packages are `private: true`).

## Commands

Developing needs Node ^22.22.2 or >= 24.15 (`engine-strict`); the packages run
on >= 22.12. `npm ci` installs lockfile-exact (`.npmrc`: `min-release-age=7`) and
the lefthook hooks (eslint + prettier at commit, typecheck + `test:fast` at push; `LEFTHOOK=0` skips).

- `npm run check` — **the repo gate**, in order: `tsc -b` (also the build),
  `pack:check` (publint + attw per tarball), knip (exports/types at error
  level), eslint, `docs:api:check` (TypeDoc over the three public barrels,
  warnings as errors), `prettier --check`, `audit:comments -- --summary` (0
  process identifiers in comments/titles), `vendor:drift` (sha256 integrity; byte-diff
  only with `ANALYTICS_ROOT`), `test:coverage` (every vitest project incl. the
  corpus replay, the `*.test-d.ts` type tests and the pack-and-install test —
  `MP_SKIP_PACK_TEST=1` skips that locally; global v8 floors 88/88/90/82),
  browser-bundle smoke. Run before committing.
- `npm run build` / `typecheck` — both `tsc -b` (packages into gitignored
  `dist/`, every project checked); after toggling a flag in
  `tsconfig.lib.json`, run `npx tsc -b --force` once.
- `npm run lint` — `eslint . --max-warnings 0` under a 4 GB heap (typed, ~30 s); every rule is
  `error` or `off` with a reason, never `warn`. Ignore list once in `scripts/lib/lint-ignores.mjs`
  (`tests/ignore-lists.test.ts` syncs `.prettierignore`). `npm run knip`; `npm run fmt` / `fmt:check`.
- `npm test` — all vitest projects (`core`, `node`, `browser`, `rig`, `corpus`,
  `differential`, `repo`); `test:fast` = all but the corpus, `test:corpus` =
  only it; `npx vitest run --project node`; `npx vitest run <file>`.
- `npm run conformance -- --report json [--filter "compat/"]` — corpus replay
  CLI; run after any change under `packages/core/src`, confirm 0 `FAIL_*`.
  `npm run oracle` — oracle-ts stdio bridge (spawned by the Python fuzz harness).
- `npm run sync:corpus` (`MP_PYTHON_REPO`, `MP_RIG_BRANCH`); `npm run vendor:drift`
  (`ANALYTICS_ROOT`); `npm run audit:comments` (`:fix -- --dry-run` previews).
- Generators: `npm run generate:all` (error-codes, api-map, bridge-allowlist);
  `generate:compat-tables` and `generate:canonical-fixtures` run Python through
  `uv run --python <pin>` (`scripts/compat-python.pin.json`; other interpreters refused).
- Docs site: `npm run docs:build` (`tsc -b` → `docs:api` = TypeDoc into git-ignored
  `docs/reference/` → `vitepress build docs`; every ` ```ts twoslash ` block is
  type-checked against `dist/`, dead links fail); `docs:dev` previews;
  `docs:api:check` validates the reference (in the gate).
  Conventions in CONTRIBUTING.md "Documentation".
- Playground (`/demo/`, `docs/.vitepress/theme/demo/`): `npm run generate:demo-fixtures`
  rewrites the synthetic project (`--check` for drift); `npm run demo:canary` probes
  Mixpanel's CORS/OAuth policy for live mode (weekly in `demo-canary.yml`).
- Releasing: `npx changeset` per change to a published package;
  `npm run version` / `release` = `changeset version` / `publish` (run by `release.yml`).

## Layout (npm workspaces)

| Workspace            | Purpose                                                                     |
| -------------------- | --------------------------------------------------------------------------- |
| `packages/core`      | Isomorphic port — zero Node deps                                            |
| `packages/node`      | Node-only surface (config files, env, OAuth callback, fs seams)             |
| `packages/browser`   | Browser-only surface (CredentialStore, redirect PKCE) — same purity as core |
| `conformance-runner` | Replays the Python-extracted vector corpus (private)                        |
| `differential`       | oracle-ts stdio bridge + ajv bookmark-schema referee (private)              |
| `scripts/`, `tests/` | Generators/launchers/codemods/audits (see `scripts/README.md`); repo tests  |

Cross-workspace imports use the bare specifiers `@mixpanel-headless/core`,
`@mixpanel-headless/core/internal` (rig/platform plumbing, **not semver-stable**),
`@mixpanel-headless/node`, `@mixpanel-headless/conformance-runner` — never a
relative path (only exception: node/browser _tests_ reach
`packages/core/test-support/`). Package `exports` point at `dist/`; vitest and the
esbuild launchers map the specifiers back to `src/` (`scripts/lib/workspace-aliases.mjs`).
`packages/core/src/index.ts` is an explicit
named list, `src/internal.ts` the rest; `tests/core-public-surface.test.ts`
locks "nothing `@internal` reachable from `.`" (`stripInternal` is off — see
`tsconfig.lib.json`; the tsconfig chain is described in CONTRIBUTING.md).

**Core-purity boundary:** `packages/core` and `packages/browser` must not import
Node built-ins (`node:*`, `fs`, `path`, `os`) or `undici`, and must not read
`process` — configuration is injected. Enforced by eslint and by
`scripts/browser-smoke.mjs` (esbuild for `platform: "browser"`, fails on any
Node dependency in the graph). Node-specific code belongs in `packages/node`.

## Conformance rig

- `conformance-runner/corpus/` is a **committed snapshot** pinned by `sourceCommit`
  in `corpus.config.json` (sync aborts on mismatch). Never hand-edit corpus files.
- `src/runner.ts` dispatches vectors to the bindings (`src/bindings.ts` façade,
  `src/bindings/*.ts`; wire vectors via `src/wire-*.ts` + `vector-fetch.ts`).
  Verdicts: `PASS`, `FAIL_OUTPUT`, `FAIL_REQUEST`, `FAIL_ERROR`,
  `PRECISION_LOSS`, `UNPORTED`, `UNMAPPED_API`.
- Python↔TS naming: generated `src/api-map.gen.ts` + `src/naming-exceptions.json`
  - `src/authored-apis.json` (the generator fails hard on unmapped names); equality
    goes through `src/canonical.ts` and the order-preserving `lossless-json.ts`.

## Generated files — never hand-edit

Regenerate instead (full table with inputs and freshness tests in CONTRIBUTING.md):

- `*.gen.ts` / `bridge-allowlist.gen.json` ← `npm run generate:all` (byte-exact
  freshness tests); the compat tables and `canonical-fixtures.json` ←
  `generate:compat-tables` / `generate:canonical-fixtures`
  (`tests/generated-tables-provenance.test.ts` pins interpreter, generator sha256, corpus pin).
- `vendor/**` — vendored verbatim with sha256 provenance; re-vendor, don't patch.
- `packages/*/CHANGELOG.md` — written by `changeset version` (only `0.1.0` is hand-written).

## Conventions

- tsconfig is strict everywhere (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `noPropertyAccessFromIndexSignature` — use `obj["key"]` — `erasableSyntaxOnly`: no
  `enum`/`namespace`; `verbatimModuleSyntax`, NodeNext); library builds add `isolatedDeclarations`.
- Naming: identifiers and constructor/config option bags are camelCase; snake_case
  only for names that mirror Python or the wire and for query-option bags mirroring Python
  keyword arguments 1:1 (`namingConvention()` in `eslint.config.js`, `tests/naming-config-bags.test.ts`).
- Comments explain why, never when/who; Python provenance by dotted symbol
  (`@see mixpanel_headless.workspace.Workspace.list_dashboards`), never line
  numbers; deliberate differences are `// Divergence:` + a PORTING.md entry.
  Test titles are English; the Python name goes in a trailing `// python: test_x`
  comment (lint-enforced). Full style guide in CONTRIBUTING.md.
- Scratch notes go in `.notes/` (git-ignored); run records in `GATE.md` / `RUN.md`.
  Commit as `type(scope): subject`; mechanical changes in their own commit.
- Agents: `.claude/` is git-ignored and excluded from lint/format/tests; create
  worktrees **outside** the repo (`git worktree add ../mp-ts-<name> -b <branch>`), never under `.claude/`.
