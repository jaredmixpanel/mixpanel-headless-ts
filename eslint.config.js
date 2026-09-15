// ESLint flat config for the mixpanel-headless-ts workspace (ESLint 10,
// `defineConfig` / `globalIgnores` from "eslint/config").
//
// Shape and rule decisions: CLEANUP-PLAN.md §8 (Phase 4). Every rule is
// either enforced (`error`) or `off` with a one-line reason; nothing is ever
// `warn` (a load-time assertion at the bottom guarantees that). Rules whose
// fixes are still being hand-applied are configured in full in the main
// blocks and parked `off` inside the delimited "Phase 4 lane" blocks near
// the end — landing a lane means deleting its block. To see a lane's errors
// before it lands, drop its block for one run:
//
//     MP_LINT_UNPARK=L2 npx eslint packages/core/src      # one lane
//     MP_LINT_UNPARK=all npx eslint . -f json              # everything
//
// Purity boundary: packages/core is isomorphic and packages/browser is
// browser-only. Neither may import Node built-ins (`node:*`, `fs`, `path`,
// `os`) or `undici`, nor touch the `process` global. Enforced here and by the
// browser-bundle smoke (scripts/browser-smoke.mjs) wired into `npm run check`.

import process from "node:process";

import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import importPlugin from "eslint-plugin-import-x";
import jsdocPlugin from "eslint-plugin-jsdoc";
import n from "eslint-plugin-n";
import regexp from "eslint-plugin-regexp";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import tsdoc from "eslint-plugin-tsdoc";
import unicorn from "eslint-plugin-unicorn";
import globals from "globals";
import tseslint from "typescript-eslint";

import { eslintIgnorePatterns } from "./scripts/lib/lint-ignores.mjs";
import { WORKSPACE_ALIASES } from "./scripts/lib/workspace-aliases.mjs";

// ---------------------------------------------------------------------------
// File groups
// ---------------------------------------------------------------------------

const LIBRARY_SRC = ["packages/*/src/**/*.ts"];
const TEST_FILES = [
  "packages/*/test/**/*.ts",
  "packages/core/test-support/**/*.ts",
  "conformance-runner/test/**/*.ts",
  "differential/test/**/*.ts",
  "tests/**/*.ts",
];
// Everything that runs under Node. Core/browser tests run under vitest (Node)
// too, but they must not grow Node imports by accident, so they are left out.
const NODE_FILES = [
  "packages/node/**/*.ts",
  "conformance-runner/**/*.ts",
  "differential/**/*.ts",
  "scripts/**/*.{mjs,mts}",
  "tests/**/*.ts",
  "vitest.config.ts",
  "eslint.config.js",
];
const JS_FILES = ["**/*.{js,mjs,cjs}"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Upstream presets that still ship `warn`: normalise them to `error`. */
function errorsOnly(config) {
  return {
    ...config,
    rules: Object.fromEntries(
      Object.entries(config.rules ?? {}).map(([rule, entry]) => {
        if (entry === "warn" || entry === 1) {
          return [rule, "error"];
        }
        if (Array.isArray(entry) && (entry[0] === "warn" || entry[0] === 1)) {
          return [rule, ["error", ...entry.slice(1)]];
        }
        return [rule, entry];
      }),
    ),
  };
}

const CORE_PURITY_MESSAGE =
  "packages/core is isomorphic and packages/browser is browser-only: no " +
  "Node built-ins, no undici. Node-specific code belongs in packages/node.";

const CROSS_PACKAGE_MESSAGE =
  "Never reach into another workspace by relative path; import the bare " +
  "specifier (@mixpanel-headless/core, …/core/internal, …/node, …/browser).";

/**
 * `no-restricted-imports` options: forbid relative imports into any other
 * workspace's `src/` (Phase 3 made this zero; `import-x/no-relative-packages`
 * catches the resolved form, this catches the spelling), optionally plus the
 * core/browser purity boundary.
 */
function restrictedImports({ ownPackage, purity }) {
  const otherPackages = ["core", "node", "browser"].filter(
    (p) => p !== ownPackage,
  );
  const patterns = [
    {
      group: [
        "**/packages/*/src/**",
        ...otherPackages.map((p) => `**/${p}/src/**`),
        "**/conformance-runner/src/**",
      ],
      message: CROSS_PACKAGE_MESSAGE,
    },
  ];
  const paths = [];
  if (purity) {
    patterns.push({ group: ["node:*"], message: CORE_PURITY_MESSAGE });
    for (const name of ["fs", "path", "os", "undici"]) {
      paths.push({ name, message: CORE_PURITY_MESSAGE });
    }
  }
  return ["error", { paths, patterns }];
}

/** `import-x/no-extraneous-dependencies` for one workspace (root deps hoist). */
function noExtraneous(...packageDirs) {
  return [
    "error",
    {
      packageDir: [
        import.meta.dirname,
        ...packageDirs.map((d) => `${import.meta.dirname}/${d}`),
      ],
      devDependencies: [
        "**/test/**",
        "**/test-support/**",
        "tests/**",
        "scripts/**",
        "conformance-runner/**",
        "differential/**",
        "eslint.config.js",
        "vitest.config.ts",
      ],
      optionalDependencies: false,
      peerDependencies: false,
    },
  ];
}

const NO_PROCESS_GLOBAL = [
  "error",
  {
    name: "process",
    message:
      "packages/core and packages/browser must not read process (env is " +
      "node-only); inject configuration instead.",
  },
];

// ---------------------------------------------------------------------------
// Lane blocks (Phase 4 hand-fix categories; CLEANUP-PLAN.md §8.4)
// ---------------------------------------------------------------------------

const UNPARKED = new Set(
  (process.env["MP_LINT_UNPARK"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

/** A lane block is an ordinary config object unless the lane is unparked. */
function lane(id, config) {
  if (UNPARKED.has("all") || UNPARKED.has(id)) {
    return [];
  }
  return [{ name: `phase4-lane-${id}`, ...config }];
}

const config = defineConfig([
  globalIgnores(eslintIgnorePatterns(), "repo/ignores"),

  // -------------------------------------------------------------------------
  // Presets
  // -------------------------------------------------------------------------
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  errorsOnly(importPlugin.flatConfigs.recommended),
  importPlugin.flatConfigs.typescript,
  errorsOnly(regexp.configs["flat/recommended"]),
  unicorn.configs.recommended,

  {
    name: "repo/typed-parser",
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      "import-x/resolver-next": [
        createTypeScriptImportResolver({
          alwaysTryTypes: true,
          noWarnOnMultipleProjects: true,
          project: [
            "packages/core/tsconfig.json",
            "packages/core/tsconfig.test.json",
            "packages/node/tsconfig.json",
            "packages/node/tsconfig.test.json",
            "packages/browser/tsconfig.json",
            "packages/browser/tsconfig.test.json",
            "conformance-runner/tsconfig.json",
            "differential/tsconfig.json",
            "scripts/tsconfig.json",
            "tsconfig.tests.json",
          ],
          // The published `exports` maps point at dist/; lint resolves the
          // bare specifiers to src/ through the one shared alias table so a
          // stale or missing build never changes lint results.
          alias: Object.fromEntries(
            WORKSPACE_ALIASES.map(([specifier, sourcePath]) => [
              specifier,
              [sourcePath],
            ]),
          ),
        }),
      ],
      "import-x/internal-regex": "^@mixpanel-headless/",
      jsdoc: {
        mode: "typescript",
        tagNamePreference: {
          // TSDoc spellings.
          return: "returns",
          arg: "param",
          argument: "param",
          exception: "throws",
          inheritdoc: "inheritDoc",
        },
      },
    },
  },

  // -------------------------------------------------------------------------
  // Every file: preset adjustments and rules that are off with a reason
  // -------------------------------------------------------------------------
  {
    name: "repo/all-files",
    plugins: { "simple-import-sort": simpleImportSort },
    rules: {
      // --- import-x -------------------------------------------------------
      "import-x/first": "error",
      "import-x/newline-after-import": "error",
      "import-x/no-duplicates": ["error", { "prefer-inline": true }],
      "import-x/no-self-import": "error",
      "import-x/no-relative-packages": "error",
      "import-x/no-useless-path-segments": ["error", { noUselessIndex: false }],
      "import-x/no-named-as-default": "error",
      // simple-import-sort instead of import-x/order: the latter's fixer
      // oscillated with `consistent-type-imports` / `no-duplicates` on
      // mixed inline-type imports and bails on comment-separated blocks.
      // Groups: side effects, node: builtins, packages, workspace
      // specifiers, absolute, relative — a blank line between groups.
      "simple-import-sort/imports": [
        "error",
        {
          groups: [
            [String.raw`^\u0000`],
            ["^node:"],
            [String.raw`^@?\w`],
            ["^@mixpanel-headless/"],
            ["^"],
            [String.raw`^\.`],
          ],
        },
      ],
      "simple-import-sort/exports": "error",
      // import-x's no-cycle skips type-only imports unconditionally (there
      // is no `ignoreTypeImports` option in 4.x), so this already is the
      // "types ignored" form; the remaining hits are the real cycles Phase 6
      // §10.4 breaks (lane L7).
      "import-x/no-cycle": "error",
      // tsc (NodeNext) already rejects unresolved specifiers and invalid
      // default imports; import-x's second pass cannot see `export =`
      // packages (typescript) or `?raw` query imports.
      "import-x/no-unresolved": "off",
      "import-x/default": "off",
      // Default-import namespaces (`fc.assert`, `ts.factory`, a plugin's
      // `configs`) are the documented API of those packages; the rule
      // cannot tell them from a mistaken default import.
      "import-x/no-named-as-default-member": "off",

      // --- unicorn: off (with reasons) -----------------------------------
      // Identifier vocabulary is a style choice this codebase does not make.
      "unicorn/prevent-abbreviations": "off",
      "unicorn/name-replacements": "off",
      "unicorn/consistent-boolean-name": "off",
      // The port models Python `None` as `null`.
      "unicorn/no-null": "off",
      // `reduce` is used deliberately and readably.
      "unicorn/no-array-reduce": "off",
      // Prettier owns literal and comment layout.
      "unicorn/numeric-separators-style": "off",
      "unicorn/single-line-block-comment-style": "off",
      // Scripts already use top-level await where it applies; the rule is
      // noisy on library entry points that cannot.
      "unicorn/prefer-top-level-await": "off",
      // Python float literals (`1.0`) are mirrored on purpose in compat code
      // and fixtures: the spelling documents float-ness even though JS
      // numbers do not keep it.
      "unicorn/no-zero-fractions": "off",
      // Member ordering is off (see `@typescript-eslint/member-ordering`).
      "unicorn/consistent-class-member-order": "off",
      // Fixture builders and codec tables nest calls legitimately.
      "unicorn/max-nested-calls": "off",
      // Entity-model statics name the concrete class deliberately (D10);
      // switching to `this` changes behaviour under subclassing.
      "unicorn/class-reference-in-static-methods": "off",
      // In-place `sort()` / `reverse()` are intentional where used; the
      // copying variants allocate and are covered by the typed
      // `require-array-sort-compare`.
      "unicorn/no-array-sort": "off",
      "unicorn/no-array-reverse": "off",
      // Duplicate of the type-aware @typescript-eslint rules (which know a
      // string[] needs no comparator and which template literals are useless).
      "unicorn/require-array-sort-compare": "off",
      // `.then()` chains in OAuth flows and tests are deliberate; `.then(a, b)`
      // and `.then(a).catch(b)` differ in what `catch` sees.
      "unicorn/prefer-await": "off",
      "unicorn/prefer-then-catch": "off",
      // Named imports from `node:path` & co. are this repo's convention.
      "unicorn/import-style": "off",
      // Inner helpers that close over test state are fine; hoisting them is
      // churn with no behavioural gain.
      "unicorn/consistent-function-scoping": "off",
      // Readability calls this codebase makes the other way.
      "unicorn/no-unreadable-for-of-expression": "off",
      "unicorn/prefer-simple-condition-first": "off",
      "unicorn/no-break-in-nested-loop": "off",
      "unicorn/prefer-ternary": "off",
      "unicorn/no-declarations-before-early-exit": "off",
      "unicorn/prefer-includes-over-repeated-comparisons": "off",
      "unicorn/no-await-expression-member": "off",
      // The ternary form `...(cond ? { a } : {})` is used consistently and
      // reads explicitly; `...(cond && { a })` relies on a spread quirk.
      "unicorn/consistent-conditional-object-spread": "off",
      // Lazily-initialised module-level caches and one-time module init
      // (inspect hooks, codec registration) are deliberate.
      "unicorn/no-top-level-assignment-in-function": "off",
      "unicorn/no-top-level-side-effects": "off",
      // compat/ chooses UTF-16 code units vs code points per site to match
      // CPython; `Number.isInteger` vs `isSafeInteger` likewise.
      "unicorn/prefer-code-point": "off",
      "unicorn/prefer-number-is-safe-integer": "off",
      // `Number.NaN` / `Number.POSITIVE_INFINITY` are explicit and cannot be
      // shadowed; the float-compat code prefers them.
      "unicorn/prefer-global-number-constants": "off",
      // Not in the `es2023` lib the packages compile against (typecheck
      // would fail): Iterator helpers, Set methods, Array.fromAsync,
      // Promise.withResolvers, Promise.try (Node 24+).
      "unicorn/prefer-iterator-to-array": "off",
      "unicorn/prefer-iterator-helpers": "off",
      "unicorn/prefer-set-methods": "off",
      "unicorn/prefer-array-from-async": "off",
      "unicorn/prefer-promise-with-resolvers": "off",
      "unicorn/prefer-promise-try": "off",
      // `JSON.parse(JSON.stringify())` round-trips are deliberate (they drop
      // `undefined` and class instances the way the wire does).
      "unicorn/prefer-structured-clone": "off",
      // Fixture URLs and loopback OAuth redirect URIs are `http://` by design.
      "unicorn/prefer-https": "off",
      // Tests traverse a hand-rolled DOM stub that has no `firstElementChild`.
      "unicorn/better-dom-traversing": "off",
      // compat/ and the JSON scanners spell control/ASCII ranges as
      // `\xNN` / `\uNNNN` exactly as the RFCs and CPython tables they
      // mirror do.
      "unicorn/prefer-unicode-code-point-escapes": "off",
      // Comparators sort by code point on purpose (Python parity);
      // `localeCompare` / subtraction would change the order.
      "unicorn/prefer-simple-sort-comparator": "off",

      // --- regexp ---------------------------------------------------------
      // Regex sources mirror Python / server patterns byte-for-byte in
      // places (report-links.test.ts pins `SLUG_RE.source`); the
      // shorter-spelling rewrites are not a goal here.
      "regexp/prefer-w": "off",
      "regexp/prefer-d": "off",
      "regexp/use-ignore-case": "off",

      // --- core ESLint ----------------------------------------------------
      curly: ["error", "all"],
      // `== null` is the idiomatic "is None" check; everything else strict.
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
      "no-param-reassign": ["error", { props: false }],
      "no-nested-ternary": "error",
      "no-else-return": ["error", { allowElseIf: false }],
      "no-lonely-if": "error",
      "object-shorthand": ["error", "always"],
      "prefer-template": "error",
      "no-useless-assignment": "error",
      // Library sources re-enable it below; scripts, rig CLIs and tests log.
      "no-console": "off",
      complexity: ["error", 20],
      "max-depth": ["error", 4],
      "max-params": ["error", 5],
    },
  },

  // -------------------------------------------------------------------------
  // Every TypeScript file
  // -------------------------------------------------------------------------
  {
    name: "repo/typescript",
    files: ["**/*.ts", "**/*.mts"],
    plugins: { tsdoc },
    extends: [errorsOnly(jsdocPlugin.configs["flat/recommended-tsdoc-error"])],
    rules: {
      // --- typescript-eslint: autofixable style (on now) -------------------
      "@typescript-eslint/dot-notation": [
        "error",
        // D9: `obj["key"]` is the deliberate signal for index signatures.
        { allowIndexSignaturePropertyAccess: true },
      ],
      "@typescript-eslint/array-type": [
        "error",
        { default: "array-simple", readonly: "array-simple" },
      ],
      "@typescript-eslint/method-signature-style": ["error", "property"],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "inline-type-imports",
          // vitest's `importOriginal<typeof import("./x.js")>()` idiom.
          disallowTypeAnnotations: false,
        },
      ],
      "@typescript-eslint/consistent-type-exports": [
        "error",
        { fixMixedExportsWithInlineTypeSpecifier: true },
      ],
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/no-inferrable-types": "error",
      "@typescript-eslint/consistent-indexed-object-style": ["error", "record"],
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-unnecessary-template-expression": "error",
      "@typescript-eslint/no-confusing-void-expression": "error",
      "@typescript-eslint/prefer-optional-chain": "error",
      // Its fix (`x as T` → `x!`) is exactly what `no-non-null-assertion`
      // forbids in source, where narrowing helpers are wanted instead; the
      // test block re-enables it (tests may use `!`).
      "@typescript-eslint/non-nullable-type-assertion-style": "off",

      // --- typescript-eslint: hand-fix categories (parked in lanes) -------
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          // Every flag stated: a partial override silently resets the rest.
          allowNumber: true,
          allowBoolean: false,
          allowAny: false,
          allowNullish: false,
          allowRegExp: false,
          allowNever: false,
        },
      ],
      "@typescript-eslint/restrict-plus-operands": [
        "error",
        {
          allowAny: false,
          allowBoolean: false,
          allowNullish: false,
          allowNumberAndString: false,
          allowRegExp: false,
          skipCompoundAssignments: false,
        },
      ],
      "@typescript-eslint/no-base-to-string": "error",
      "@typescript-eslint/no-unnecessary-type-conversion": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      "@typescript-eslint/no-redundant-type-constituents": "error",
      "@typescript-eslint/no-unnecessary-type-parameters": "error",
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        {
          considerDefaultExhaustiveForUnions: false,
          requireDefaultForNonUnion: true,
        },
      ],
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/no-misused-spread": "error",
      "@typescript-eslint/unbound-method": "error",
      "@typescript-eslint/require-array-sort-compare": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/require-await": "error",
      "no-shadow": "off", // superseded by the type-aware @typescript-eslint/no-shadow
      "@typescript-eslint/no-shadow": [
        "error",
        { builtinGlobals: false, hoist: "all", ignoreTypeValueShadow: true },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-dynamic-delete": "error",
      "no-empty-function": "off", // superseded by @typescript-eslint/no-empty-function
      "@typescript-eslint/no-empty-function": "error",
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/no-useless-default-assignment": "error",
      "@typescript-eslint/naming-convention": [
        "error",
        // D1: camelCase identifiers everywhere; snake_case only for
        // wire/contract properties (directory-scoped block below).
        {
          selector: "default",
          format: ["camelCase"],
          leadingUnderscore: "forbid",
          trailingUnderscore: "forbid",
        },
        { selector: "import", format: ["camelCase", "PascalCase"] },
        {
          selector: "variable",
          format: ["camelCase", "UPPER_CASE", "PascalCase"],
        },
        { selector: "variable", modifiers: ["destructured"], format: null },
        { selector: "function", format: ["camelCase", "PascalCase"] },
        {
          selector: "parameter",
          format: ["camelCase"],
          leadingUnderscore: "allow",
        },
        { selector: "typeLike", format: ["PascalCase"] },
        {
          selector: "memberLike",
          modifiers: ["private"],
          format: ["camelCase"],
          leadingUnderscore: "forbid",
        },
        {
          selector: ["classProperty", "objectLiteralProperty", "typeProperty"],
          modifiers: ["requiresQuotes"],
          format: null,
        },
        {
          selector: ["objectLiteralProperty", "typeProperty"],
          format: ["camelCase", "UPPER_CASE"],
        },
      ],

      // --- typescript-eslint: off ------------------------------------------
      // 603 hits, purely stylistic, and it fights `require-await` here.
      "@typescript-eslint/promise-function-async": "off",
      // 361 hits, low value; a light config may land after Phase 6 (lane L7).
      "@typescript-eslint/member-ordering": "off",
      // High noise in an `unknown`-heavy port; `no-unnecessary-condition`
      // covers the useful part.
      "@typescript-eslint/strict-boolean-expressions": "off",

      // --- tsdoc / jsdoc ---------------------------------------------------
      "tsdoc/syntax": "error",
      "jsdoc/no-types": "error",
      "jsdoc/require-hyphen-before-param-description": ["error", "always"],
      // One blank line between the description and the first tag, none
      // between tags (TSDoc layout).
      "jsdoc/tag-lines": ["error", "never", { startLines: 1 }],
    },
  },

  // -------------------------------------------------------------------------
  // Library sources (packages/*/src): the published contract
  // -------------------------------------------------------------------------
  {
    name: "repo/library-src",
    files: LIBRARY_SRC,
    rules: {
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      "no-console": "error",
      // `isolatedDeclarations` demands explicit annotations on exported
      // bindings and class properties; these two fixers would strip them
      // (`readonly m: Map<K, V> = new Map()` is the required spelling).
      "@typescript-eslint/no-inferrable-types": "off",
      "@typescript-eslint/consistent-generic-constructors": "off",
      "max-lines": [
        "error",
        { max: 800, skipBlankLines: true, skipComments: true },
      ],
      "max-lines-per-function": [
        "error",
        { max: 120, skipBlankLines: true, skipComments: true },
      ],
      "jsdoc/require-jsdoc": [
        "error",
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            ClassDeclaration: true,
            MethodDefinition: true,
            ArrowFunctionExpression: true,
          },
        },
      ],
      "jsdoc/require-description": "error",
      "jsdoc/require-throws": "error",
      "jsdoc/require-example": [
        "error",
        {
          contexts: [
            "ClassDeclaration",
            "ExportNamedDeclaration > FunctionDeclaration",
          ],
        },
      ],
      "jsdoc/require-param-description": "error",
      "jsdoc/require-returns": "error",
    },
  },
  {
    // D1: wire/contract shapes and Python-mirroring option bags keep their
    // snake_case property names.
    name: "repo/library-src/snake-case-contracts",
    files: [
      "packages/core/src/types/entities/**/*.ts",
      "packages/core/src/types/results/**/*.ts",
      "packages/core/src/types/query-params/**/*.ts",
      "packages/core/src/bookmarks/**/*.ts",
      "packages/core/src/errors.ts",
      "packages/core/src/workspace-query-params.ts",
    ],
    rules: {
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "default",
          format: ["camelCase"],
          leadingUnderscore: "forbid",
          trailingUnderscore: "forbid",
        },
        { selector: "import", format: ["camelCase", "PascalCase"] },
        {
          selector: "variable",
          format: ["camelCase", "UPPER_CASE", "PascalCase"],
        },
        { selector: "variable", modifiers: ["destructured"], format: null },
        { selector: "function", format: ["camelCase", "PascalCase"] },
        {
          selector: "parameter",
          format: ["camelCase"],
          leadingUnderscore: "allow",
        },
        { selector: "typeLike", format: ["PascalCase"] },
        {
          selector: "memberLike",
          modifiers: ["private"],
          format: ["camelCase"],
          leadingUnderscore: "forbid",
        },
        {
          selector: ["classProperty", "objectLiteralProperty", "typeProperty"],
          modifiers: ["requiresQuotes"],
          format: null,
        },
        {
          selector: ["classProperty", "objectLiteralProperty", "typeProperty"],
          format: ["camelCase", "snake_case", "UPPER_CASE"],
        },
      ],
    },
  },

  // -------------------------------------------------------------------------
  // Workspace boundaries
  // -------------------------------------------------------------------------
  {
    name: "repo/boundary/core",
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-imports": restrictedImports({
        ownPackage: "core",
        purity: true,
      }),
      "no-restricted-globals": NO_PROCESS_GLOBAL,
      "import-x/no-extraneous-dependencies": noExtraneous("packages/core"),
    },
  },
  {
    name: "repo/boundary/browser",
    files: ["packages/browser/**/*.ts"],
    rules: {
      "no-restricted-imports": restrictedImports({
        ownPackage: "browser",
        purity: true,
      }),
      "no-restricted-globals": NO_PROCESS_GLOBAL,
      "import-x/no-extraneous-dependencies": noExtraneous("packages/browser"),
    },
  },
  {
    name: "repo/boundary/node",
    files: ["packages/node/**/*.ts"],
    rules: {
      "no-restricted-imports": restrictedImports({
        ownPackage: "node",
        purity: false,
      }),
      "import-x/no-extraneous-dependencies": noExtraneous("packages/node"),
    },
  },
  {
    name: "repo/boundary/rig",
    files: [
      "conformance-runner/**/*.ts",
      "differential/**/*.ts",
      "scripts/**",
      "tests/**/*.ts",
      "vitest.config.ts",
      "eslint.config.js",
    ],
    rules: {
      "no-restricted-imports": restrictedImports({
        ownPackage: null,
        purity: false,
      }),
      "import-x/no-extraneous-dependencies": noExtraneous(
        "conformance-runner",
        "differential",
      ),
    },
  },

  // -------------------------------------------------------------------------
  // Node-side code: platform package, rig, scripts, repo-level tests
  // -------------------------------------------------------------------------
  {
    name: "repo/node",
    files: NODE_FILES,
    extends: [n.configs["flat/recommended-module"]],
    languageOptions: { globals: globals.node },
    settings: {
      // The lowest runtime any of this must run on is the packages' floor
      // (`engines.node >=22.12`); the root manifest's higher dev floor is a
      // tooling constraint, not an API one.
      node: { version: ">=22.12" },
    },
    rules: {
      "n/prefer-node-protocol": "error",
      "n/no-unsupported-features/es-builtins": "error",
      "n/no-unsupported-features/es-syntax": [
        "error",
        { ignores: ["modules"] },
      ],
      "n/no-unsupported-features/node-builtins": [
        "error",
        {
          // Shipped unflagged well before 22.12 (WHATWG streams since 18,
          // webcrypto global since 19, import.meta.dirname since 20.11);
          // n still labels them "experimental" from the docs' stability index.
          ignores: [
            "ReadableStream",
            "DecompressionStream",
            "crypto",
            "import.meta.dirname",
          ],
        },
      ],
      "n/no-extraneous-import": "error",
      "n/no-unpublished-import": "error",
      // tsc's NodeNext resolution is authoritative; n's resolver misses
      // `exports` subpaths (`ajv/dist/2020.js`) and `.mjs` imported from TS.
      "n/no-missing-import": "off",
    },
  },

  // -------------------------------------------------------------------------
  // Tests
  // -------------------------------------------------------------------------
  {
    name: "repo/tests",
    files: TEST_FILES,
    extends: [errorsOnly(vitest.configs.recommended)],
    rules: {
      "vitest/consistent-test-it": [
        "error",
        { fn: "it", withinDescribe: "it" },
      ],
      "vitest/prefer-strict-equal": "error",
      "vitest/prefer-to-be": "error",
      "vitest/prefer-to-have-length": "error",
      "vitest/require-to-throw-message": "error",
      "vitest/prefer-expect-resolves": "error",
      "vitest/no-conditional-tests": "error",
      "vitest/prefer-hooks-on-top": "error",
      "vitest/no-disabled-tests": "error",
      "vitest/consistent-test-filename": [
        "error",
        { pattern: String.raw`\.test\.ts$` },
      ],
      // Default options only: rejecting `test_` prefixes is Phase 5.4 (D7).
      "vitest/valid-title": "error",
      // vitest's `expect(actual, message)` form.
      "vitest/valid-expect": ["error", { maxArgs: 2 }],
      "vitest/expect-expect": [
        "error",
        { assertFunctionNames: ["expect", "expect*", "assert*"] },
      ],

      // §8.3 relaxations.
      "@typescript-eslint/no-non-null-assertion": "off", // fixtures assert shape by construction
      "@typescript-eslint/non-nullable-type-assertion-style": "error",
      "@typescript-eslint/no-unsafe-assignment": "off", // fixture JSON
      "@typescript-eslint/no-unsafe-argument": "off", // fixture JSON
      "@typescript-eslint/no-unsafe-call": "off", // fixture JSON
      "@typescript-eslint/no-unsafe-member-access": "off", // fixture JSON
      "@typescript-eslint/no-unsafe-return": "off", // fixture JSON
      "@typescript-eslint/explicit-module-boundary-types": "off", // no public contract in tests
      "@typescript-eslint/explicit-function-return-type": "off", // no public contract in tests
      "@typescript-eslint/no-empty-function": "off", // stub sinks
      "@typescript-eslint/unbound-method": "off", // `vi.fn` references
      "max-lines": "off", // fixture-heavy files
      "max-lines-per-function": "off", // describe blocks
      "jsdoc/require-jsdoc": "off", // docstrings are a source-contract concern
      "jsdoc/require-description": "off",
      "jsdoc/require-throws": "off",
      "jsdoc/require-example": "off",
      "jsdoc/require-param": "off",
      "jsdoc/require-param-description": "off",
      "jsdoc/require-returns": "off",
      "jsdoc/require-returns-description": "off",
      "jsdoc/require-yields": "off",
      "jsdoc/require-property": "off",
      // node/browser tests reach packages/core/test-support/ relatively (the
      // one sanctioned exception, CLAUDE.md) and the vendored-contract type
      // tests read vendor/ relatively; source boundaries are enforced by
      // `no-restricted-imports` above.
      "import-x/no-relative-packages": "off",
    },
  },

  // -------------------------------------------------------------------------
  // Plain JavaScript (repo scripts, this config): untyped lint
  // -------------------------------------------------------------------------
  {
    name: "repo/javascript",
    files: JS_FILES,
    extends: [
      tseslint.configs.disableTypeChecked,
      errorsOnly(jsdocPlugin.configs["flat/recommended-error"]),
    ],
    languageOptions: { globals: globals.node },
    rules: {
      "jsdoc/require-hyphen-before-param-description": ["error", "always"],
      "jsdoc/tag-lines": ["error", "never", { startLines: 1 }],
      // Phase 9 (§13.1) gives every script a shebang + exec bit; until
      // then the rule strips the shebangs that already exist.
      "n/hashbang": "off",
      // Scripts are CLIs: a non-zero `process.exit` is their contract.
      "n/no-process-exit": "off",
      "unicorn/no-process-exit": "off",
    },
  },

  // -------------------------------------------------------------------------
  // Phase 4 lanes — hand-fix categories parked until each lane lands.
  // Each block lists the rules it owns and sets them `off`; the full rule
  // configuration lives above, so landing a lane is "delete the block".
  // -------------------------------------------------------------------------

  // --- Phase 4 lane L1: stringification — pending; delete this block when the lane lands ---
  ...lane("L1", {
    rules: {
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/restrict-plus-operands": "off",
      "@typescript-eslint/no-unnecessary-type-conversion": "off",
      "@typescript-eslint/no-unnecessary-template-expression": "off",
      "unicorn/no-useless-template-literals": "off",
      "unicorn/no-incorrect-template-string-interpolation": "off",
    },
  }),

  // --- Phase 4 lane L2: unnecessary conditions / types — pending; delete this block when the lane lands ---
  ...lane("L2", {
    // no-unnecessary-type-assertion's fixer leaves the cast's type import
    // unused and no-confusing-void-expression's breaks `(): unknown =>`
    // arrows, so both are applied in this lane (`MP_LINT_UNPARK=L2
    // eslint --fix`) with the fallout fixed by hand, not mechanically.
    rules: {
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/prefer-nullish-coalescing": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/no-unnecessary-type-parameters": "off",
      "@typescript-eslint/prefer-optional-chain": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/prefer-find": "off",
      // Its fixer (`x as T` → `x!`) produces `a?.b!`, which
      // no-non-null-asserted-optional-chain then rejects — apply by hand.
      "@typescript-eslint/non-nullable-type-assertion-style": "off",
      "unicorn/prefer-else-if": "off",
      "unicorn/prefer-logical-operator-over-ternary": "off",
      "unicorn/prefer-minimal-ternary": "off",
      "unicorn/no-duplicate-if-branches": "off",
    },
  }),

  // --- Phase 4 lane L3b: semantics-sensitive autofixers — pending; L3 applies these one rule at a time against the corpus ---
  ...lane("L3b", {
    rules: {
      "unicorn/prefer-spread": "off",
      "unicorn/no-for-each": "off",
      "unicorn/no-useless-undefined": "off",
      "unicorn/prefer-at": "off",
      "unicorn/prefer-response-static-json": "off",
      "unicorn/prefer-type-error": "off",
    },
  }),

  // --- Phase 4 lane L4: tests — pending; delete this block when the lane lands ---
  ...lane("L4", {
    files: TEST_FILES,
    rules: {
      "vitest/prefer-strict-equal": "off",
      "vitest/no-conditional-expect": "off",
      "vitest/expect-expect": "off",
      "vitest/no-standalone-expect": "off",
      "vitest/valid-title": "off",
      "vitest/no-conditional-tests": "off",
      "vitest/require-to-throw-message": "off",
      "vitest/prefer-expect-resolves": "off",
      "vitest/no-disabled-tests": "off",
      "vitest/prefer-hooks-on-top": "off",
      "vitest/consistent-test-filename": "off",
    },
  }),

  // --- Phase 4 lane L5: jsdoc/tsdoc content — pending; lands at the end of Phase 5 (its acceptance criteria) ---
  ...lane("L5", {
    rules: {
      "jsdoc/require-jsdoc": "off",
      "jsdoc/require-description": "off",
      "jsdoc/require-throws": "off",
      "jsdoc/require-example": "off",
      "jsdoc/require-param": "off",
      "jsdoc/require-param-description": "off",
      "jsdoc/require-returns": "off",
      "jsdoc/require-returns-description": "off",
      "jsdoc/require-returns-check": "off",
      "jsdoc/require-yields": "off",
      "jsdoc/check-param-names": "off",
      "jsdoc/check-tag-names": "off",
      "jsdoc/empty-tags": "off",
      "jsdoc/valid-types": "off",
      "jsdoc/escape-inline-tags": "off",
      "tsdoc/syntax": "off",
    },
  }),

  // --- Phase 4 lane L6: naming (D1) — pending; delete this block when the lane lands ---
  ...lane("L6", {
    rules: {
      "@typescript-eslint/naming-convention": "off",
      "unicorn/no-non-function-verb-prefix": "off",
      "unicorn/consistent-compound-words": "off",
    },
  }),

  // --- Phase 4 lane L7: size / complexity / real import cycles — lands after Phase 6 ---
  ...lane("L7", {
    rules: {
      complexity: "off",
      "max-depth": "off",
      "max-params": "off",
      "max-lines": "off",
      "max-lines-per-function": "off",
      "import-x/no-cycle": "off",
    },
  }),

  // Prettier owns formatting: last, so it switches off every stylistic rule
  // the presets above may have enabled.
  prettier,
]);

// Nothing may be `warn`: a rule is enforced or it is off with a reason.
for (const entry of config) {
  for (const [rule, value] of Object.entries(entry.rules ?? {})) {
    const severity = Array.isArray(value) ? value[0] : value;
    if (severity === "warn" || severity === 1) {
      throw new Error(
        `eslint.config.js: ${rule} is "warn" in ${entry.name ?? "<unnamed>"}; use "error" or "off" with a reason`,
      );
    }
  }
}

export default config;
