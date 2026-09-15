#!/usr/bin/env node
// Codemod: move every `EntityModel` subclass onto the generic base.
//
// For each `class X extends EntityModel` in the entity-model files:
//
//   extends EntityModel                       → extends EntityModel<XInit>
//   static readonly fieldSpecs: readonly EntityFieldSpec[]
//                                             → static readonly fieldSpecs: EntityFieldSpecs<XInit>
//   super(X, fields as unknown as Readonly<Record<string, unknown>>)
//                                             → super(X, fields)
//   new X(prepareInit(X, raw) as unknown as XInit)
//                                             → new X(prepareInit(X, raw))
//   /** @internal <doc> */ on modelName / extraPolicy / fieldSpecs / computedSpecs
//                                             → /** <doc> */   (the statics are part of the
//                                               public class shape; see tsconfig.lib.json)
//
// and swaps the `type EntityFieldSpec` import specifier for `type EntityFieldSpecs`
// when the file no longer uses the singular. A generic class (`PaginatedResponse<T>`)
// gets `EntityModel<XInit<T>>` on the heritage clause and `EntityFieldSpecs<XInit<unknown>>`
// on the static (statics cannot see the class type parameter).
//
// The edit is type-level only — no emitted JavaScript changes except the removed
// casts, which are erased anyway. Idempotent: classes whose heritage clause already
// carries a type argument are skipped.
//
// Usage: node scripts/codemods/entity-generic-base.mjs [--check] [file ...]
//   --check   report the per-file edit counts without writing
//   file ...  restrict to these files (default: every entity-model file)
// Run `npx prettier --write` over the touched files afterwards (done here unless
// --check).
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CHECK = process.argv.includes("--check");
const explicitFiles = process.argv.slice(2).filter((a) => !a.startsWith("--"));

/** Every module that declares `EntityModel` subclasses. */
const ENTITIES_DIR = "packages/core/src/types/entities";
const DEFAULT_FILES = [
  ...readdirSync(resolve(REPO_ROOT, ENTITIES_DIR))
    .filter(
      (f) =>
        f.endsWith(".ts") && !/^(?:index|model-base|decode-utils)\.ts$/.test(f),
    )
    .map((f) => `${ENTITIES_DIR}/${f}`),
  "packages/core/src/client/me.ts",
];

const files = (explicitFiles.length > 0 ? explicitFiles : DEFAULT_FILES).map(
  (f) => resolve(REPO_ROOT, f),
);

const STATICS_TO_UNTAG = new Set([
  "modelName",
  "extraPolicy",
  "fieldSpecs",
  "computedSpecs",
]);

/**
 * Collect the text edits for one source file.
 *
 * @param {ts.SourceFile} sf - Parsed entity-model source (with parent pointers).
 * @returns {{ edits: Array<{ start: number, end: number, text: string }>, classes: number, skipped: string[] }} The text edits, the number of classes migrated and a note per skipped class or member.
 */
function planFile(sf) {
  const edits = [];
  const skipped = [];
  let classes = 0;
  const text = sf.text;

  const replaceNode = (node, newText) => {
    edits.push({ start: node.getStart(sf), end: node.getEnd(), text: newText });
  };

  for (const st of sf.statements) {
    if (!ts.isClassDeclaration(st) || st.name === undefined) continue;
    const heritage = st.heritageClauses
      ?.flatMap((h) => h.types)
      .find(
        (t) =>
          ts.isIdentifier(t.expression) && t.expression.text === "EntityModel",
      );
    if (heritage === undefined) continue;
    const name = st.name.text;
    if (heritage.typeArguments !== undefined) {
      skipped.push(`${name} (already generic)`);
      continue;
    }
    classes += 1;
    const typeParams = st.typeParameters?.map((p) => p.name.text) ?? [];
    const initName = `${name}Init`;
    const heritageArg =
      typeParams.length > 0
        ? `${initName}<${typeParams.join(", ")}>`
        : initName;
    const staticArg =
      typeParams.length > 0
        ? `${initName}<${typeParams.map(() => "unknown").join(", ")}>`
        : initName;

    replaceNode(heritage, `EntityModel<${heritageArg}>`);

    for (const member of st.members) {
      const isStatic = member.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.StaticKeyword,
      );
      const memberName =
        member.name !== undefined && ts.isIdentifier(member.name)
          ? member.name.text
          : undefined;

      // `@internal` on the runtime-metadata statics.
      if (
        isStatic &&
        memberName !== undefined &&
        STATICS_TO_UNTAG.has(memberName)
      ) {
        for (const range of ts.getLeadingCommentRanges(
          text,
          member.getFullStart(),
        ) ?? []) {
          const comment = text.slice(range.pos, range.end);
          if (!comment.startsWith("/**") || !comment.includes("@internal"))
            continue;
          const untagged = comment.replace(/@internal[ \t]*/, "");
          edits.push({ start: range.pos, end: range.end, text: untagged });
        }
      }

      // static readonly fieldSpecs: readonly EntityFieldSpec[] = [...]
      if (
        isStatic &&
        memberName === "fieldSpecs" &&
        ts.isPropertyDeclaration(member) &&
        member.type !== undefined
      ) {
        const typeText = member.type.getText(sf).replaceAll(/\s+/g, " ");
        if (typeText !== "readonly EntityFieldSpec[]") {
          throw new Error(
            `${sf.fileName}: ${name}.fieldSpecs has unexpected type ${typeText}`,
          );
        }
        replaceNode(member.type, `EntityFieldSpecs<${staticArg}>`);
      }

      // constructor: super(X, fields as unknown as Readonly<Record<string, unknown>>)
      if (ts.isConstructorDeclaration(member) && member.body !== undefined) {
        let found = false;
        const visit = (node) => {
          if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.SuperKeyword &&
            node.arguments.length === 2
          ) {
            const arg = node.arguments[1];
            const inner = stripAsUnknownAs(arg);
            if (inner !== arg) {
              replaceNode(arg, inner.getText(sf));
              found = true;
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(member.body);
        if (!found) skipped.push(`${name}.constructor (no cast found)`);
      }

      // static fromDict: new X(prepareInit(X, raw) as unknown as XInit)
      if (
        isStatic &&
        memberName === "fromDict" &&
        ts.isMethodDeclaration(member) &&
        member.body !== undefined
      ) {
        const visit = (node) => {
          if (ts.isAsExpression(node)) {
            const inner = stripAsUnknownAs(node);
            if (
              inner !== node &&
              ts.isCallExpression(inner) &&
              ts.isIdentifier(inner.expression) &&
              inner.expression.text === "prepareInit"
            ) {
              replaceNode(node, inner.getText(sf));
              return;
            }
          }
          ts.forEachChild(node, visit);
        };
        visit(member.body);
      }
    }
  }
  return { edits, classes, skipped };
}

/**
 * Peel `expr as unknown as T` (any depth of `as`) down to `expr`.
 *
 * @param {ts.Expression} node - The expression to peel.
 * @returns {ts.Expression} The innermost operand, unwrapped from parentheses; `node` itself when it is not an `as` expression.
 */
function stripAsUnknownAs(node) {
  let current = node;
  while (ts.isAsExpression(current)) current = current.expression;
  // Parenthesised inner expressions come back without their parens.
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

/**
 * Apply edits (non-overlapping, applied back to front).
 *
 * @param {string} text - Original source text.
 * @param {Array<{ start: number, end: number, text: string }>} edits - Replacements by character offset; must not overlap.
 * @returns {string} The rewritten text.
 */
function applyEdits(text, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = text;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const edit of sorted) {
    if (edit.end > lastStart) throw new Error("overlapping edits");
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    lastStart = edit.start;
  }
  return out;
}

/**
 * Swap the `type EntityFieldSpec` import specifier for `EntityFieldSpecs` when
 * the singular is no longer referenced; add the plural next to it otherwise.
 *
 * @param {string} text - Source text after the class edits were applied.
 * @returns {string} The text with the import specifier adjusted, or unchanged when the plural is not referenced.
 */
function fixImports(text) {
  const sf = ts.createSourceFile("x.ts", text, ts.ScriptTarget.Latest, true);
  let usesSingular = false;
  let specifier;
  const visit = (node) => {
    if (ts.isImportSpecifier(node)) {
      const imported = (node.propertyName ?? node.name).text;
      if (imported === "EntityFieldSpec") specifier = node;
      return;
    }
    if (ts.isIdentifier(node) && node.text === "EntityFieldSpec")
      usesSingular = true;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (specifier === undefined)
    throw new Error("no `EntityFieldSpec` import specifier found");
  if (!/\bEntityFieldSpecs\b/.test(text)) return text;
  const start = specifier.getStart(sf);
  const end = specifier.getEnd();
  const replacement = usesSingular
    ? `${specifier.getText(sf)},\n  type EntityFieldSpecs`
    : specifier.getText(sf).replace(/EntityFieldSpec\b/, "EntityFieldSpecs");
  return text.slice(0, start) + replacement + text.slice(end);
}

const touched = [];
let totalClasses = 0;
for (const file of files) {
  const original = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, original, ts.ScriptTarget.Latest, true);
  const { edits, classes, skipped } = planFile(sf);
  const rel = relative(REPO_ROOT, file);
  for (const note of skipped) console.log(`  skip ${rel}: ${note}`);
  if (edits.length === 0) {
    console.log(`  ok   ${rel}: nothing to do`);
    continue;
  }
  let updated = applyEdits(original, edits);
  if (classes > 0) updated = fixImports(updated);
  totalClasses += classes;
  console.log(
    `  ${CHECK ? "would" : "edit"} ${rel}: ${classes} classes, ${edits.length} edits`,
  );
  if (!CHECK) {
    writeFileSync(file, updated);
    touched.push(file);
  }
}
console.log(
  `${CHECK ? "would migrate" : "migrated"} ${totalClasses} classes in ${files.length} files`,
);
if (touched.length > 0) {
  execFileSync("npx", ["prettier", "--write", ...touched], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
}
