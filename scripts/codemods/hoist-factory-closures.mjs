#!/usr/bin/env node
// Codemod: turn a closure factory (`export function createXMethods(core) {
// const helper = async (…) => {…}; return { m: async (…) => {…}, … }; }`)
// into module-level functions plus a thin assembly.
//
// Every arrow / function declared in the factory body, and every arrow
// assigned to a property of the returned object literal, becomes a named
// module-level `function` placed before the factory. Each hoisted function
// gains, as leading parameters, exactly the factory parameters it (or a
// hoisted helper it calls) references; call sites between hoisted functions
// are rewritten to thread them. The factory is reduced to the returned
// object, where each hoisted method is re-attached with
// `bindFirst(<param>, fn)` (one leading parameter) or an explicit arrow
// (several). Property getters and non-function properties stay verbatim.
//
// The transform is purely positional (text edits over the TypeScript AST);
// it aborts, without writing, on any shape it does not understand — a
// non-function local, `this`, a hoisted name that collides with a
// module-level declaration or import — so a half-applied file never
// reaches disk. Run `npx prettier --write` and `npx eslint --fix` over the
// result (done here unless --check).
//
// Usage: node scripts/codemods/hoist-factory-closures.mjs <file> <factoryName> [--check]
//   --check  print the rewritten file to stdout instead of writing it
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CHECK = process.argv.includes("--check");
const [filePath, factoryName] = process.argv
  .slice(2)
  .filter((a) => !a.startsWith("--"));
if (!filePath || !factoryName) {
  console.error(
    "usage: hoist-factory-closures.mjs <file> <factoryName> [--check]",
  );
  process.exit(2);
}

const BIND_MODULE = "client/internals.js";
const BIND_NAME = "bindFirst";

const absPath = resolve(REPO_ROOT, filePath);
const source = readFileSync(absPath, "utf8");
const sf = ts.createSourceFile(
  absPath,
  source,
  ts.ScriptTarget.ES2023,
  true,
  ts.ScriptKind.TS,
);

/**
 * Abort without writing, naming the offending line when a node is given.
 *
 * @param {string} message - What the transform could not handle.
 * @param {ts.Node} [node] - The node the message is about.
 */
function fail(message, node) {
  const where = node
    ? `:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`
    : "";
  console.error(`hoist-factory-closures: ${message} (${filePath}${where})`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Locate the factory and inventory the module scope
// ---------------------------------------------------------------------------

const factory = sf.statements.find(
  (s) => ts.isFunctionDeclaration(s) && s.name?.text === factoryName,
);
if (!factory || !factory.body) fail(`factory ${factoryName} not found`);

const factoryParams = factory.parameters.map((p) => {
  if (!ts.isIdentifier(p.name)) fail("destructured factory parameter", p);
  return { name: p.name.text, text: p.getText(sf) };
});
const factoryParamNames = new Set(factoryParams.map((p) => p.name));

/** Names already declared at module level (values and imports). */
const moduleNames = new Set();
for (const s of sf.statements) {
  if (ts.isFunctionDeclaration(s) && s.name) moduleNames.add(s.name.text);
  if (ts.isVariableStatement(s)) {
    for (const d of s.declarationList.declarations) {
      if (ts.isIdentifier(d.name)) moduleNames.add(d.name.text);
    }
  }
  if (ts.isImportDeclaration(s) && s.importClause) {
    const { name, namedBindings } = s.importClause;
    if (name) moduleNames.add(name.text);
    if (namedBindings && ts.isNamedImports(namedBindings)) {
      for (const el of namedBindings.elements) moduleNames.add(el.name.text);
    }
    if (namedBindings && ts.isNamespaceImport(namedBindings)) {
      moduleNames.add(namedBindings.name.text);
    }
  }
}

// ---------------------------------------------------------------------------
// Collect hoist candidates
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Hoist
 * @property {string} name  the hoisted function's name
 * @property {ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration} fn  the source function
 * @property {string} leadingComments  JSDoc / comments to carry over
 * @property {Set<string>} direct  factory params referenced directly
 * @property {Set<string>} calls   other hoisted names called
 * @property {Set<string>} needs   resolved leading params (fixpoint)
 */

/** @type {Hoist[]} */
const hoists = [];
/** @type {ts.ReturnStatement | undefined} */
let returnStmt;

/**
 * Leading comment text (full ranges) before a node.
 *
 * @param {ts.Node} node - Node whose leading trivia is read.
 * @returns {string} The comments joined by newlines; empty when there are none.
 */
function leadingComments(node) {
  const ranges = ts.getLeadingCommentRanges(source, node.getFullStart()) ?? [];
  return ranges.map((r) => source.slice(r.pos, r.end)).join("\n");
}

/**
 * Whether a node is an arrow function, function expression or declaration.
 *
 * @param {ts.Node} node - Candidate node.
 * @returns {boolean} True for the three hoistable function shapes.
 */
function isFunctionLike(node) {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node)
  );
}

for (const stmt of factory.body.statements) {
  if (ts.isReturnStatement(stmt)) {
    if (returnStmt) fail("two return statements in factory", stmt);
    returnStmt = stmt;
    continue;
  }
  if (ts.isFunctionDeclaration(stmt) && stmt.name) {
    hoists.push({
      name: stmt.name.text,
      fn: stmt,
      leadingComments: leadingComments(stmt),
    });
    continue;
  }
  if (ts.isVariableStatement(stmt)) {
    const decls = stmt.declarationList.declarations;
    if (decls.length !== 1) fail("multi-declarator local", stmt);
    const [decl] = decls;
    if (!ts.isIdentifier(decl.name) || !decl.initializer) {
      fail("non-identifier local", stmt);
    }
    if (!isFunctionLike(decl.initializer)) {
      fail(`local \`${decl.name.text}\` is not a function`, stmt);
    }
    hoists.push({
      name: decl.name.text,
      fn: decl.initializer,
      leadingComments: leadingComments(stmt),
    });
    continue;
  }
  fail("unexpected statement in factory body", stmt);
}
if (
  !returnStmt?.expression ||
  !ts.isObjectLiteralExpression(returnStmt.expression)
) {
  fail("factory does not end in `return { … }`");
}
const returned = returnStmt.expression;

/** Property → how to re-emit it. */
const propertyPlans = [];
for (const prop of returned.properties) {
  if (ts.isPropertyAssignment(prop) && isFunctionLike(prop.initializer)) {
    if (!ts.isIdentifier(prop.name)) fail("computed method name", prop);
    hoists.push({
      name: prop.name.text,
      fn: prop.initializer,
      leadingComments: leadingComments(prop),
    });
    propertyPlans.push({ kind: "hoisted", name: prop.name.text, prop });
  } else if (ts.isShorthandPropertyAssignment(prop)) {
    propertyPlans.push({ kind: "shorthand", name: prop.name.text, prop });
  } else if (
    ts.isPropertyAssignment(prop) &&
    ts.isIdentifier(prop.initializer) &&
    ts.isIdentifier(prop.name)
  ) {
    propertyPlans.push({
      kind: "alias",
      name: prop.name.text,
      target: prop.initializer.text,
      prop,
    });
  } else {
    propertyPlans.push({ kind: "verbatim", prop });
  }
}

const hoistByName = new Map(hoists.map((h) => [h.name, h]));
if (hoistByName.size !== hoists.length) fail("duplicate hoisted name");
for (const h of hoists) {
  if (moduleNames.has(h.name)) {
    fail(`hoisted name \`${h.name}\` collides with a module-level name`);
  }
  if (h.name === BIND_NAME) fail(`hoisted name \`${BIND_NAME}\` reserved`);
}

// ---------------------------------------------------------------------------
// Dependency analysis: which factory params does each hoisted function need?
// ---------------------------------------------------------------------------

/**
 * Whether an identifier node is a value reference (not a property name).
 *
 * @param {ts.Identifier} id - Identifier to classify.
 * @returns {boolean} False when the identifier names a property, parameter, declaration or type.
 */
function isValueReference(id) {
  const p = id.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === id) return false;
  if (ts.isPropertyAssignment(p) && p.name === id) return false;
  if (ts.isPropertySignature(p) && p.name === id) return false;
  if (ts.isMethodDeclaration(p) && p.name === id) return false;
  if (ts.isBindingElement(p) && p.propertyName === id) return false;
  if (ts.isParameter(p) && p.name === id) return false;
  if (ts.isVariableDeclaration(p) && p.name === id) return false;
  if (ts.isTypeReferenceNode(p)) return false;
  if (ts.isQualifiedName(p)) return false;
  return true;
}

/**
 * Whether the identifier is shadowed by a nested parameter or local between
 * its use site and the hoisted function.
 *
 * @param {ts.Identifier} id - The reference being resolved.
 * @param {ts.Node} fnNode - The hoisted function that bounds the search.
 * @returns {boolean} True when an inner scope redeclares the name.
 */
function shadowedWithin(id, fnNode) {
  let cur = id.parent;
  while (cur && cur !== fnNode) {
    if (ts.isFunctionLike(cur)) {
      for (const p of cur.parameters) {
        if (ts.isIdentifier(p.name) && p.name.text === id.text) return true;
      }
    }
    if (ts.isBlock(cur) || ts.isSourceFile(cur)) {
      for (const s of cur.statements) {
        if (ts.isVariableStatement(s)) {
          for (const d of s.declarationList.declarations) {
            if (ts.isIdentifier(d.name) && d.name.text === id.text) return true;
          }
        }
      }
    }
    cur = cur.parent;
  }
  return false;
}

for (const h of hoists) {
  h.direct = new Set();
  h.calls = new Set();
  h.callSites = [];
  h.thisUse = false;
  const ownParams = new Set(
    h.fn.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : "")),
  );
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.ThisKeyword) h.thisUse = true;
    if (ts.isIdentifier(node) && isValueReference(node)) {
      const name = node.text;
      if (
        factoryParamNames.has(name) &&
        !ownParams.has(name) &&
        !shadowedWithin(node, h.fn)
      ) {
        h.direct.add(name);
      }
      if (
        hoistByName.has(name) &&
        name !== h.name &&
        !ownParams.has(name) &&
        !shadowedWithin(node, h.fn)
      ) {
        h.calls.add(name);
        const p = node.parent;
        if (ts.isCallExpression(p) && p.expression === node) {
          h.callSites.push(p);
        } else {
          fail(
            `\`${name}\` is referenced as a value (not called) inside \`${h.name}\`; hoist by hand`,
            node,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  if (h.fn.body) visit(h.fn.body);
  for (const p of h.fn.parameters) if (p.initializer) visit(p.initializer);
  if (h.thisUse) fail(`\`this\` inside \`${h.name}\``, h.fn);
}

// Fixpoint over the call graph.
for (const h of hoists) h.needs = new Set(h.direct);
let changed = true;
while (changed) {
  changed = false;
  for (const h of hoists) {
    for (const callee of h.calls) {
      for (const need of hoistByName.get(callee).needs) {
        if (h.needs.has(need)) continue;
        h.needs.add(need);
        changed = true;
      }
    }
  }
}
/**
 * Leading params in factory-parameter order.
 *
 * @param {Hoist} h - The hoisted function.
 * @returns {Array<{ name: string, text: string }>} The factory parameters it needs, with their declaration text.
 */
function leadingOf(h) {
  return factoryParams.filter((p) => h.needs.has(p.name));
}

// ---------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------

/**
 * Apply non-overlapping edits to a slice of the source.
 *
 * @param {number} start - Slice start offset in `source`.
 * @param {number} end - Slice end offset in `source`.
 * @param {Array<{ pos: number, end: number, text: string }>} edits - Replacements inside the slice.
 * @returns {string} The rewritten slice.
 */
function applyEdits(start, end, edits) {
  const sorted = [...edits].sort((a, b) => a.pos - b.pos);
  let out = "";
  let cursor = start;
  for (const e of sorted) {
    if (e.pos < cursor || e.end > end) fail("overlapping edits");
    out += source.slice(cursor, e.pos) + e.text;
    cursor = e.end;
  }
  return out + source.slice(cursor, end);
}

/**
 * Render one hoisted function as a module-level declaration, threading the
 * leading parameters into its calls to other hoisted functions.
 *
 * @param {Hoist} h - The hoisted function.
 * @returns {string} The function declaration text, with its leading comments.
 */
function emitHoisted(h) {
  const fn = h.fn;
  const leading = leadingOf(h);
  const isAsync = fn.modifiers?.some(
    (m) => m.kind === ts.SyntaxKind.AsyncKeyword,
  );
  const star = fn.asteriskToken ? "*" : "";
  const typeParams = fn.typeParameters
    ? `<${fn.typeParameters.map((t) => t.getText(sf)).join(", ")}>`
    : "";
  const ownParams = fn.parameters.map((p) => p.getText(sf));
  const params = [...leading.map((p) => p.text), ...ownParams].join(", ");
  if (!fn.type) fail(`\`${h.name}\` has no explicit return type`, fn);
  const ret = fn.type.getText(sf);
  // Body: thread leading params into calls to other hoisted functions.
  const edits = h.callSites.map((call) => {
    const calleeLeading = leadingOf(hoistByName.get(call.expression.text));
    const open = call.arguments.pos; // position right after `(`
    const insert = calleeLeading.map((p) => p.name).join(", ");
    const trailing = call.arguments.length > 0 ? ", " : "";
    return { pos: open, end: open, text: insert ? insert + trailing : "" };
  });
  let body;
  if (ts.isBlock(fn.body)) {
    body = applyEdits(fn.body.getStart(sf), fn.body.getEnd(), edits);
  } else {
    const expr = applyEdits(fn.body.getStart(sf), fn.body.getEnd(), edits);
    body = `{\n  return ${expr};\n}`;
  }
  const head = `${isAsync ? "async " : ""}function${star} ${h.name}${typeParams}(${params}): ${ret} `;
  const comments = h.leadingComments ? `${h.leadingComments}\n` : "";
  return `${comments}${head}${body}\n`;
}

/**
 * Render one property of the returned object literal for the reduced factory.
 *
 * @param {{ kind: string, name?: string, target?: string, prop: ts.ObjectLiteralElementLike }} plan - How the property is re-emitted.
 * @returns {string} The property text: verbatim, shorthand, a `bindFirst` call or an explicit arrow.
 */
function emitProperty(plan) {
  if (plan.kind === "verbatim")
    return source.slice(plan.prop.getStart(sf), plan.prop.getEnd());
  const target = plan.kind === "alias" ? plan.target : plan.name;
  const h = hoistByName.get(target);
  if (!h) return source.slice(plan.prop.getStart(sf), plan.prop.getEnd());
  const leading = leadingOf(h);
  if (leading.length === 0) {
    return plan.name === target ? plan.name : `${plan.name}: ${target}`;
  }
  if (leading.length === 1) {
    return `${plan.name}: ${BIND_NAME}(${leading[0].name}, ${target})`;
  }
  const own = h.fn.parameters.map((p) =>
    ts.isIdentifier(p.name) ? p.name.text : fail("destructured param", p),
  );
  const args = [...leading.map((p) => p.name), ...own].join(", ");
  return `${plan.name}: (${own.join(", ")}) => ${target}(${args})`;
}

const usesBind = propertyPlans.some((plan) => {
  if (plan.kind === "verbatim") return false;
  const h = hoistByName.get(plan.kind === "alias" ? plan.target : plan.name);
  return h && leadingOf(h).length === 1;
});

const hoistedText = hoists.map((h) => emitHoisted(h)).join("\n");
const factoryHead = source.slice(
  factory.getStart(sf),
  factory.body.getStart(sf),
);
const factoryComments = leadingComments(factory);
const props = propertyPlans.map((p) => `    ${emitProperty(p)},`).join("\n");
const commentBlock = factoryComments ? `${factoryComments}\n` : "";
const newFactory = `${commentBlock}${factoryHead}{\n  return {\n${props}\n  };\n}\n`;

let output = `${source.slice(0, factory.getFullStart())}\n${hoistedText}\n${newFactory}${source.slice(factory.getEnd())}`;

// Import `bindFirst` when used.
if (usesBind) {
  const fileDir = dirname(absPath);
  const target = resolve(REPO_ROOT, "packages/core/src", BIND_MODULE);
  let spec = relative(fileDir, target).replaceAll("\\", "/");
  if (!spec.startsWith(".")) spec = `./${spec}`;
  const existing = sf.statements.find(
    (s) =>
      ts.isImportDeclaration(s) &&
      ts.isStringLiteral(s.moduleSpecifier) &&
      s.moduleSpecifier.text === spec &&
      !s.importClause?.isTypeOnly,
  );
  // Imports sit before the factory, so their offsets are identical in
  // `source` and `output`.
  if (
    existing?.importClause?.namedBindings &&
    ts.isNamedImports(existing.importClause.namedBindings) &&
    existing.importClause.namedBindings.elements.length > 0
  ) {
    const els = existing.importClause.namedBindings.elements;
    const at = els.at(-1).getEnd();
    output = `${output.slice(0, at)}, ${BIND_NAME}${output.slice(at)}`;
  } else {
    const lastImport = sf.statements.findLast((s) => ts.isImportDeclaration(s));
    const at = lastImport ? lastImport.getEnd() : 0;
    output = `${output.slice(0, at)}\nimport { ${BIND_NAME} } from "${spec}";${output.slice(at)}`;
  }
}

if (CHECK) {
  process.stdout.write(output);
  process.exit(0);
}
writeFileSync(absPath, output);
execFileSync("npx", ["eslint", "--fix", absPath], {
  cwd: REPO_ROOT,
  stdio: "inherit",
});
execFileSync("npx", ["prettier", "--write", absPath], {
  cwd: REPO_ROOT,
  stdio: "inherit",
});
console.log(
  `hoisted ${hoists.length} functions out of ${factoryName} in ${filePath}`,
);
