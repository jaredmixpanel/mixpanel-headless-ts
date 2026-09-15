// Bridge allowlist tests (heads spec 01 §5.3, task H2).
//
// The committed table `conformance-runner/bridge-allowlist.gen.json` is the
// route/classification source of truth the desktop bridge handler matches
// against. It is DERIVED from the pinned corpus, so it can go stale exactly
// like `api-map.gen.ts` does; these tests are the gate that notices.
//
// 1. Freshness: re-run scripts/generate-bridge-allowlist.mjs against the
//    committed corpus pin and byte-compare. The two header stamps that
//    legitimately move on every run (`generatedAt`, `headlessCommit`) are
//    fed back into the regeneration so the comparison stays byte-exact
//    over everything that is actually derived.
// 2. Coverage: every `wire_api` in the corpus api-index has at least one
//    row, unless the rules file records it as excluded or as a justified
//    coverage exception — so a headless method with no wire vector is
//    noticed rather than silently unreachable through the bridge.
// 3. Rules hygiene: no stale exclusion rows, every reason non-empty.
// 4. Row invariants: write rows carry a write class and a consent verb,
//    read rows carry neither, and overlapping templates never disagree
//    about access (the classifier must not be widenable by route order).
// 5. Pinning and route shape: every row's `pin` is backed by real evidence
//    in the route (§5.5 pins the project id wherever it rides — path, query
//    param or body field), no placeholder sits directly under a family root
//    where it would wildcard the family, no bindable id is left anonymous,
//    and no literal segment still holds a slash.
// 6. Denied routes: routes the rules refuse are emitted, justified, and
//    never present in the matchable `rows`.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/** The conformance-runner package root. */
const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** The repository root (generator + rule data live under scripts/). */
const REPO_ROOT = resolve(PACKAGE_DIR, "..");

const GENERATOR_PATH = resolve(
  REPO_ROOT,
  "scripts",
  "generate-bridge-allowlist.mjs",
);
const RULES_PATH = resolve(REPO_ROOT, "scripts", "bridge-allowlist-rules.json");
const VERBS_PATH = resolve(REPO_ROOT, "scripts", "consent-verbs.json");
const ROUTE_VERBS_PATH = resolve(REPO_ROOT, "scripts", "route-verbs.json");
const ALLOWLIST_PATH = resolve(PACKAGE_DIR, "bridge-allowlist.gen.json");
const API_INDEX_PATH = resolve(PACKAGE_DIR, "corpus", "api-index.json");
const CORPUS_CONFIG_PATH = resolve(PACKAGE_DIR, "corpus.config.json");

/** One alias row: a second headless api reaching the same route. */
interface AllowlistAlias {
  readonly pyApi: string;
  readonly tsMethod: string;
  readonly capability: string;
  readonly vectorCount: number;
}

/** Which identifier §5.5 can pin a route against. */
type PinKind = "project" | "organization" | "workspace" | "none";

/** One allowlist row (spec 01 §5.3 step 6). */
interface AllowlistRow {
  readonly method: string;
  readonly family: string;
  readonly template: string;
  readonly paramNames: readonly string[];
  readonly access: "read" | "write";
  readonly pin: PinKind;
  readonly pinSources: ReadonlyArray<"path" | "query" | "body">;
  readonly writeClass?: string;
  readonly consentVerb?: string;
  readonly tsMethod: string;
  readonly pyApi: string;
  readonly capability: string;
  readonly vectorCount: number;
  readonly aliases?: readonly AllowlistAlias[];
}

/** A route the corpus records but the rules refuse to admit. */
interface DeniedRoute extends AllowlistRow {
  readonly denyReason: string;
}

/** The committed table. */
interface Allowlist {
  readonly note: string;
  readonly schema: number;
  readonly corpusCommit: string;
  readonly generatedAt: string;
  readonly headlessCommit: string;
  readonly rulesSha256: string;
  readonly verbsSha256: string;
  readonly routeVerbsSha256: string;
  readonly rows: readonly AllowlistRow[];
  readonly deniedRoutes: readonly DeniedRoute[];
}

/** One family root, e.g. `/api/query/engage`. */
interface FamilyRule {
  readonly pathPrefix: string;
  readonly family: string;
}

/** The committed rule data (scripts/bridge-allowlist-rules.json). */
interface Rules {
  readonly excludedApis: Readonly<Record<string, string>>;
  readonly coverageExceptions: Readonly<Record<string, string>>;
  readonly families: readonly FamilyRule[];
}

/** The committed consent copy (scripts/consent-verbs.json). */
interface ConsentVerbs {
  readonly verbs: Readonly<Record<string, string>>;
}

/** One api-index entry (corpus sidecar shape). */
interface ApiIndexEntry {
  readonly capability: string;
  readonly kind: string;
}

const allowlistText = readFileSync(ALLOWLIST_PATH, "utf8");
const allowlist = JSON.parse(allowlistText) as Allowlist;
const rules = JSON.parse(readFileSync(RULES_PATH, "utf8")) as Rules;
const consentVerbs = JSON.parse(
  readFileSync(VERBS_PATH, "utf8"),
) as ConsentVerbs;
const apiIndex = JSON.parse(readFileSync(API_INDEX_PATH, "utf8")) as Readonly<
  Record<string, ApiIndexEntry>
>;
const corpusConfig = JSON.parse(
  readFileSync(CORPUS_CONFIG_PATH, "utf8"),
) as Readonly<{ sourceCommit: string }>;

/** sha256 of a file's bytes. */
function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("bridge-allowlist.gen.json freshness (spec 01 §5.3)", () => {
  it("is byte-identical to a fresh regeneration from the pinned corpus", () => {
    const regenerated = execFileSync(
      process.execPath,
      [
        GENERATOR_PATH,
        "--stdout",
        `--generated-at=${allowlist.generatedAt}`,
        `--headless-commit=${allowlist.headlessCommit}`,
      ],
      { encoding: "utf8", cwd: REPO_ROOT },
    );
    expect(regenerated).toBe(allowlistText);
  });

  it("stamps the corpus pin and all three rule-input digests", () => {
    expect(allowlist.schema).toBe(1);
    expect(allowlist.corpusCommit).toBe(corpusConfig.sourceCommit);
    expect(allowlist.rulesSha256).toBe(sha256(RULES_PATH));
    expect(allowlist.verbsSha256).toBe(sha256(VERBS_PATH));
    expect(allowlist.routeVerbsSha256).toBe(sha256(ROUTE_VERBS_PATH));
  });

  it("says in the file that the two moving stamps are not load-bearing", () => {
    expect(allowlist.note).toContain("generatedAt");
    expect(allowlist.note).toContain("headlessCommit");
    expect(allowlist.note).toContain("informational");
  });
});

describe("bridge-allowlist coverage (spec 01 §5.3)", () => {
  /**
   * Every python api the table accounts for: primary rows plus aliases, and
   * the denied routes too — an api the rules deliberately refuse is still
   * accounted for, and the desktop needs the row to name the refusal.
   */
  const coveredApis = new Set<string>();
  for (const row of [...allowlist.rows, ...allowlist.deniedRoutes]) {
    coveredApis.add(row.pyApi);
    for (const alias of row.aliases ?? []) {
      coveredApis.add(alias.pyApi);
    }
  }

  it("has at least one row for every wire_api that is not excluded", () => {
    const missing = Object.entries(apiIndex)
      .filter(([, entry]) => entry.kind === "wire_api")
      .map(([name]) => name)
      .filter(
        (name) =>
          !coveredApis.has(name) &&
          !Object.hasOwn(rules.excludedApis, name) &&
          !Object.hasOwn(rules.coverageExceptions, name),
      )
      .sort();
    expect(missing).toStrictEqual([]);
  });

  it("records only live, justified exclusions", () => {
    const stale: string[] = [];
    for (const [name, reason] of [
      ...Object.entries(rules.excludedApis),
      ...Object.entries(rules.coverageExceptions),
    ]) {
      if (!Object.hasOwn(apiIndex, name)) {
        stale.push(`${name} (not in api-index.json)`);
      }
      if (reason.trim() === "") {
        stale.push(`${name} (empty justification)`);
      }
    }
    expect(stale.sort()).toStrictEqual([]);
  });

  it("never excludes an api it also emits rows for", () => {
    const contradictory = Object.keys(rules.excludedApis)
      .filter((name) => coveredApis.has(name))
      .sort();
    expect(contradictory).toStrictEqual([]);
  });
});

describe("bridge-allowlist row invariants (spec 01 §5.3, §7.2)", () => {
  it("gives every write row a write class and a consent verb", () => {
    const bad = allowlist.rows
      .filter(
        (row) =>
          row.access === "write" &&
          (row.writeClass === undefined || row.consentVerb === undefined),
      )
      .map((row) => `${row.method} ${row.template}`);
    expect(bad).toStrictEqual([]);
  });

  it("gives read rows neither a write class nor a consent verb", () => {
    const bad = allowlist.rows
      .filter(
        (row) =>
          row.access === "read" &&
          (row.writeClass !== undefined || row.consentVerb !== undefined),
      )
      .map((row) => `${row.method} ${row.template}`);
    expect(bad).toStrictEqual([]);
  });

  it("has exactly one row per (method, family, template), sorted", () => {
    const keys = allowlist.rows.map(
      // NUL separator, written as an escape so this file stays plain
      // text: it sorts below every printable character, so comparing
      // the joined keys is exactly comparing the (family, template,
      // method) tuples the generator sorted by.
      (row) => `${row.family}\u0000${row.template}\u0000${row.method}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toStrictEqual([...keys].sort());
  });

  it("never lets two overlapping templates disagree about access", () => {
    /** Can `a` and `b` match the same concrete path? */
    const overlaps = (a: AllowlistRow, b: AllowlistRow): boolean => {
      const left = a.template.split("/");
      const right = b.template.split("/");
      if (left.length !== right.length) return false;
      return left.every((segment, i) => {
        const other = right[i];
        if (other === undefined) return false;
        const placeholder =
          segment.startsWith("{") || other.startsWith("{") ? true : false;
        return placeholder ? true : segment === other;
      });
    };
    const conflicts: string[] = [];
    for (let i = 0; i < allowlist.rows.length; i += 1) {
      for (let j = i + 1; j < allowlist.rows.length; j += 1) {
        const a = allowlist.rows[i];
        const b = allowlist.rows[j];
        if (a === undefined || b === undefined) continue;
        if (a.method !== b.method || a.family !== b.family) continue;
        if (!overlaps(a, b)) continue;
        if (a.access !== b.access || a.writeClass !== b.writeClass) {
          conflicts.push(`${a.method} ${a.template} vs ${b.template}`);
        }
      }
    }
    expect(conflicts).toStrictEqual([]);
  });

  it("carries no consent verb for a method that is never a write", () => {
    /** Every write tsMethod the table can reach, primary rows plus aliases. */
    const writeMethods = new Set<string>();
    for (const row of allowlist.rows) {
      if (row.access !== "write") continue;
      writeMethods.add(row.tsMethod);
      for (const alias of row.aliases ?? []) {
        writeMethods.add(alias.tsMethod);
      }
    }
    const unused = Object.keys(consentVerbs.verbs)
      .filter((method) => !writeMethods.has(method))
      .sort();
    expect(unused).toStrictEqual([]);
  });

  it("never admits an export-family host route", () => {
    const bad = allowlist.rows
      .filter((row) => !["query", "engage", "app"].includes(row.family))
      .map((row) => `${row.family} ${row.template}`);
    expect(bad).toStrictEqual([]);
  });
});

describe("bridge-allowlist pinning and route shape (spec 01 §5.2, §5.5)", () => {
  const everyRow: readonly AllowlistRow[] = [
    ...allowlist.rows,
    ...allowlist.deniedRoutes,
  ];

  it("gives every row a pin backed by evidence in the route", () => {
    // §5.5 pins every occurrence of a project identifier, wherever it rides:
    // a path placeholder, a query param, or a top-level JSON body field. A
    // pin must be evidenced by at least one of those, and only `none` may
    // have no evidence at all.
    const wrong: string[] = [];
    for (const row of everyRow) {
      const evidence = new Set(row.pinSources);
      if (row.pin === "none") {
        if (evidence.size > 0) wrong.push(`${row.template}: none with sources`);
        continue;
      }
      if (evidence.size === 0) {
        wrong.push(`${row.method} ${row.template}: ${row.pin} with no source`);
        continue;
      }
      const placeholder = `{${row.pin === "project" ? "project_id" : row.pin === "organization" ? "organization_id" : "workspace_id"}}`;
      if (evidence.has("path") !== row.template.includes(placeholder)) {
        wrong.push(`${row.method} ${row.template}: path source disagrees`);
      }
    }
    expect(wrong).toStrictEqual([]);
  });

  it("pins the whole query family to a project", () => {
    // Regression guard: the query family carries project_id as a param or a
    // body field, never as a path segment. A template-only pin rule reports
    // "none" here and silently drops the §5.5 check for every query route.
    const unpinned = allowlist.rows
      .filter((row) => row.family === "query" || row.family === "engage")
      .filter((row) => row.pin !== "project")
      .map((row) => `${row.method} ${row.template}: ${row.pin}`);
    expect(unpinned).toStrictEqual([]);
  });

  it("never leaves a workspace route pin-less", () => {
    // §5.5: a workspace-scoped route pins to its project when it carries
    // project evidence and to the workspace otherwise. Pin-less would mean
    // the lease has nothing to hold it to, and a page could reach another
    // project's workspace through it.
    const unpinned = everyRow
      .filter((row) => row.template.includes("{workspace_id}"))
      .filter((row) => row.pin !== "project" && row.pin !== "workspace")
      .map((row) => `${row.method} ${row.template}: ${row.pin}`);
    expect(unpinned).toStrictEqual([]);
  });

  it("only ever pins to the workspace where there is no project evidence", () => {
    const wrong = everyRow
      .filter((row) => row.pin === "workspace")
      .filter(
        (row) =>
          row.template.includes("{project_id}") ||
          row.paramNames.includes("project_id"),
      )
      .map((row) => `${row.method} ${row.template}`);
    expect(wrong).toStrictEqual([]);
  });

  it("pins every project-scoped app route", () => {
    const unpinned = allowlist.rows
      .filter((row) => row.template.includes("{project_id}"))
      .filter(
        (row) => row.pin !== "project" || !row.pinSources.includes("path"),
      )
      .map((row) => `${row.method} ${row.template}: ${row.pin}`);
    expect(unpinned).toStrictEqual([]);
  });

  it("never leaves a bindable id as an anonymous {param} or {int}", () => {
    // A digit segment straight after a literal `workspaces`/`organizations`
    // is an id the lease can be pinned against; if it landed as {int} or
    // {param} the matcher would have nothing to bind.
    const leaked: string[] = [];
    for (const row of everyRow) {
      const segments = row.template.split("/");
      segments.forEach((segment, i) => {
        if (segment !== "workspaces" && segment !== "organizations") return;
        const next = segments[i + 1];
        if (next === "{int}" || next === "{param}") {
          leaked.push(`${row.method} ${row.template}`);
        }
      });
    }
    expect(leaked).toStrictEqual([]);
  });

  it("never places a placeholder directly under a family root", () => {
    // A wildcard in the first segment after /api/query, /api/query/engage or
    // /api/app is a wildcard over that whole family (spec 01 §5.3).
    const rootDepth = new Map<string, number>();
    for (const family of rules.families) {
      const root = family.pathPrefix.replace(/\/$/, "");
      rootDepth.set(family.family, root.split("/").length);
    }
    const wildcards: string[] = [];
    for (const row of everyRow) {
      const depth = rootDepth.get(row.family);
      if (depth === undefined) continue;
      const head = row.template.split("/")[depth];
      if (head !== undefined && head.startsWith("{")) {
        wildcards.push(`${row.method} ${row.family} ${row.template}`);
      }
    }
    expect(wildcards).toStrictEqual([]);
  });

  it("never leaves a slash inside a literal template segment", () => {
    const ambiguous = everyRow
      .filter((row) =>
        row.template
          .split("/")
          .some((segment) => !segment.startsWith("{") && segment.includes("/")),
      )
      .map((row) => `${row.method} ${row.template}`);
    expect(ambiguous).toStrictEqual([]);
  });

  it("keeps the saved-report types as literal routes, not a wildcard", () => {
    const savedReport = everyRow.filter(
      (row) =>
        row.pyApi === "api_client.query_saved_report" ||
        (row.aliases ?? []).some(
          (alias) => alias.pyApi === "api_client.query_saved_report",
        ),
    );
    expect(savedReport.length).toBeGreaterThan(1);
    const templates = savedReport.map((row) => row.template).sort();
    expect(templates.every((t) => !t.includes("{"))).toBe(true);
  });
});

describe("bridge-allowlist consent verbs (spec 01 §7.2)", () => {
  /** Run the generator with substitute rule inputs; return its stderr. */
  const runGenerator = (
    overrides: Readonly<{ verbs?: string; routeVerbs?: string }>,
  ): { readonly status: number; readonly stderr: string } => {
    const result = spawnSync(
      process.execPath,
      [
        GENERATOR_PATH,
        "--stdout",
        "--generated-at=x",
        "--headless-commit=x",
        `--verbs=${overrides.verbs ?? VERBS_PATH}`,
        `--route-verbs=${overrides.routeVerbs ?? ROUTE_VERBS_PATH}`,
      ],
      { encoding: "utf8", cwd: REPO_ROOT },
    );
    return { status: result.status ?? -1, stderr: result.stderr };
  };

  /** Write `body` to a scratch file that dies with the test run. */
  const scratch = (name: string, body: unknown): string => {
    const path = join(mkdtempSync(join(tmpdir(), "h2-")), name);
    writeFileSync(path, JSON.stringify(body));
    return path;
  };

  it("fails, naming the route and the verbs, when methods disagree", () => {
    // Drop every route-level phrase: the routes whose methods disagree must
    // now be unresolvable rather than silently taking the primary's verb.
    const { status, stderr } = runGenerator({
      routeVerbs: scratch("route-verbs.json", { verbs: {} }),
    });
    expect(status).toBe(1);
    expect(stderr).toContain(
      "/api/app/projects/{project_id}/data-definitions/events/",
    );
    expect(stderr).toContain("different consent verbs");
    expect(stderr).toContain("deleteCustomEvent");
    expect(stderr).toContain("deleteEventDefinition");
  });

  it("fails when a {n} verb is reachable by a non-bulk method", () => {
    const verbs = JSON.parse(
      readFileSync(VERBS_PATH, "utf8"),
    ) as ConsentVerbs & { verbs: Record<string, string> };
    verbs.verbs["deleteAnnotation"] = "delete {n} annotations";
    const { status, stderr } = runGenerator({
      verbs: scratch("consent-verbs.json", verbs),
    });
    expect(status).toBe(1);
    expect(stderr).toContain("deleteAnnotation");
    expect(stderr).toContain("{n}");
  });

  it("only ever renders {n} on a route every method of which is bulk", () => {
    const isBulk = (method: string): boolean =>
      method.startsWith("bulk") || method.endsWith("Bulk");
    const bad = allowlist.rows
      .filter((row) => (row.consentVerb ?? "").includes("{n}"))
      .filter((row) =>
        [row.tsMethod, ...(row.aliases ?? []).map((a) => a.tsMethod)].some(
          (method) => !isBulk(method),
        ),
      )
      .map((row) => `${row.method} ${row.template}: ${row.consentVerb ?? ""}`);
    expect(bad).toStrictEqual([]);
  });

  it("gives every write route exactly one phrase for all of its methods", () => {
    // The union property: a route reached by several methods must not be
    // described by one of them, because the server cannot tell them apart.
    const routeVerbs = JSON.parse(
      readFileSync(ROUTE_VERBS_PATH, "utf8"),
    ) as ConsentVerbs;
    const methodVerbs = consentVerbs.verbs;
    const misdescribed: string[] = [];
    for (const row of allowlist.rows) {
      if (row.access !== "write") continue;
      const key = `${row.method} ${row.family} ${row.template}`;
      if (Object.hasOwn(routeVerbs.verbs, key)) continue;
      const distinct = new Set(
        [row.tsMethod, ...(row.aliases ?? []).map((a) => a.tsMethod)].map(
          (method) => methodVerbs[method],
        ),
      );
      if (distinct.size !== 1) misdescribed.push(key);
    }
    expect(misdescribed).toStrictEqual([]);
  });
});

describe("bridge-allowlist denied routes (spec 01 §5.3)", () => {
  it("keeps every denied route out of the matchable rows", () => {
    const matchable = new Set(
      allowlist.rows.map(
        (row) => `${row.method} ${row.family} ${row.template}`,
      ),
    );
    const leaked = allowlist.deniedRoutes
      .filter((row) =>
        matchable.has(`${row.method} ${row.family} ${row.template}`),
      )
      .map((row) => `${row.method} ${row.template}`);
    expect(leaked).toStrictEqual([]);
  });

  it("denies exactly the routes it is supposed to, by name", () => {
    // Identity, not just count: a refusal quietly disappearing (or a new
    // route quietly appearing in the denied set) is the failure mode.
    const denied = allowlist.deniedRoutes
      .map((row) => `${row.method} ${row.family} ${row.template}`)
      .sort();
    expect(denied).toStrictEqual([
      "GET app /api/app/projects/{project_id}/data-definitions/lookup-tables/upload-url/",
    ]);
  });

  it("gives every denied route a written justification", () => {
    expect(allowlist.deniedRoutes.length).toBeGreaterThan(0);
    const unjustified = allowlist.deniedRoutes
      .filter((row) => row.denyReason.trim() === "")
      .map((row) => `${row.method} ${row.template}`);
    expect(unjustified).toStrictEqual([]);
  });
});
