# mixpanel-headless-ts — Cleanup & Hardening Plan

**Date:** 2026-09-14
**Status:** Executed 2026-09-14/15 on branch cleanup/2026-09; see CONTRIBUTING.md for the resulting conventions
**Goal:** Prepare the repository for review, installation, and contribution by
outside engineers. The bar is "a thoughtfully, professionally engineered
codebase that is rigorously maintained for collaborative, team-based
engineering": clean structure, readable code, concise and valuable comments,
exhaustive docstrings, rigorous typing, exhaustive and fully-enforced lint, and
proper packaging.

This document is the single source of truth for the cleanup effort. It is
ordered so that each phase leaves the gate (`npm run check`) green and each
later phase is _verifiable_ by tooling introduced in an earlier one.

---

## Table of contents

0. [How this plan was produced](#0-how-this-plan-was-produced)
1. [Executive summary](#1-executive-summary)
2. [Baseline measurements](#2-baseline-measurements)
3. [Decisions that need an owner call](#3-decisions-that-need-an-owner-call)
4. [Phase 0 — Hygiene quick wins](#4-phase-0--hygiene-quick-wins-½-day)
5. [Phase 1 — Toolchain upgrade and pinning](#5-phase-1--toolchain-upgrade-and-pinning-1-day)
6. [Phase 2 — TypeScript configuration hardening](#6-phase-2--typescript-configuration-hardening-1-2-days)
7. [Phase 3 — Packaging and module boundaries](#7-phase-3--packaging-and-module-boundaries-3-5-days)
8. [Phase 4 — Exhaustive, fully-enforced lint](#8-phase-4--exhaustive-fully-enforced-lint-2-3-days)
9. [Phase 5 — Comment and docstring overhaul](#9-phase-5--comment-and-docstring-overhaul-5-8-days)
10. [Phase 6 — Structural refactors](#10-phase-6--structural-refactors-8-12-days)
11. [Phase 7 — Test suite quality and coverage](#11-phase-7--test-suite-quality-and-coverage-2-3-days)
12. [Phase 8 — Correctness and security findings](#12-phase-8--correctness-and-security-findings-1-2-days)
13. [Phase 9 — Repository documentation, CI, and process](#13-phase-9--repository-documentation-ci-and-process-2-3-days)
14. [The gate after this plan](#14-the-gate-after-this-plan)
15. [Sequencing, PR slicing, and effort](#15-sequencing-pr-slicing-and-effort)

- [Appendix A — Reproducing the measurements](#appendix-a--reproducing-the-measurements)
- [Appendix B — File hotlist](#appendix-b--file-hotlist)
- [Appendix C — Lint trial results by rule](#appendix-c--lint-trial-results-by-rule)
- [Appendix D — Comment style guide (to adopt)](#appendix-d--comment-style-guide-to-adopt)
- [Appendix E — Sources](#appendix-e--sources)

---

## 0. How this plan was produced

1. **Best-practice research** (2026-09-14) against official documentation for
   TypeScript 5.9/6.0/7.0, typescript-eslint 8, ESLint 10, Vitest 5, knip 6,
   publint, arethetypeswrong, TSDoc/api-extractor, npm 12, Changesets 3, and
   GitHub Actions. Package versions and peer/engine constraints were verified
   with `npm view` on the day. See Appendix E.
2. **Baseline measurement** of the repository as of commit `90cd19f`:
   the existing gate, timing, dependency audit, knip, a trial run of
   typescript-eslint `strictTypeChecked` + `stylisticTypeChecked` plus ~25
   extra rules, and a trial `tsc` run with every stricter compiler flag.
3. **Six parallel reviews**, each with `file:line` evidence: core (two
   halves), node + browser + packaging, rig + scripts + CI + docs,
   a compiler-API-driven docstring/comment audit, and the research above.
   Every claim carried into this plan that could be spot-checked in source
   was spot-checked.

Nothing was modified in the repository while producing this plan.

The six full review reports, the compiler-API audit scripts, and the raw
typed-lint trial output are kept (git-ignored) under
`.notes/cleanup-audit-2026-09-14/` for anyone executing this plan.

---

## 1. Executive summary

**The good news.** The code is far more disciplined than "rapidly developed
with AI" suggests. Across ~110k lines of hand-written TypeScript there are
zero `any`, zero `@ts-ignore`, six `@ts-expect-error` (all in negative-type
tests), 13 `eslint-disable` lines (most justified), and only 19 non-null
assertions in library source. JSDoc is present on 99.9% of 7,239 exported
symbols. The typed-lint trial found **zero** floating or misused promises.
The gate runs in under a minute (typecheck 8 s, lint 4 s, 11,162 tests in
10 s) and is green. The verification rig (conformance corpus, differential
oracle, schema referees) is a genuine differentiator.

**The five problems an outside engineer hits first, in order:**

1. **The packages cannot be installed or imported by name.** `core` and
   `node` have no `exports`/`main`/`types`; `browser` points `exports` at a
   `.ts` file; all three are `private`; there is no build; 142 imports in
   `packages/` and ~120 in the rig reach across packages via
   `../../core/src/…`. `packages/node` and `packages/browser` only type-check
   today because `@types/node` leaks in transitively through vitest's
   typings. The README's `npm install @mixpanel-headless/node` is not yet
   true.
2. **Comments are an internal audit trail, not documentation.** 4,330
   references to internal process identifiers (`B6-W2`, `R9.1`, `P2-4`,
   `b9-packets.md §0.4`, `arbiter`, `watchlist #13`, `QA 2026-08-17`) on
   3,497 comment lines across 494 of 512 files, plus ~2,100 references to
   Python source _line numbers_ (`workspace.py:4506-4536`) that rot on the
   next Python commit. 42% of core source lines are comments. Only ~11% of
   tagged comment paragraphs carry rationale; the rest is provenance. Several
   headers are now false ("lands in TS-5", "everything replays as UNPORTED").
   Test titles are Python identifiers (`it("test_verifier_length_is_86_chars")`).
3. **Lint is not exhaustive.** The config is `recommended` only, not
   type-aware. Turning on `strictTypeChecked` + `stylisticTypeChecked`
   surfaces 7,576 findings (≈4,900 autofixable), including a small number of
   real defects: 36 `no-base-to-string` (`String(unknown)` → `[object
Object]`), 7 string spreads that mishandle astral code points, one
   `throw` of a non-Error, several non-exhaustive switches.
4. **Structure has a few god files and one systemic typing hole.**
   `workspace.ts` is 7,093 lines (218 members, 145 alias imports);
   41 source files exceed 800 lines; 24 functions exceed 200 lines. The 125
   hand-written entity classes each declare their fields three times and
   carry two `as unknown as` casts apiece (241 of core's 273 such casts).
   There are 29 import cycles (mostly type-only) and ~9 duplicated helper
   families. knip reports 4 unused files, 36 unused export groups, 31 unused
   types.
5. **Repository presentation is stale.** No LICENSE, CONTRIBUTING,
   SECURITY, CODEOWNERS, `.editorconfig`, `.node-version`, `.npmrc`. Four
   tracked `.DS_Store` files. Personal absolute paths in two scripts, two run
   records, and shipped rig source. README says Node ≥ 20 and "3,262
   vectors"; `engines` says ≥ 22 and the current corpus is 3,453. CI still
   guards against a corpus snapshot that has existed since August. Four dev
   dependency vulnerabilities (two fixable in place).

**Tooling landscape that shapes the plan (verified 2026-09-14):**

| Tool              | Installed   | Latest                                | Constraint                                                                               |
| ----------------- | ----------- | ------------------------------------- | ---------------------------------------------------------------------------------------- |
| typescript        | 5.9.3       | 7.0.2                                 | TS 7 ships no compiler API; typescript-eslint peer is `<6.1`. **Pin `~6.0.3`.**          |
| eslint            | 9.39.5      | 10.10.0                               | ESLint 9 is end-of-life (Aug 2026). Move to 10. `eslint-plugin-unicorn` 74 needs ≥ 10.4. |
| typescript-eslint | 8.66.0      | 8.70.0                                | Supports ESLint 8/9/10.                                                                  |
| vitest            | 3.2.7       | 5.0.0                                 | Vitest 5 needs Node ≥ 22.12. Has the `@vitest/mocker` advisory fix.                      |
| @types/node       | 20.19.43    | 26.x                                  | Should track lowest `engines` major → `^22`.                                             |
| esbuild           | 0.25.12     | 0.28.2                                | Scripts target `node20`; should be `node22`.                                             |
| knip              | —           | 6.35.1                                | depcheck is deprecated in favour of knip.                                                |
| Node              | 24.18 local | 24 = Active LTS, 22 = Maintenance LTS | Set `engines` to `>=22.12`.                                                              |

**Effort.** Roughly 25–40 engineer-days end to end, but the work is highly
parallelisable after Phases 0–4 (≈5 days) land, and the first three phases
alone remove the "cannot install / looks generated" first impression.

---

## 2. Baseline measurements

All numbers are from commit `90cd19f` on 2026-09-14. Reproduction commands are
in Appendix A.

### 2.1 Size and shape

| Metric                                                        | Value                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------- |
| Tracked files (excl. corpus, vendor, context)                 | 567                                                     |
| Hand-written source files (packages/*/src, rig, differential) | 227 (110,340 lines; mean 486, median 277)               |
| Test files                                                    | 274 (~111k lines)                                       |
| Source files > 500 / > 800 / > 1000 / > 1500 / > 2000 lines   | 73 / 41 / 29 / 14 / 4                                   |
| Largest file                                                  | `packages/core/src/workspace.ts` — 7,093 lines          |
| Functions > 100 / > 200 / > 300 lines                         | 67 / 24 / 15                                            |
| Core public barrel surface                                    | 778 symbols (433 value, 345 type); 48 `export *` edges  |
| Browser barrel                                                | 126 symbols (102 re-exported from core)                 |
| Node barrel                                                   | 15 symbols (many public classes unreachable)            |
| Import cycles (madge)                                         | 29 (24 are `client/client.ts ↔ services/**`, type-only) |
| Git history                                                   | 177 commits, 2026-08-14 → 2026-09-14                    |

### 2.2 Gate and tooling

| Check                             | Result                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`               | pass, 7.9 s                                                                                                                           |
| `npm run lint` (recommended only) | pass, 4.2 s                                                                                                                           |
| `npm test`                        | 266 files, 11,162 passed, 1 skipped, 10.9 s wall                                                                                      |
| `npm audit`                       | 4 vulnerabilities (2 high: `fast-uri`, `js-yaml` — fix available in place; 2 moderate: `vitest`/`@vitest/mocker` — fixed in Vitest 5) |
| Coverage provider                 | none installed; no thresholds                                                                                                         |
| Stray test stdout                 | one line (`packages/node/test/auth-effects-bag.test.ts:210`)                                                                          |

### 2.3 Typing rigor

| Metric                                 | Source                                                       | Tests                         |
| -------------------------------------- | ------------------------------------------------------------ | ----------------------------- |
| `any`                                  | 0                                                            | 0                             |
| `@ts-ignore` / `@ts-nocheck`           | 0                                                            | 0                             |
| `@ts-expect-error`                     | 0                                                            | 6 (negative-type tests, fine) |
| `eslint-disable`                       | 6                                                            | 3 (+ generated/dist)          |
| Non-null assertions (`!`)              | 19 (8 in `bookmarks/schema-sorting.ts`)                      | 626                           |
| `as unknown as`                        | ≈340 (241 are entity-model boilerplate; 29 in `bindings.ts`) | —                             |
| `as never`                             | 19 (14 in `workspace-query-params.ts`)                       | —                             |
| `Record<string, unknown>`              | ≈950                                                         | —                             |
| Exported functions without return type | 0                                                            | —                             |

### 2.4 Stricter `tsc` flags (errors if enabled today)

| Flag                                                                                                                                       | core                     | node | browser | rig | differential                     |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | ---- | ------- | --- | -------------------------------- |
| `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `allowUnusedLabels:false` | 0                        | 0    | 0       | 0   | 0                                |
| `allowUnreachableCode: false`                                                                                                              | 1                        | 0    | 0       | 0   | 0                                |
| `noPropertyAccessFromIndexSignature`                                                                                                       | 93 (84 in tests)         | 9*   | 9*      | 9*  | 9*                               |
| `erasableSyntaxOnly`                                                                                                                       | 7 (all `types/enums.ts`) | 7*   | 7*      | 7*  | 34 (generated json2ts file) + 7* |
| `isolatedDeclarations` (core only)                                                                                                         | 50 (41 × TS9010)         | —    | —       | —   | —                                |

\* the same core files, reached transitively.

### 2.5 Typed-lint trial (strictTypeChecked + stylisticTypeChecked + extras)

7,576 findings; 2,321 in `packages/core/src`, 4,029 in `packages/core/test`,
588 in `conformance-runner/src`. About 4,900 are autofixable. Full table in
Appendix C. Real-defect categories in source: `no-base-to-string` 26,
`no-unnecessary-condition` 52, `no-misused-spread` 7, `switch-exhaustiveness-
check` 6, `unbound-method` 6, `no-unsafe-*` 7, `only-throw-error` 1,
`require-array-sort-compare` 1.

### 2.6 Documentation

| Metric                                                             | Value                                                                                                                                        |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Exported symbols with any JSDoc                                    | 99.9% (7,234 / 7,239)                                                                                                                        |
| Top-level exported functions with all `@param` documented          | 99.5%                                                                                                                                        |
| … with `@returns`                                                  | 94.6%                                                                                                                                        |
| … with `@throws`                                                   | 48.7% (core `types/results` 22%, `replays` 3%)                                                                                               |
| … with `@example`                                                  | 7.9% (entity classes 0.1%, result classes 0.3%)                                                                                              |
| Description ≥ 10 words: classes / functions / interface properties | 97% / 72% / 9%                                                                                                                               |
| Comment lines as share of source (core / node / browser)           | 42% / 42% / 51%                                                                                                                              |
| Process-identifier references (all scope)                          | 4,330 occurrences, 3,497 lines, 494 / 512 files                                                                                              |
| … by kind                                                          | `Bn` 1,469 · `Rn.n` 1,402 · "packet" 519 · `bN-packets.md` 301 · `phaseN` 246 · `Pn-n` 171 · `D1n` 120 · `TS-n` 51 · `AIE-n` 12 · QA dates 6 |
| … carrying rationale (paragraph-level heuristic)                   | ≈11%                                                                                                                                         |
| Python line-number references (`.py:NNN`)                          | 1,706 in source, 914 in tests                                                                                                                |
| `TODO(port)` disclosures                                           | 19 in source (genuine; keep, relocate)                                                                                                       |
| Commented-out code                                                 | effectively none                                                                                                                             |
| Test titles that are Python identifiers                            | e.g. 257 / 433 `it()` titles in `packages/node/test`                                                                                         |

### 2.7 Dead code (knip 6.35, vendor/generated ignored)

- Unused files: `differential/oracle/main.ts` (it is the esbuild entry; needs
  knip `entry`), `packages/core/src/replays/index.ts`,
  `packages/core/src/services/index.ts` (barrels the public index never
  wires in).
- 36 unused export groups (e.g. the `*_LITERAL_VALUES` tuples in
  `bookmarks/schema.ts`, `buildFunnelParams`/`buildRetentionParams`,
  `pythonUnquote` duplicated in core _and_ node).
- 31 unused exported types (mostly `*Options` interfaces in `services/`).
- `differential/src/generated/reports/bookmark.ts` (1,207 lines, `npm run
generate`) is imported by nothing.

---

## 3. Decisions that need an owner call

These change the shape of later phases. Recommendations are given; the plan
below assumes the recommendation unless noted.

| #   | Decision                                                                                                                                                                                                                          | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Why it matters                                                                                                        |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| D1  | **Option-bag key casing.** The `Workspace` facade takes snake_case option keys (`{ retention_days, cdn_concurrency }`: 106 snake vs 4 camel), `MixpanelClientOptions` is camelCase, and `errors.ts:210` states the opposite rule. | Keep snake_case for _wire/contract_ fields (entity model fields, bookmark params, error `details`) and for query-option bags that mirror Python keyword arguments 1:1 (the README markets Python migration). Convert _constructor/config_ option bags and all private identifiers to camelCase. Write the rule down once (README "Naming" section + `types/index.ts` module doc) and enforce it with `@typescript-eslint/naming-convention` scoped by directory. | Converting facade query options is a breaking API change; deferring it is defensible, leaving it undocumented is not. |
| D2  | **TypeScript version.**                                                                                                                                                                                                           | Pin `typescript` to `~6.0.3` until typescript-eslint/TypeDoc support TS 7 (expected 7.1). Do not float `^5`.                                                                                                                                                                                                                                                                                                                                                     | TS 7 is `latest` on npm; a casual `npm i -D typescript` breaks lint.                                                  |
| D3  | **Node floor.**                                                                                                                                                                                                                   | `engines.node = ">=22.12"`; `.node-version` = `22`; CI matrix 22 + 24; `@types/node ^22`; esbuild target `node22`.                                                                                                                                                                                                                                                                                                                                               | Vitest 5, eslint-plugin-jsdoc 64 and others require ≥ 22.12; README currently says 20.                                |
| D4  | **Publishing intent.** Are `@mixpanel-headless/{core,node,browser}` going to npm (public), a private registry, or git-installed only?                                                                                             | Build them as publishable ESM-only packages regardless; keep `private: true` until a release process exists. Add `publint` + `attw` to the gate now.                                                                                                                                                                                                                                                                                                             | Determines whether Phase 3 adds Changesets + trusted publishing or stops at "installable from a git checkout".        |
| D5  | **`context/` (3.7 MB, 173 files) at repo root.**                                                                                                                                                                                  | Move to `docs/history/` with a README and reading order; move `context/blog/` out of the repo. Keep the Prettier/ESLint ignores.                                                                                                                                                                                                                                                                                                                                 | Outsiders see phase1–4 directories and an HTML blog draft with no entry point.                                        |
| D6  | **Rig-internal exports.** The conformance runner imports ~100 core internals by relative path.                                                                                                                                    | Add a `@mixpanel-headless/core/internal` subpath export (not documented as stable) and move `types/vector-codecs.ts` into the rig.                                                                                                                                                                                                                                                                                                                               | Alternative is TS `paths` aliases, which do not survive a build.                                                      |
| D7  | **Test titles.** ~60% of `it()` titles are Python test identifiers.                                                                                                                                                               | Rename to English behaviour statements; keep the Python name in a trailing comment or a `// python: test_x` tag. Mechanical but large.                                                                                                                                                                                                                                                                                                                           | Traceability vs. readability; reviewers will flag `it("test_frozen")`.                                                |
| D8  | **Comment provenance policy.**                                                                                                                                                                                                    | Strip process identifiers entirely; keep the Python _symbol_ name (`@see mixpanel_headless.workspace.Workspace.list_dashboards`), never line numbers; record the Python commit once in `corpus.config.json` and `PORTING.md`.                                                                                                                                                                                                                                    | The alternative (a glossary that makes `R9.1` resolvable) preserves noise.                                            |
| D9  | **`noPropertyAccessFromIndexSignature`.**                                                                                                                                                                                         | Enable it (93 fixes, 84 in tests) and set `@typescript-eslint/dot-notation` with `allowIndexSignaturePropertyAccess: true`.                                                                                                                                                                                                                                                                                                                                      | Makes `obj["key"]` a deliberate signal for index signatures and removes 3,511 lint hits at once.                      |
| D10 | **Entity-model generation.** 125 classes × triple field declaration.                                                                                                                                                              | Make `EntityModel` generic and derive `XInit` from `fieldSpecs` (no codegen) — Phase 6. Revisit codegen only if a Python-side schema export becomes available.                                                                                                                                                                                                                                                                                                   | Largest single typing hole; codegen would add a generator to maintain.                                                |

---

## 4. Phase 0 — Hygiene quick wins (½ day)

Zero-risk changes that fix the first-glance impression. One PR.

| #    | Task                                                                                                                                                                                                                                                                       | Files                                                                                                                                                                                                                                                                                                      | Acceptance                                                   |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 0.1  | Untrack `.DS_Store` files (`git rm --cached`); keep the `.gitignore` rule.                                                                                                                                                                                                 | `packages/core/.DS_Store`, `packages/core/src/.DS_Store`, `packages/core/src/services/.DS_Store`, `packages/core/src/types/.DS_Store`                                                                                                                                                                      | `git ls-files \| grep DS_Store` is empty                     |
| 0.2  | Remove personal absolute paths. Scripts: env-var only, fail with a helpful message when unset. Rig source: delete the hard-coded fallback (the corpus always contains the file). Docs: relative paths.                                                                     | `scripts/sync-corpus.sh:37`, `scripts/check-vendor-drift.sh:7,18`, `conformance-runner/src/selftest-path.ts:29`, `conformance-runner/GATE.md:32`, `differential/oracle/RUN.md:141,171,208`, `vendor/mixpanel-contracts/README.md:5` (+ `PROVENANCE.json` if it embeds a path — re-vendor, don't hand-edit) | `git grep -n "/Users/"` is empty                             |
| 0.3  | Add `LICENSE` (the browser bundle banner already asserts "Copyright Mixpanel, Inc."; pick the licence and make the banner match).                                                                                                                                          | root                                                                                                                                                                                                                                                                                                       | present; `license` field in every package.json               |
| 0.4  | Add `.editorconfig` (utf-8, lf, final newline, 2 spaces), `.node-version` (`22`), `.npmrc` (`engine-strict=true`, `save-exact=false`).                                                                                                                                     | root                                                                                                                                                                                                                                                                                                       | present                                                      |
| 0.5  | Fix Node-version statements: README badge (line 4), table (≈62), Requirements (≈754) → ≥ 22.12; esbuild `target: "node22"` in `scripts/run-conformance.mjs:23` and `scripts/run-oracle.mjs:26`; root `package.json` `engines` → `>=22.12`.                                 | README, scripts, package.json                                                                                                                                                                                                                                                                              | one consistent number everywhere                             |
| 0.6  | Fix README parity numbers ("3,262 conformance vectors" at lines 15 and 748 → current 3,453/0/0, or "3,400+" with a pointer to `differential/oracle/RUN.md`).                                                                                                               | README                                                                                                                                                                                                                                                                                                     | matches RUN.md                                               |
| 0.7  | Root `package.json` `description` ("Phase 1 verification rig scaffold") → a real one-liner; add `repository`, `license`, `keywords` to all package.json files.                                                                                                             | package.json ×6                                                                                                                                                                                                                                                                                            | —                                                            |
| 0.8  | Remove the stray test stdout (`effects.narrate("sweep: narrate wired")` should assert on a captured sink, not print).                                                                                                                                                      | `packages/node/test/auth-effects-bag.test.ts:210`                                                                                                                                                                                                                                                          | `npm test` prints only the reporter                          |
| 0.9  | `npm audit fix` for `fast-uri` and `js-yaml` (in-place fixes available); the vitest advisory is closed by Phase 1.                                                                                                                                                         | package-lock.json                                                                                                                                                                                                                                                                                          | `npm audit` shows only the vitest pair, then 0 after Phase 1 |
| 0.10 | Delete `differential/src/generated/reports/bookmark.ts`, the `generate` script, and the `json-schema-to-typescript` devDependency (nothing imports the output; the referee validates with ajv against the JSON schema directly). Update CLAUDE.md's generated-files table. | differential, package.json, CLAUDE.md                                                                                                                                                                                                                                                                      | knip and grep confirm no consumer                            |
| 0.11 | Fix the `sync-corpus.sh` default branch (`ts-port/phase2-contract-support` → `main`) and replace its history-lesson header with usage.                                                                                                                                     | `scripts/sync-corpus.sh:11-20,41`                                                                                                                                                                                                                                                                          | —                                                            |

---

## 5. Phase 1 — Toolchain upgrade and pinning (1 day)

Do this before touching lint or tsconfig so later phases are built on the
supported versions.

| #   | Task                                                                                                                                                                                                                                                                                                                                                  | Notes                                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1.1 | `typescript` → `~6.0.3` (pinned tilde; see D2). Run the gate; TS 6.0 changed defaults (`strict`, `module: esnext`, floating `target`, `types: []`, `noUncheckedSideEffectImports: true`) — our base config sets most of these explicitly, so expect few surprises. Deprecations that error in 7.0 (`baseUrl`, `moduleResolution: node`) are not used. | Add a comment in `package.json` (via `"//"` key or CONTRIBUTING) explaining the pin. |
| 1.2 | `eslint` → `^10.10`, `@eslint/js` → `^10`, `typescript-eslint` → `^8.70`. Rewrite `eslint.config.js` with `defineConfig`/`globalIgnores` from `eslint/config` (Phase 4 does the rule work; this step only ports the existing config).                                                                                                                 | ESLint 10 removes eslintrc entirely.                                                 |
| 1.3 | `vitest` → `^5.0`, add `@vitest/coverage-v8@^5`. Migration notes: `clearMocks` defaults to true, `vi.mock` must be top-level, un-awaited `expect(...).resolves` fails, `.vitest/` output dir (add to `.gitignore`).                                                                                                                                   | Closes the `@vitest/mocker` advisory.                                                |
| 1.4 | `@types/node` → `^22` (matches the engines floor; do not track latest). `esbuild` → `^0.28`. `smol-toml` → `^1.8` (or document why it is exact-pinned).                                                                                                                                                                                               | `npm outdated` clean except intentional pins.                                        |
| 1.5 | Add devDependencies used by later phases: `globals`, `eslint-plugin-import-x`, `eslint-plugin-n`, `eslint-plugin-unicorn`, `eslint-plugin-regexp`, `@vitest/eslint-plugin`, `eslint-plugin-jsdoc`, `eslint-plugin-tsdoc`, `eslint-config-prettier`, `knip`, `publint`, `@arethetypeswrong/cli`.                                                       | Versions in Appendix E.                                                              |
| 1.6 | npm 12: keep the existing `allowScripts` block (esbuild) — it is the new default policy; verify `npm ci` is silent. Add `min-release-age=7` to `.npmrc` if desired (align Dependabot cooldown in Phase 9).                                                                                                                                            | —                                                                                    |
| 1.7 | Regenerate the lockfile once (`npm install`), commit, and add the lockfile-freshness check to CI (Phase 9) so it never drifts again.                                                                                                                                                                                                                  | Commit `90cd19f` fixed exactly this by hand.                                         |

Acceptance: `npm run check` green on Node 22.12 and 24; `npm audit` = 0;
`npm outdated` shows only `typescript` (intentional).

---

## 6. Phase 2 — TypeScript configuration hardening (1–2 days)

### 6.1 Base configuration

Replace `tsconfig.base.json` with the library-strict set. Everything below
except the two marked lines is already zero-cost (Section 2.4).

```jsonc
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "target": "es2023",
    "lib": ["es2023", "esnext.disposable"], // core/browser add "dom", "dom.iterable" (see 6.2)
    "types": [],
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true, // 93 fixes (D9)
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "allowUnreachableCode": false, // 1 fix
    "allowUnusedLabels": false,
    "useUnknownInCatchVariables": true,
    "noUncheckedSideEffectImports": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "erasableSyntaxOnly": true, // after 6.4 converts 7 enums
    "isolatedDeclarations": true, // after 6.5 (50 fixes in core)
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "composite": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
  },
}
```

### 6.2 Per-workspace configuration

| Workspace                            | Change                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`                      | `lib` adds `dom`, `dom.iterable` (it uses `fetch`, `AbortSignal`, `TextEncoder`, `crypto.subtle`); `types: []` stays. **Verify `Symbol.asyncDispose` resolves from `esnext.disposable`, not from `@types/node`.** `rootDir: "src"`, `outDir: "dist"`, `include: ["src"]`; tests get their own `tsconfig.test.json` (extends, `noEmit`, `types: ["node"]`-free, includes `test`). |
| `packages/browser`                   | same as core; `references: [{ "path": "../core" }]`.                                                                                                                                                                                                                                                                                                                             |
| `packages/node`                      | `types: ["node"]` (today it type-checks only via vitest's transitive reference — verified with `--explainFiles`); `references` → core.                                                                                                                                                                                                                                           |
| `conformance-runner`, `differential` | `types: ["node"]`; `references` → the packages they import; `noEmit` (they are not published).                                                                                                                                                                                                                                                                                   |
| root                                 | `tsconfig.json` as a solution file: `{ "files": [], "references": [ …six… ] }`. `npm run typecheck` becomes `tsc -b` (use `--noEmit`-free build for packages, since Phase 3 needs `dist/`).                                                                                                                                                                                      |
| `scripts/`                           | `scripts/tsconfig.json` with `allowJs`, `checkJs`, `types: ["node"]`, `noEmit` so `.mjs` scripts are type-checked and typed-lintable via `projectService`.                                                                                                                                                                                                                       |
| `tests/`                             | keep `tsconfig.tests.json`, extend the base, `types: ["node"]`.                                                                                                                                                                                                                                                                                                                  |

### 6.3 Fix list for the new flags

- `noPropertyAccessFromIndexSignature`: 9 sites in `bookmarks/schema-sorting.ts`, `bookmarks/schema.ts`, `query/validation-bookmark.ts`; 84 in tests (`validation-bookmark.test.ts` 48, `validation-cohort-bookmark.test.ts` 14, `schema.pbt.test.ts` 10, `bookmark-validation.pbt.test.ts` 8, …).
- `allowUnreachableCode: false`: 1 site in core (TS7027).

### 6.4 Enums → `as const` objects (`erasableSyntaxOnly`)

`packages/core/src/types/enums.ts` holds the only 7 TypeScript `enum`s
(lines 26–114). The rest of the repo already ports Python enums as `as const`
objects + literal unions (`replays/rrweb-analyzer.ts:60-109`). Convert, keep
the exported names, and add `type X = (typeof X)[keyof typeof X]`. Check the
conformance corpus still passes (enum _values_ must not change).

### 6.5 `isolatedDeclarations`

50 errors in core, 41 of them TS9010 (exported function lacks an explicit
return type on an inferred expression) — mostly `export const x = …` arrow
functions and object literals. Adding explicit annotations is also what
`explicit-module-boundary-types` wants (Phase 4). Enables parallel `.d.ts`
emit later and forces the public surface to be self-describing.

Acceptance: `tsc -b` green with the full flag set; no `@ts-expect-error`
added; conformance corpus unchanged.

---

## 7. Phase 3 — Packaging and module boundaries (3–5 days)

Goal: `npm install` from a checkout (or a tarball) and `import { Workspace }
from "@mixpanel-headless/core"` works in Node and in a bundler, with types.

### 7.1 Build

- `tsc -b` emits `dist/` per package (`.js`, `.d.ts`, `.d.ts.map`,
  `.js.map`). No bundler needed for three small ESM-only libraries; keep
  esbuild only for the two rig CLIs and the browser smoke bundle. (If
  bundling is later wanted, `tsdown` over `tsup`.)
- Add `"build": "tsc -b"` at root and `"clean"`. `npm run check` runs the
  build (it replaces the `--noEmit` typecheck).
- `.gitignore` already covers `dist/`; add `*.tsbuildinfo` (already there).

### 7.2 Package manifests

For each of `core`, `node`, `browser`:

```jsonc
{
  "name": "@mixpanel-headless/core",
  "version": "0.1.0",
  "type": "module",
  "license": "…",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/jaredmixpanel/mixpanel-headless-ts.git",
    "directory": "packages/core",
  },
  "engines": { "node": ">=22.12" },
  "sideEffects": false,
  "files": ["dist", "README.md"],
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./internal": {
      "types": "./dist/internal.d.ts",
      "default": "./dist/internal.js",
    }, // core only (D6)
    "./package.json": "./package.json",
  },
  "scripts": { "build": "tsc -b", "typecheck": "tsc -b --noEmit" },
  "publishConfig": { "access": "public", "provenance": true },
  "private": true, // until D4 is decided
}
```

- `node` and `browser`: `"dependencies": { "@mixpanel-headless/core": "0.1.0" }`
  (npm workspaces link it; `workspace:*` is **not** supported by npm).
- `node`: move `@types/node` to its devDependencies as well as root.
- Root remains `private: true`.

### 7.3 Replace relative cross-package imports

| Location                                      | Count | Target                                                                                                                                                                  |
| --------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/node/src`, `packages/browser/src`   | 119   | `@mixpanel-headless/core` (public) or `@mixpanel-headless/core/internal`                                                                                                |
| `packages/node/test`, `packages/browser/test` | ~70   | same; shared test helpers move to a `packages/core/test-support` (non-published) or `@mixpanel-headless/core/internal/testing`                                          |
| `conformance-runner/src`, `differential/**`   | ~120  | `@mixpanel-headless/core/internal`; move `types/vector-codecs.ts` (1,091 lines, rig plumbing incl. the `GROUP_BY_FLOAT_BUCKETS` WeakMap) into `conformance-runner/src/` |

Enforce with `import-x/no-relative-packages` and a `no-restricted-imports`
pattern for `**/packages/*/src/**` from outside that package (Phase 4).

### 7.4 Curate the public API

Current state: the core barrel `export *`s ~70 client plumbing names
(`executeWithRetry`, `handleResponse`, `parseBody`, `rawFetch`, `MAX_PAGES`,
`setEntryPoint`, `MixpanelHttpError`, …) but does **not** export the ~55
`Workspace*Options` interfaces or `services/`. The node barrel exposes 15
symbols and leaves `ConfigManager`, `OAuthFlow`, `OAuthStorage`, the bridge
trio, `MeCache`, `CredentialPathError` unreachable. `bookmarks/index.ts`
exports ~170 names including `_`-prefixed constants.

- Write `packages/core/src/index.ts` as an explicit, sectioned list:
  facade (`Workspace`, `WorkspaceOptions`, every `Workspace*Options`),
  client factory + option types, errors, entity/result/param models,
  literal unions, `compat` helpers that are part of the contract, auth
  types. No `export *` from leaf modules with > 15 symbols.
- Create `packages/core/src/internal.ts` for rig/platform-package needs
  (client plumbing, validators, builders, replays internals, test seams).
- Complete the node barrel (list above); decide public vs internal per
  module and stop writing internal modules' JSDoc as if public.
- Browser: keep the `Workspace` type-only posture; import core by name
  instead of re-exporting 50 symbols by deep path.
- `@internal` (623 uses) becomes meaningful: enable `stripInternal` or run
  api-extractor to trim `.d.ts`; anything tagged `@internal` must not be
  reachable from `"."`.
- Replace `export *` in `bookmarks/index.ts`, `replays/index.ts`,
  `services/index.ts` with named lists or delete the unused barrels.

### 7.5 Verification

- Add `publint` and `attw --pack . --profile esm-only` per package to
  `npm run check`.
- Add `tests/package-consumption.test.ts`: `npm pack` each package into a
  temp dir, `npm install` the tarballs, and run a tiny ESM script that
  imports `Workspace` from `@mixpanel-headless/node` and
  `createBrowserWorkspace` from the browser package (in a `vm` context with
  no Node globals — reuse `scripts/browser-smoke.mjs` logic).
- knip config (`knip.json`) with workspace entries; `npm run knip` in the
  gate with `--strict`; ignore `*.gen.ts`.

Acceptance: fresh clone → `npm ci && npm run build && node -e 'import("@mixpanel-headless/node")'`
works; publint/attw clean; knip clean; zero relative cross-package imports.

---

## 8. Phase 4 — Exhaustive, fully-enforced lint (2–3 days)

### 8.1 Configuration shape (ESLint 10 flat config)

```js
// eslint.config.js
import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import importX from "eslint-plugin-import-x";
import n from "eslint-plugin-n";
import unicorn from "eslint-plugin-unicorn";
import regexp from "eslint-plugin-regexp";
import vitest from "@vitest/eslint-plugin";
import jsdoc from "eslint-plugin-jsdoc";
import tsdoc from "eslint-plugin-tsdoc";
import prettier from "eslint-config-prettier";

export default defineConfig([
  globalIgnores([
    /* one shared list, also consumed by .prettierignore via a script */
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,
  regexp.configs["flat/recommended"],
  unicorn.configs.recommended,
  jsdoc.configs["flat/recommended-tsdoc"],
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  { files: ["**/*.ts"], plugins: { tsdoc }, rules: {/* 8.2 */} },
  { files: ["packages/*/src/**/*.ts"], rules: {/* library-only rules, 8.2 */} },
  {
    files: ["packages/core/**", "packages/browser/**"],
    rules: {/* purity boundary (existing) */},
  },
  {
    files: [
      "packages/node/**",
      "scripts/**",
      "conformance-runner/**",
      "differential/**",
    ],
    extends: [n.configs["flat/recommended-module"]],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/test/**/*.ts", "tests/**/*.ts"],
    extends: [vitest.configs.recommended],
    rules: {/* test relaxations, 8.3 */},
  },
  { files: ["**/*.{js,mjs}"], extends: [tseslint.configs.disableTypeChecked] },
  prettier,
]);
```

Run with `eslint . --max-warnings 0`. **No rule is ever set to `warn`
permanently**: a rule is either enforced or off with a comment explaining
why.

### 8.2 Rule decisions (from the trial; counts are today's source hits)

| Rule                                                                                                                                                                                                                                                                                                                                                                                                   | Decision                                                                                                                                                                                                                                                                                                                | Rationale / cost                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `@typescript-eslint/dot-notation`                                                                                                                                                                                                                                                                                                                                                                      | on, `allowIndexSignaturePropertyAccess: true`                                                                                                                                                                                                                                                                           | pairs with `noPropertyAccessFromIndexSignature`; removes 3,511 noise hits                                                        |
| `array-type`                                                                                                                                                                                                                                                                                                                                                                                           | `{ default: "array-simple", readonly: "array-simple" }`                                                                                                                                                                                                                                                                 | 560 hits, autofix; today four spellings coexist                                                                                  |
| `method-signature-style`                                                                                                                                                                                                                                                                                                                                                                               | `"property"`                                                                                                                                                                                                                                                                                                            | 364 hits, autofix; enables strict function-type variance                                                                         |
| `consistent-type-imports` (`inline-type-imports`), `consistent-type-exports`, `no-import-type-side-effects`                                                                                                                                                                                                                                                                                            | on                                                                                                                                                                                                                                                                                                                      | 35 hits, autofix; `verbatimModuleSyntax` already errors on the worst cases                                                       |
| `explicit-module-boundary-types`                                                                                                                                                                                                                                                                                                                                                                       | on for `packages/*/src`                                                                                                                                                                                                                                                                                                 | 32 hits; a library contract; aligns with `isolatedDeclarations`                                                                  |
| `explicit-function-return-type`                                                                                                                                                                                                                                                                                                                                                                        | on for `packages/*/src` with `allowExpressions`, `allowTypedFunctionExpressions`                                                                                                                                                                                                                                        | 1 hit                                                                                                                            |
| `switch-exhaustiveness-check` `{ considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: true }`                                                                                                                                                                                                                                                                                         | on                                                                                                                                                                                                                                                                                                                      | 7 hits, real                                                                                                                     |
| `restrict-template-expressions`                                                                                                                                                                                                                                                                                                                                                                        | on with **every** `allow*` stated explicitly (`allowNumber: true`, `allowBoolean: false`, `allowAny: false`, `allowNullish: false`, `allowRegExp: false`, `allowNever: false`)                                                                                                                                          | 143 hits, almost all numbers; partial overrides silently reset the others                                                        |
| `no-base-to-string`, `no-misused-spread`, `only-throw-error`, `no-unsafe-*`, `unbound-method`, `require-array-sort-compare`, `no-unnecessary-condition`, `no-unnecessary-type-assertion`, `non-nullable-type-assertion-style`, `prefer-nullish-coalescing`, `no-redundant-type-constituents`                                                                                                           | on (all in strict/stylistic)                                                                                                                                                                                                                                                                                            | fix by hand: 36 / 36 / 1 / 7 / 6 / 1 / 60 / 139 / 255 / 57 / 26                                                                  |
| `no-non-null-assertion`                                                                                                                                                                                                                                                                                                                                                                                | on in source; off in tests                                                                                                                                                                                                                                                                                              | 17 source hits → narrowing helpers (`defined()`)                                                                                 |
| `prefer-readonly`, `no-shadow` (TS), `no-useless-default-assignment`, `no-unnecessary-type-conversion`, `no-unnecessary-template-expression`                                                                                                                                                                                                                                                           | on                                                                                                                                                                                                                                                                                                                      | small counts                                                                                                                     |
| `require-await`                                                                                                                                                                                                                                                                                                                                                                                        | on; annotate intentional async-for-symmetry functions with an explicit `await Promise.resolve()`-free pattern (return `Promise.resolve(...)`)                                                                                                                                                                           | 69 hits (59 in tests)                                                                                                            |
| `promise-function-async`                                                                                                                                                                                                                                                                                                                                                                               | **off**                                                                                                                                                                                                                                                                                                                 | 603 hits, purely stylistic, conflicts with `require-await` in this codebase                                                      |
| `member-ordering`                                                                                                                                                                                                                                                                                                                                                                                      | **off** (or a minimal `fields → constructor → accessors → methods` config)                                                                                                                                                                                                                                              | 361 hits, low value; a light config is fine after Phase 6                                                                        |
| `strict-boolean-expressions`                                                                                                                                                                                                                                                                                                                                                                           | **off**                                                                                                                                                                                                                                                                                                                 | 10 hits; high noise in a `unknown`-heavy port                                                                                    |
| `naming-convention`                                                                                                                                                                                                                                                                                                                                                                                    | on, scoped: camelCase for variables/functions/private members everywhere; `snake_case` allowed only for object-literal/interface _properties_ under `types/entities`, `types/results`, `types/query-params`, `bookmarks`, `errors.ts` details (D1); `UPPER_CASE` for module constants; no leading underscore on exports | encodes D1                                                                                                                       |
| `eqeqeq`, `curly` (`all`), `no-console` (source only; scripts and CLIs allowed), `prefer-const`, `no-param-reassign`, `no-nested-ternary`, `no-else-return`, `no-lonely-if`, `object-shorthand`, `prefer-template`                                                                                                                                                                                     | on                                                                                                                                                                                                                                                                                                                      | 1 / 29 / 0 / 0 / ? / 25                                                                                                          |
| `complexity` (20), `max-depth` (4), `max-params` (5)                                                                                                                                                                                                                                                                                                                                                   | on **after Phase 6** (49 / 8 / 15 hits today)                                                                                                                                                                                                                                                                           | list offenders in Phase 6                                                                                                        |
| `max-lines` (800), `max-lines-per-function` (120)                                                                                                                                                                                                                                                                                                                                                      | on **after Phase 6**, source only                                                                                                                                                                                                                                                                                       | 41 / 56 files today                                                                                                              |
| `import-x/no-cycle`, `no-self-import`, `no-duplicates`, `no-extraneous-dependencies`, `no-relative-packages`, `first`, `newline-after-import`, `order` (alphabetised groups, or use `simple-import-sort`)                                                                                                                                                                                              | on                                                                                                                                                                                                                                                                                                                      | `no-cycle` has 29 hits today; Phase 6 breaks the 5 real ones; type-only cycles can be allowed via `ignoreTypeImports` until then |
| `n/no-unsupported-features/*` (reads `engines`), `n/no-extraneous-import`, `n/no-unpublished-import`, `n/prefer-node-protocol`                                                                                                                                                                                                                                                                         | on for node/scripts/rig                                                                                                                                                                                                                                                                                                 | free                                                                                                                             |
| `unicorn` recommended                                                                                                                                                                                                                                                                                                                                                                                  | on, with **off**: `prevent-abbreviations`, `no-null` (the port models Python `None`), `filename-case` (check first), `no-array-reduce`, `no-array-for-each` (decide), `numeric-separators-style` (autofix), `prefer-top-level-await` (scripts already do)                                                               | audit hits before enabling; expect a few hundred autofixes                                                                       |
| `regexp` recommended                                                                                                                                                                                                                                                                                                                                                                                   | on                                                                                                                                                                                                                                                                                                                      | compat/ is regex-heavy                                                                                                           |
| `jsdoc` `flat/recommended-tsdoc` + `require-jsdoc { publicOnly: true, require: { FunctionDeclaration, ClassDeclaration, MethodDefinition, ArrowFunctionExpression (exported) } }`, `require-description`, `require-throws`, `require-example` (classes + `packages/*/src/index.ts`-reachable functions only), `check-tag-names` with TSDoc tags, `no-types`, `require-hyphen-before-param-description` | on for `packages/*/src`                                                                                                                                                                                                                                                                                                 | formalises "exhaustive docstrings" (Phase 5)                                                                                     |
| `tsdoc/syntax`                                                                                                                                                                                                                                                                                                                                                                                         | on                                                                                                                                                                                                                                                                                                                      | with a `tsdoc.json`                                                                                                              |
| `vitest` recommended + `consistent-test-it: it`, `prefer-strict-equal`, `prefer-to-be`, `prefer-to-have-length`, `require-to-throw-message`, `prefer-expect-resolves`, `no-conditional-tests`, `prefer-hooks-on-top`, `no-disabled-tests: error`, `consistent-test-filename` (`.test.ts`), `valid-title` (no `test_` prefixes → D7)                                                                    | on for tests                                                                                                                                                                                                                                                                                                            | —                                                                                                                                |

### 8.3 Test-file relaxations

Tests keep `strictTypeChecked` but disable: `no-non-null-assertion`,
`no-unsafe-*` (for fixture JSON), `max-lines*`, `explicit-*-types`,
`no-empty-function` (stub sinks), `unbound-method` (for `vi.fn` refs),
`jsdoc/require-*`.

### 8.4 Rollout

1. Land the config with every rule that autofixes; run `eslint --fix` and
   `prettier --write`; commit as a single "mechanical" PR (no logic changes;
   reviewers can skim).
2. Fix the hand-fix categories (≈ 250 source sites) in 3–4 topic PRs
   (stringification & template expressions; unnecessary
   conditions/assertions; switch exhaustiveness & throw hygiene; tests).
3. Turn on `import-x/no-cycle` with `ignoreTypeImports` until Phase 6.
4. Complexity/size rules land at the end of Phase 6.
5. Prettier: make intent explicit — `.prettierrc.json` →
   `{ "printWidth": 80, "trailingComma": "all", "proseWrap": "always" }`
   (current defaults; state them) and generate `.prettierignore` from the
   same ignore list the ESLint config uses (small script, or keep the two
   lists adjacent with a freshness test). Add `packages/core/src/compat/{decimal-digits,whitespace}.gen.ts`
   to both ignore lists (currently in neither while `non-printable.gen.ts` is in both).

Acceptance: `eslint . --max-warnings 0` clean; zero `eslint-disable` without
a `-- reason`; `.eslintcache` in `.gitignore`; lint time stays < 60 s
(typed lint over 220k lines: expect ~15–25 s).

---

## 9. Phase 5 — Comment and docstring overhaul (5–8 days)

The largest editorial task and the single biggest change in how the code
_reads_. Adopt the style guide in Appendix D first, then work file by file
in priority order (Appendix B), with a scripted first pass.

### 9.1 Scripted pass (½ day to build, run repeatedly)

Write `scripts/audit/comment-archaeology.mjs` (AST-based; the audit scripts in
`/tmp/mp-audit` used during this analysis are a starting point and should be
re-created in-repo) that:

1. **Reports** every comment line matching the banned-token list (below) with
   file:line, and exits non-zero. This becomes a gate step once the count is
   zero, so archaeology cannot creep back.
2. **Rewrites** the purely mechanical cases with `--fix`:
   - `(\`foo.py:123-456\`)`and`foo.py:123` → drop the line range, keep the
module (`foo.py`) only if no symbol name is nearby; otherwise remove the
     whole parenthetical.
   - `(R4.10)`, `(R2.8)`, `(D12)`, `(P2-4)`, `(TS-5)`, `(B6-W2)`, `(AIE-926)`
     parentheticals with nothing else inside → delete.
   - Lines that are only a shard-ownership marker
     (`// === B6-W2 dashboard members (W2 owns; append-only) ===`) → delete or
     replace with a plain section comment (`// --- Dashboards ---`).
3. **Leaves for humans** any tagged paragraph that also contains rationale
   words (≈ 392 paragraphs); the report lists them.

Banned tokens (comments only; test titles too): `\bB\d+(-[A-Z]\d+|-R\d+|-W\d+|-S\d+|-N\d+|-K\d+|-M\d+|-ARB|-BIND|-MAPFIX)?\b`,
`\bR\d+\.\d+\b`, `\bP\d-\d+\b`, `\bTS-\d+\b`, `\bD1\d\b`, `\bAIE-\d+\b`,
`\bQA 20\d\d`, `packets?\.md`, `\bpacket\b`, `\bshard\b`, `\barbiter\b`,
`\bwatchlist\b`, `\bphase-?[1-4]\b`, `reviewB`, `review-resolution`,
`notes\.md`, `ledger row`, `Caution #?\d+`, `\.py:\d+`, `\(:\d+`, `FB-\d+`,
`SEM-F\d+`, `CRED-F\d+`. Allowed exceptions: `docs/history/**`, `GATE.md`,
`RUN.md`, `CHANGELOG`, and the Python _symbol_ form `module.Class.method`.

Known false positive: 36 comment lines in `query/validation-bookmark.ts`
(and three of its tests) use `// B8:` / `// B19:` as bookmark-validation
_rule_ labels, not batch IDs. Rename them to descriptive labels (`// Rule:
event behaviours need a name`) or, if the numbering mirrors a Python rule
table, prefix them `// rule B19` and whitelist that exact form.

### 9.2 Manual pass — file headers and rationale (3–4 days)

For each of the ~45 files in Appendix B, and then the remainder:

- **Rewrite the header** as a 3–8 line module overview: what the module is,
  what it owns, what it deliberately does not do, and one `@see` to the
  Python module by dotted name. Delete sequencing narratives ("the
  orchestrator dispatched S1 first", "B8-N3 extends THIS file"), ownership
  notes, "landed at"/"lands in" prose, and dated changelogs
  (`schema-sorting.ts:35-57`).
- **Keep genuine rationale, reworded without IDs**, e.g.: why the
  printability table is generated (`compat/non-printable.ts`), float-repr
  rules (`python-float-str.ts`), `use()` atomicity (`client.ts:1128-1158`),
  `str.isdigit` divergence (`auth/resolver.ts:354-363`), header layer
  precedence (`client/headers.ts:139-158`), why `MixpanelHttpError` sits
  outside the hierarchy (`client/internals.ts:38-48`), the `HOME`-freeze
  deviation (`node/config.ts:87-98`), the `O_NOFOLLOW` TOCTOU window
  (`node/io-utils.ts:12-23`), the StrictMode double-invoke registry
  (`browser/redirect-flow.ts:392-405`), the localStorage warning
  (`browser/credential-store.ts:115-133`), pydantic-lax probe findings
  (`bookmarks/schema.ts:29-55`).
- **Fix stale statements**: `errors.ts:22-23` ("deferred to B4"),
  `errors.ts:1017-1019` (`Region` "may tighten" — it is still `string`;
  tighten it or drop the note), `client.ts:223` ("unused by C1 paths"),
  `client.ts:449-458`, `services/index.ts` header, `workspace.ts:1454-1456`
  (`UNPORTED_RESOLVER_SEAM`), `conformance-runner/src/index.ts:3-4`,
  `bindings.ts:12-15`, `test/corpus.test.ts:6-9`,
  `differential/src/index.ts:3-5`, `ci.yml:1-5`.
- **`TODO(port)` disclosures (19)**: keep each as a one-line
  `// Divergence: …` pointing to a new `PORTING.md` section that lists every
  known behavioural divergence from Python with its reason. Remove the
  "CLOSED" TODO narratives (`bookmarks/enums.ts:26-30`,
  `results/replays.ts:15-25`, `filter.ts:1063-1065`, `query-engine.ts:860,872`).
- Remove ALL-CAPS emphasis (≈ 208 instances of ALWAYS/NEVER/ONLY/BY NAME) in
  favour of normal prose; keep capitals only in constants.

### 9.3 Docstrings — from "present" to "exhaustive" (2–3 days)

Coverage is already 99.9%; the work is quality:

1. **First sentence = behaviour.** Today the summary line is often
   provenance (`Load and validate a v2 bridge file from disk (port of
load_bridge, bridge.py:137-194)`), which is exactly what IDE hover shows.
   Lead with what it does; put `@see mixpanel_headless.auth.bridge.load_bridge`
   last.
2. **`@throws` on every deliberate throw** (currently 49% top-level;
   `types/results` 22%, `replays` 3%, `bookmarks` 14%, `client` 23%). The
   `jsdoc/require-throws` rule enforces it going forward.
3. **`@example`** on: each entity family's primary class (0.1% today), each
   result class's `toRows()`/`toMarkdown()` shape, `ReplayBundle`,
   `MixpanelClient` factory, the auth entry points not yet covered. Target:
   every class reachable from a package barrel and every barrel-exported
   function with more than one parameter.
4. **Interface properties** (2,505; 9% have ≥ 10-word descriptions): state
   units, defaults (`@defaultValue`), and constraints, not the type.
5. **Constructors** (260; 10%): document the init contract once on the class
   and `{@inheritDoc}`/`@see` from the constructor rather than repeating.
6. **Module-level docs**: `packages/core/src/index.ts` (today: "D11 design …
   TS-2, rulebook §11"), `types/index.ts` (explain entities vs results vs
   query-params once), each barrel, `compat/index.ts`, the rig `index.ts`.
   Use `@packageDocumentation`.
7. **`@internal` consistency**: after Phase 3, `@internal` is only used on
   symbols that are not reachable from `"."`; test seams in option bags
   (`ConfigManagerOptions.writeBytes`, `OAuthFlowOptions.*`) are either
   public (documented as such) or moved to an internal options type.
8. **Naming leaks in docs**: `@throws ValueError` / `PythonIntError`
   (`workspace.ts:1867, 2784`) must name exported error classes; duplicated
   `@throws` (`workspace.ts:6848/6857`); orphaned doc block above
   `export { isPythonDict }` in `query/validation-shared.ts:296-309`.
9. **The three undocumented barrel-reachable members**:
   `CreateCohortParams.fromDict`, `UpdateCohortParams.fromDict`,
   `BulkUpdateCohortEntry.fromDict` (`types/entities/cohorts.ts:335,437,524`).

### 9.4 Tests (1–2 days, mechanical; D7)

- Rename `it("test_snake_case")` titles to behaviour statements; keep the
  Python identifier as a trailing comment on the `it` line. Same for
  `describe("TestPkceChallenge (test_auth_pkce.py:25)")` → `describe("PKCE
challenge")`.
- Rewrite test-file headers (e.g. `governance-data.test.ts:1-40` is a 40-line
  packet crosswalk) to 2–5 lines: what is under test, which Python suite it
  mirrors (by name), and what is additive.
- Delete the skeleton tests and constants (`*_PACKAGE_NAME` in core, node,
  browser, rig, differential and their `index.test.ts`).

Acceptance: banned-token report = 0 in `packages/`, `conformance-runner/`,
`differential/`, `scripts/`, `tests/`; `jsdoc/*` rules clean; `@throws` on
100% of throwing barrel-reachable functions; `@example` on 100% of
barrel-reachable classes; comment share of core source drops from 42% to a
target of ≈ 25–30% without losing rationale.

---

## 10. Phase 6 — Structural refactors (8–12 days)

Ordered by leverage. Each item is behaviour-preserving and must keep the
conformance corpus (3,453 vectors) and the differential oracle green; run
`npm run conformance` after each. Items are independent unless noted and can
be parallelised across engineers.

### 10.1 `workspace.ts` (7,093 → ≈ 3,000 lines) — M/L

Anatomy today: lines 19–525 imports (118–339 are 145 `x as xMember` alias
imports); 527–1262 ≈ 55 `Workspace*Options` interfaces; class 1263–6879 with
218 members, 138 of which are one-line delegations; real logic is the
user-query engine (2482–2777), replay orchestration (3058–3527), and report
links (6242–6879 + helpers 6977–7093).

1. Namespace imports: `import * as dashboards from "./workspace-members/dashboards.js"` →
   `dashboards.list(this.client, options)`; delete the `Member` suffix
   convention (≈ 220 lines, mechanical).
2. `workspace/options.ts`: all option interfaces + type re-exports.
3. `workspace/user-query-engine.ts`: `#executeUserQuerySequential/Aggregate/Parallel`,
   `#exportPage` as functions over `{ client, logger }`.
4. `workspace/report-links.ts` and `workspace/replays.ts` in the same
   `workspace-members` pattern.
5. Name the magic defaults (`?? 500` ×3, `?? 50` ×3, `?? 30` ×4, `?? "prod"` ×5,
   `?? 5` ×3, `pagesNeeded > 48`, `Math.min(workers, 5)`) as constants with
   docs.
6. Remove the `const facade = this` + `eslint-disable no-this-alias`
   (`#businessContextHost`, ≈ line 3802) with arrow accessors.
7. `throw failures[0]?.[1]` (3400) and `throw aborted` (2739) rethrow
   `unknown`; wrap in typed errors.

### 10.2 Entity-model boilerplate (D10) — L

125 classes × (`XInit` interface + `declare readonly` fields + `static
fieldSpecs`) + 241 `as unknown as` casts (`fields as unknown as
Readonly<Record<string, unknown>>` ×120, `prepareInit(X, raw) as unknown as
XInit` ×121), `EntityModelStatics.new(fields: never)`
(`model-base.ts:196`), `cls as unknown as typeof EntityModel`
(`vector-codecs.ts:955`).

- Make `EntityModel<F>` generic with `protected constructor(cls:
EntityModelStatics<F>, fields: F)`; type `fieldSpecs` as
  `readonly EntityFieldSpec<keyof F>[]`; derive `XInit` from the spec
  builder (`defineFields({...} as const)`) so the field list is declared
  once.
- Delete the 24 redundant `unknown | null | undefined` unions
  (`no-redundant-type-constituents`).
- Cache the alias `Map`/`Set` and `known` sets on class statics instead of
  rebuilding per decode (`model-base.ts:404-413, 468`).

### 10.3 `types/literals.ts` (872 → ≈ 400 lines) — S

Each alias is written four times (union, `_VALUES` tuple,
`LITERAL_ALIAS_VALUES` entry, `LiteralAliasCoverageProof` entry). Derive
`export type TimeUnit = (typeof TIME_UNIT_VALUES)[number]` and delete the
coverage proof (lines 740–872) and `AssertAllNever`. Same for the
`*_LITERAL_VALUES` tuples in `bookmarks/schema.ts:83-314` (knip flags 15 of
them as unused — delete or wire them to the types).

### 10.4 Break the real import cycles — M

- `query/validation-shared.ts` → move Python-semantics helpers
  (`isFloatCarrier`, `pythonTypeName`, `pythonListRepr`, `pythonStrLoose`,
  `pythonNumberStr`, `pythonIterableElements`, `requireHashable`,
  `codepointGreater`; lines 196–650) to `compat/python-values.ts`, the
  `difflib.SequenceMatcher` port (667–981) to `compat/difflib.ts`, and
  `query/python-builtins.ts` to `compat/`. Import concrete modules instead
  of `../types/index.js` (line 43). Repoint the four `isPythonDict` imports
  (`bookmarks/schema.ts:71`, `schema-sorting.ts:71-75`, `builders.ts:44`,
  `rrweb-analyzer.ts:46`) to `compat/python-dict.ts`.
- `types/results/replays.ts` ↔ `replays/{aggregators,replay-labels,rrweb-analyzer}.ts`:
  make `replays/*` depend on a `UserAction`-shaped interface (or move
  `UserAction`/`ReplayEvent` into `replays/`); split `ReplayBundle`'s
  aggregation/`sample`/`summaryMarkdown` and `FlowQueryResult`'s graph/tree
  builders into sibling modules (also cuts `results/replays.ts` 1,990 and
  `results/query-engine.ts` 2,105 lines).
- `types/query-params/cohort.ts` ↔ `filter.ts`: move `sanitizeRawCohort`
  to `guards.ts`.
- `client/client.ts` ↔ `services/**` (24 type-only cycles): move
  `ClientCore`, `HttpHandle`, request option types to `client/core.ts`.
- Then enable `import-x/no-cycle` without `ignoreTypeImports`.

### 10.5 Long validators (`query/validation-args.ts`, `user-validators.ts`) — M

`validateQueryArgs` 388 lines, `validateUserArgs` 461, `validateFunnelArgs`
337, `validateRetentionArgs` 282, `validateFlowArgs` 217; the event-name
triple (empty / control-char / invisible) is copy-pasted 6× (`validation-args.ts:476-510,
848-910, 1207-1240, 1525-1558`). Introduce `checkEventName(path, name,
codes)` and a `push(path, msg, code)` closure; split per-rule blocks into
named functions (`validateExclusions`, `validateBucketSizes`, …). **Emission
order is contract** (the corpus checks error ordering) — preserve by call
order and run the corpus after each extraction.

### 10.6 Closure factories → module functions — M

`createQueryHostMethods` 574 lines (`services/queries/query-host.ts:721`),
`createMixpanelClient` 541 (`client/client.ts:776`), `createStreamingMethods`
334, `createLookupTableMethods` 316, `createLexiconMethods` 314,
`createDashboardMethods` 294, `createBookmarkUrlMethods` 238. Each is a list
of independent arrow functions inside one closure: hoist each to a named
`function x(core, …)` and assemble the object at the bottom. `handleResponse`
(`client/internals.ts:368`) builds the same 6-key context bag at 6 throw
sites — build once.

### 10.7 `errors.ts` (1,589 lines) — M

- `protected _code` mutated after `super()` in 5 subclasses (384, 426, 458,
  522, 567) → pass `code` through the constructor chain, make it `readonly`.
- `_details` is `protected readonly` but mutated via `Object.assign` (1399)
  and index writes (736–740).
- Accessors that re-parse `_details` with `typeof` guards (388–397, 430–439,
  462–465, 571–580) → typed private fields as `EventNotFoundError` already
  does (775–810).
- One shared `HttpErrorContext` for the 6 near-identical `*ErrorOptions`
  interfaces.
- Tighten `Region` from `string` to the literal union (the stale note at
  1017–1019 promised this).

### 10.8 Consolidate duplicated helpers — M

| Helper                                                                                                             | Copies                                                                                                                  | Home                                                                        |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `isPlainObject`                                                                                                    | `model-base.ts:275`, `cohort.ts:96`, `schema-sorting.ts:449`, `canonical.ts`, `wire-workspace.ts`, `oracle/raw-json.ts` | `compat/python-dict.ts` (it _is_ `isPythonDict`) / rig `internal/guards.ts` |
| `requireIsoText`                                                                                                   | `model-base.ts:236`, `vector-codecs.ts:135` (verbatim)                                                                  | `types/entities/decode-utils.ts`                                            |
| `describeValue`                                                                                                    | `model-base.ts:258`, `result-base.ts:65`                                                                                | same                                                                        |
| `codepointLength` / `cpLength`                                                                                     | `model-base.ts:220`, `compat/codepoint.ts:25`                                                                           | `compat/codepoint.ts`                                                       |
| `isPythonFloat` (two different semantics)                                                                          | `validation-shared.ts:277`, `schema-sorting.ts:496`                                                                     | rename one                                                                  |
| PyFloat-carrier duck typing                                                                                        | `vector-codecs.ts:622-635, 722-729` vs `isFloatCarrier`                                                                 | `compat/`                                                                   |
| `truthyStr`/`truthyList`                                                                                           | `services/entities/shared.ts`, `queries/engage.ts`, `queries/query-host.ts`                                             | `services/shared.ts`                                                        |
| `pythonTypeNameOf`                                                                                                 | ×3                                                                                                                      | `compat/`                                                                   |
| `dictGet`                                                                                                          | `discovery.ts:119`, `entities/schemas.ts`, `live-query-transforms.ts`                                                   | `client/json-value.ts`                                                      |
| `parseFail`                                                                                                        | `auth/account.ts`, `session.ts`, `token.ts`                                                                             | `auth/shared.ts`                                                            |
| `toNativeRecord` / `native` / `toNativeJson`                                                                       | `discovery.ts:1359`, `workspace.ts:6973`, `workspace-members/shared.ts:44`, `client/json-value.ts`                      | one name in `client/json-value.ts`                                          |
| `isLeapYear`, `asciiDigitsToInt`, `defaultToday`, `passthrough`, `isSet`                                           | ×2 each                                                                                                                 | `compat/`                                                                   |
| Six Python-repr helpers (`pyReprStr`, `pythonReprStr`, `pyRepr`, `pythonReprNumber`, `pythonStrOfRecord`, `pyStr`) | `discovery.ts:679,762`, `replays.ts:1145`, `lifecycle.ts:253`, `workspace-query-params.ts:2259`, `lookup-tables.ts:557` | `compat/python-str.ts`                                                      |
| `pythonUnquote`                                                                                                    | `core/auth/query-params.ts`, `node/auth/query-params.ts`                                                                | core only; delete the node shim                                             |
| `kwargBag` ×4, `asObject`/`optionalString` ×2, `isExpectErrorConvertible` ×2                                       | rig                                                                                                                     | `conformance-runner/src/internal/guards.ts`                                 |
| OAuth region gate                                                                                                  | `node/auth/flow.ts` ctor, `browser/redirect-flow.ts:186-195` (character-identical)                                      | core `requireOAuthBaseUrl(region)`                                          |
| `exc instanceof Error ? exc.message : String(exc)` + `new ConfigError(…)`                                          | 20× across node/browser                                                                                                 | `wrapAsConfigError(prefix, exc)`                                            |

### 10.9 Remove `as never` (19) and other escape hatches — M

`workspace-query-params.ts` ×14, `workspace.ts:2564, 2776`
(`engageStats(statsKwargs as never)`, `exportProfilesPage(page, kwargs as
never)`), `auth/oauth-http.ts:103, 475`. Give `buildPageKwargs` /
`buildStatsKwargs` / the cohort builders return types that match
`ExportProfilesPageOptions` / `EngageStatsOptions`. Replace
`workspaces.find(...) as PublicWorkspace` (`client.ts:1105-1107`) with an
explicit throw. Replace the 6 `as PythonValue` "typing formality" casts in
node with a `toPythonValue(unknown)` guard. Introduce a `defined<T>(x: T |
undefined, what: string): T` helper for the 17 source non-null assertions.

### 10.10 Other structure items — S each

- `types/vector-codecs.ts`: hoist the mid-file `import` block (lines
  833–911); move the file to the rig (Phase 3.3).
- `packages/node/src/config.ts` (1,180): split along its own section
  markers (338, 692, 832, 937, 1111, 1158) into `config/manager.ts`,
  `config/blocks.ts`, `config/apply.ts`.
- Delete the node pass-through shims `auth/pkce.ts`,
  `auth/oauth-constants.ts`, `auth/query-params.ts`, and the inline
  re-exports at `flow.ts:139`, `callback-server.ts:83`.
- `node/src/index.ts:85-256`: 25 near-identical lazy namespace wrappers →
  one `lazyNamespace(factory)` helper.
- `defaultAuthEffects()` (`core/accounts/auth-effects.ts:504-601`): 100
  lines of hand-enumerated throwing stubs + `UNPORTED_AUTH_SEAMS` string
  list → a `Proxy`-based throwing bag, or drop now that `packages/node`
  exists.
- `client/headers.ts:43` module-global `entryPoint` + public
  `setEntryPoint`: document as process-global or move onto client options.
- `DOMTracker.MAX_NODES` mutable public field → constructor option.
- Rig: split `bindings.ts` (1,621) into `bindings/{compat,types,wire,replays}.ts`;
  replace the `as unknown as` kwargs plumbing (29 sites) with a typed
  `kwarg<T>(ctx, name, guard)` accessor; the `register*Bindings` functions
  (618, 607, 587, 425, 404, 357, 336 lines) become tables of
  `[name, binder]` pairs.
- Rig: `cli.ts:46 argv[index] as string`, `selftest-path.ts:71 as string`
  → guards. `raw-json.ts` vs `core/client/lossless-json.ts`: one header
  sentence on why two parsers exist.
- Un-export the ≈ 40 internal-only / test-only symbols knip and the
  reviews list (Section 2.7 plus `detectLoginType`,
  `resolveProjectForLogin`, `summaryWithMe`, `domainToRegion`,
  `buildTestFailureResult`, `deriveAccountNameForCredential`,
  `formatNoAccountError`, `formatNoProjectError`, `slugify`, `isLongLived`,
  `probeBaseUrl`, `overrideProbeOrder`, `resolveAccountAxis`,
  `sessionAuthHeader`, …); anything tests need goes through the internal
  entry.
- Rename the 22 underscore-prefixed exports (`_suggest`, `_enumError`,
  `_MAX_FUNNEL_STEPS`, …) and snake_case locals/private constants (D1).
- Performance: `DOMTracker.addNode` BFS uses `queue.shift()`
  (`rrweb-analyzer.ts:318`, O(n²) on 50k-node snapshots) → index cursor.
- `pythonTypeName` returns `value.constructor.name` (`validation-shared.ts:392`)
  — minifier-unsafe in the browser bundle; set explicit names or document
  the no-mangle requirement in `scripts/build-browser-bundle.mjs`.

After 10.1–10.10: enable `max-lines` (800), `max-lines-per-function` (120),
`complexity` (20), `max-depth` (4), `max-params` (5) as errors for source.

---

## 11. Phase 7 — Test suite quality and coverage (2–3 days)

| #   | Task                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 7.1 | `vitest.config.ts`: `test.projects` per workspace (`core`, `node`, `browser`, `rig`, `differential`, `repo`) so `vitest --project core` works and the 3.6k-case corpus replay is opt-in locally (`CONFORMANCE=1` or a `corpus` project) while CI runs everything.                                                                                                        |
| 7.2 | Coverage: `@vitest/coverage-v8`, `include: ["packages/*/src/**"]`, exclude `*.gen.ts`; thresholds `lines 90 / branches 85 / functions 90 / statements 90` globally, `perFile: false` initially; measure first, then ratchet with `autoUpdate`. Upload `lcov` as a CI artefact.                                                                                           |
| 7.3 | Shared helpers: `makeWorkspace` is defined locally in 21 test files; `fakeTransport` exists in both `core/test/client/client-test-helpers.ts` and `browser/test/helpers.ts`; `jsonResponse` ×3. Create `packages/core/test-support/` (`makeWorkspace`, `fakeTransport`, `jsonResponse`, `fakeStorage`) and import it from node/browser via the internal entry (Phase 3). |
| 7.4 | Fixed-port network test: `packages/node/test/callback-server.test.ts:90-201` binds real `127.0.0.1:19284-19287`. Allow `startCallbackServer({ port: 0 })` and read `server.address().port`, or mark the file sequential and skip when the port is occupied.                                                                                                              |
| 7.5 | Env mutation: 60 direct `process.env[...]` writes and `HOME` reassignment (`bridge.test.ts:61-74`, `create-node-workspace.test.ts:34-36`) → `vi.stubEnv` / `vi.unstubAllEnvs` in `afterEach`. Keep `assertNotUnderHome`.                                                                                                                                                 |
| 7.6 | Giant test files (14 > 950 lines; `bookmarks/builders.test.ts` 2,120, `workspace/workspace-report-links.test.ts` 1,882): split by `describe` block along the Python class boundaries they mirror.                                                                                                                                                                        |
| 7.7 | Adopt `@vitest/eslint-plugin` (Phase 4) and fix: `no-disabled-tests` (the one `it.skip("test_frozen")` should be `it.todo` or a type-level test), `valid-title`, `prefer-strict-equal`, `require-to-throw-message`.                                                                                                                                                      |
| 7.8 | Add `vitest --typecheck` with a small set of `*.test-d.ts` files for the public types (option bags, result row shapes, `Workspace` method signatures) — replaces the `@ts-expect-error`-in-skipped-test pattern in `report-links.test.ts:137`.                                                                                                                           |
| 7.9 | Compat generated tables: add `generate:compat-tables` (wraps the three Python generators via `uv run`) and a freshness test that checks the provenance header (CPython version, Unicode version, sha256 of the generator) — regeneration itself needs CPython 3.14.6 and stays manual. Same for `generate-canonical-fixtures.py`.                                        |

---

## 12. Phase 8 — Correctness and security findings (1–2 days)

Found during review; none is a data-loss or remote-exploit issue, but each is
the kind of thing an outside reviewer circles. Verify each before fixing.

| #    | Finding                                                                                                                                                                                                                                                                            | Location                                                                                                                          | Fix                                                                                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.1  | **Windows browser launcher** spawns `cmd /c start "" <url>` without shell quoting; Node only quotes arguments containing whitespace, so the authorize URL is split at every `&` and the remainder runs as commands.                                                                | `packages/node/src/auth/flow.ts:211`                                                                                              | Escape `&` → `^&` (what `open` does), or `rundll32 url.dll,FileProtocolHandler <url>`, or depend on `open`. Add a unit test of the argv shape.           |
| 8.2  | Callback server consumes the one-shot request on **any** GET path; a favicon/preconnect probe burns it.                                                                                                                                                                            | `packages/node/src/auth/callback-server.ts:141-164`                                                                               | 404 anything not `/callback`.                                                                                                                            |
| 8.3  | CSRF `expected_state` is placed in `OAuthError.details` (hosts that log details log the nonce).                                                                                                                                                                                    | `callback-server.ts:205`                                                                                                          | Drop it; keep `received_state` if useful.                                                                                                                |
| 8.4  | Server binds `127.0.0.1` but `redirect_uri` uses `localhost` (RFC 8252 §7.3 recommends the loopback literal to avoid IPv6-first stalls).                                                                                                                                           | `callback-server.ts:235`, `flow.ts` login step                                                                                    | Use `http://127.0.0.1:PORT/callback`.                                                                                                                    |
| 8.5  | `chmodSync(dirname(configPath), 0o700)` on every write silently tightens a user-chosen directory (`MP_CONFIG_PATH=./config/mp.toml`). Inherited from Python.                                                                                                                       | `packages/node/src/config.ts:414-419`                                                                                             | Restrict the tighten to the default `~/.mp` location, or document loudly on `configPath`.                                                                |
| 8.6  | `no-base-to-string` sites where `String(unknown)` can yield `[object Object]` in error messages/headers.                                                                                                                                                                           | `errors.ts:534`, `auth/token.ts:258,263`, `client/transport.ts:99`, `conformance-runner/src/wire-client.ts:133-332` (+ ≈ 30 more) | Narrow before stringifying; use `pythonStr`/`describeValue`.                                                                                             |
| 8.7  | String spread mishandles astral code points (`no-misused-spread`).                                                                                                                                                                                                                 | `auth/account.ts:295`, `bookmarks/schema-sorting.ts:302` (+5)                                                                     | Use `Array.from(str)` deliberately or `compat/codepoint.ts`.                                                                                             |
| 8.8  | Silent failure isolation: per-item errors in `fetchReplays` and the parallel user-query engine go to an optional `logger?.warning?.()`; with the default constructor they vanish. `DiscoveryService`'s no-op `warn` and `iterDictRows` dropping parse failures are the same shape. | `workspace.ts:3376-3385, 2723-2728`, `services/discovery.ts:462-487, 879`                                                         | Add a `failures` field on `ReplayBundle`/meta (there is already `failed_pages` precedent); make the logger non-optional with a documented no-op default. |
| 8.9  | Non-exhaustive switches.                                                                                                                                                                                                                                                           | `coerce.ts:89`, `workspace-members/lifecycle.ts:406` (+4)                                                                         | `switch-exhaustiveness-check` fixes.                                                                                                                     |
| 8.10 | `throw` of a non-Error value.                                                                                                                                                                                                                                                      | `workspace.ts:2739`                                                                                                               | wrap.                                                                                                                                                    |
| 8.11 | `no-unnecessary-condition` "types have no overlap" (dead branches that suggest a wrong type).                                                                                                                                                                                      | `client.ts:1291`, `canonical.ts:220`, `live-query-transforms.ts:1208`, `login-unified.ts:211,213`                                 | Fix the type or delete the branch.                                                                                                                       |
| 8.12 | State comparison is `!==` (not constant-time). Acceptable for a single-use loopback nonce; note it in a comment so reviewers don't re-raise it.                                                                                                                                    | `callback-server.ts`                                                                                                              | comment only                                                                                                                                             |

---

## 13. Phase 9 — Repository documentation, CI, and process (2–3 days)

### 13.1 Documents

| File                                                                                                           | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                                                                                                    | Keep the consumer-facing structure (it is good). Fix versions/numbers (Phase 0). Add a short **Development** section: gate, conformance CLI, oracle, where `GATE.md`/`RUN.md` live and what they prove, link to CONTRIBUTING. Add the **Naming** paragraph (D1). Remove the pointer to CLAUDE.md as the only dev doc.                                                                                                                                                                                                                                                                           |
| `CONTRIBUTING.md`                                                                                              | Clone → `npm ci` → `npm run check`; Node/TS pins and why; workspace layout; generated files rule and table (all seven artefacts, their generators, freshness tests); corpus refresh procedure; comment/docstring style guide (Appendix D); test conventions (English titles, Python name in comment, helpers location); PR expectations; how to run a single project.                                                                                                                                                                                                                           |
| `PORTING.md`                                                                                                   | Python revision pinned; naming rules; the list of known behavioural divergences (from the 19 `TODO(port)` notes); what the conformance corpus and oracle do and do not prove.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `SECURITY.md`, `CODEOWNERS` (esp. `.github/workflows/**`), `CHANGELOG.md` (Changesets-managed if D4 = publish) | standard                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `packages/*/README.md`                                                                                         | Short per-package README (install, entry points, platform notes). Rewrite `packages/browser/README.md` (currently heavy with "pair-B review", "D2 spike", "ledger row 8").                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `context/` → `docs/history/` (D5)                                                                              | `README.md` with what it is and a reading order (plan → rulebook → phase1-design D11–D16 → inbound-ledger); glossary of the identifiers that survive there; move `blog/` out.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `conformance-runner/GATE.md`                                                                                   | Either a dated historical record with a current-status header, or append a row per corpus re-pin (currently frozen at 2026-08-14 / 2,603 vectors / old `sourceCommit`).                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `scripts/README.md`                                                                                            | Table of every script, its inputs/env vars, and its npm alias. Give every script a shebang + exec bit; rename `gen-error-codes.mjs` → `generate-error-codes.mjs`; unify generated-file headers ("Regenerate with: npm run generate:…"); add `generate:all`; extract the duplicated esbuild bundle-and-run boilerplate from `run-conformance.mjs`/`run-oracle.mjs` into `scripts/lib/`. Add a one-line "external spec, see <repo>" note in the bridge-allowlist files (they cite documents that live in `mixpanel-desktop-app`), and consider moving the bridge-allowlist generator to `tools/`. |
| `CLAUDE.md`                                                                                                    | Refresh after the above (paths, commands, generated-files table); stop pointing at git-ignored `.notes/ts5-scratch.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `.notes/`                                                                                                      | nothing to promote; leave ignored.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### 13.2 CI (`.github/workflows/ci.yml`)

```yaml
name: ci
on: { push: { branches: [main] }, pull_request: {} }
permissions: { contents: read }
concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: ${{ github.event_name == 'pull_request' }} }
jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    strategy: { matrix: { node: [22, 24] } }
    steps:
      - uses: actions/checkout@<sha>          # SHA-pin all actions
      - uses: actions/setup-node@<sha>
        with: { node-version: ${{ matrix.node }}, cache: npm }
      - run: npm ci
      - run: git diff --exit-code package-lock.json     # lockfile freshness
      - run: npm run check                              # build, lint, fmt, test+coverage, knip, publint/attw, smoke, vendor:drift, archaeology guard
      - uses: actions/upload-artifact@<sha>
        with: { name: conformance-report-node${{ matrix.node }}, path: conformance-runner/dist/report.json }
```

- Delete the Phase-1 comments and the "Detect corpus snapshot" guard; drop
  the separate `conformance` job (the corpus already runs inside
  `npm run check` via `corpus.test.ts`) or make it the _only_ corpus run.
- Add `dependabot.yml`: `npm` (grouped minor/patch, majors separate,
  `ignore` majors for `typescript` and `@types/node`, `cooldown` aligned to
  `min-release-age`) and `github-actions` ecosystems.
- Optional: a scheduled job that runs the differential oracle against the
  Python repo when both are checked out (self-hosted or a composite checkout).
- If D4 = publish: `release.yml` with Changesets, `id-token: write`, npm
  trusted publishing, `environment: npm`.

### 13.3 Local workflow (optional but recommended)

- `lefthook.yml`: pre-commit `eslint --fix` + `prettier --write` on staged
  files; pre-push `tsc -b --noEmit` + affected tests. `"prepare": "lefthook install"`.
- Skip commitlint; if squash-merging, lint PR titles instead. Keep the
  existing `type(scope): subject` habit and document it.

---

## 14. The gate after this plan

`npm run check` (and CI) will enforce, in order:

| Step                                    | Command                                                                         | New?             |
| --------------------------------------- | ------------------------------------------------------------------------------- | ---------------- |
| Build + typecheck (all flags in 6.1)    | `tsc -b`                                                                        | upgraded         |
| Lint (typed, exhaustive, zero warnings) | `eslint . --max-warnings 0`                                                     | upgraded         |
| Format                                  | `prettier --check .`                                                            | —                |
| Dead code / deps                        | `knip --strict`                                                                 | new              |
| Package correctness                     | `publint` + `attw --pack --profile esm-only` per package                        | new              |
| Tests + coverage thresholds             | `vitest run --coverage` (all projects)                                          | upgraded         |
| Type tests                              | `vitest --typecheck`                                                            | new              |
| Browser purity smoke                    | `scripts/browser-smoke.mjs`                                                     | —                |
| Package consumption smoke               | `tests/package-consumption.test.ts`                                             | new              |
| Generated-file freshness                | vitest tests for all seven artefacts                                            | extended         |
| Vendor integrity                        | `scripts/check-vendor-drift.sh` (integrity half always; byte-diff when mounted) | wired into check |
| Comment archaeology guard               | `scripts/audit/comment-archaeology.mjs` (exit 1 on any banned token)            | new              |
| Lockfile freshness (CI only)            | `git diff --exit-code package-lock.json`                                        | new              |

---

## 15. Sequencing, PR slicing, and effort

```
Phase 0 (½d) ─► Phase 1 (1d) ─► Phase 2 (1–2d) ─► Phase 3 (3–5d) ─► Phase 4 (2–3d)
                                                        │                 │
                                                        ▼                 ▼
                                               Phase 5 comments (5–8d)   Phase 6 refactors (8–12d)
                                                        │                 │
                                                        ▼                 ▼
                                               Phase 7 tests (2–3d)     Phase 8 fixes (1–2d)
                                                                  │
                                                                  ▼
                                                         Phase 9 docs/CI (2–3d)
```

- **Phases 0–4 are sequential** (each depends on the previous) and total
  ≈ 8–12 days. They remove the "cannot install" and "no real lint" problems
  and give later phases the tooling to verify themselves.
- **Phases 5 and 6 can run in parallel** across engineers, split by
  directory (they touch the same files, so assign ownership per directory
  and rebase often; do the Phase 5 header rewrite of a file _after_ its
  Phase 6 split, or you rewrite twice).
- **Phase 8 items** are small and can be slotted anywhere after Phase 4
  (the lint rules catch regressions).
- **Phase 9** last, so docs describe the final state; but the CI rewrite
  (13.2) can land right after Phase 1.

**PR slicing rules** for reviewability:

1. Mechanical/autofix changes (lint `--fix`, import rewrites, alias-import
   removal, docstring first-line swaps done by script) ship as their own PRs
   labelled `mechanical`, with the script that produced them committed.
2. No PR mixes a refactor with a behaviour change; Phase 8 fixes are
   separate PRs with a test each.
3. Every refactor PR states "conformance: 3,453/0/0, oracle: pass" in its
   description (the numbers come from `npm run conformance -- --report json`).

**Effort summary**

| Phase                 | Days        | Parallelisable                       |
| --------------------- | ----------- | ------------------------------------ |
| 0 Hygiene             | 0.5         | —                                    |
| 1 Toolchain           | 1           | —                                    |
| 2 tsconfig            | 1–2         | —                                    |
| 3 Packaging           | 3–5         | partly (import rewrites per package) |
| 4 Lint                | 2–3         | partly (hand-fix topics)             |
| 5 Comments/docstrings | 5–8         | yes (by directory)                   |
| 6 Refactors           | 8–12        | yes (by item)                        |
| 7 Tests               | 2–3         | yes                                  |
| 8 Fixes               | 1–2         | yes                                  |
| 9 Docs/CI             | 2–3         | partly                               |
| **Total**             | **≈ 26–40** | with 3 engineers ≈ 3 calendar weeks  |

---

## Appendix A — Reproducing the measurements

```bash
# gate + timing
time npm run typecheck; time npm run lint; time npx vitest run --reporter=dot

# tracked junk / personal paths
git ls-files | grep DS_Store; git grep -n "/Users/"

# stricter tsc flags per workspace
for w in packages/core packages/node packages/browser conformance-runner differential; do
  echo "== $w"; npx tsc --noEmit -p $w --noImplicitOverride --noImplicitReturns \
    --noFallthroughCasesInSwitch --noPropertyAccessFromIndexSignature --noUnusedLocals \
    --noUnusedParameters --allowUnreachableCode false --allowUnusedLabels false 2>&1 \
    | grep -oE "error TS[0-9]+" | sort | uniq -c | sort -rn
done
npx tsc --noEmit -p packages/core --isolatedDeclarations 2>&1 | grep -oE "error TS[0-9]+" | sort | uniq -c
npx tsc --noEmit -p packages/core --erasableSyntaxOnly 2>&1 | grep -E "error TS" | head

# how packages/node currently gets Node typings
npx tsc --noEmit -p packages/node --explainFiles | grep -B1 -A2 "@types/node/index.d.ts" | head

# typed-lint trial (write a temporary eslint.trial.config.mjs with strictTypeChecked +
# stylisticTypeChecked + projectService, then aggregate by rule)
npx eslint -c eslint.trial.config.mjs . -f json -o /tmp/lint.json
node -e 'const r=require("/tmp/lint.json"),b={};for(const f of r)for(const m of f.messages)b[m.ruleId]=(b[m.ruleId]||0)+1;console.table(Object.entries(b).sort((a,c)=>c[1]-a[1]))'

# dead code
npx knip@latest --no-progress --reporter compact   # add a knip.json ignoring vendor/, docs/history/, corpus/, *.gen.ts

# comment archaeology (rough grep; the AST-based script in Phase 5 replaces this)
grep -rnoE "\b(TS-[0-9]+|B[0-9]+(-[A-Z][0-9]+)?|P[0-9]-[0-9]+|R[0-9]+\.[0-9]+|D1[0-9]|AIE-[0-9]+|b[0-9]-packets|QA 20[0-9]{2})\b" \
  packages/*/src conformance-runner/src differential scripts --include='*.ts' --include='*.mjs' | wc -l
grep -rnoE "\.py:[0-9]+" packages/*/src conformance-runner/src differential --include='*.ts' | wc -l

# cross-package relative imports
grep -rhoE 'from "(\.\./)+(core|node|browser|packages/[a-z]+)/src/[^"]*"' packages conformance-runner differential --include='*.ts' | wc -l

# import cycles
npx madge --circular --extensions ts packages/core/src

# dependency landscape
npm outdated; npm audit; npm view typescript dist-tags; npm view typescript-eslint peerDependencies
```

The JSDoc coverage, barrel-surface, function-length and file-size tables in
Section 2 came from small TypeScript-compiler-API scripts (walk exported
declarations, check `node.jsDoc`, count tags; follow `export *` chains; measure
function body spans). Recreate them under `scripts/audit/` in Phase 5 so the
numbers are reproducible in-repo.

---

## Appendix B — File hotlist

Files to treat first in Phases 5 and 6, ranked by size × archaeology density ×
public importance.

| File                                                             | Lines          | Process refs              | Why                                                               |
| ---------------------------------------------------------------- | -------------- | ------------------------- | ----------------------------------------------------------------- |
| `packages/core/src/workspace.ts`                                 | 7,093          | 76                        | facade; 145 alias imports; split (10.1)                           |
| `packages/core/src/index.ts`                                     | ~120           | high                      | the first file any reader opens; header is pure process narration |
| `conformance-runner/src/bindings.ts`                             | 1,621          | 100                       | god file; 29 `as unknown as`                                      |
| `conformance-runner/src/batch-status.ts`                         | —              | 76 (32% of comment lines) | dated historical record in source                                 |
| `packages/core/src/workspace-query-params.ts`                    | 2,460          | —                         | 14 `as never`; 7 functions > 100 lines                            |
| `packages/core/src/types/results/live-query.ts`                  | 2,412          | —                         | largest result module                                             |
| `packages/core/src/types/results/query-engine.ts`                | 2,105          | —                         | cycle with replays; graph/tree builders                           |
| `packages/core/src/types/results/replays.ts`                     | 1,990          | —                         | cycle with `replays/*`                                            |
| `packages/core/src/query/validation-args.ts`                     | 1,831          | —                         | 5 functions > 200 lines; copy-pasted checks                       |
| `packages/core/src/types/entities/schemas.ts`                    | 1,796          | —                         | entity boilerplate                                                |
| `packages/core/src/errors.ts`                                    | 1,589          | 51                        | mutable `_code`, `_details` re-parsing, stale notes               |
| `packages/core/src/query/validation-bookmark.ts`                 | 1,276          | 67 (18%)                  | inline `// B8:`/`// B19:` markers                                 |
| `packages/core/src/accounts/auth-effects.ts`                     | —              | 62 (14%)                  | `defaultAuthEffects` stub bag                                     |
| `packages/core/src/client/client.ts`                             | 1,318          | 46                        | 541-line factory; hub of 24 cycles                                |
| `packages/core/src/client/internals.ts`                          | 705            | 42                        | `handleResponse` context bag                                      |
| `packages/core/src/query/validation-shared.ts`                   | 1,380          | 35                        | wrong layering; cycle; orphaned JSDoc                             |
| `packages/core/src/types/literals.ts`                            | 872            | —                         | 4× repetition                                                     |
| `packages/core/src/types/entities/model-base.ts`                 | 839            | 34                        | generic `EntityModel`                                             |
| `packages/core/src/types/vector-codecs.ts`                       | 1,091          | high                      | rig plumbing in core; mid-file imports                            |
| `packages/core/src/bookmarks/schema-sorting.ts`                  | 1,419          | —                         | 8 `!`; dated changelog header                                     |
| `packages/core/src/services/queries/query-host.ts`               | 1,297          | —                         | 574-line factory                                                  |
| `packages/core/src/services/discovery.ts`                        | 1,427          | —                         | duplicated helpers; silent `warn`                                 |
| `packages/core/src/services/live-query-transforms.ts`            | 1,578          | 34                        | —                                                                 |
| `packages/core/src/replays/rrweb-analyzer.ts`                    | 1,533          | —                         | O(n²) BFS; magic strings                                          |
| `packages/node/src/config.ts`                                    | 1,180          | —                         | split; 20× error-wrap pattern                                     |
| `packages/node/src/auth/flow.ts`                                 | 722            | 35                        | Windows launcher; header narrative                                |
| `packages/node/src/auth/bridge.ts`                               | 692            | 18                        | 40% justification comments                                        |
| `packages/browser/src/client.ts`, `redirect-flow.ts`, `index.ts` | —              | 27 / 24 / —               | "pair-B FB-n" prefixes; 50 deep re-exports                        |
| `conformance-runner/src/wire-*.ts` (5 files)                     | 600–1,100 each | —                         | 300–600-line register functions; 100+ `as` casts each             |
| `differential/oracle/server.ts`                                  | 996            | —                         | fine structurally; header only                                    |
| `.github/workflows/ci.yml`, `eslint.config.js`                   | —              | —                         | stale narrative headers                                           |

---

## Appendix C — Lint trial results by rule

typescript-eslint 8.66 `strictTypeChecked` + `stylisticTypeChecked` +
the extras listed in 8.2, run over everything except generated/vendored
files. "src" = library/rig source, "test" = test files.

| Rule                                                                    | src       | test      | autofix     |
| ----------------------------------------------------------------------- | --------- | --------- | ----------- |
| `@typescript-eslint/dot-notation`                                       | 819       | 2,692     | yes         |
| `@typescript-eslint/promise-function-async`                             | 403       | 200       | yes         |
| `@typescript-eslint/member-ordering`                                    | 361       | 0         | no          |
| `@typescript-eslint/method-signature-style`                             | 342       | 22        | yes         |
| `@typescript-eslint/array-type`                                         | 268       | 292       | yes         |
| `@typescript-eslint/non-nullable-type-assertion-style`                  | 164       | 91        | yes         |
| `@typescript-eslint/restrict-template-expressions`                      | 104       | 39        | no          |
| `@typescript-eslint/no-unnecessary-type-assertion`                      | 98        | 41        | yes         |
| `max-lines-per-function` (120)                                          | 56        | 131       | no          |
| `@typescript-eslint/prefer-nullish-coalescing`                          | 55        | 2         | no          |
| `@typescript-eslint/no-unnecessary-condition`                           | 52        | 8         | no          |
| `complexity` (20)                                                       | 47        | 2         | no          |
| `max-lines` (800)                                                       | 41        | 30        | no          |
| `@typescript-eslint/explicit-module-boundary-types`                     | 32        | 0         | no          |
| `@typescript-eslint/no-redundant-type-constituents`                     | 26        | 0         | no          |
| `@typescript-eslint/no-base-to-string`                                  | 26        | 10        | no          |
| `no-nested-ternary`                                                     | 21        | 4         | no          |
| `@typescript-eslint/no-unnecessary-template-expression`                 | 21        | 2         | yes         |
| `@typescript-eslint/no-unnecessary-type-conversion`                     | 17        | 6         | no          |
| `@typescript-eslint/consistent-type-imports`                            | 17        | 18        | yes         |
| `@typescript-eslint/no-non-null-assertion`                              | 17        | 626       | no          |
| `@typescript-eslint/no-inferrable-types`                                | 16        | 0         | yes         |
| `@typescript-eslint/consistent-indexed-object-style`                    | 12        | 9         | yes         |
| `@typescript-eslint/require-await`                                      | 10        | 59        | no          |
| `max-params` (5)                                                        | 9         | 6         | no          |
| `curly`                                                                 | 8         | 21        | yes         |
| `max-depth` (4)                                                         | 8         | 0         | no          |
| `@typescript-eslint/no-misused-spread`                                  | 7         | 29        | no          |
| `@typescript-eslint/strict-boolean-expressions`                         | 7         | 3         | no          |
| `@typescript-eslint/no-confusing-void-expression`                       | 6         | 43        | yes         |
| `@typescript-eslint/no-dynamic-delete`                                  | 6         | 7         | no          |
| `@typescript-eslint/prefer-optional-chain`                              | 6         | 2         | partly      |
| `@typescript-eslint/switch-exhaustiveness-check`                        | 6         | 1         | no          |
| `@typescript-eslint/unbound-method`                                     | 6         | 0         | no          |
| `@typescript-eslint/no-unsafe-assignment/return/argument/member-access` | 7         | 3         | no          |
| `@typescript-eslint/no-unnecessary-type-parameters`                     | 3         | 0         | no          |
| `@typescript-eslint/no-empty-function`                                  | 3         | 14        | no          |
| `@typescript-eslint/consistent-type-exports`                            | 2         | 0         | yes         |
| `@typescript-eslint/restrict-plus-operands`                             | 2         | 0         | no          |
| `@typescript-eslint/no-useless-constructor`                             | 1         | 0         | no          |
| `@typescript-eslint/no-shadow`                                          | 1         | 5         | no          |
| `@typescript-eslint/require-array-sort-compare`                         | 1         | 0         | no          |
| `@typescript-eslint/only-throw-error`                                   | 1         | 0         | no          |
| `@typescript-eslint/await-thenable`                                     | 0         | 19        | no          |
| `@typescript-eslint/no-floating-promises`                               | 0         | 1         | no          |
| `eqeqeq`                                                                | 0         | 1         | yes         |
| **Total**                                                               | **3,169** | **4,407** | **≈ 4,900** |

---

## Appendix D — Comment style guide (to adopt)

To be copied into `CONTRIBUTING.md`.

1. **Comments explain _why_, never _when_ or _who_.** No batch, shard,
   packet, ticket, reviewer, or date references in code. History lives in
   git and in `docs/history/`.
2. **Provenance is a symbol, not a line number.** Reference Python as
   `@see mixpanel_headless.workspace.Workspace.list_dashboards`. Never
   `workspace.py:4506-4536`. The Python revision the port tracks is recorded
   once in `PORTING.md` / `corpus.config.json`.
3. **Every exported symbol has a TSDoc block** whose first sentence states
   behaviour in the imperative ("Return the …", "Resolve the …"), followed
   by `@remarks` for non-obvious semantics, `@param name - description`
   (units, constraints, defaults; never the type), `@returns`, `@throws
{@link ErrorClass}` for each deliberate throw, `@example` for anything
   with more than one parameter or a non-trivial return shape, and `@see`
   last. `@defaultValue` on optional properties. `@internal` only on symbols
   not reachable from the package's `"."` entry.
4. **Module headers** are 3–8 lines: purpose, ownership boundary, one
   `@see`. Use `@packageDocumentation` on entry points.
5. **Rationale that would surprise a competent reader stays**; narration of
   what the next line obviously does goes. Prefer a well-named helper to a
   comment.
6. **No shouting.** No ALL-CAPS words for emphasis; no `!!!`.
7. **Divergences from Python** are marked `// Divergence: <one line>` and
   listed in `PORTING.md`. `TODO` requires an owner or an issue link.
8. **Section dividers** are plain (`// --- Dashboards ---`), never ownership
   markers.
9. **Tests**: `describe` names the unit; `it` states the behaviour in plain
   English ("rejects a redirect URI without a scheme"); the mirrored Python
   test name goes in a trailing comment. Test-file headers say what is under
   test and what is additive relative to the Python suite, in ≤ 5 lines.
10. **`eslint-disable`** always carries `-- <reason>`; `@ts-expect-error`
    always carries a description; neither appears in library source without
    a linked issue or a one-line justification.

---

## Appendix E — Sources

Versions verified with `npm view` on 2026-09-14: typescript 7.0.2 (latest) /
6.0.3 (last 6.x); typescript-eslint 8.70.0 (peer `typescript >=4.8.4 <6.1.0`,
`eslint ^8.57||^9||^10`); eslint 10.10.0 (engines `^20.19||^22.13||>=24`);
vitest 5.0.0 and @vitest/coverage-v8 5.0.0 (engines `^22.12||^24||>=26`);
knip 6.35.1; publint 0.3.24; @arethetypeswrong/cli 0.18.5;
eslint-plugin-import-x 4.17.1; @vitest/eslint-plugin 1.6.27;
eslint-plugin-jsdoc 64.4.0 (engines `^22.22.2||>=24.15`); eslint-plugin-tsdoc
0.5.2; eslint-plugin-unicorn 74.0.0 (peer `eslint >=10.4`); eslint-plugin-n
18.3.0; eslint-plugin-regexp 3.3.0; globals 17.12.0; @changesets/cli 3.0.3;
lefthook 2.1.14; syncpack 15.3.3.

- TypeScript 7.0 announcement (no compiler API in 7.0):
  https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- typescript-eslint TS 7 tracking: https://github.com/typescript-eslint/typescript-eslint/issues/10940
- TypeScript 6.0 release notes (changed defaults, deprecations):
  https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html
- TypeScript 5.9 release notes / new `tsc --init` defaults:
  https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-9.html
- Project references: https://www.typescriptlang.org/docs/handbook/project-references.html
- `@tsconfig/strictest`: https://github.com/tsconfig/bases/blob/main/bases/strictest.json
- TSConfig cheat sheet (Pocock): https://www.totaltypescript.com/tsconfig-cheat-sheet
- ESLint v10 release and migration: https://eslint.org/blog/2026/02/eslint-v10.0.0-released/ ,
  https://eslint.org/docs/latest/use/migrate-to-10.0.0
- typescript-eslint typed linting / configs / v8 notes:
  https://typescript-eslint.io/getting-started/typed-linting/ ,
  https://typescript-eslint.io/users/configs/ ,
  https://typescript-eslint.io/blog/announcing-typescript-eslint-v8/
- Rule docs cited: switch-exhaustiveness-check, explicit-module-boundary-types,
  consistent-type-imports (conflict note with `verbatimModuleSyntax`),
  no-floating-promises (`ignoreVoid` default), restrict-template-expressions
  (partial-override gotcha) — all under https://typescript-eslint.io/rules/
- eslint-plugin-import-x: https://github.com/un-ts/eslint-plugin-import-x
- eslint-plugin-n: https://github.com/eslint-community/eslint-plugin-n
- eslint-plugin-unicorn: https://github.com/sindresorhus/eslint-plugin-unicorn
- eslint-plugin-jsdoc: https://github.com/gajus/eslint-plugin-jsdoc
- eslint-plugin-tsdoc / TSDoc spec: https://tsdoc.org/ ,
  https://tsdoc.org/pages/packages/eslint-plugin-tsdoc/
- API Extractor doc-comment syntax / release tags: https://api-extractor.com/pages/tsdoc/doc_comment_syntax/
- FluidFramework TSDoc guidelines: https://github.com/microsoft/FluidFramework/wiki/TSDoc-Guidelines
- Vitest 5 blog / migration / coverage / typecheck / projects:
  https://vitest.dev/blog/vitest-5 , https://vitest.dev/guide/migration ,
  https://vitest.dev/config/coverage , https://vitest.dev/config/typecheck
- @vitest/eslint-plugin: https://github.com/vitest-dev/eslint-plugin-vitest
- knip v6 and monorepo config: https://knip.dev/blog/knip-v6 ,
  https://knip.dev/features/monorepos-and-workspaces
- depcheck deprecation: https://github.com/depcheck/depcheck
- publint rules: https://publint.dev/rules
- arethetypeswrong CLI: https://github.com/arethetypeswrong/arethetypeswrong.github.io/blob/main/packages/cli/README.md
- npm workspaces do not support `workspace:` protocol: https://github.com/npm/cli/issues/8845
- npm 12 changelog (install-scripts policy, `min-release-age`):
  https://docs.npmjs.com/cli/v12/using-npm/changelog/
- npm trusted publishing: https://docs.npmjs.com/trusted-publishers/
- Changesets v3: https://changesets.dev/blog/announcing-changesets-v3
- Node.js release schedule: https://nodejs.org/dist/index.json
- ESM-only libraries and `require(esm)`: https://nodejs.org/api/esm.html
- `@types/node` should track the lowest supported major:
  https://github.com/DefinitelyTyped/DefinitelyTyped/discussions/69418
- actions/setup-node: https://github.com/actions/setup-node
- GitHub Actions security hardening: https://docs.github.com/en/actions/reference/security/secure-use
- Dependabot options (cooldown): https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference
- RFC 8252 §7.3 (loopback redirect): https://www.rfc-editor.org/rfc/rfc8252#section-7.3

Unverified in this pass (check before relying on them): exact flat-config
export names for eslint-plugin-n v18; API Extractor's compatibility with
TypeScript 6 typings; the TS 7.1 release timing.
