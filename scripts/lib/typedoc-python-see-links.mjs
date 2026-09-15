// TypeDoc plugin: link `@see mixpanel_headless.…` provenance tags to the
// Python library's reference.
//
// Every ported symbol cites its Python origin as a dotted name
// (`@see mixpanel_headless.workspace.Workspace.query`; CONTRIBUTING,
// "Comments and docstrings"). The Python site renders its API with
// mkdocstrings, whose heading anchors are the identifier exactly as the
// page's `::: mixpanel_headless.X` directive spells it plus the member path
// (`#mixpanel_headless.Workspace.query`, `#mixpanel_headless.accounts.add`,
// `#mixpanel_headless.auth_types.OAuthTokens`), and only for the members the
// directive selects. Which anchors exist is therefore data, not a rule:
// `python-reference-anchors.gen.json` (scripts/generate-python-reference-anchors.mjs,
// built from the Python checkout at the corpus pin) lists them per page,
// and this plugin links nothing that file does not carry.
//
// Resolution drops the module segments a directive omits (`workspace.`,
// `types.`) and keeps the ones it spells (`auth_types.`): the first
// capitalised segment (or, for module-level names, each segment in turn)
// starts the candidate, and the longest listed prefix wins. A name whose
// full path is listed links there; one whose object is listed but whose
// member is not — private helpers, methods the directive's `members:`
// leaves out — links the object's own anchor; anything else (`_internal`
// modules, private functions) stays plain text.
//
// Registered from `typedoc.json` (`plugin`); runs in `npm run docs:api`
// and `npm run docs:api:check`.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Application } from "typedoc";

const ANCHORS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "python-reference-anchors.gen.json",
);
const ROOT = "mixpanel_headless";

/** @type {{ site: string, pages: Record<string, string[]> }} */
const { site, pages } = JSON.parse(readFileSync(ANCHORS, "utf8"));

/** Anchor id → page slug. */
const PAGE_OF = new Map();
for (const [page, ids] of Object.entries(pages)) {
  for (const id of ids) PAGE_OF.set(id, page);
}

/**
 * Resolve a dotted `mixpanel_headless.…` name against the anchor set.
 *
 * @param {string} dotted - The name as written after `@see`.
 * @returns {{ url: string, anchor: string, exact: boolean } | undefined}
 *   The page URL with fragment and whether the fragment is the name's own
 *   anchor (`exact`) or its object's; `undefined` when nothing is listed.
 */
export function resolvePythonReference(dotted) {
  const segments = dotted.split(".");
  if (segments.shift() !== ROOT || segments.length === 0) return;
  // Candidates start at each module prefix up to the object (the first
  // capitalised segment); a module-level name tries every segment.
  const capital = segments.findIndex((s) => /^[A-Z]/.test(s));
  const lastStart = capital === -1 ? segments.length - 1 : capital;
  let best;
  for (let start = 0; start <= lastStart; start++) {
    for (let end = segments.length; end > start; end--) {
      const anchor = [ROOT, ...segments.slice(start, end)].join(".");
      const page = PAGE_OF.get(anchor);
      if (page === undefined) continue;
      const hit = {
        url: `${site}/${page}/#${anchor}`,
        anchor,
        exact: end === segments.length,
      };
      if (hit.exact) return hit;
      if (!best || end - start > best.depth)
        best = { ...hit, depth: end - start };
      break;
    }
  }
  if (!best) return;
  return { url: best.url, anchor: best.anchor, exact: false };
}

/**
 * TypeDoc's plugin entry point.
 *
 * @param {Application} app - The TypeDoc application.
 * @returns {void}
 */
export function load(app) {
  app.on(Application.EVENT_PROJECT_REVIVE, (project) => {
    const counts = { exact: 0, object: 0, plain: 0 };
    for (const id in project.reflections) {
      const comment = project.reflections[id].comment;
      if (!comment) continue;
      for (const tag of comment.blockTags) {
        if (tag.tag !== "@see" || tag.content.length !== 1) continue;
        const [part] = tag.content;
        if (part.kind !== "text") continue;
        const dotted = part.text.trim();
        if (!dotted.startsWith(`${ROOT}.`) || /\s/.test(dotted)) continue;
        const hit = resolvePythonReference(dotted);
        if (hit === undefined) {
          counts.plain += 1;
          continue;
        }
        counts[hit.exact ? "exact" : "object"] += 1;
        tag.content = [
          { kind: "inline-tag", tag: "@link", text: dotted, target: hit.url },
        ];
      }
    }
    app.logger.verbose(
      `[typedoc-python-see-links] @see tags: ${counts.exact} linked to their own anchor, ${counts.object} to their object's, ${counts.plain} left as text`,
    );
  });
}
