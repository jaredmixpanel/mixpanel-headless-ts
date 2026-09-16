// ESLint flat config for the mixpanel-headless-ts workspace (ESLint 10,
// `defineConfig` / `globalIgnores` from "eslint/config").
//
// Every rule is either enforced (`error`) or `off` with a one-line reason;
// nothing is ever `warn` (a load-time assertion at the bottom guarantees
// that).
//
// Purity boundary: packages/core is isomorphic and packages/browser is
// browser-only. Neither may import Node built-ins (`node:*`, `fs`, `path`,
// `os`) or `undici`, nor touch the `process` global. Enforced here and by the
// browser-bundle smoke (scripts/browser-smoke.mjs) wired into `npm run check`.

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
  // The docs site's config runs under Node; its theme (docs/.vitepress/theme)
  // runs in the browser and is deliberately not listed.
  "docs/.vitepress/config.mts",
];
// The documentation site (CONTRIBUTING.md "Documentation").
const DOCS_SITE_FILES = ["docs/.vitepress/**/*.{ts,mts}"];
const JS_FILES = ["**/*.{js,mjs,cjs}"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize an upstream preset that still ships `warn` severities to `error`.
 *
 * @param {object} config - One flat-config entry (a preset object with `rules`).
 * @returns {object} The same entry with every `warn` severity raised to `error`.
 */
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
 * Build the `no-restricted-imports` entry for one workspace: relative imports
 * into any other workspace's `src/` are forbidden (`import-x/no-relative-packages`
 * catches the resolved form, this catches the spelling), optionally plus the
 * core/browser purity boundary.
 *
 * @param {object} options - Scope of the rule.
 * @param {string} options.ownPackage - Directory name under `packages/` whose own
 *   `src/` stays importable (`"core"`, `"node"`, `"browser"`).
 * @param {boolean} options.purity - Also forbid Node built-ins and `undici` (core and
 *   browser).
 * @returns {[string, object]} The rule entry (`["error", { paths, patterns }]`).
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

/**
 * Build the `import-x/no-extraneous-dependencies` entry for one workspace;
 * the root `package.json` is always consulted because workspace dependencies
 * hoist there.
 *
 * @param {...string} packageDirs - Workspace directories (relative to the repo root)
 *   whose `package.json` may declare the imported dependency.
 * @returns {[string, object]} The rule entry.
 */
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
        "docs/.vitepress/**",
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
// Naming (rule D1; the README's "Naming" section is the user-facing rule)
// ---------------------------------------------------------------------------

/**
 * `@typescript-eslint/naming-convention` options. Identifiers are camelCase
 * (PascalCase for types and classes, UPPER_CASE for constants and
 * environment-variable mirrors). Object-literal keys and methods are
 * unconstrained everywhere: that is where wire payloads, JSON fixtures and
 * Python-keyword option bags are written (D1). Declared property names —
 * interface/type members, class fields, accessors — are camelCase unless
 * `snakeCaseProperties` is set, which the contract scopes below use for
 * files whose shapes mirror Python data 1:1 (Python underscore-prefixed
 * fields such as `_df_cache` and `Filter._property` are mirrored verbatim,
 * hence the leading-underscore allowance there).
 *
 * @param {object} [options] - Scope of the rule.
 * @param {boolean} [options.snakeCaseProperties] - Allow `snake_case` declared property
 *   names (contract scopes that mirror Python data). Default `false`.
 * @returns {[string, ...object[]]} The rule entry.
 */
function namingConvention({ snakeCaseProperties = false } = {}) {
  const propertyFormats = snakeCaseProperties
    ? ["camelCase", "snake_case", "UPPER_CASE"]
    : ["camelCase", "UPPER_CASE"];
  return [
    "error",
    {
      selector: "default",
      format: ["camelCase"],
      leadingUnderscore: "forbid",
      trailingUnderscore: "forbid",
    },
    { selector: "import", format: ["camelCase", "PascalCase"] },
    // Trailing underscore: unicorn/catch-error-name's shadow suffix
    // (`error_`) and Python-keyword avoidance (`default_`, `type_`).
    {
      selector: "variable",
      format: ["camelCase", "UPPER_CASE", "PascalCase"],
      trailingUnderscore: "allow",
    },
    { selector: "variable", modifiers: ["destructured"], format: null },
    { selector: "function", format: ["camelCase", "PascalCase"] },
    {
      selector: "parameter",
      format: ["camelCase"],
      leadingUnderscore: "allow",
      trailingUnderscore: "allow",
    },
    { selector: "typeLike", format: ["PascalCase"] },
    {
      selector: "memberLike",
      modifiers: ["private"],
      format: ["camelCase"],
      leadingUnderscore: "forbid",
    },
    // D1: object-literal keys are unconstrained (wire payloads, fixtures,
    // Python kwargs); the value-side rule lives on the declared types.
    {
      selector: ["objectLiteralProperty", "objectLiteralMethod"],
      format: null,
    },
    {
      selector: ["classProperty", "typeProperty"],
      modifiers: ["requiresQuotes"],
      format: null,
    },
    // `static readonly` class constants read like module constants.
    {
      selector: "classProperty",
      modifiers: ["static", "readonly"],
      format: ["camelCase", "UPPER_CASE"],
    },
    {
      selector: ["classProperty", "typeProperty", "classicAccessor"],
      format: propertyFormats,
      ...(snakeCaseProperties
        ? { leadingUnderscore: "allowSingleOrDouble" }
        : {}),
    },
  ];
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
            "docs/.vitepress/tsconfig.json",
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
          default: "defaultValue",
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
      // is no `ignoreTypeImports` option in 4.x), so this is the "types
      // ignored" form; the value-level graph is acyclic (madge agrees).
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

      // `() => undefined` is the typed no-op for `() => T | undefined` seams
      // and for "replaced later" resolver slots; the rule's `() => {}`
      // rewrite returns `void` and does not type-check against them.
      "unicorn/no-useless-undefined": [
        "error",
        { checkArrowFunctionBody: false },
      ],

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
      // Entity-model statics name the concrete class deliberately;
      // switching to `this` changes behavior under subclassing.
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
      // churn with no behavioral gain.
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
      // Lazily-initialized module-level caches and one-time module init
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
      // Library, rig and oracle sources only: the one-off generators and
      // codemods under scripts/ and the test fixtures are exempt below.
      complexity: ["error", 20],
      "max-depth": ["error", 4],
      "max-params": ["error", 5],
    },
  },
  {
    name: "repo/scripts-and-tests/no-size-rules",
    files: ["scripts/**", ...TEST_FILES],
    rules: {
      complexity: "off", // one-off generators, codemods and test bodies
      "max-depth": "off",
      "max-params": "off",
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
      // Arrow shorthands returning void (`expect(() => f()).toThrow()`,
      // `(...args) => ns.use(...args)` forwarders) are the idiom here — 49
      // sites, all stylistic; the option keeps the rule's real catches
      // (`const x = voidCall()`, `return voidCall()` in a non-arrow).
      "@typescript-eslint/no-confusing-void-expression": [
        "error",
        { ignoreArrowShorthand: true },
      ],
      "@typescript-eslint/prefer-optional-chain": "error",
      // Its fix (`x as T` → `x!`) is exactly what `no-non-null-assertion`
      // forbids in source, where narrowing helpers are wanted instead; the
      // test block re-enables it (tests may use `!`).
      "@typescript-eslint/non-nullable-type-assertion-style": "off",

      // --- typescript-eslint: rules configured beyond the presets ----------
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
      // D1: camelCase identifiers; declared property names camelCase except
      // in the two snake-case contract scopes below (see namingConvention).
      "@typescript-eslint/naming-convention": namingConvention(),

      // --- typescript-eslint: off ------------------------------------------
      // 603 hits, purely stylistic, and it fights `require-await` here.
      "@typescript-eslint/promise-function-async": "off",
      // 361 hits, low value; a light config is a possible follow-up.
      "@typescript-eslint/member-ordering": "off",
      // High noise in an `unknown`-heavy port; `no-unnecessary-condition`
      // covers the useful part.
      "@typescript-eslint/strict-boolean-expressions": "off",

      // --- tsdoc / jsdoc ---------------------------------------------------
      "tsdoc/syntax": "error",
      // TSDoc `@param` names are bare identifiers: a destructured object
      // parameter is documented once, as prose on the root name, never as
      // dotted `options.field` tags (tsdoc/syntax rejects those).
      "jsdoc/require-param": ["error", { checkDestructured: false }],
      "jsdoc/check-param-names": ["error", { checkDestructured: false }],
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
  // Size caps for the rig and the oracle (the library block above covers
  // packages/*/src; tests are exempt in the test block).
  {
    name: "repo/rig/size",
    files: ["conformance-runner/src/**/*.ts", "differential/**/*.ts"],
    ignores: [...TEST_FILES],
    rules: {
      "max-lines": [
        "error",
        { max: 800, skipBlankLines: true, skipComments: true },
      ],
      "max-lines-per-function": [
        "error",
        { max: 120, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  // `max-lines` ratchet — files over the 800-line cap, each pinned at its
  // current size (rounded up) so none can grow; delete an entry once its
  // file drops below 800. Splitting these is a per-file decision: the
  // data-table modules (entity/result/param models, the pydantic schema
  // mirrors) mirror Python module boundaries and share one 1000-line
  // ceiling; the rest are listed singly.
  ...[
    [
      [
        "packages/core/src/types/entities/**/*.ts",
        "packages/core/src/types/results/**/*.ts",
        "packages/core/src/types/query-params/**/*.ts",
        "packages/core/src/bookmarks/schema.ts",
        "packages/core/src/bookmarks/schema-sorting.ts",
      ],
      1000,
    ],
    [["packages/core/src/types/results/live-query.ts"], 1400],
    [["packages/core/src/index.ts"], 1000], // the explicit public export list
    [["packages/core/src/client/client.ts"], 900],
    [["packages/core/src/services/queries/query-host.ts"], 900],
    [["packages/core/src/services/live-query-transforms.ts"], 950],
    [["packages/core/src/replays/rrweb-analyzer.ts"], 950],
    [["packages/core/src/query/validation-args.ts"], 1300],
    [["packages/core/src/workspace-query-params.ts"], 1700],
    [["packages/core/src/workspace.ts"], 2000], // the facade: ~140 one-line delegations with their docblocks
    [["conformance-runner/src/wire-workspace.ts"], 850],
  ].map(([files, max]) => ({
    name: `repo/max-lines-ratchet/${max}`,
    files,
    rules: {
      "max-lines": ["error", { max, skipBlankLines: true, skipComments: true }],
    },
  })),
  {
    // D1: files whose declared property names mirror Python data 1:1 keep
    // snake_case — entity/result/param models, bookmark params, error
    // `details`, the Workspace/service query-option bags that mirror Python
    // keyword arguments, and on-disk/wire records (accounts, OAuth tokens,
    // `/me`). Constructor/config option bags in these files stay camelCase;
    // tests/naming-config-bags.test.ts locks them. Extend by whole file only.
    name: "repo/library-src/snake-case-contracts",
    files: [
      "packages/core/src/types/entities/**/*.ts",
      "packages/core/src/types/results/**/*.ts",
      "packages/core/src/types/query-params/**/*.ts",
      "packages/core/src/types/report-links.ts",
      "packages/core/src/bookmarks/**/*.ts",
      "packages/core/src/errors.ts",
      "packages/core/src/workspace.ts",
      "packages/core/src/workspace-query-params.ts",
      "packages/core/src/workspace-members/**/*.ts",
      "packages/core/src/services/**/*.ts",
      "packages/core/src/query/validation-*.ts",
      "packages/core/src/query/user-validators.ts",
      "packages/core/src/accounts/accounts-ops.ts",
      "packages/core/src/accounts/auth-effects.ts",
      "packages/core/src/accounts/login-unified.ts",
      "packages/core/src/auth/account.ts",
      "packages/core/src/auth/region-probe.ts",
      "packages/core/src/auth/resolver.ts",
      "packages/core/src/auth/session.ts",
      "packages/core/src/auth/token.ts",
      "packages/core/src/client/me.ts",
      "packages/core/src/client/pagination.ts",
      "packages/core/src/replays/aggregators.ts",
      "packages/core/src/replays/rrweb-analyzer.ts",
      "packages/core/src/replays/user-action.ts",
      "packages/core/src/report-links.ts",
      "packages/browser/src/redirect-flow.ts",
    ],
    rules: {
      "@typescript-eslint/naming-convention": namingConvention({
        snakeCaseProperties: true,
      }),
    },
  },
  {
    // D1: tests and the conformance rig declare shapes for Python fixtures,
    // recorded kwargs and JSON artifacts; their property names follow the
    // data they describe.
    name: "repo/tests-and-rig/snake-case-fixtures",
    files: [
      ...TEST_FILES,
      "conformance-runner/src/**/*.ts",
      "differential/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/naming-convention": namingConvention({
        snakeCaseProperties: true,
      }),
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
    name: "repo/rig/error-classes",
    files: ["conformance-runner/**/*.ts", "differential/**/*.ts"],
    rules: {
      // The rig and the oracle report a thrown error's class name to the
      // Python side ("TS raised TypeError" must pair with Python's
      // TypeError). A harness-invariant failure therefore stays a bare
      // `Error`, so it can never satisfy a vector that expects TypeError.
      "unicorn/prefer-type-error": "off",
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

  {
    name: "repo/boundary/docs-site",
    files: DOCS_SITE_FILES,
    // Untyped on purpose: a typed program for these few files pulls in
    // TypeScript's own declarations plus the vitepress/vue/vite graph (about
    // 1.1 GB on top of the repo's lint run), which pushes `eslint .` past the
    // roughly 2 GB default heap of an 8 GB CI runner. `tsc -b` type-checks
    // them through the root project references instead.
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      "no-restricted-imports": restrictedImports({
        ownPackage: null,
        purity: false,
      }),
      "import-x/no-extraneous-dependencies": noExtraneous(),
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
        // `*.test-d.ts` = vitest typecheck files (type-level tests).
        { pattern: String.raw`\.test(-d)?\.ts$` },
      ],
      // Titles are English behavior statements; the Python test name lives
      // in a trailing `// python: test_x` comment, never in the title
      // (CONTRIBUTING "Tests").
      "vitest/valid-title": [
        "error",
        {
          mustNotMatch: {
            it: [
              "^test_",
              "State the behavior in English; keep the Python name in a `// python:` comment",
            ],
            test: [
              "^test_",
              "State the behavior in English; keep the Python name in a `// python:` comment",
            ],
            describe: [
              String.raw`^Test[A-Z]|^test_|\.py:\d`,
              "Name the unit under test; keep the Python class in a `// python:` comment",
            ],
          },
        },
      ],
      // vitest's `expect(actual, message)` form.
      "vitest/valid-expect": ["error", { maxArgs: 2 }],
      // `fc.assert`: fast-check properties that return booleans assert
      // through the runner, not through `expect`.
      "vitest/expect-expect": [
        "error",
        { assertFunctionNames: ["expect", "expect*", "assert*", "fc.assert"] },
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
      // Every CLI under scripts/ carries `#!/usr/bin/env node` and an exec
      // bit; library modules (scripts/lib/, *-lib.mjs, this config) carry
      // none. The rule enforces both directions.
      "n/hashbang": [
        "error",
        {
          additionalExecutables: [
            "scripts/*.mjs",
            "scripts/audit/comment-archaeology.mjs",
            "scripts/codemods/*.mjs",
          ],
          executableMap: { ".mjs": "node" },
        },
      ],
      // Scripts are CLIs: a non-zero `process.exit` is their contract.
      "n/no-process-exit": "off",
      "unicorn/no-process-exit": "off",
    },
  },

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
