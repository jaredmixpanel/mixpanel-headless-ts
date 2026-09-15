# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A TypeScript port of the Python `mixpanel_headless` library (checkout expected at
`../mixpanel-headless`), built around a verification rig rather than a from-scratch
rewrite: a conformance corpus extracted from the Python implementation is replayed
against the TS port, a cross-language differential oracle is fuzzed against the
Python one, and vendored JSON-schema referees check payload shapes.

The human-facing documents are the source of truth for conventions and are kept
current — read them before changing anything non-trivial:

- `CONTRIBUTING.md` — toolchain pins, layout, the gate, generated files, corpus
  refresh, comment/docstring style, test and commit conventions.
- `PORTING.md` — the pinned Python revision, naming rules, every known
  behavioural divergence (with its TS symbol), what the corpus and oracle prove.
- `docs/history/` — the port's archived process record (frozen); its README has
  a reading order and a glossary of the identifiers (`R9.1`, `B6-W2`, `P2-4`,
  `TS-5`, `D11–D16`, `AIE-nnn`) older commits and comments still cite. Never
  add new references to them; Python provenance is a dotted symbol name only.
- `conformance-runner/GATE.md` / `differential/oracle/RUN.md` — dated run
  records; `scripts/README.md` — every script, its inputs and npm alias.

Remote: `github.com/jaredmixpanel/mixpanel-headless-ts` (private); CI
(`.github/workflows/ci.yml`) runs `npm run check` on Node 22 and 24.

## Commands

Developing needs Node ^22.22.2 or >= 24.15 (root `engines`, `engine-strict`);
the packages themselves run on >= 22.12. Install with `npm ci` (lockfile-exact).

- `npm run check` — **the repo gate**, in order: `tsc -b` (root solution file —
  also the build), `pack:check` (publint + attw on each package's `npm pack`
  tarball), knip, eslint, `prettier --check`, full vitest run (including the
  corpus replay and `tests/package-consumption.test.ts`, which packs and
  installs the three tarballs — `MP_SKIP_PACK_TEST=1` skips it locally),
  browser-bundle smoke. Run before committing.
- `npm run build` / `npm run typecheck` — both `tsc -b`: builds the three
  packages into their `dist/` (gitignored) and type-checks every test, rig and
  script project. `npm run clean` = `tsc -b --clean`. After toggling a flag in
  `tsconfig.lib.json`, run `npx tsc -b --force` once.
- `npm run lint` — `eslint . --max-warnings 0` (typed, ~20 s). Every rule is
  `error` or `off` with a reason, never `warn`. Rules still being hand-applied
  are parked `off` in the delimited `// --- Phase 4 lane L<n>` blocks near the
  end; `MP_LINT_UNPARK=L5` (or `all`) drops a block for one run — and the fixer
  must run with the lane unparked too, or it deletes that lane's disable
  directives as unused. The ignore list lives once in
  `scripts/lib/lint-ignores.mjs` (`tests/ignore-lists.test.ts` syncs `.prettierignore`).
- `npm run knip` (unused exports/types are warnings until the un-export sweep);
  `npm run fmt` / `fmt:check` — Prettier owns formatting.
- `npm test` — vitest across all workspaces (CI parity, corpus included).
  `vitest.config.ts` defines one project per tree (`core`, `node`, `browser`,
  `rig`, `corpus`, `differential`, `repo`): `npm run test:fast` = everything
  but the corpus replay, `npm run test:corpus` = only it, one workspace:
  `npx vitest run --project node`, one file:
  `npx vitest run conformance-runner/test/runner.test.ts`.
- `npm run conformance -- --report json [--filter "compat/"]` — corpus replay
  CLI (filter = vector-id substring). Run it after any change under
  `packages/core/src` and confirm 0 `FAIL_*`.
- `npm run oracle` — oracle-ts (stdin/stdout line protocol), normally spawned by
  the Python fuzz harness as `--right "node .../scripts/run-oracle.mjs"`.
- `npm run sync:corpus` (`MP_PYTHON_REPO`, `MP_RIG_BRANCH`) — re-snapshot the
  corpus; `npm run vendor:drift` (`ANALYTICS_ROOT`) — vendored-contract
  integrity; `npm run audit:comments` — comment-archaeology scan.
- Generators: `npm run generate:all` (error-codes, api-map, bridge-allowlist),
  `npm run generate:compat-tables` (the three CPython-pinned tables, needs `uv`).

## Layout (npm workspaces)

| Workspace            | Purpose                                                                     |
| -------------------- | --------------------------------------------------------------------------- |
| `packages/core`      | Isomorphic port — zero Node deps                                            |
| `packages/node`      | Node-only surface (config files, env, OAuth callback, fs seams)             |
| `packages/browser`   | Browser-only surface (CredentialStore, redirect PKCE) — same purity as core |
| `conformance-runner` | Replays the Python-extracted vector corpus (private)                        |
| `differential`       | oracle-ts stdio bridge + ajv bookmark-schema referee (private)              |
| `scripts/`, `tests/` | Generators/launchers/audits (see `scripts/README.md`); repo-level tests     |

Cross-workspace imports use the bare specifiers `@mixpanel-headless/core`,
`@mixpanel-headless/core/internal` (rig/platform plumbing, **not semver-stable**),
`@mixpanel-headless/node`, `@mixpanel-headless/conformance-runner` — never a
relative path (only exception: node/browser _tests_ reach
`packages/core/test-support/`). Package `exports` point at `dist/`; vitest, the
esbuild launchers and the browser smoke map the specifiers back to `src/` via
`scripts/lib/workspace-aliases.mjs`, so a stale `dist/` never shadows the code
under test. `packages/core/src/index.ts` is an explicit named list (no
`export *`), `src/internal.ts` the rest; `tests/core-public-surface.test.ts`
locks "nothing `@internal` reachable from `.`" (`stripInternal` is deliberately
off — see `tsconfig.lib.json`). tsconfig chain: `tsconfig.base.json` ←
`tsconfig.lib.json` (composite, `isolatedDeclarations`) ← `packages/*/tsconfig.json`
(+ `tsconfig.test.json`); rig/scripts/root tests are `noEmit` reference projects.

## Core-purity boundary

`packages/core` and `packages/browser` must not import Node built-ins (`node:*`,
`fs`, `path`, `os`) or `undici`, and must not read `process` — configuration is
injected. Enforced by eslint (`no-restricted-imports`/`globals`) and by
`scripts/browser-smoke.mjs` (esbuild for `platform: "browser"`, fails on any
Node dependency in the graph). Node-specific code belongs in `packages/node`.

## Conformance rig

- `conformance-runner/corpus/` is a **committed snapshot** pinned by `sourceCommit`
  in `corpus.config.json` (sync aborts on mismatch). Never hand-edit corpus files.
- `src/runner.ts` dispatches vectors to the bindings in `src/bindings.ts` (wire
  vectors via `src/wire-*.ts` + `vector-fetch.ts`). Verdicts: `PASS`, `FAIL_OUTPUT`,
  `FAIL_REQUEST`, `FAIL_ERROR`, `PRECISION_LOSS`, `UNPORTED`, `UNMAPPED_API`.
- Python↔TS naming: generated `src/api-map.gen.ts` + `src/naming-exceptions.json`
  - `src/authored-apis.json`; the generator fails hard on unmapped names.
- Python-parity semantics live in `packages/core/src/compat/`; equality goes
  through `src/canonical.ts` and the order-preserving `lossless-json.ts`.

## Generated files — never hand-edit

Regenerate instead (full table with inputs and freshness tests in CONTRIBUTING.md):

- `conformance-runner/src/api-map.gen.ts` ← `npm run generate:api-map` (byte-exact test)
- `packages/core/src/errors-codes.gen.ts` ← `npm run generate:error-codes` (byte-exact test)
- `conformance-runner/bridge-allowlist.gen.json` ← `npm run generate:bridge-allowlist` (byte-exact test)
- `packages/core/src/compat/{non-printable,decimal-digits,whitespace}.gen.ts` ←
  `npm run generate:compat-tables` (no freshness test yet; parity tests only)
- `packages/core/test/compat/fixtures/canonical-fixtures.json` ← `scripts/generate-canonical-fixtures.py` + `npm run fmt`
- `vendor/**` — vendored verbatim with sha256 provenance (`PROVENANCE.json`); re-vendor, don't patch.

## Conventions

- tsconfig is strict everywhere (`strict`, `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature` — use
  `obj["key"]` — `erasableSyntaxOnly` — no `enum`/`namespace` —
  `verbatimModuleSyntax`, NodeNext, `es2023`); library builds add `isolatedDeclarations`.
- Naming (D1): identifiers, private members and constructor/config option
  bags are camelCase; snake_case only for names that mirror Python or the wire
  (entity/result/param fields, bookmark params, error `details`, on-disk
  records) and for query-option bags that mirror Python keyword arguments 1:1.
  Object-literal keys are unconstrained. Enforced by `namingConvention()` in
  `eslint.config.js` (snake_case scopes are listed there by file) and
  `tests/naming-config-bags.test.ts`; README "Naming" is the user-facing rule.
- Comments explain why, never when/who; Python provenance by dotted symbol
  (`@see mixpanel_headless.workspace.Workspace.list_dashboards`), never line
  numbers; deliberate differences are marked `// Divergence:` and listed in
  PORTING.md. Full style guide in CONTRIBUTING.md.
- Task-scoped scratch notes go in `.notes/` (git-ignored); durable run records
  go in `GATE.md` / `RUN.md`. Commit as `type(scope): subject`; mechanical
  changes in their own commit.
