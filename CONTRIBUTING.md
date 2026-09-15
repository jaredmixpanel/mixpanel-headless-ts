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
npm run check   # the gate: build, packaging, lint, format, archaeology, vendor, tests, browser smoke
```

`npm ci` also installs the git hooks (`lefthook.yml`: eslint + prettier on the
staged files at commit, typecheck + `npm run test:fast` before push;
`LEFTHOOK=0 git commit` skips them once). They are a fast subset, not the gate.

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
- **`typedoc` is pinned `~0.28.20` and `vitepress` `~1.6`.** TypeDoc is 0.x,
  so a minor is its breaking bump and its TypeScript range moves per minor;
  VitePress 2 is alpha. Dependabot ignores minors and majors for both
  (`.github/dependabot.yml`); bump them by hand with a docs build.
- Everything else floats within its caret range; Dependabot
  (`.github/dependabot.yml`) proposes bumps. The lockfile is authoritative —
  CI fails if `npm ci` rewrites it.
- `.npmrc` sets `min-release-age=7`: npm resolves only to releases at least a
  week old, the same cooldown Dependabot applies, so an `npm install` and a
  Dependabot PR never disagree about a version (and `fund=false`).

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
| `docs/`              | The documentation site (VitePress + TypeDoc); see "Documentation". `docs/reference/` is generated and git-ignored.                   |
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
been seen to miss `isolatedDeclarations` diagnostics. To build from clean use
`npm run clean` (`tsc -b --clean`), which removes `dist/` and the
`*.tsbuildinfo` files together — deleting `dist/` by hand leaves the build info
claiming the packages are built, and the next `tsc -b` fails the test projects
with TS6305 instead of re-emitting.

`stripInternal` is deliberately off (reasons in `tsconfig.lib.json`; the last
trial produced 407 `tsc -b` errors, all in white-box test projects that read
`@internal` members through the built declarations); the boundary the repo
actually wants — nothing tagged `@internal` reachable from a
package's `"."` entry — is enforced by `tests/core-public-surface.test.ts`.

## The gate

`npm run check` runs these in order; CI (`.github/workflows/ci.yml`) runs the
same script on Node 22 and 24. Run it before every commit.

| Step                | Command                                                                     | What it proves                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Build + typecheck   | `tsc -b` (`npm run typecheck`, also `npm run build`)                        | The three packages compile into `dist/` under the strict flags above with `isolatedDeclarations`; every test, rig and script project type-checks against the built declarations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Package correctness | `npm run pack:check` (`publint --strict`, `attw --pack --profile esm-only`) | Each package's `npm pack` tarball has a coherent `exports` map, ships its types, and resolves correctly for ESM consumers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Dead code           | `npm run knip`                                                              | No unused files, dependencies, exports or types (`exports` / `types` at error level; an interface or type alias used only in its own module's exported signatures is exempt, because declaration emit needs it exported). Not `--strict` — `knip.jsonc` says why.                                                                                                                                                                                                                                                                                                                                                                                            |
| Lint                | `npm run lint` (`eslint . --max-warnings 0` under a 4 GB V8 heap)           | Typed, exhaustive lint (peaks near 2 GB of heap, the default on an 8 GB CI runner, hence the explicit limit); every rule is `error` or `off` with a reason, never `warn` (asserted when the config loads). Covers the purity boundary, import ordering, per-file size caps, the naming convention, the jsdoc/tsdoc content rules (every exported symbol documented, `@example` on classes and exported functions, `@throws` on deliberate throws) and the English-title rule for tests.                                                                                                                                                                      |
| API reference       | `npm run docs:api:check` (`typedoc --emit none --treatWarningsAsErrors`)    | The three public barrels convert under TypeDoc with `notExported`, `invalidLink`, `notDocumented` and `rewrittenLink` on and zero warnings: every type a public signature names is exported, every `{@link}` resolves, nothing exported is undocumented. Writes nothing (`docs:api` is the emitting twin).                                                                                                                                                                                                                                                                                                                                                   |
| Format              | `npm run fmt:check`                                                         | Prettier owns all formatting (`npm run fmt` to apply). Generated and vendored paths are excluded through the one list in `scripts/lib/lint-ignores.mjs`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Comment archaeology | `npm run audit:comments -- --summary`                                       | No comment or test title carries a port-process identifier (batch/task ids, `foo.py:123` citations, shard/packet vocabulary); any hit is exit 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Vendor integrity    | `npm run vendor:drift`                                                      | Every file under `vendor/mixpanel-contracts/` matches the sha256 in its `PROVENANCE.json`; with `ANALYTICS_ROOT` set it also byte-diffs each file against the analytics checkout.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Tests + coverage    | `npm run test:coverage` (`vitest run --coverage`, every project)            | All workspace unit tests; the type-level tests (`*.test-d.ts`, vitest's typecheck inside the `core` and `browser` projects); the full conformance corpus (`conformance-runner/test/corpus.test.ts`); generated-file freshness and provenance tests; the public-surface lock; the ignore-list sync; and `tests/package-consumption.test.ts`, which packs and installs the three tarballs (`MP_SKIP_PACK_TEST=1` skips it locally). Global v8 coverage floors over `packages/*/src` (generated tables and pure barrels excluded): lines 88 / statements 88 / functions 90 / branches 82 — set two points under the measured suite; raise by hand, never lower. |
| Browser smoke       | `npm run smoke:browser`                                                     | `packages/core` and `packages/browser` bundle for `platform: "browser"` with no Node built-in in the graph, and the bundle exposes the required exports.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

CI adds what an npm script cannot: the Node 22 / 24 matrix, lockfile
freshness (`git diff --exit-code package-lock.json` after `npm ci`), and the
coverage and conformance-report artifacts. `release.yml` runs the same
`check` before anything is versioned or published.

If you changed anything under `packages/core/src`, also run the corpus CLI
and confirm zero `FAIL_*` verdicts:

```bash
npm run conformance -- --report json     # summary on stderr, JSON report on stdout
npm run conformance -- --report json --filter "bookmarks/"   # vector-id substring filter
```

## Generated files — never hand-edit

Every generated artefact has a generator; regenerate instead of editing. Where
a byte-exact freshness test exists it fails on a hand edit.

| Artefact                                                     | Generator / command                                                                                       | Inputs                                                                                                                                                                                                                  | Freshness test                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `conformance-runner/src/api-map.gen.ts`                      | `npm run generate:api-map` (`scripts/generate-api-map.mjs`)                                               | `conformance-runner/corpus/{api-index,typescript-port-api-map}.json`, `conformance-runner/src/{naming-exceptions,authored-apis}.json`                                                                                   | `conformance-runner/test/api-map.test.ts` — sha256 stamps of all four inputs + parity with `src/naming.ts`                                                                                                                                                                                                   |
| `packages/core/src/errors-codes.gen.ts`                      | `npm run generate:error-codes` (`scripts/generate-error-codes.mjs`; `--check` for a dry diff)             | `conformance-runner/corpus/contract/error-codes.json`                                                                                                                                                                   | `conformance-runner/test/error-codes-registry.test.ts` — regenerate-and-diff, plus registry equality against the live `errors.ts`                                                                                                                                                                            |
| `conformance-runner/bridge-allowlist.gen.json`               | `npm run generate:bridge-allowlist` (`scripts/generate-bridge-allowlist.mjs`)                             | Corpus wire vectors, `api-index.json`, `api-map.gen.ts`, `scripts/{bridge-allowlist-rules,consent-verbs,route-verbs}.json`                                                                                              | `conformance-runner/test/bridge-allowlist.test.ts` — byte-identical regeneration (the two moving stamps excluded)                                                                                                                                                                                            |
| `packages/core/src/compat/non-printable.gen.ts`              | `npm run generate:compat-tables` (`scripts/generate-non-printable.py` through `uv run --python <pin>`)    | The pinned CPython's `str.isprintable()` per codepoint                                                                                                                                                                  | `tests/generated-tables-provenance.test.ts` — the header names the interpreter and Unicode version of `scripts/compat-python.pin.json` and the generator's sha256, its counts match the body, and the npm script names the pinned interpreter; body parity in `packages/core/test/compat/python-str.test.ts` |
| `packages/core/src/compat/decimal-digits.gen.ts`             | `npm run generate:compat-tables` (`scripts/generate-decimal-digits.py`, same pin)                         | The pinned CPython's `int(ch)` per codepoint                                                                                                                                                                            | Same provenance test; body parity in the `compat/` tests                                                                                                                                                                                                                                                     |
| `packages/core/src/compat/whitespace.gen.ts`                 | `npm run generate:compat-tables` (`scripts/generate-whitespace.py`, same pin)                             | The pinned CPython's `str.isspace()` / `int()` whitespace acceptance                                                                                                                                                    | Same provenance test; body parity in `python-strip.test.ts`                                                                                                                                                                                                                                                  |
| `packages/core/test/compat/fixtures/canonical-fixtures.json` | `npm run generate:canonical-fixtures` (`scripts/generate-canonical-fixtures.py`, same pin, then Prettier) | A deterministic sample of corpus `builder` vectors rendered by CPython `json.dumps`                                                                                                                                     | Same provenance test — pinned interpreter, generator sha256, corpus pin equal to `corpus.config.json` `sourceCommit`, row count and per-row sha256; parity in `python-json-dumps-canonical.test.ts`                                                                                                          |
| `scripts/lib/python-reference-anchors.gen.json`              | `npm run generate:python-anchors` (`-- --check` for a dry diff)                                           | The Python checkout (`MP_PYTHON_REPO`, default `../mixpanel-headless`) at the corpus pin: a detached worktree, `uv run --offline --extra docs mkdocs build`, then every `id="mixpanel_headless.…"` on its `api/*` pages | `tests/python-reference-anchors.test.ts` pins the corpus pin and generator sha256 the header records; the plugin links only listed anchors                                                                                                                                                                   |
| `conformance-runner/corpus/**`                               | `npm run sync:corpus` (`scripts/sync-corpus.sh`)                                                          | The Python checkout's `conformance/vectors/**`, `conformance/contract/*.json`, `conformance/schema/canonical-selftest.json`; the api-map from `docs/history/`                                                           | Pin gate inside the script (`corpus.config.json` `sourceCommit` must equal the source manifest); `corpus.test.ts` replays every vector                                                                                                                                                                       |
| `vendor/mixpanel-contracts/**`                               | Re-vendor per `vendor/mixpanel-contracts/README.md`; `PROVENANCE.json` records source path + sha256       | The analytics checkout (`ANALYTICS_ROOT`, read-only)                                                                                                                                                                    | `npm run vendor:drift` in `check` (integrity always; byte-diff when the checkout is mounted)                                                                                                                                                                                                                 |

`npm run generate:all` runs the three Node generators in dependency order
(error-codes, api-map, then bridge-allowlist). The four Python generators run
through `uv run --python <pin>`; the pin is `scripts/compat-python.pin.json`
(CPython 3.14.6 / Unicode 16.0.0) and `scripts/gen_provenance.py` makes each
generator refuse any other interpreter and stamp its own sha256 into the
header it emits. Re-run them, and commit the output, only when the port's
target CPython is upgraded: update the pin first, then regenerate all four.

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

`npm run audit:comments` (in the gate as `-- --summary`) fails on any comment
or test title that carries a process identifier; `npm run audit:comments:fix -- --dry-run`
previews the mechanical rewrites the tool knows (see `scripts/audit/README.md`).

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
- Property-based tests (`fast-check`) go in `*.pbt.test.ts` and must be
  reproducible: a failure report carries the seed; pin it in the fix.
- Generated-file freshness tests regenerate and byte-compare; when you change a
  generator, regenerate and commit the output in the same change.

`vitest.config.ts` defines one project per test tree: `core`, `node`,
`browser`, `rig` (the conformance runner's own tests), `corpus` (the vector
replay, one `it` per vector), `differential` and `repo` (`tests/`). `npm test`
runs them all (CI parity); the corpus replay is the slow one.

```bash
npm run test:fast                                     # every project but the corpus
npm run test:corpus                                   # only the corpus replay
npx vitest run --project node                         # one project
npx vitest run conformance-runner/test/runner.test.ts # one file
npx vitest run -t "rejects a redirect"                # by title
npx tsc -b packages/core/tsconfig.test.json           # type-check one package's tests
```

Type-level tests (`*.test-d.ts`: `expectTypeOf`, `@ts-expect-error`) sit next
to the runtime tests and run inside the `core` and `browser` projects through
vitest's typecheck; their `tsconfig.test-d.json` includes `src/` directly, so
a stale `dist/` can never satisfy an assertion.

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

## Documentation

The site at <https://jaredmixpanel.github.io/mixpanel-headless-ts/> is built
from `docs/` by [VitePress](https://vitepress.dev/) with the API reference
generated by [TypeDoc](https://typedoc.org/) (`typedoc.json` at the root,
`entryPointStrategy: "packages"` over the three `packages/*/typedoc.json`,
each documenting its `src/index.ts` only; `@mixpanel-headless/core/internal`
is not documented). Node and browser re-export core symbols; those re-exports
are treated as external (`externalPattern` covers `packages/*/dist`), so each
package documents only its own symbols and links across to core's pages.
`scripts/lib/typedoc-link-fallbacks.mjs` (registered in `typedoc.json`)
resolves the two link shapes TypeDoc cannot on its own because TypeScript
parses `@throws {@link X}` without a link node: a bare `{@link ConfigError}`
in node or browser docs resolves to core's one export of that name, and
`{@link TypeError}` and other JS builtins resolve to MDN through
typedoc-plugin-mdn-links. Neither the TSDoc grammar the linter enforces nor
TypeDoc's accepts the other's cross-package or global-scope spelling, so the
sources keep the plain `{@link Name}` form.
Two sibling plugins shape the core reference: `typedoc-barrel-groups.mjs`
groups and orders it by the `// --- … ---` sections of
`packages/core/src/index.ts` (so a new section divider is also a new
reference group), and `typedoc-python-see-links.mjs` links every
`@see mixpanel_headless.…` tag to the Python site. It links only anchors
the generated `scripts/lib/python-reference-anchors.gen.json` lists (a
member the Python page leaves out links its object; `_internal` names stay
text), so regenerate that file when the corpus pin moves.

| Path                                                                                       | What it is                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/index.md`, `docs/getting-started/`, `docs/guide/`, `docs/api/`, `docs/architecture/` | Hand-written pages. Frontmatter `title` and `description`; the description is the page's line in `llms.txt`.                                                                                                                                                                                                                                            |
| `docs/.vitepress/config.mts`                                                               | Nav and sidebar, `base` from `DOCS_BASE`, the twoslash compiler options, the llms and tabs plugins. Reads the sidebar JSON TypeDoc writes into `docs/reference/`.                                                                                                                                                                                       |
| `docs/.vitepress/theme/`                                                                   | The default theme plus the Mixpanel palette (`mixpanel.css`, ported from the Python site), the code themes (`shiki-mixpanel-*.json`: GitHub themes with the brand token colours on top) and the copy-as-Markdown buttons above every page. Plain TypeScript, no Vue SFC. `docs/public/og.png` is the social-preview image (Pillow-rendered brand card). |
| `docs/reference/`                                                                          | Generated by `npm run docs:api`; git-ignored, never edited, on the shared ignore list (`scripts/lib/lint-ignores.mjs`) with `docs/.vitepress/{dist,cache}/`.                                                                                                                                                                                            |
| `docs/history/`                                                                            | The frozen process record; excluded from the site (`srcExclude`).                                                                                                                                                                                                                                                                                       |

Commands (all root npm scripts; `scripts/README.md` lists them too):

- `npm run docs:dev` — `tsc -b`, TypeDoc, then the dev server with hot reload.
- `npm run docs:build` — the same, then `vitepress build docs` into
  `docs/.vitepress/dist/` (the site, `llms.txt`, `llms-full.txt`, and a
  Markdown twin next to every page); `npm run docs:preview` serves that.
- Code blocks use twoslash's static `rendererRich` (CSS hover popups), not
  `@shikijs/vitepress-twoslash`'s floating-vue renderer. Measured on the full
  site (24 pages, ~890 twoslash blocks): floating-vue emits a Vue component
  per hover, which needed 6 GB of V8 heap (8.1 GB RSS) for half as many
  blocks and fails under Node's default ~4 GB; the static renderer builds
  the whole site in the default heap at 3.5 GB RSS in 42 s. The static
  renderer was chosen while the repository was private (8 GB runners); the
  public repository's 16 GB runners would also fit floating-vue (hover UI
  with smarter placement), which remains the alternative. The
  static popups get `position: fixed` in `mixpanel.css` so the code block's
  horizontal scroll cannot clip them. Twoslash results are cached under
  `docs/.vitepress/cache/twoslash/` (keyed by snippet text, so wipe it after
  changing the compiler options); that makes rebuilds faster, not smaller.
- Size follow-ups, accepted and not fixed here: the local search index skips
  `reference/**` (`search.options._render`; the 807 generated pages had
  grown it to 5.7 MB, it is 1.25 MB without them), and `dist/reference` is
  still ~343 MB because VitePress renders the whole sidebar tree, collapsed
  groups included, into every page and core's ~800-item tree cannot be split
  by path (core is grouped by `@group` across the kind directories). The
  fix is either per-group output directories from TypeDoc or a sidebar item
  that renders collapsed children lazily.
- `npm run docs:api` regenerates the reference; `npm run docs:api:check`
  validates it without writing (`--emit none --treatWarningsAsErrors`, with
  `notExported`, `invalidLink`, `notDocumented` and `rewrittenLink` on).
  The check runs in `npm run check` right after `lint`; `docs:api` itself
  still emits with warnings, so a docblock regression never blocks a site
  build, only the gate.

Writing a page:

- Frontmatter, one `#` heading, then `##` / `###`. Links between pages are
  root-relative without extension (`/guide/query-funnels`,
  `/reference/core/classes/Workspace`); VitePress fails the build on a dead
  link. Admonitions are `::: tip` / `info` / `warning` / `danger`;
  `::: code-group` pairs a TypeScript and a Python block; `:::tabs` (from
  vitepress-plugin-tabs) is for prose tabs.
- Runnable examples are ``ts twoslash```` blocks. VitePress compiles each
one when the site is built, against the packages' _built_ declarations
(`dist/`, reached through the workspace symlinks in `node_modules`, which
is why `docs:build` runs `tsc -b` first) with `module: NodeNext`,
`strict` and the DOM libs. Import from `@mixpanel-headless/node`, `core` or
`browser` exactly as a consumer would; top-level `await` works; a type
error fails the build and hover types render in the site. Fragments that
are deliberately partial stay plain ``ts````. Never put real
  credentials in a snippet.
- Prettier formats `docs/**/*.md` (`npm run fmt`). Documentation changes need
  no changeset.

`.github/workflows/docs.yml` runs `npm run docs:build` on every push to
`main`, every pull request and on dispatch (the site is a downloadable
artifact on pull requests) and deploys to GitHub Pages from `main`, then
checks every URL in the deployed `llms.txt`. `DOCS_BASE` is derived from the
repository name there (`/mixpanel-headless-ts/`); a custom domain later means
dropping the variable, not editing the config. Pages is enabled with source
"GitHub Actions"; the site is at https://jaredmixpanel.github.io/mixpanel-headless-ts/.
If Pages were ever disabled, the build would still run and only the deploy
job would fail.

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
- A PR that changes a published package adds a changeset (`npx changeset`;
  see "Releasing").
- The gate must be green locally before pushing; CI runs the same script.
- Scratch notes for a task go in `.notes/` (git-ignored); durable run records
  go in `conformance-runner/GATE.md` / `differential/oracle/RUN.md`.

## Releasing

Versions and changelogs are managed by
[Changesets](https://github.com/changesets/changesets) (`.changeset/config.json`):
the three packages form one `fixed` group and release in lockstep, the two
rig workspaces are ignored, and `packages/*/CHANGELOG.md` are the release
notes (the root `CHANGELOG.md` only points at them).

1. A pull request that changes a published package adds a changeset:
   `npx changeset`, pick the bump (`patch` / `minor`; `major` only once 1.0
   is out), write the release-note line, commit the generated
   `.changeset/*.md` with the change.
2. On every push to `main`, `.github/workflows/release.yml` runs the gate and
   then `changesets/action`. With unreleased changesets present it opens or
   refreshes a "Version Packages" PR (`npm run version` = `changeset version`:
   bumps the three manifests, rewrites the `^` ranges between them, folds
   the changesets into the changelogs). With none pending it runs
   `npm run release` = `changeset publish`, which publishes every package
   whose version is not on the registry yet.
3. Merging the "Version Packages" PR therefore publishes. `changeset publish`
   runs `npm publish` per package with provenance (`publishConfig` in each
   manifest) through npm trusted publishing: the workflow's `id-token: write`
   permission and its `npm` deployment environment; no token secret exists.

**Publishing is a no-op today.** The three manifests carry `"private": true`,
which `changeset publish` skips; the version flow still runs
(`privatePackages.version` is on), so changesets accumulate into changelogs
meanwhile. Turning releases on is the owner's flip:

1. Remove the `"private": true` line from `packages/core/package.json`,
   `packages/node/package.json` and `packages/browser/package.json`.
2. On npmjs.com, create the `@mixpanel-headless` organisation and add a
   trusted publisher to each of the three packages: GitHub Actions,
   repository `jaredmixpanel/mixpanel-headless-ts`, workflow `release.yml`,
   environment `npm`. If npm still requires a package to exist before a
   trusted publisher can be attached, publish `0.1.0` once by hand
   (`npx changeset publish` from a logged-in machine) and configure the
   publisher afterwards. Protect the `npm` environment in the repository
   settings (required reviewers) if a human should approve each publish.
3. Merge to `main`. With no changeset pending, the publish step releases the
   `0.1.0` already in the manifests; from then on every release goes through
   a "Version Packages" PR.
