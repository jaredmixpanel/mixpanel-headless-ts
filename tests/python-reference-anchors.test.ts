// Provenance of scripts/lib/python-reference-anchors.gen.json (the Python
// reference's heading anchors the TypeDoc @see plugin links against) and
// the resolution rules the plugin applies to it. Regeneration needs the
// Python checkout and a mkdocs build, so the test pins what the header
// records — the corpus pin and the generator's sha256 — rather than
// re-running it, and checks that every provenance tag in the sources
// resolves to an anchor the file actually lists.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolvePythonReference } from "../scripts/lib/typedoc-python-see-links.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ANCHORS = "scripts/lib/python-reference-anchors.gen.json";
const GENERATOR = "scripts/generate-python-reference-anchors.mjs";
const IDENTIFIER = /^mixpanel_headless(\.[A-Za-z_]\w*)+$/;
const PROVENANCE_RE =
  /^Provenance: mixpanel-headless (?<pin>[0-9a-f]{40}) \(the corpus pin\), mkdocs build of a detached worktree with mkdocstrings-python (?<handler>[\w.]+), (?<count>\d+) anchors on (?<pages>\d+) pages\.$/;
const GENERATOR_RE =
  /^Generator sha256: (?<sha>[0-9a-f]{64}) \((?<script>scripts\/[\w.-]+\.mjs)\)\.$/;

interface AnchorDocument {
  readonly $comment: readonly string[];
  readonly site: string;
  readonly pages: Readonly<Record<string, readonly string[]>>;
}

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new Error(`${what} missing`);
  }
  return value;
}

/** Every distinct `@see mixpanel_headless.…` name in the package sources. */
function provenanceTags(): string[] {
  const names = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) {
        for (const match of readFileSync(path, "utf8").matchAll(
          /@see (mixpanel_headless[\w.]*)/g,
        )) {
          names.add(must(match[1], "tag"));
        }
      }
    }
  };
  for (const pkg of ["core", "node", "browser"]) {
    walk(join(REPO_ROOT, "packages", pkg, "src"));
  }
  return [...names].sort();
}

describe("python-reference-anchors.gen.json", () => {
  const document = JSON.parse(read(ANCHORS)) as AnchorDocument;
  const provenance = must(
    document.$comment
      .map((line) => PROVENANCE_RE.exec(line)?.groups)
      .find(Boolean),
    "provenance line",
  );
  const generated = must(
    document.$comment
      .map((line) => GENERATOR_RE.exec(line)?.groups)
      .find(Boolean),
    "generator line",
  );
  const ids = Object.values(document.pages).flat();

  it("was built from the Python revision the corpus pins", () => {
    const config = JSON.parse(
      read("conformance-runner/corpus.config.json"),
    ) as {
      sourceCommit: string;
    };
    expect(provenance["pin"]).toBe(config.sourceCommit);
  });

  it("records the sha256 of the generator that produced it", () => {
    expect(generated["script"]).toBe(GENERATOR);
    expect(generated["sha"]).toBe(
      createHash("sha256")
        .update(readFileSync(join(REPO_ROOT, GENERATOR)))
        .digest("hex"),
    );
  });

  it("claims exactly the anchors it carries", () => {
    expect(Number(provenance["count"])).toBe(ids.length);
    expect(Number(provenance["pages"])).toBe(
      Object.keys(document.pages).length,
    );
  });

  it("lists identifier anchors, sorted and unique per page", () => {
    for (const [page, list] of Object.entries(document.pages)) {
      expect(page, "page slug").toMatch(/^[a-z]+$/);
      expect([...list].sort()).toStrictEqual([...list]);
      expect(new Set(list).size).toBe(list.length);
      for (const id of list) expect(id).toMatch(IDENTIFIER);
    }
    expect(document.site).toBe(
      "https://mixpanel.github.io/mixpanel-headless/api",
    );
  });

  it("covers the pages the plugin's links point at", () => {
    expect(Object.keys(document.pages).sort()).toStrictEqual([
      "auth",
      "exceptions",
      "types",
      "workspace",
    ]);
  });
});

describe("resolvePythonReference", () => {
  const document = JSON.parse(read(ANCHORS)) as AnchorDocument;
  const listed = new Map<string, string>();
  for (const [page, list] of Object.entries(document.pages)) {
    for (const id of list) listed.set(id, page);
  }

  it("drops the module segments a directive omits and keeps the ones it spells", () => {
    expect(
      resolvePythonReference("mixpanel_headless.workspace.Workspace.query"),
    ).toStrictEqual({
      url: `${document.site}/workspace/#mixpanel_headless.Workspace.query`,
      anchor: "mixpanel_headless.Workspace.query",
      exact: true,
    });
    expect(
      resolvePythonReference("mixpanel_headless.auth_types.OAuthTokens")
        ?.anchor,
    ).toBe("mixpanel_headless.auth_types.OAuthTokens");
    expect(
      resolvePythonReference("mixpanel_headless.accounts.login_unified")
        ?.anchor,
    ).toBe("mixpanel_headless.accounts.login_unified");
  });

  it("falls back to the object's own anchor for an unlisted member", () => {
    const method = resolvePythonReference(
      "mixpanel_headless.workspace.Workspace.fetch_replay",
    );
    expect(method).toStrictEqual({
      url: `${document.site}/workspace/#mixpanel_headless.Workspace`,
      anchor: "mixpanel_headless.Workspace",
      exact: false,
    });
    expect(
      resolvePythonReference(
        "mixpanel_headless.workspace.Workspace._persist_active",
      )?.exact,
    ).toBe(false);
  });

  it("leaves names no page documents as plain text", () => {
    expect(
      resolvePythonReference(
        "mixpanel_headless._internal.api_client.MixpanelAPIClient.list_alerts",
      ),
    ).toBeUndefined();
    expect(
      resolvePythonReference("mixpanel_headless.types._boolean_filter_value"),
    ).toBeUndefined();
    expect(resolvePythonReference("mixpanel_headless")).toBeUndefined();
    expect(resolvePythonReference("not_mixpanel.Workspace")).toBeUndefined();
  });

  it("never emits a fragment the generated file does not list", () => {
    const tags = provenanceTags();
    expect(tags.length).toBeGreaterThan(500);
    const fabricated: string[] = [];
    for (const tag of tags) {
      const hit = resolvePythonReference(tag);
      if (hit === undefined) continue;
      const page = listed.get(hit.anchor);
      if (
        page === undefined ||
        hit.url !== `${document.site}/${page}/#${hit.anchor}`
      ) {
        fabricated.push(`${tag} -> ${hit.url}`);
      }
    }
    expect(fabricated).toStrictEqual([]);
  });
});
