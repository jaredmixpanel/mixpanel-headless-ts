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

Node >= 22 required (the conformance rig's request-side float twin uses
`JSON.rawJSON`, absent before Node 21; CI runs 24). Install with `npm ci`
(lockfile-exact).

- `npm run check` — **the repo gate**: per-workspace `tsc --noEmit`, eslint,
  `prettier --check`, full vitest run, browser-bundle smoke. Run before committing.
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
- Generators (see "Generated files" below): `npm run generate`,
  `npm run generate:error-codes`, `npm run generate:api-map`.

## Layout (npm workspaces)

| Workspace            | Purpose                                                                              |
| -------------------- | ------------------------------------------------------------------------------------ |
| `packages/core`      | Isomorphic port — zero Node deps (R9.1)                                              |
| `packages/node`      | Node-only surface (config files, env, OAuth callback, fs seams)                      |
| `packages/browser`   | Browser-only surface (CredentialStore, redirect PKCE) — same purity boundary as core |
| `conformance-runner` | Replays the Python-extracted vector corpus (D12/D13)                                 |
| `differential`       | oracle-ts stdio bridge (D14) + ajv bookmark-schema referee (D15a)                    |

There is **no build step**: `tsc` runs `--noEmit`, vitest executes TS directly, and
the two CLIs (`scripts/run-conformance.mjs`, `scripts/run-oracle.mjs`) esbuild-bundle
their entry point into `dist/` on each invocation.

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
- `differential/src/generated/**` ← `npm run generate` (json2ts from vendored schema)
- `vendor/**` — vendored verbatim with sha256 provenance (`PROVENANCE.json`); re-vendor, don't patch.

## Conventions

- tsconfig is strict everywhere: `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, NodeNext modules.
- Task-scoped scratch notes go in `.notes/` (see `.notes/ts5-scratch.md` for the
  pattern); durable run records go in `GATE.md` / `RUN.md`.
- Environment overrides for scripts: `MP_PYTHON_REPO` (Python checkout path),
  `MP_RIG_BRANCH` (corpus sync branch), `ANALYTICS_ROOT` (vendor drift source,
  read-only).
