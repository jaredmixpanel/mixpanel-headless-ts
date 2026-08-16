/**
 * B5-S3 R10.9 differential harness — the TS side.
 *
 * Reads `cases.json` (written by `py-side.py`), rebuilds the SAME typed
 * objects from each recipe, runs the four oracle-callable members, and
 * writes `ts-out.json`.
 *
 *     npx vite-node throwaway/b5-s3/ts-side.ts
 *
 * Throwaway (packet §7.5 removes `throwaway/b5-s3/` at the batch gate).
 */

/* eslint-disable @typescript-eslint/no-explicit-any --
   Throwaway harness: `cases.json` is an untyped recipe language read on
   both sides; `unknown` would only add casts at every use site. */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { RrwebAnalyzer } from "../../packages/core/src/replays/rrweb-analyzer.js";
import {
  defaultLabelFn,
  selectorLabelFn,
  urlNormalizer,
} from "../../packages/core/src/replays/replay-labels.js";
import { UserAction } from "../../packages/core/src/types/results/replays.js";
import { MixpanelHeadlessError } from "../../packages/core/src/errors.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** A recipe object as loaded from `cases.json`. */
type Rec = Record<string, any>;

const cases = JSON.parse(
  readFileSync(join(HERE, "cases.json"), "utf8"),
) as Record<string, any[]>;

/**
 * Materialize a `UserAction` from a recipe (the `_build_action` twin).
 *
 * @param recipe - The recipe dict.
 * @returns The constructed action.
 */
function buildAction(recipe: Rec): UserAction {
  return new UserAction({
    timestamp: recipe["timestamp"],
    action: recipe["action"],
    target_node_id: recipe["target_node_id"],
    target_desc: recipe["target_desc"],
    url: recipe["url"],
    metadata: { ...(recipe["metadata"] as Record<string, unknown>) },
  });
}

/**
 * Project an `AnalyzerResult` into the comparable frozen shape (the
 * `_freeze_analyzer` twin).
 *
 * @param events - The raw rrweb event stream.
 * @returns `{actions, markdown, page_visits, console_errors}`.
 */
function freezeAnalyzer(events: any[]): Rec {
  const result = new RrwebAnalyzer().analyze(events);
  return {
    actions: result.actions.map((a) => a.toJSON()),
    markdown: result.markdown_summary,
    page_visits: result.pages.map((p) => ({
      timestamp: p.timestamp,
      url: p.url,
    })),
    console_errors: result.errors.map((e) => ({
      timestamp: e.timestamp,
      message: e.message,
      url: e.url,
    })),
  };
}

/**
 * Run `fn`, capturing a throw as the comparable `{__error__}` record.
 *
 * @param fn - The zero-arg thunk.
 * @returns The value, or an error record with the class name + code.
 */
function run(fn: () => unknown): Rec {
  try {
    return { ok: fn() };
  } catch (exc) {
    return {
      __error__: exc instanceof Error ? exc.constructor.name : typeof exc,
      code: exc instanceof MixpanelHeadlessError ? exc.code : null,
    };
  }
}

const out: Record<string, Rec[]> = {
  url_normalizer: [],
  default_label_fn: [],
  selector_label_fn: [],
  "rrweb_analyzer.analyze": [],
};

for (const url of cases["url_normalizer"] ?? []) {
  out["url_normalizer"]?.push(run(() => urlNormalizer(url as string)));
}
for (const recipe of cases["default_label_fn"] ?? []) {
  out["default_label_fn"]?.push(
    run(() => defaultLabelFn(buildAction(recipe as Rec))),
  );
}
for (const recipe of cases["selector_label_fn"] ?? []) {
  const rec = recipe as Rec;
  out["selector_label_fn"]?.push(
    run(() =>
      selectorLabelFn(rec["attr"] as string)(buildAction(rec["action"] as Rec)),
    ),
  );
}
for (const events of cases["rrweb_analyzer.analyze"] ?? []) {
  out["rrweb_analyzer.analyze"]?.push(
    run(() => freezeAnalyzer(events as any[])),
  );
}

writeFileSync(join(HERE, "ts-out.json"), JSON.stringify(out, null, 1));
for (const [family, values] of Object.entries(out)) {
  const raised = values.filter((v) => "__error__" in v).length;
  console.log(
    `${family.padEnd(26)} ${String(values.length).padStart(5)} cases  ${String(
      raised,
    ).padStart(4)} raised`,
  );
}
