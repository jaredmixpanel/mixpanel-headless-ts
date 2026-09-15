// TypeDoc plugin: two link-resolution fallbacks the repo's docblocks need.
//
// TypeScript parses `@throws {@link X}` as a throws tag whose type
// expression is a stray `{` and never emits a JSDocLink node, so TypeDoc
// cannot resolve `X` through the checker there. It falls back to a
// by-name lookup inside the owning module, which leaves two cases open:
//
// 1. `@throws {@link ConfigError}` written in @mixpanel-headless/node or
//    /browser, where the class is documented once under
//    @mixpanel-headless/core (the packages strategy treats the other
//    packages' `dist/` as external). Before TypeDoc's own resolver runs on
//    the merged project, point such bare-name links at the one export of
//    that name in a sibling package.
// 2. `@throws {@link TypeError}` and other JS builtins. Re-ask the
//    registered external resolvers (typedoc-plugin-mdn-links) with the
//    reference marked global, which is the shape they resolve builtins in.
//
// Neither the TSDoc grammar eslint enforces (`pkg#Symbol`, no `!` global
// prefix) nor TypeDoc's (`pkg!Symbol`, `!Global`) is accepted by the other
// parser, so this cannot be written in the sources themselves.
//
// Registered from `typedoc.json` (`plugin`); runs in `npm run docs:api`
// and `npm run docs:api:check`.
import { Application, Reflection, ReflectionKind } from "typedoc";

const BARE_NAME = /^\s*([A-Za-z_$][\w$]*)\s*(?:\|.*)?$/;
const LINK_TAGS = new Set(["@link", "@linkcode", "@linkplain"]);

/**
 * The bare identifier a link's text names, or `undefined` for anything
 * with a path, a module source or a URL.
 *
 * @param {import("typedoc").InlineTagDisplayPart} part - The link part.
 * @returns {string | undefined} The identifier.
 */
function bareName(part) {
  const match = BARE_NAME.exec(part.text);
  return match ? match[1] : undefined;
}

/**
 * Every display part of a reflection's comment (summary and block tags).
 *
 * @param {Reflection} reflection - The reflection whose comment to walk.
 * @yields {import("typedoc").CommentDisplayPart} Each part in order.
 */
function* commentParts(reflection) {
  const comment = reflection.comment;
  if (!comment) return;
  yield* comment.summary;
  for (const tag of comment.blockTags) yield* tag.content;
}

/**
 * The single exported reflection named `name` in a package other than the
 * owner's, or `undefined` when there is none or more than one.
 *
 * @param {import("typedoc").ProjectReflection} project - The merged project.
 * @param {Reflection} owner - The reflection whose comment holds the link.
 * @param {string} name - The bare identifier.
 * @returns {Reflection | undefined} The unique sibling export.
 */
function siblingExport(project, owner, name) {
  const ownModule = owner.parent?.kindOf(ReflectionKind.SomeModule)
    ? owner.parent
    : undefined;
  const hits = [];
  for (const mod of project.children ?? []) {
    if (!mod.kindOf(ReflectionKind.SomeModule) || mod === ownModule) continue;
    for (const child of mod.children ?? []) {
      if (child.name === name && child.kindOf(ReflectionKind.SomeExport)) {
        hits.push(child);
      }
    }
  }
  return hits.length === 1 ? hits[0] : undefined;
}

/**
 * TypeDoc's plugin entry point.
 *
 * @param {Application} app - The TypeDoc application.
 * @returns {void}
 */
export function load(app) {
  // Priority 0 runs before TypeDoc's LinkResolverPlugin (-300) on the
  // revived, merged project, so a target set here is final.
  app.on(Application.EVENT_PROJECT_REVIVE, (project) => {
    for (const id in project.reflections) {
      const reflection = project.reflections[id];
      for (const part of commentParts(reflection)) {
        if (part.kind !== "inline-tag" || part.target !== undefined) continue;
        if (!LINK_TAGS.has(part.tag)) continue;
        const name = bareName(part);
        if (name === undefined) continue;
        const target = siblingExport(project, reflection, name);
        if (target instanceof Reflection) part.target = target;
      }
    }
  });

  app.converter.addUnknownSymbolResolver((ref, refl, part, symbolId) => {
    if (symbolId || ref.moduleSource || ref.resolutionStart === "global") {
      return;
    }
    const path = ref.symbolReference?.path;
    if (
      !path ||
      path.length !== 1 ||
      !Object.hasOwn(globalThis, path[0].path)
    ) {
      return;
    }
    return app.converter.resolveExternalLink(
      { ...ref, resolutionStart: "global" },
      refl,
      part,
    );
  });
}
