// TypeDoc plugin: group the core reference the way `packages/core/src/index.ts`
// is written.
//
// The barrel lists every public export under a `// --- Title — detail ---`
// divider; those sections are the port's own map of the surface (facade,
// client, errors, entity models, …), and a reader of the reference should
// see the same map instead of TypeDoc's default kind buckets. Rather than
// carrying a `@group` tag on ~700 declarations, this plugin reads the
// barrel once per run and tags each top-level export of the core package
// with its section before TypeDoc computes groups; the section order
// becomes `groupOrder`, and the divider's detail becomes the group's
// description on the package index page.
//
// Registered from `typedoc.json` (`plugin`); runs in `npm run docs:api`
// and `npm run docs:api:check`.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Comment, CommentTag, Converter } from "typedoc";
import ts from "typescript";

const BARREL = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../packages/core/src/index.ts",
);
const PACKAGE = "@mixpanel-headless/core";
const DIVIDER = /^\/\/ --- (.+?)(?: — (.+?))? ---$/gm;

/**
 * The barrel's sections in file order, each with the names it exports.
 *
 * @returns {{ title: string, detail: string | undefined, names: string[] }[]}
 *   One entry per divider.
 */
function readSections() {
  const text = readFileSync(BARREL, "utf8");
  const sections = [];
  for (const match of text.matchAll(DIVIDER)) {
    const [, heading, detail] = match;
    // A parenthesised qualifier is part of the file's prose, not the title.
    const title = heading.replace(/ \(.*\)$/, "");
    sections.push({ title, detail, start: match.index, names: [] });
  }
  const source = ts.createSourceFile(
    BARREL,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    const clause = statement.exportClause;
    if (!clause || !ts.isNamedExports(clause)) continue;
    const section = sections.findLast((s) => s.start < statement.getStart());
    if (!section) continue;
    for (const element of clause.elements)
      section.names.push(element.name.text);
  }
  return sections;
}

/**
 * TypeDoc's plugin entry point.
 *
 * @param {import("typedoc").Application} app - The TypeDoc application.
 * @returns {void}
 */
export function load(app) {
  const sections = readSections();
  const sectionOf = new Map();
  for (const section of sections) {
    for (const name of section.names) sectionOf.set(name, section.title);
  }

  // In packages mode each package converts with its own options copy, so
  // the order is set when conversion begins rather than at bootstrap.
  app.converter.on(Converter.EVENT_BEGIN, () => {
    if (!app.options.isSet("groupOrder")) {
      app.options.setValue("groupOrder", [
        ...sections.map((s) => s.title),
        "*",
      ]);
    }
  });

  // RESOLVE_BEGIN runs before GroupPlugin's RESOLVE_END pass computes the
  // groups; in packages mode each package converts separately, so only the
  // core package's project is touched.
  app.converter.on(Converter.EVENT_RESOLVE_BEGIN, (context) => {
    const project = context.project;
    if (project.packageName !== PACKAGE) return;
    for (const child of project.children ?? []) {
      const title = sectionOf.get(child.name);
      if (title === undefined) continue;
      const tag = new CommentTag("@group", [{ kind: "text", text: title }]);
      // Functions and methods keep their comment on the signature; match
      // where GroupPlugin looks.
      const targets = child.comment
        ? [child]
        : (child.getNonIndexSignatures?.().filter((s) => s.comment) ?? []);
      if (targets.length === 0) {
        child.comment = new Comment([], [tag]);
        continue;
      }
      for (const target of targets) target.comment.blockTags.push(tag);
    }
    if (project.comment) {
      for (const section of sections) {
        if (!section.detail) continue;
        project.comment.blockTags.push(
          new CommentTag("@groupDescription", [
            { kind: "text", text: `${section.title}\n${section.detail}` },
          ]),
        );
      }
    }
  });
}
