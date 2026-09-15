# Contributing

This repository is the TypeScript port of the Python
[`mixpanel_headless`](https://github.com/mixpanel/mixpanel-headless) library,
built around a verification rig: a corpus of test vectors extracted from the
Python implementation is replayed against the port, and a cross-language
differential oracle fuzzes the two implementations against each other.
[`PORTING.md`](PORTING.md) records the Python revision the port tracks, the
known divergences, and what the corpus and oracle do and do not prove. The
port's process record is archived under [`docs/history/`](docs/history/README.md).

## Getting started

```bash
git clone git@github.com:jaredmixpanel/mixpanel-headless-ts.git
cd mixpanel-headless-ts
npm ci          # lockfile-exact; engine-strict, see "Toolchain pins"
npm run check   # the gate: build, packaging, lint, format, tests, browser smoke
```

`npm run check` takes a few minutes the first time (it packs and installs the
three package tarballs; `MP_SKIP_PACK_TEST=1 npm run check` skips that step
locally). A Python checkout of `mixpanel-headless` next to this repository
(`../mixpanel-headless`) is needed only for corpus refreshes and oracle runs.

### Toolchain pins

- **Two Node floors.** The published packages run on Node ≥ 22.12
  (`packages/*/package.json` `engines`; the conformance rig's request-side
  float twin needs `JSON.rawJSON`, which arrived in Node 21). _Developing_ the
  repository needs **Node ^22.22.2 or ≥ 24.15** — the strictest dev dependency
  (`eslint-plugin-jsdoc` 64) requires it — so the root `package.json` `engines`
  carries the higher floor, `.node-version` pins the 22 line, and `.npmrc`'s
  `engine-strict=true` turns a wrong Node into one clear `npm ci` error rather
  than a confusing per-package failure mid-install. CI runs Node 22 and 24.
- **`typescript` is pinned `~6.0.3`, not `^`.** TypeScript 7 is `latest` on
  npm, but typescript-eslint's peer range is `<6.1.0`, so a casual
  `npm i -D typescript` would break `npm run lint`. Move the pin when
  typescript-eslint (and TypeDoc) support TS 7.
- Everything else floats within its caret range; Dependabot
  (`.github/dependabot.yml`) proposes bumps. The lockfile is authoritative —
  CI fails if `npm ci` rewrites it.

## Layout

npm workspaces; every package is ESM-only (`"type": "module"`).

| Workspace            | Purpose                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core`      | `@mixpanel-headless/core` — the isomorphic port: `Workspace` facade, query builders, result models, errors. Zero Node deps.          |
| `packages/node`      | `@mixpanel-headless/node` — config files, env, OAuth login with a localhost callback, token storage, fs seams.                       |
| `packages/browser`   | `@mixpanel-headless/browser` — bearer-token and redirect-PKCE auth over an injected `CredentialStore`; same purity boundary as core. |
| `conformance-runner` | Replays the committed Python-extracted vector corpus against the port (private; not published).                                      |
| `differential`       | oracle-ts, the stdio bridge the Python fuzz harness drives, plus the ajv bookmark-schema referee (private).                          |
| `scripts/`           | Generators, launchers, codemods and audits — see [`scripts/README.md`](scripts/README.md).                                           |
| `tests/`             | Repo-level tests that own no workspace (public-surface lock, package consumption, ignore-list sync, browser bundle).                 |
| `vendor/`            | Contract artefacts vendored verbatim with sha256 provenance (`vendor/mixpanel-contracts/PROVENANCE.json`).                           |
| `docs/history/`      | The port's archived process record. Frozen; see its README.                                                                          |

Cross-workspace imports use the bare specifiers `@mixpanel-headless/core`,
`@mixpanel-headless/core/internal` (rig and platform-package plumbing, **not
semver-stable**), `@mixpanel-headless/node` and — from `differential` —
`@mixpanel-headless/conformance-runner`. Never import another workspace by
relative path; the one sanctioned exception is node/browser _tests_ reaching
`packages/core/test-support/`. `scripts/codemods/rewrite-workspace-imports.mjs --check`
audits this.

The packages' `exports` maps point at `dist/`. Everything that executes
TypeScript from source — vitest, the two esbuild launchers, the browser smoke —
maps the bare specifiers back to `src/` through the one alias table in
`scripts/lib/workspace-aliases.mjs`, so a stale `dist/` can never shadow the
code under test.

### Purity boundary

`packages/core` and `packages/browser` must not import Node built-ins
(`node:*`, `fs`, `path`, `os`) or `undici`, and must not read the `process`
global; configuration is injected (a `fetch`, a `Storage`-shaped store, an env
reader). Enforced twice: `no-restricted-imports` / `no-restricted-globals` in
`eslint.config.js`, and `scripts/browser-smoke.mjs`, which bundles both entry
points for `platform: "browser"` and fails on any Node dependency in the graph.
Node-specific code belongs in `packages/node`.

### TypeScript configuration

`tsconfig.base.json` holds the shared strict flags: `strict`,
`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
`noPropertyAccessFromIndexSignature` (use `obj["key"]` for index-signature
reads), `noUnusedLocals` / `noUnusedParameters`, `noImplicitOverride`,
`noImplicitReturns`, `erasableSyntaxOnly` (no `enum` / `namespace`; use
`as const` objects and literal unions), `verbatimModuleSyntax`, NodeNext
modules, target/lib `es2023`. `tsconfig.lib.json` adds the composite library
build (`declaration`, `declarationMap`, `sourceMap`, `isolatedDeclarations` —
every exported binding needs an explicit type unless trivially inferable).
Each package has `tsconfig.json` (`rootDir: src`, `outDir: dist`) and
`tsconfig.test.json` (`noEmit`, references the build). The root
`tsconfig.json` is the solution file `tsc -b` drives. After toggling a flag in
`tsconfig.lib.json`, run `npx tsc -b --force` once; incremental builds have
been seen to miss `isolatedDeclarations` diagnostics.

`stripInternal` is deliberately off (reasons in `tsconfig.lib.json`); the
boundary the repo actually wants — nothing tagged `@internal` reachable from a
package's `"."` entry — is enforced by `tests/core-public-surface.test.ts`.

## The gate

`npm run check` runs these in order; CI (`.github/workflows/ci.yml`) runs the
same script on Node 22 and 24 and adds a lockfile-freshness check and a
conformance-report artifact. Run it before every commit.

| Step                | Command                                                                     | What it proves                                                                                                                                                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build + typecheck   | `tsc -b` (`npm run typecheck`, also `npm run build`)                        | The three packages compile into `dist/` under the strict flags above with `isolatedDeclarations`; every test, rig and script project type-checks against the built declarations.                                                                                                            |
| Package correctness | `npm run pack:check` (`publint --strict`, `attw --pack --profile esm-only`) | Each package's `npm pack` tarball has a coherent `exports` map, ships its types, and resolves correctly for ESM consumers.                                                                                                                                                                  |
| Dead code           | `npm run knip`                                                              | No unused files or dependencies. Unused exports/types are reported as warnings until the un-export sweep lands. <!-- TODO(final-pass): flip knip `exports`/`types` rules back to error after the Phase 6 un-export sweep. -->                                                               |
| Lint                | `npm run lint` (`eslint . --max-warnings 0`)                                | Typed, exhaustive lint; every rule is `error` or `off` with a reason, never `warn` (asserted when the config loads). Includes the purity boundary and import ordering. Rules still being hand-applied are parked in delimited lane blocks; `MP_LINT_UNPARK=<lane>` shows one lane's errors. |
| Format              | `npm run fmt:check`                                                         | Prettier owns all formatting (`npm run fmt` to apply). Generated and vendored paths are excluded through the one list in `scripts/lib/lint-ignores.mjs`.                                                                                                                                    |
| Tests               | `npm test` (`vitest run`)                                                   | All workspace unit tests; the full conformance corpus (`conformance-runner/test/corpus.test.ts`); generated-file freshness tests; the public-surface lock; the ignore-list sync; and `tests/package-consumption.test.ts`, which packs and installs the three tarballs.                      |
| Browser smoke       | `npm run smoke:browser`                                                     | `packages/core` and `packages/browser` bundle for `platform: "browser"` with no Node built-in in the graph, and the bundle exposes the required exports.                                                                                                                                    |

Not yet in `check`: `npm run vendor:drift` (sha256 integrity of the vendored
contracts; byte-diff against the analytics checkout when `ANALYTICS_ROOT` is
set) and `npm run audit:comments` (the comment-archaeology scan).
<!-- TODO(final-pass): the planned end state of the gate (docs/history/cleanup-plan-2026-09.md §14) also lists coverage thresholds, `vitest --typecheck`, vitest projects (so `npm test` can skip the corpus locally), the archaeology guard and vendor drift wired into `check`. Update this table when Phases 5–7 land. -->

If you changed anything under `packages/core/src`, also run the corpus CLI
and confirm zero `FAIL_*` verdicts:

```bash
npm run conformance -- --report json     # summary on stderr, JSON report on stdout
npm run conformance -- --report json --filter "bookmarks/"   # vector-id substring filter
```

## Generated files — never hand-edit

Every generated artefact has a generator; regenerate instead of editing. Where
a byte-exact freshness test exists it fails on a hand edit.

| Artefact                                                     | Generator / command                                                                                 | Inputs                                                                                                                                                        | Freshness test                                                                                                                         |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `conformance-runner/src/api-map.gen.ts`                      | `npm run generate:api-map` (`scripts/generate-api-map.mjs`)                                         | `conformance-runner/corpus/{api-index,typescript-port-api-map}.json`, `conformance-runner/src/{naming-exceptions,authored-apis}.json`                         | `conformance-runner/test/api-map.test.ts` — sha256 stamps of all four inputs + parity with `src/naming.ts`                             |
| `packages/core/src/errors-codes.gen.ts`                      | `npm run generate:error-codes` (`scripts/generate-error-codes.mjs`; `--check` for a dry diff)       | `conformance-runner/corpus/contract/error-codes.json`                                                                                                         | `conformance-runner/test/error-codes-registry.test.ts` — regenerate-and-diff, plus registry equality against the live `errors.ts`      |
| `conformance-runner/bridge-allowlist.gen.json`               | `npm run generate:bridge-allowlist` (`scripts/generate-bridge-allowlist.mjs`)                       | Corpus wire vectors, `api-index.json`, `api-map.gen.ts`, `scripts/{bridge-allowlist-rules,consent-verbs,route-verbs}.json`                                    | `conformance-runner/test/bridge-allowlist.test.ts` — byte-identical regeneration (the two moving stamps excluded)                      |
| `packages/core/src/compat/non-printable.gen.ts`              | `uv run --no-project python scripts/generate-non-printable.py`                                      | The host CPython's `str.isprintable()` (header records CPython 3.14.6 / Unicode 16.0.0)                                                                       | **None.** `packages/core/test/compat/python-str.test.ts` asserts parity on pinned cases, not byte freshness.                           |
| `packages/core/src/compat/decimal-digits.gen.ts`             | `uv run --no-project python scripts/generate-decimal-digits.py`                                     | The host CPython's `int(ch)` per codepoint                                                                                                                    | **None.**                                                                                                                              |
| `packages/core/src/compat/whitespace.gen.ts`                 | `uv run --no-project python scripts/generate-whitespace.py`                                         | The host CPython's `str.isspace()` / `int()` whitespace acceptance                                                                                            | **None.** `python-strip.test.ts` consumes the table.                                                                                   |
| `packages/core/test/compat/fixtures/canonical-fixtures.json` | `uv run --no-project python scripts/generate-canonical-fixtures.py`, then `npm run fmt`             | A deterministic sample of corpus `builder` vectors rendered by CPython `json.dumps`                                                                           | Parity only (`python-json-dumps-canonical.test.ts`); its provenance header currently names the previous corpus pin.                    |
| `conformance-runner/corpus/**`                               | `npm run sync:corpus` (`scripts/sync-corpus.sh`)                                                    | The Python checkout's `conformance/vectors/**`, `conformance/contract/*.json`, `conformance/schema/canonical-selftest.json`; the api-map from `docs/history/` | Pin gate inside the script (`corpus.config.json` `sourceCommit` must equal the source manifest); `corpus.test.ts` replays every vector |
| `vendor/mixpanel-contracts/**`                               | Re-vendor per `vendor/mixpanel-contracts/README.md`; `PROVENANCE.json` records source path + sha256 | The analytics checkout (`ANALYTICS_ROOT`, read-only)                                                                                                          | `npm run vendor:drift` (integrity always; byte-diff when the checkout is mounted) — not in `check`                                     |

`npm run generate:all` runs the three Node generators in dependency order
(error-codes, api-map, then bridge-allowlist). The Python generators run
against a specific CPython: the headers they emit record the interpreter and
Unicode version, and they must be re-run (and committed) only when the port's
target CPython is upgraded.
<!-- TODO(final-pass): Phase 7 adds byte-exact freshness tests for the three compat tables and a pin check for the canonical-fixtures provenance; update the "Freshness test" column when they land. -->

### Refreshing the corpus

The corpus is a committed snapshot pinned by `sourceCommit` in
`conformance-runner/corpus.config.json`. Never edit corpus files.

1. In the Python checkout, land the change and re-extract the corpus so its
   manifest's `source_commit` is the commit you want to track.
2. Update `sourceCommit` in `conformance-runner/corpus.config.json` to that
   commit.
3. `MP_PYTHON_REPO=../mixpanel-headless npm run sync:corpus`. The script
   aborts if the source manifest's pin differs from step 2. If the Python
   working tree is dirty in a copied path, the copy is taken from a read-only
   worktree of `MP_RIG_BRANCH` (default `main`) instead.
4. `npm run generate:all` (the api-map and error-codes inputs live in the
   corpus), then `npm run check`. Fix `FAIL_*` verdicts in the port, or record
   a new divergence in `PORTING.md` if the Python behaviour is one the port
   deliberately does not follow.
5. Commit the corpus snapshot separately from hand-written changes, and add a
   row to `conformance-runner/GATE.md` with the new pin and totals.

## Comments and docstrings

1. **Comments explain _why_, never _when_ or _who_.** No batch, shard, packet,
   ticket, reviewer or date references in code. History lives in git and in
   `docs/history/`.
2. **Provenance is a symbol, not a line number.** Reference Python as
   `@see mixpanel_headless.workspace.Workspace.list_dashboards`, never as
   `workspace.py:4506-4536`. The Python revision the port tracks is recorded
   once, in `corpus.config.json` and `PORTING.md`.
3. **Every exported symbol has a TSDoc block.** The first sentence states the
   behaviour in the imperative ("Return the …", "Resolve the …"). Then, as
   needed: `@remarks` for non-obvious semantics; `@param name - description`
   (units, constraints, defaults — never the type); `@returns`;
   `@throws {@link ErrorClass}` for each deliberate throw; `@example` for
   anything with more than one parameter or a non-trivial return shape; `@see`
   last. `@defaultValue` on optional properties. `@internal` only on symbols
   not reachable from the package's `"."` entry. Custom tags are declared in
   `tsdoc.json`.
4. **Module headers** are three to eight lines: purpose, ownership boundary,
   one `@see`. Entry points use `@packageDocumentation`.
5. **Rationale that would surprise a competent reader stays**; narration of
   what the next line obviously does goes. Prefer a well-named helper to a
   comment.
6. **No shouting.** No ALL-CAPS words for emphasis, no `!!!`.
7. **Divergences from Python** are marked `// Divergence: <one line>` at the
   site and listed in `PORTING.md`. A `TODO` names an owner or links an issue.
8. **Section dividers** are plain (`// --- Dashboards ---`), never ownership
   markers.
9. **`eslint-disable`** always carries `-- <reason>`; `@ts-expect-error` always
   carries a description; neither appears in library source without a linked
   issue or a one-line justification.

`npm run audit:comments` reports comments and test titles that still carry
process identifiers; `npm run audit:comments:fix -- --dry-run` previews the
mechanical rewrites (see `scripts/audit/README.md`).

## Tests

- `describe` names the unit under test; `it` states the behaviour in plain
  English ("rejects a redirect URI without a scheme"). When a test mirrors a
  Python test, the Python name goes in a trailing comment
  (`// python: test_rejects_missing_scheme`), never in the title. Test-file
  headers say what is under test and what is additive relative to the Python
  suite, in at most five lines.
- Shared helpers live in `packages/core/test-support/` (`createMockClient`,
  `mockWorkspaceClient`, `makeSession`, `fakeTransport`, `asyncIterableOf`,
  `drain`, …). Assert throws with `expectThrows` / `expectRejects` from
  `test-support/raises.ts` (the `pytest.raises` twins: they return the thrown
  value so the `toBeInstanceOf` / `.code` assertions sit after the call, never
  inside a `catch`); a bare `toThrow()` with no message matcher is a lint
  error.
- Prefer `toStrictEqual`; `toEqual` is reserved for the few sites that compare
  across prototypes on purpose.
- Platform-conditional tests use `it.skipIf(condition)`, not a hand-rolled
  `const itPosix = …`.
- Never mutate `process.env` or `HOME` directly in a test; use `vi.stubEnv`
  (restored automatically) so a failing test cannot leak state into the next.
  <!-- TODO(final-pass): Phase 7 converts the remaining direct `process.env` writes in packages/node/test to `vi.stubEnv`; drop this sentence's hedging once done. -->
- Property-based tests (`fast-check`) go in `*.pbt.test.ts` and must be
  reproducible: a failure report carries the seed; pin it in the fix.
- Generated-file freshness tests regenerate and byte-compare; when you change a
  generator, regenerate and commit the output in the same change.

Running subsets:

```bash
npx vitest run packages/node                          # one workspace
npx vitest run conformance-runner/test/runner.test.ts # one file
npx vitest run -t "rejects a redirect"                # by title
npx tsc -b packages/core/tsconfig.test.json           # type-check one package's tests
```

<!-- TODO(final-pass): Phase 7 introduces vitest projects; document `vitest run --project <name>` and the local `npm test` (without the corpus) once they exist. -->

## Running the differential oracle

oracle-ts (`differential/oracle/main.ts`) speaks the line protocol the Python
fuzz harness drives. From the Python checkout:

```bash
uv run python -m conformance.differential.fuzz_harness \
  --right "node ../mixpanel-headless-ts/scripts/run-oracle.mjs" \
  --examples 500 --seed <seed> --report json
```

Both bridges must report the same `source_commit` (the corpus pin). A run
that matters — a re-pin, a change to a shared builder, a fixed divergence —
gets a dated entry in `differential/oracle/RUN.md` with the seed, totals and
the reason it was run. `npm run referee:bookmark` runs the ajv bookmark-schema
referee over the recorded `build_params` payloads.

## Commits and pull requests

- Conventional messages: `type(scope): subject` — `feat`, `fix`, `refactor`,
  `docs`, `test`, `chore`, `ci`; scope is a workspace or area
  (`core`, `node`, `browser`, `rig`, `scripts`, `lint`). Imperative subject,
  body explains why.
- Mechanical changes (codemods, `eslint --fix`, regenerated files, corpus
  snapshots) go in their own commit, separate from hand edits, and are
  labelled `mechanical` in the PR.
- A refactor PR states the conformance numbers before and after
  (`npm run conformance -- --report json` summary) and, when it touches a
  shared builder, the oracle run it was checked against.
- A PR that changes behaviour relative to Python adds a `// Divergence:`
  marker and a `PORTING.md` row in the same change.
- The gate must be green locally before pushing; CI runs the same script.
- Scratch notes for a task go in `.notes/` (git-ignored); durable run records
  go in `conformance-runner/GATE.md` / `differential/oracle/RUN.md`.

## Publishing

The three packages carry `"private": true`. They are built as publishable
ESM-only packages (`publishConfig.access = "public"`, provenance enabled) and
pass `publint` / `attw` on every gate run, but publishing is the owner's
decision: removing the `"private": true` line from each `packages/*/package.json`
is the one-line flip.
<!-- TODO(final-pass): Phase 9 adds the release process (Changesets + trusted publishing); link it here. -->
