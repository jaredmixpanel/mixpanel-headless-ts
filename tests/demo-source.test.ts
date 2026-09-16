// Source-level rules for the docs playground (docs/.vitepress/theme/demo/;
// CONTRIBUTING.md "Documentation" → "Playground"): nothing durable may hold
// a token, the OAuth redirect URI is a build constant for both login
// transports, the callback page relays a popup return before it would
// complete anything, the setup snippets the code panel prefixes are the
// page's compiled twoslash blocks, and every link literal the components
// emit points at a page that exists.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { renderCall } from "../docs/.vitepress/theme/demo/model/call.js";
import { toCall } from "../docs/.vitepress/theme/demo/model/query-spec.js";
import {
  LIVE_SETUP,
  OFFLINE_SETUP,
  withImports,
} from "../docs/.vitepress/theme/demo/model/setup-snippets.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(REPO_ROOT, "docs");
const DEMO_SOURCE = join(DOCS, ".vitepress/theme/demo");
const DEMO_PAGE = join(DOCS, "demo/index.md");
const REFERENCE = join(DOCS, "reference");

/**
 * Every TypeScript file under the playground tree, repo-relative.
 *
 * @param dir - Directory to walk.
 * @returns Paths relative to the repo root, sorted.
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (entry.endsWith(".ts")) {
      out.push(relative(REPO_ROOT, path));
    }
  }
  return out.sort();
}

/**
 * Source text with comments removed, so a rule about code cannot trip on
 * a comment that names the forbidden thing.
 *
 * @param text - TypeScript source.
 * @returns The text without `//` and `/* *\/` comments.
 */
function stripComments(text: string): string {
  return text.replaceAll(/\/\*[\s\S]*?\*\//gu, "").replaceAll(/\/\/.*$/gmu, "");
}

const sources = sourceFiles(DEMO_SOURCE).map((path) => ({
  path,
  code: stripComments(readFileSync(join(REPO_ROOT, path), "utf8")),
}));

describe("playground source: storage", () => {
  it("has files to check", () => {
    expect(sources.length).toBeGreaterThan(0);
  });

  it("never touches localStorage", () => {
    const offenders = sources
      .filter(({ code }) => /\blocalStorage\b/u.test(code))
      .map(({ path }) => path);
    expect(offenders).toStrictEqual([]);
  });

  it("never touches document.cookie", () => {
    const offenders = sources
      .filter(({ code }) => /\bdocument\s*\.\s*cookie\b/u.test(code))
      .map(({ path }) => path);
    expect(offenders).toStrictEqual([]);
  });
});

/** The library calls that start a login and take a redirect URI. */
const LOGIN_STARTERS = ["beginLogin", "loginInPopup"] as const;

describe("playground source: redirect URI", () => {
  /**
   * Every call of `name` in the playground sources, as its text up to
   * the closing parenthesis (balanced), so the `redirectUri` assertion
   * looks at that call's arguments only.
   *
   * @param name - The called function.
   * @returns The calls, with the file each is in.
   */
  function callsOf(name: string): Array<{ path: string; text: string }> {
    return sources.flatMap(({ path, code }) => {
      const out: Array<{ path: string; text: string }> = [];
      let from = 0;
      for (;;) {
        const start = code.indexOf(`${name}(`, from);
        if (start === -1) {
          break;
        }
        let depth = 0;
        let end = start + name.length;
        for (; end < code.length; end += 1) {
          const ch = code[end];
          if (ch === "(") {
            depth += 1;
          } else if (ch === ")") {
            depth -= 1;
            if (depth === 0) {
              break;
            }
          }
        }
        out.push({ path, text: code.slice(start, end + 1) });
        from = end;
      }
      return out;
    });
  }
  const calls = LOGIN_STARTERS.map((name) => ({ name, calls: callsOf(name) }));

  it.each(LOGIN_STARTERS)("calls %s at most once", (name) => {
    expect(callsOf(name).length).toBeLessThanOrEqual(1);
  });

  it("starts a login through both transports", () => {
    expect(calls.map(({ calls: found }) => found.length)).toStrictEqual([1, 1]);
  });

  it("passes the build-time constant as the redirect URI to every login start", () => {
    for (const { calls: found } of calls) {
      for (const call of found) {
        expect(call.text).toMatch(/\bredirectUri:\s*__DEMO_REDIRECT_URI__\b/u);
      }
    }
  });
});

describe("playground source: callback page", () => {
  const callback = sources.find(({ path }) =>
    path.endsWith("/demo/ui/callback.ts"),
  );

  it("calls relayPopupReturn before completeLogin", () => {
    const code = callback?.code ?? "";
    const relay = code.indexOf("relayPopupReturn(");
    const complete = code.indexOf("completeLogin(");
    expect(relay).toBeGreaterThan(-1);
    expect(complete).toBeGreaterThan(-1);
    expect(relay).toBeLessThan(complete);
  });
});

describe("playground source: setup snippets", () => {
  /**
   * The `ts twoslash` code blocks of the playground page, in order, each
   * with its cut marker line removed (what the reader sees and what the
   * code panel prefixes).
   *
   * @returns The block bodies.
   */
  function pageSnippets(): string[] {
    const page = readFileSync(DEMO_PAGE, "utf8");
    return [...page.matchAll(/^```ts twoslash\n([\s\S]*?)^```$/gmu)].map(
      (match) =>
        (match[1] ?? "")
          .split("\n")
          .filter((line) => line.trim() !== "// ---cut---")
          .join("\n")
          .trimEnd(),
    );
  }

  it("the page has the offline, the live and the filtered-query block", () => {
    expect(pageSnippets().length).toBeGreaterThanOrEqual(3);
  });

  it("OFFLINE_SETUP is the page's first twoslash block", () => {
    expect(OFFLINE_SETUP.trimEnd()).toBe(pageSnippets()[0]);
  });

  it("LIVE_SETUP is the page's second twoslash block", () => {
    expect(LIVE_SETUP.trimEnd()).toBe(pageSnippets()[1]);
  });

  it("the filtered query with its merged import is the page's third twoslash block", () => {
    const call = toCall({
      kind: "trend",
      event: "Note Saved",
      math: "total",
      last: 30,
      where: { property: "platform", value: "iOS" },
    });
    const program = `${withImports(OFFLINE_SETUP, call.imports).trimEnd()}\n${renderCall(call)}`;
    expect(program).toBe(pageSnippets()[2]);
  });
});

describe("playground source: link literals", () => {
  const links = sources.flatMap(({ path, code }) =>
    [...code.matchAll(/["'`](\/(?:guide|reference)\/[^"'`\s]*)["'`]/gu)].map(
      (match) => ({ path, link: match[1] ?? "" }),
    ),
  );

  /**
   * Whether a root-relative link resolves to a Markdown page under `docs/`.
   *
   * @param link - `/guide/x` or `/reference/x/y`, optionally with a fragment.
   * @returns `true` when `docs<link>.md` or `docs<link>/index.md` exists.
   */
  function pageExists(link: string): boolean {
    const path = link.replace(/#.*$/u, "").replace(/\/$/u, "");
    return (
      existsSync(join(DOCS, `${path}.md`)) ||
      existsSync(join(DOCS, path, "index.md"))
    );
  }

  it("every /guide/ link resolves to a page", () => {
    const dead = links.filter(
      ({ link }) => link.startsWith("/guide/") && !pageExists(link),
    );
    expect(dead).toStrictEqual([]);
  });

  it.skipIf(!existsSync(REFERENCE))(
    "every /reference/ link resolves to a generated page (needs `npm run docs:api`)",
    () => {
      const dead = links.filter(
        ({ link }) => link.startsWith("/reference/") && !pageExists(link),
      );
      expect(dead).toStrictEqual([]);
    },
  );
});
