// Unit tests for Session/Project/WorkspaceRef/ActiveSession parse
// factories + free functions (packet P2-4, phase2-design C4). Extra-key
// behavior mirrors each Pydantic model_config: Project/WorkspaceRef/
// Session IGNORE extras (frozen only); ActiveSession is extra='forbid'
// and rejects `project` by name.
import { describe, expect, it } from "vitest";

import type { TokenResolver } from "../../src/auth/account.js";
import {
  parseActiveSession,
  parseProject,
  parseSession,
  parseWorkspaceRef,
  type Session,
  sessionAuthHeader,
  sessionReplace,
} from "../../src/auth/session.js";
import {
  ParamTypeError,
  ParamValidationError,
  ResponseValidationError,
} from "../../src/errors.js";

/** A minimal valid service-account payload. */
const SA_PAYLOAD = {
  type: "service_account",
  name: "team",
  region: "us",
  username: "sa.user",
  secret: "hunter2",
} as const;

/** A minimal valid session payload. */
const SESSION_PAYLOAD = {
  account: SA_PAYLOAD,
  project: { id: "3713224" },
} as const;

describe("parseProject", () => {
  it("parses the id plus optional /me fields, preserving null vs absent", () => {
    const bare = parseProject({ id: "3713224" });
    expect(bare.id).toBe("3713224");
    expect(Object.hasOwn(bare, "name")).toBe(false);
    const full = parseProject({
      id: "1",
      name: null,
      organization_id: 88,
      timezone: "US/Pacific",
    });
    expect(full.name).toBeNull();
    expect(full.organization_id).toBe(88);
    expect(full.timezone).toBe("US/Pacific");
  });

  it("rejects non-digit / empty / missing ids", () => {
    for (const bad of ["", "12a", null, undefined, 3713224]) {
      expect(() => parseProject({ id: bad })).toThrow(ResponseValidationError);
    }
  });

  it("IGNORES unknown keys (Pydantic default — no extra='forbid')", () => {
    const project = parseProject({ id: "1", server_only_field: true });
    expect(Object.hasOwn(project, "server_only_field")).toBe(false);
  });
});

describe("parseWorkspaceRef", () => {
  it("parses a positive integer id with lax coercion", () => {
    expect(parseWorkspaceRef({ id: 3448414 }).id).toBe(3448414);
    // Pydantic lax mode accepts digit strings for int fields (R4.12).
    expect(parseWorkspaceRef({ id: "42" }).id).toBe(42);
  });

  it("rejects non-positive ids (Field(gt=0))", () => {
    expect(() => parseWorkspaceRef({ id: 0 })).toThrow(ResponseValidationError);
    expect(() => parseWorkspaceRef({ id: -3 })).toThrow(
      ResponseValidationError,
    );
  });

  it("carries the optional coupling fields", () => {
    const ref = parseWorkspaceRef({
      id: 1,
      name: "Main",
      is_default: true,
      project_id: "3713224",
    });
    expect(ref.name).toBe("Main");
    expect(ref.is_default).toBe(true);
    expect(ref.project_id).toBe("3713224");
    expect(() => parseWorkspaceRef({ id: 1, is_default: "yes" })).toThrow(
      ResponseValidationError,
    );
  });
});

describe("parseSession", () => {
  it("parses nested account/project and defaults headers to an empty map", () => {
    const session = parseSession(SESSION_PAYLOAD);
    expect(session.account.type).toBe("service_account");
    expect(session.project.id).toBe("3713224");
    expect(session.headers).toBeInstanceOf(Map);
    expect(session.headers.size).toBe(0);
    // workspace omitted -> key ABSENT (lazy resolution).
    expect(Object.hasOwn(session, "workspace")).toBe(false);
  });

  it("preserves an explicit null workspace and parses a full one", () => {
    const cleared = parseSession({ ...SESSION_PAYLOAD, workspace: null });
    expect(cleared.workspace).toBeNull();
    const bound = parseSession({
      ...SESSION_PAYLOAD,
      workspace: { id: 7, project_id: "3713224" },
    });
    expect(bound.workspace?.id).toBe(7);
  });

  it("fills headers from a plain record (string values only)", () => {
    const session = parseSession({
      ...SESSION_PAYLOAD,
      headers: { "X-Custom": "yes" },
    });
    expect(session.headers.get("X-Custom")).toBe("yes");
    expect(() =>
      parseSession({ ...SESSION_PAYLOAD, headers: { "X-N": 5 } }),
    ).toThrow(ResponseValidationError);
    // default_factory fires on ABSENT only — explicit null is an error
    // (headers is a required Mapping, session.py:145 / R4.12).
    expect(() => parseSession({ ...SESSION_PAYLOAD, headers: null })).toThrow(
      ResponseValidationError,
    );
  });

  it("rejects a workspace bound to the wrong project (model validator)", () => {
    expect(() =>
      parseSession({
        ...SESSION_PAYLOAD,
        workspace: { id: 7, project_id: "999" },
      }),
    ).toThrow(ResponseValidationError);
    // No project_id on the ref -> "trust the caller", accepted.
    const trusted = parseSession({
      ...SESSION_PAYLOAD,
      workspace: { id: 7 },
    });
    expect(trusted.workspace?.id).toBe(7);
  });
});

describe("sessionAuthHeader", () => {
  it("delegates to the account for service accounts (resolver optional)", async () => {
    const session = parseSession(SESSION_PAYLOAD);
    await expect(sessionAuthHeader(session, {})).resolves.toBe(
      "Basic c2EudXNlcjpodW50ZXIy",
    );
  });

  it("requires a resolver for OAuth accounts (Python TypeError parity)", async () => {
    const session = parseSession({
      ...SESSION_PAYLOAD,
      account: { type: "oauth_browser", name: "me", region: "us" },
    });
    await expect(sessionAuthHeader(session, {})).rejects.toThrow(
      ParamTypeError,
    );
    const resolver: TokenResolver = {
      /**
       * Return a fixed browser token.
       *
       * @returns The literal `tok`.
       */
      getBrowserToken: () => Promise.resolve("tok"),
      /**
       * Return a fixed static token.
       *
       * @returns The literal `tok`.
       */
      getStaticToken: () => Promise.resolve("tok"),
    };
    await expect(
      sessionAuthHeader(session, { tokenResolver: resolver }),
    ).resolves.toBe("Bearer tok");
  });
});

describe("sessionReplace (Python Session.replace parity)", () => {
  const original: Session = parseSession({
    ...SESSION_PAYLOAD,
    workspace: { id: 7 },
    headers: { "X-A": "1" },
  });

  it("preserves omitted axes and never mutates the original", () => {
    const swapped = sessionReplace(original, {
      project: { id: "3018488" },
    });
    expect(swapped.project.id).toBe("3018488");
    expect(swapped.account).toBe(original.account);
    expect(swapped.workspace).toEqual({ id: 7 });
    expect(swapped.headers.get("X-A")).toBe("1");
    expect(original.project.id).toBe("3713224");
  });

  it("clears the workspace with an explicit null (sentinel semantics)", () => {
    const cleared = sessionReplace(original, { workspace: null });
    expect(cleared.workspace).toBeNull();
    // Omitting the key preserves.
    expect(sessionReplace(original, {}).workspace).toEqual({ id: 7 });
  });

  it("clears headers with an empty map", () => {
    const cleared = sessionReplace(original, { headers: new Map() });
    expect(cleared.headers.size).toBe(0);
  });

  it("does NOT re-validate (model_copy parity): a mismatched workspace passes", () => {
    // Python's model_copy(update=...) skips validators, so replacing in a
    // workspace whose project_id mismatches does not raise — the API
    // surfaces the mismatch at request time. Bug-compat by design.
    const mismatched = sessionReplace(original, {
      workspace: { id: 9, project_id: "999" },
    });
    expect(mismatched.workspace?.project_id).toBe("999");
  });

  it("passing null for account/project preserves them (is-not-None parity)", () => {
    const kept = sessionReplace(original, { account: null, project: null });
    expect(kept.account).toBe(original.account);
    expect(kept.project).toBe(original.project);
  });
});

describe("parseActiveSession (extra='forbid')", () => {
  it("parses account/workspace with both optional", () => {
    expect(parseActiveSession({})).toEqual({});
    const full = parseActiveSession({ account: "team", workspace: 3448414 });
    expect(full.account).toBe("team");
    expect(full.workspace).toBe(3448414);
    const nulls = parseActiveSession({ account: null, workspace: null });
    expect(nulls.account).toBeNull();
    expect(nulls.workspace).toBeNull();
  });

  it("REJECTS a project key — project lives on Account.default_project", () => {
    // Python's docstring rationale, ported: switching accounts implicitly
    // switches projects; `[active]` has NO project axis.
    expect(() =>
      parseActiveSession({ account: "team", project: "3713224" }),
    ).toThrow(ResponseValidationError);
  });

  it("rejects any other unknown key and honors the param boundary", () => {
    expect(() => parseActiveSession({ target: "ecom" })).toThrow(
      ResponseValidationError,
    );
    expect(() =>
      parseActiveSession({ target: "ecom" }, { boundary: "param" }),
    ).toThrow(ParamValidationError);
  });

  it("accepts any integer workspace (no gt=0 constraint on ActiveSession)", () => {
    // Python declares `workspace: WorkspaceId | None` with NO Field(gt=0)
    // here (unlike WorkspaceRef.id) — bug-compat: zero/negative accepted.
    expect(parseActiveSession({ workspace: 0 }).workspace).toBe(0);
    expect(parseActiveSession({ workspace: -1 }).workspace).toBe(-1);
  });

  it("parses the account name WITHOUT the accounts-block pattern guard", () => {
    // ActiveSession.account is a bare AccountName (NewType over str) —
    // no pattern/length constraints apply at this seam in Python.
    expect(parseActiveSession({ account: "has space" }).account).toBe(
      "has space",
    );
  });
});
