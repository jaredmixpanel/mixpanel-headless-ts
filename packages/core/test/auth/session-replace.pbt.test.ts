// Layer-3 translation of `tests/pbt/test_session_pbt.py` (202 lines) —
// B7-A2 packet §2.4 (`b7-packets.md`): the `replace` properties
// (:97-155), the TypeAdapter-roundtrip property (:157), and the
// `auth_header` format property (:168+).
//
// Strategy shapes preserved: name alphabet `[a-zA-Z0-9_-]{1,64}`,
// regions us/eu/in, project `^[1-9][0-9]{0,9}$`, workspace 1..2^31−1,
// non-empty text 1..64. Mechanism substitutions (header-cited, R10.2):
// - `Session.replace(**kwargs)` → `sessionReplace` (key-presence
//   sentinel, `auth/session.ts`);
// - `model_copy` identity assert (`s2 is not s`) → reference inequality
//   + deep equality;
// - `model_dump` → `TypeAdapter.validate_python` roundtrip → feeding
//   the Session's own parts (plain records + `Secret` instances, the
//   exact values `model_dump` round-trips) back through `parseSession`,
//   which re-validates like the TypeAdapter. The example-based parse
//   coverage in `session.test.ts` is NOT this property (packet §2.4:
//   "translate unless literally duplicate — header-cite either way").
// - `st.text()` for username/secret/token draws full Unicode; the fc
//   twin uses `fc.fullUnicodeString`-equivalent (`fc.string` with
//   unicode units in fast-check 4).
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  type Account,
  parseAccount,
  type TokenResolver,
} from "../../src/auth/account.js";
import {
  parseSession,
  type Project,
  type Session,
  sessionAuthHeader,
  sessionReplace,
  type WorkspaceRef,
} from "../../src/auth/session.js";
import { Secret } from "../../src/secret.js";

/** Characters of the Python `_NAME_ALPHABET`. */
const NAME_ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";

/** `account_names` — 1..64 chars from the allowed set. */
const accountNames = fc
  .array(fc.integer({ min: 0, max: NAME_ALPHABET.length - 1 }), {
    minLength: 1,
    maxLength: 64,
  })
  .map((indexes) => indexes.map((i) => NAME_ALPHABET[i] ?? "a").join(""));

/** `regions` — the three literals. */
const regions = fc.constantFrom("us", "eu", "in");

/** `project_ids = st.from_regex(r"^[1-9][0-9]{0,9}$")`. */
const projectIds = fc
  .tuple(
    fc.integer({ min: 1, max: 9 }),
    fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 0, maxLength: 9 }),
  )
  .map(([head, tail]) => `${String(head)}${tail.join("")}`);

/** `workspace_ids = st.integers(1, 2**31 - 1)`. */
const workspaceIds = fc.integer({ min: 1, max: 2 ** 31 - 1 });

/** `non_empty_text = st.text(min_size=1, max_size=64)` (Unicode). */
const nonEmptyText = fc.string({ minLength: 1, maxLength: 64, unit: "binary" });

/** `service_accounts()` composite twin. */
const serviceAccounts: fc.Arbitrary<Account> = fc
  .record({
    name: accountNames,
    region: regions,
    username: nonEmptyText,
    secret: nonEmptyText,
  })
  .map((fields) =>
    parseAccount({
      type: "service_account",
      name: fields.name,
      region: fields.region,
      username: fields.username,
      secret: new Secret(fields.secret),
    }),
  );

/** `oauth_browser_accounts()` composite twin. */
const oauthBrowserAccounts: fc.Arbitrary<Account> = fc
  .record({ name: accountNames, region: regions })
  .map((fields) =>
    parseAccount({
      type: "oauth_browser",
      name: fields.name,
      region: fields.region,
    }),
  );

/** `oauth_token_accounts()` composite twin (inline token only). */
const oauthTokenAccounts: fc.Arbitrary<Account> = fc
  .record({ name: accountNames, region: regions, token: nonEmptyText })
  .map((fields) =>
    parseAccount({
      type: "oauth_token",
      name: fields.name,
      region: fields.region,
      token: new Secret(fields.token),
    }),
  );

/** `accounts` — one of the three variants. */
const accounts: fc.Arbitrary<Account> = fc.oneof(
  serviceAccounts,
  oauthBrowserAccounts,
  oauthTokenAccounts,
);

/** `projects()` composite twin. */
const projects: fc.Arbitrary<Project> = projectIds.map((id) => ({ id }));

/** `workspaces_or_none()` composite twin. */
const workspacesOrNone: fc.Arbitrary<WorkspaceRef | null> = fc.oneof(
  fc.constant(null),
  workspaceIds.map((id) => ({ id })),
);

/** `sessions()` composite twin. */
const sessions: fc.Arbitrary<Session> = fc
  .record({ account: accounts, project: projects, workspace: workspacesOrNone })
  .map((fields) => ({
    account: fields.account,
    project: fields.project,
    workspace: fields.workspace,
    headers: new Map<string, string>(),
  }));

describe("Session.replace PBT", () => {
  it("replace account preserves other axes", () => {
    // python: test_replace_account_preserves_other_axes
    fc.assert(
      fc.property(sessions, accounts, (s, newAccount) => {
        const s2 = sessionReplace(s, { account: newAccount });
        expect(s2.account).toStrictEqual(newAccount);
        expect(s2.project).toStrictEqual(s.project);
        expect(s2.workspace).toStrictEqual(s.workspace);
      }),
    );
  });

  it("replace project preserves other axes", () => {
    // python: test_replace_project_preserves_other_axes
    fc.assert(
      fc.property(sessions, projects, (s, newProject) => {
        const s2 = sessionReplace(s, { project: newProject });
        expect(s2.project).toStrictEqual(newProject);
        expect(s2.account).toStrictEqual(s.account);
        expect(s2.workspace).toStrictEqual(s.workspace);
      }),
    );
  });

  it("replace workspace preserves other axes", () => {
    // python: test_replace_workspace_preserves_other_axes
    fc.assert(
      fc.property(sessions, workspaceIds, (s, wsId) => {
        const newWorkspace: WorkspaceRef = { id: wsId };
        const s2 = sessionReplace(s, { workspace: newWorkspace });
        expect(s2.workspace).toStrictEqual(newWorkspace);
        expect(s2.account).toStrictEqual(s.account);
        expect(s2.project).toStrictEqual(s.project);
      }),
    );
  });

  it("replace workspace to null clears", () => {
    // python: test_replace_workspace_to_none_clears
    fc.assert(
      fc.property(sessions, (s) => {
        const s2 = sessionReplace(s, { workspace: null });
        expect(s2.workspace).toBeNull();
      }),
    );
  });

  it("replace omitting workspace preserves", () => {
    // python: test_replace_omitting_workspace_preserves
    fc.assert(
      fc.property(sessions, (s) => {
        const s2 = sessionReplace(s, {});
        expect(s2.workspace).toStrictEqual(s.workspace);
      }),
    );
  });

  it("replace returns new object", () => {
    // python: test_replace_returns_new_object
    fc.assert(
      fc.property(sessions, (s) => {
        const s2 = sessionReplace(s, {});
        expect(s2).not.toBe(s);
        expect(s2).toStrictEqual(s);
      }),
    );
  });

  it("replace omitting axes preserves all", () => {
    // python: test_replace_omitting_axes_preserves_all
    fc.assert(
      fc.property(sessions, (s) => {
        const s2 = sessionReplace(s, {});
        expect(s2.account).toStrictEqual(s.account);
        expect(s2.project).toStrictEqual(s.project);
        expect(s2.workspace).toStrictEqual(s.workspace);
        expect(s2.headers).toStrictEqual(s.headers);
      }),
    );
  });

  it("session typeadapter roundtrip preserves equality", () => {
    // python: test_session_typeadapter_roundtrip_preserves_equality
    fc.assert(
      fc.property(sessions, (s) => {
        // model_dump → validate_python twin: re-parse the session's own
        // parts (parseSession re-validates every nested payload).
        const rebuilt = parseSession({
          account: s.account,
          project: s.project,
          workspace: s.workspace,
          headers: s.headers,
        });
        expect(rebuilt.account).toStrictEqual(s.account);
        expect(rebuilt.project).toStrictEqual(s.project);
        expect(rebuilt.workspace).toStrictEqual(s.workspace);
      }),
    );
  });

  it("session auth header format", async () => {
    // python: test_session_auth_header_format
    // A fake TokenResolver is supplied so the OAuth variants don't
    // need real on-disk tokens.
    const fakeResolver: TokenResolver = {
      getBrowserToken: () => Promise.resolve("fake-browser-token"),
      getStaticToken: () => Promise.resolve("fake-static-token"),
    };
    await fc.assert(
      fc.asyncProperty(sessions, async (s) => {
        const header = await sessionAuthHeader(s, {
          tokenResolver: fakeResolver,
        });
        const expectedScheme =
          s.account.type === "service_account" ? "Basic " : "Bearer ";
        expect(header.startsWith(expectedScheme)).toBe(true);
        // Whichever prefix, the value after the space is non-empty.
        const spaceIndex = header.indexOf(" ");
        const prefix = header.slice(0, spaceIndex);
        const value = header.slice(spaceIndex + 1);
        expect(["Basic", "Bearer"]).toContain(prefix);
        expect(value.length).toBeGreaterThan(0);
      }),
    );
  });
});
