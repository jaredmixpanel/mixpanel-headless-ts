// Import-statement surgery shared by the test codemods: count a name's uses
// outside the import block, and rebuild every named import without the
// specifiers a rewrite orphaned.
import ts from "typescript";

/**
 * Count references to `name` outside import declarations — identifier nodes
 * only, so a name that survives just in prose (comments, `@link` tags)
 * counts as unused, matching tsc's `noUnusedLocals`.
 *
 * @param {ts.SourceFile} source - Parsed file.
 * @param {string} name - Identifier to count.
 * @returns {number} Occurrences.
 */
export function usesOutsideImports(source, name) {
  let count = 0;
  /** @param {ts.Node} node - Visited node. */
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && node.text === name) count += 1;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return count;
}

/**
 * Rebuild the named-import list of every import statement, dropping the
 * specifiers no longer referenced in the file body (and the statement when
 * nothing is left). Side-effect imports and namespace imports are untouched.
 *
 * @param {string} text - Source text.
 * @param {string} fileName - For the parser.
 * @returns {string} The pruned text.
 */
export function pruneImports(text, fileName) {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  /** @type {Array<{ start: number; end: number; replacement: string }>} */
  const edits = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (!clause) continue;
    if (
      clause.name &&
      !clause.namedBindings &&
      usesOutsideImports(source, clause.name.text) === 0
    ) {
      // Bare default import (`import fc from "fast-check"`) gone unused.
      edits.push({
        start: statement.getFullStart(),
        end: statement.getEnd(),
        replacement: "",
      });
      continue;
    }
    if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) {
      continue;
    }
    const kept = clause.namedBindings.elements.filter(
      (element) => usesOutsideImports(source, element.name.text) > 0,
    );
    if (kept.length === clause.namedBindings.elements.length) continue;
    const start = statement.getFullStart();
    const end = statement.getEnd();
    if (kept.length === 0 && !clause.name) {
      edits.push({ start, end, replacement: "" });
      continue;
    }
    const typeOnly = clause.isTypeOnly ? "type " : "";
    const names = kept.map((element) => element.getText()).join(", ");
    const spec = statement.moduleSpecifier.getText();
    const leading = text.slice(start, statement.getStart());
    edits.push({
      start,
      end,
      replacement: `${leading}import ${typeOnly}{ ${names} } from ${spec};`,
    });
  }
  let out = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
  }
  return out;
}
