// B6-W1 Layer-3 translation of
// `tests/unit/test_workspace_business_context.py` (WHOLE file, 583
// lines — packet §3 table): `TestGetBusinessContextProject` (:146),
// `TestSetBusinessContextProject` (:230),
// `TestClearBusinessContextProject` (:324),
// `TestGetBusinessContextOrganization` (:350),
// `TestSetBusinessContextOrganization` (:446),
// `TestGetBusinessContextChain` (:483).
//
// Python's `httpx.MockTransport` handler becomes the injected-fetch
// `fakeTransport` seam; `_make_workspace(handler)` becomes
// `makeWorkspace(handler)`; `_stub_me(ws, …)` installs a canned
// MeService through the facade's `meService` accessor (Python assigns
// `ws._me_service` directly).
//
// R5.4: message assertions in the Python file (`missing required field
// 'content'`) are kept as CODE + shape assertions plus the message
// regex, matching the Python intent without promoting the text to
// contract.

import { describe, expect, it, vi } from "vitest";

import { MeOrgInfo, MeProjectInfo, MeResponse } from "../../src/client/me.js";
import {
  BusinessContextValidationError,
  MixpanelHeadlessError,
  QueryError,
  WorkspaceScopeError,
} from "../../src/errors.js";
import type { MeService } from "../../src/services/me.js";
import {
  BUSINESS_CONTEXT_MAX_CHARS,
  BusinessContext,
  BusinessContextChain,
} from "../../src/types/entities/business-context.js";
import { Workspace } from "../../src/workspace.js";
import {
  type CannedResponse,
  type CapturedFetchRequest,
  createMockClient,
  type FakeTransport,
  makeSession,
} from "../../test-support/client-test-helpers.js";

/** The `_session()` helper (:54-61) — project 12345, us, oauth token. */
const SESSION = makeSession({
  projectId: "12345",
  region: "us",
  oauthToken: "test-token",
});

/**
 * Build a 200 App-API response wrapping `results` (`_ok`, :133).
 *
 * @param results - The `results` payload.
 * @returns The canned response.
 */
function ok(results: Record<string, unknown>): CannedResponse {
  return { status: 200, json: { status: "ok", results } };
}

/**
 * Build a Workspace whose client routes through `handler`
 * (`_make_workspace`, :63-74).
 *
 * @param handler - The canned-response handler.
 * @returns The facade plus the transport capture log.
 */
function makeWorkspace(
  handler: (request: CapturedFetchRequest) => CannedResponse,
): { ws: Workspace; transport: FakeTransport } {
  const { client, transport } = createMockClient(SESSION, handler);
  return { ws: new Workspace({ session: SESSION, client }), transport };
}

/**
 * Pre-populate the facade's MeService with a canned MeResponse
 * (`_stub_me`, :77-131).
 *
 * @param ws - The facade.
 * @param options - Which orgs/projects the canned `/me` carries.
 */
function stubMe(
  ws: Workspace,
  options: {
    projectOrg?: number | null;
    extraOrgs?: Record<string, number>;
    noActiveProject?: boolean;
  } = {},
): void {
  const projectOrg =
    options.projectOrg === undefined ? 100 : options.projectOrg;
  const orgs: Record<string, MeOrgInfo> = {};
  const projects: Record<string, MeProjectInfo> = {};
  if (projectOrg !== null && options.noActiveProject !== true) {
    orgs[String(projectOrg)] = new MeOrgInfo({
      id: projectOrg,
      name: `Org ${String(projectOrg)}`,
    });
    projects["12345"] = new MeProjectInfo({
      name: "Active",
      organization_id: projectOrg,
    });
  }
  for (const [key, oid] of Object.entries(options.extraOrgs ?? {})) {
    orgs[key] = new MeOrgInfo({ id: oid, name: `Org ${String(oid)}` });
  }
  const response = new MeResponse({ organizations: orgs, projects });
  const stub = {
    fetch: () => Promise.resolve(response),
    peek: () => Promise.resolve(response),
  } as unknown as MeService;
  vi.spyOn(ws, "meService", "get").mockReturnValue(stub);
  vi.spyOn(ws, "meServiceIfCreated", "get").mockReturnValue(stub);
}

/** The `${method} ${path}` capture spelling the Python `seen` list uses. */
function seenOf(transport: FakeTransport): string[] {
  return transport.captures.map(
    (capture) => `${capture.method} ${new URL(capture.url).pathname}`,
  );
}

describe("TestGetBusinessContextProject (:146)", () => {
  it("GET returns a BusinessContext with project_id and content", async () => {
    const { ws, transport } = makeWorkspace(() =>
      ok({ content: "# Project context\n\nHello." }),
    );

    const ctx = await ws.getBusinessContext({ level: "project" });

    expect(ctx).toBeInstanceOf(BusinessContext);
    expect(ctx.level).toBe("project");
    expect(ctx.project_id).toBe("12345");
    expect(ctx.organization_id).toBeNull();
    expect(ctx.content).toBe("# Project context\n\nHello.");
    expect(ctx.is_empty).toBe(false);
    expect(ctx.character_count).toBe("# Project context\n\nHello.".length);
    expect(seenOf(transport)).toEqual([
      "GET /api/app/projects/12345/business-context",
    ]);
  });

  it("calling without `level` defaults to project", async () => {
    const { ws } = makeWorkspace(() => ok({ content: "" }));

    const ctx = await ws.getBusinessContext();

    expect(ctx.level).toBe("project");
    expect(ctx.is_empty).toBe(true);
  });

  it("empty content yields is_empty", async () => {
    const { ws } = makeWorkspace(() => ok({ content: "" }));

    const ctx = await ws.getBusinessContext({ level: "project" });

    expect(ctx.content).toBe("");
    expect(ctx.is_empty).toBe(true);
    expect(ctx.character_count).toBe(0);
  });

  it("an invalid level rejects before any HTTP call", async () => {
    const { ws, transport } = makeWorkspace(() => {
      throw new Error("HTTP must not be called for invalid level");
    });

    await expect(
      ws.getBusinessContext({ level: "org" as "organization" }),
    ).rejects.toMatchObject({ code: "WS2_INVALID_LEVEL" });
    expect(transport.captures).toHaveLength(0);
  });

  it("a non-string `content` names the offending Python type", async () => {
    const { ws } = makeWorkspace(() => ok({ content: true }));

    await expect(ws.getBusinessContext({ level: "project" })).rejects.toThrow(
      /field 'content' is bool, expected str/,
    );
  });

  it("a response without `content` raises MixpanelHeadlessError", async () => {
    const { ws } = makeWorkspace(() => ok({ unexpected: "shape" }));

    await expect(ws.getBusinessContext({ level: "project" })).rejects.toThrow(
      /missing required field 'content'/,
    );
    await expect(
      ws.getBusinessContext({ level: "project" }),
    ).rejects.toBeInstanceOf(MixpanelHeadlessError);
  });
});

describe("TestSetBusinessContextProject (:230)", () => {
  it("SET issues PUT with a {content} body", async () => {
    const bodies: Array<[string, string, unknown]> = [];
    const { ws } = makeWorkspace((request) => {
      const body: unknown = JSON.parse(request.bodyText);
      bodies.push([request.method, new URL(request.url).pathname, body]);
      return ok({ content: (body as { content: string }).content });
    });

    const ctx = await ws.setBusinessContext("# New content", {
      level: "project",
    });

    expect(ctx.level).toBe("project");
    expect(ctx.project_id).toBe("12345");
    expect(ctx.content).toBe("# New content");
    expect(bodies).toEqual([
      [
        "PUT",
        "/api/app/projects/12345/business-context",
        { content: "# New content" },
      ],
    ]);
  });

  it("50_001 chars rejects client-side with no HTTP call", async () => {
    const { ws, transport } = makeWorkspace(() => ok({ content: "" }));

    try {
      await ws.setBusinessContext("x".repeat(BUSINESS_CONTEXT_MAX_CHARS + 1));
      expect.unreachable("oversize content must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessContextValidationError);
      const err = error as BusinessContextValidationError;
      expect(err.details).toHaveLength(BUSINESS_CONTEXT_MAX_CHARS + 1);
      expect(err.details["max"]).toBe(BUSINESS_CONTEXT_MAX_CHARS);
      expect(err.code).toBe("BUSINESS_CONTEXT_TOO_LONG");
    }
    expect(transport.captures).toHaveLength(0);
  });

  it("exactly 50,000 chars passes client-side validation", async () => {
    const { ws } = makeWorkspace((request) => {
      const body = JSON.parse(request.bodyText) as { content: string };
      return ok({ content: body.content });
    });

    const ctx = await ws.setBusinessContext(
      "x".repeat(BUSINESS_CONTEXT_MAX_CHARS),
      { level: "project" },
    );

    expect(ctx.character_count).toBe(BUSINESS_CONTEXT_MAX_CHARS);
  });

  it("a server 400 surfaces as QueryError", async () => {
    const { ws } = makeWorkspace(() => ({
      status: 400,
      json: {
        status: "error",
        error: "content exceeds maximum length of 50000 characters",
      },
    }));

    await expect(
      ws.setBusinessContext("# legal here", { level: "project" }),
    ).rejects.toBeInstanceOf(QueryError);
  });

  it("an invalid level on set rejects before any HTTP call", async () => {
    const { ws, transport } = makeWorkspace(() => {
      throw new Error("HTTP must not be called for invalid level");
    });

    await expect(
      ws.setBusinessContext("x", { level: "oops" as "organization" }),
    ).rejects.toMatchObject({ code: "WS2_INVALID_LEVEL" });
    expect(transport.captures).toHaveLength(0);
  });
});

describe("TestClearBusinessContextProject (:324)", () => {
  it("CLEAR issues PUT with an empty content body", async () => {
    const bodies: unknown[] = [];
    const { ws } = makeWorkspace((request) => {
      const body = JSON.parse(request.bodyText) as { content: string };
      bodies.push(body);
      return ok({ content: body.content });
    });

    const ctx = await ws.clearBusinessContext({ level: "project" });

    expect(ctx.level).toBe("project");
    expect(ctx.is_empty).toBe(true);
    expect(bodies).toEqual([{ content: "" }]);
  });
});

describe("TestGetBusinessContextOrganization (:350)", () => {
  it("an explicit organization_id skips the /me fetch", async () => {
    const { ws, transport } = makeWorkspace(() =>
      ok({ content: "# Org content" }),
    );
    const exploding = {
      fetch: () => {
        throw new Error("MeService.fetch should not be called");
      },
      peek: () => {
        throw new Error("MeService.peek should not be called");
      },
    } as unknown as MeService;
    vi.spyOn(ws, "meService", "get").mockReturnValue(exploding);

    const ctx = await ws.getBusinessContext({
      level: "organization",
      organization_id: 42,
    });

    expect(ctx.level).toBe("organization");
    expect(ctx.organization_id).toBe(42);
    expect(ctx.project_id).toBeNull();
    expect(ctx.content).toBe("# Org content");
    expect(seenOf(transport)).toEqual([
      "GET /api/app/organizations/42/business-context",
    ]);
  });

  it("without an explicit id, derives it from /me.projects[pid]", async () => {
    const { ws, transport } = makeWorkspace(() =>
      ok({ content: "# Auto-resolved" }),
    );
    stubMe(ws, { projectOrg: 100 });

    const ctx = await ws.getBusinessContext({ level: "organization" });

    expect(ctx.organization_id).toBe(100);
    expect(seenOf(transport)).toEqual([
      "GET /api/app/organizations/100/business-context",
    ]);
  });

  it("falls through to the sole org when the project is absent", async () => {
    const { ws, transport } = makeWorkspace(() => ok({ content: "" }));
    stubMe(ws, {
      projectOrg: null,
      extraOrgs: { "77": 77 },
      noActiveProject: true,
    });

    const ctx = await ws.getBusinessContext({ level: "organization" });

    expect(ctx.organization_id).toBe(77);
    expect(seenOf(transport)).toEqual([
      "GET /api/app/organizations/77/business-context",
    ]);
  });

  it("multiple orgs + absent project raises WorkspaceScopeError", async () => {
    const { ws, transport } = makeWorkspace(() => {
      throw new Error("HTTP call should not happen on resolution failure");
    });
    stubMe(ws, {
      projectOrg: null,
      extraOrgs: { "1": 1, "2": 2 },
      noActiveProject: true,
    });

    try {
      await ws.getBusinessContext({ level: "organization" });
      expect.unreachable("ambiguous org must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkspaceScopeError);
      const err = error as WorkspaceScopeError;
      expect(err.code).toBe("ORGANIZATION_AMBIGUOUS");
      expect(err.details["project_id"]).toBe("12345");
      expect(err.details["available_organizations"]).toEqual(["1", "2"]);
    }
    expect(transport.captures).toHaveLength(0);
  });
});

describe("TestSetBusinessContextOrganization (:446)", () => {
  it("org SET hits the /organizations/{id} path", async () => {
    const seen: Array<[string, string, unknown]> = [];
    const { ws } = makeWorkspace((request) => {
      const body = JSON.parse(request.bodyText) as { content: string };
      seen.push([request.method, new URL(request.url).pathname, body]);
      return ok({ content: body.content });
    });

    const ctx = await ws.setBusinessContext("# Org-wide", {
      level: "organization",
      organization_id: 100,
    });

    expect(ctx.level).toBe("organization");
    expect(ctx.organization_id).toBe(100);
    expect(ctx.content).toBe("# Org-wide");
    expect(seen).toEqual([
      [
        "PUT",
        "/api/app/organizations/100/business-context",
        { content: "# Org-wide" },
      ],
    ]);
  });
});

describe("TestGetBusinessContextChain (:483)", () => {
  it("the chain returns both scopes from one round-trip", async () => {
    const { ws, transport } = makeWorkspace(() =>
      ok({ org_context: "# Org info", project_context: "# Project info" }),
    );
    stubMe(ws, { projectOrg: 100 });

    const chain = await ws.getBusinessContextChain();

    expect(chain).toBeInstanceOf(BusinessContextChain);
    expect(chain.organization.level).toBe("organization");
    expect(chain.organization.organization_id).toBe(100);
    expect(chain.organization.content).toBe("# Org info");
    expect(chain.project.level).toBe("project");
    expect(chain.project.project_id).toBe("12345");
    expect(chain.project.content).toBe("# Project info");
    expect(seenOf(transport)).toEqual([
      "GET /api/app/projects/12345/business-context/chain",
    ]);
  });

  it("empty strings yield is_empty contexts on both scopes", async () => {
    const { ws } = makeWorkspace(() =>
      ok({ org_context: "", project_context: "" }),
    );
    stubMe(ws, { projectOrg: 100 });

    const chain = await ws.getBusinessContextChain();

    expect(chain.organization.is_empty).toBe(true);
    expect(chain.project.is_empty).toBe(true);
  });

  it("a cold /me cache leaves organization_id null and issues no /me call", async () => {
    const { ws, transport } = makeWorkspace((request) => {
      if (new URL(request.url).pathname.endsWith("/me")) {
        throw new Error("Chain endpoint must not trigger /me fetch");
      }
      return ok({ org_context: "# Org", project_context: "# Project" });
    });
    // Do NOT stub the MeService — the facade's own service was never
    // constructed, so `_cached_organization_id` returns None
    // (`workspace.py:10355-10357`).

    const chain = await ws.getBusinessContextChain();

    expect(chain.organization.organization_id).toBeNull();
    expect(chain.organization.content).toBe("# Org");
    expect(chain.project.content).toBe("# Project");
    expect(seenOf(transport)).toEqual([
      "GET /api/app/projects/12345/business-context/chain",
    ]);
  });

  it("a response without org_context raises MixpanelHeadlessError", async () => {
    const { ws } = makeWorkspace(() => ok({ project_context: "# Project" }));

    const call = ws.getBusinessContextChain();
    // B6-ARB (assertions Finding C): Python asserts BOTH the class and
    // the message (`pytest.raises(MixpanelHeadlessError)` + str-contains,
    // test_workspace_business_context.py TestGetBusinessContextChain).
    await expect(call).rejects.toBeInstanceOf(MixpanelHeadlessError);
    await expect(call).rejects.toThrow(/missing required field 'org_context'/);
  });

  it("a response without project_context raises MixpanelHeadlessError", async () => {
    const { ws } = makeWorkspace(() => ok({ org_context: "# Org" }));

    const call = ws.getBusinessContextChain();
    await expect(call).rejects.toBeInstanceOf(MixpanelHeadlessError);
    await expect(call).rejects.toThrow(
      /missing required field 'project_context'/,
    );
  });
});
