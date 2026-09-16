// The playground's state machine as one discriminated union. Offline and
// live share the query panel; only the `ws` differs (the browser factories
// return the core `Workspace` facade, not a wrapper). The transition
// functions and the token hand-off (`finishLogin`, `signOut`) are pure and
// unit-tested under Node (tests/demo-session.test.ts); stores are passed
// in, so nothing here touches `sessionStorage` or the DOM.

import {
  CREDENTIAL_KEYS,
  type CredentialStore,
  parseOAuthTokens,
  type Workspace,
} from "@mixpanel-headless/browser";

/** Mixpanel data-residency region (part of the login URL). */
export type Region = "us" | "eu" | "in";

/** Every region, in picker order. */
export const REGIONS: readonly Region[] = ["us", "eu", "in"];

/**
 * The `sessionStorage` key holding the region picked before the redirect.
 * Not a secret: the pending record is keyed per region and the callback
 * page must know which key to complete.
 */
export const REGION_STORAGE_KEY = "mp-demo.region";

/**
 * The `sessionStorage` flag marking that this tab held a live session.
 * Not a secret and never a credential — it only lets a fresh document on
 * `/demo` explain that the in-memory tokens died with the reload instead
 * of silently showing the demo project. Set when tokens land in memory,
 * cleared on sign out.
 */
export const LIVE_FLAG_STORAGE_KEY = "mp-demo.live";

/**
 * Narrow a stored string to a region.
 *
 * @param value - Whatever storage returned.
 * @returns The region, or `null` for anything else.
 */
export function asRegion(value: unknown): Region | null {
  return typeof value === "string" &&
    (REGIONS as readonly string[]).includes(value)
    ? (value as Region)
    : null;
}

/** `ws.me()`'s result type, via the facade (not on the browser barrel). */
export type Me = Awaited<ReturnType<Workspace["me"]>>;

/** A project the picker offers. */
export interface PickedProject {
  readonly id: string;
  readonly name: string;
  readonly organization: string;
}

/** A workspace the picker offers. */
export interface PickedWorkspace {
  readonly id: number;
  readonly name: string;
  readonly isDefault: boolean;
}

/** A project with the workspaces `/me` lists for it. */
export interface PickerProject extends PickedProject {
  readonly workspaces: readonly PickedWorkspace[];
}

/** One organisation's projects, in picker order. */
export interface PickerGroup {
  readonly organization: string;
  readonly projects: readonly PickerProject[];
}

/** Where an error sends the user next. */
export type ErrorRetry = "signed-out" | "offline";

/** A library error mapped to copy (programs key on `.code`, never on text). */
export interface DemoError {
  /** The error's `.code`, or `null` for non-library failures. */
  readonly code: string | null;
  /** The error class name (shown in the inline error line). */
  readonly className: string;
  /** Short, user-facing explanation. */
  readonly message: string;
  /** HTTP status when the library reports one. */
  readonly statusCode: number | null;
  /** The library's redacted `details`, shown only behind a disclosure. */
  readonly details: unknown;
  /** Whether the error ends the session (→ `error` state) or stays inline. */
  readonly fatal: boolean;
  /** The state a fatal error retries from (`null` when inline). */
  readonly retry: ErrorRetry | null;
}

/** The page's state. */
export type DemoState =
  | { readonly mode: "offline"; readonly ws: Workspace }
  | {
      readonly mode: "signed-out";
      readonly region: Region;
      readonly notice: string | null;
    }
  | {
      readonly mode: "login-pending";
      readonly region: Region;
      readonly authorizeUrl: string | null;
    }
  | { readonly mode: "callback" }
  | {
      readonly mode: "project-picker";
      readonly region: Region;
      readonly ws: Workspace;
      readonly me: Me;
      /** ISO timestamp of token expiry (`OAuthTokens.expires_at`). */
      readonly expiresAt: string;
    }
  | {
      readonly mode: "ready";
      readonly region: Region;
      readonly ws: Workspace;
      readonly project: PickedProject;
      readonly workspace: PickedWorkspace | null;
      readonly user: string | null;
      /** ISO timestamp of token expiry (`OAuthTokens.expires_at`). */
      readonly expiresAt: string;
    }
  | {
      readonly mode: "error";
      readonly region: Region | null;
      readonly error: DemoError;
      readonly retry: ErrorRetry;
    };

/**
 * Move the tokens `completeLogin` wrote into the in-memory store and wipe
 * the hop store: tokens, the DCR client registration and the (already
 * consumed) pending record all leave `sessionStorage`, whether or not the
 * move succeeds.
 *
 * @param hop - The storage-backed store that survived the redirect.
 * @param memory - The store the live `Workspace` reads.
 * @param region - The region the login ran for.
 * @returns The token expiry (`OAuthTokens.expires_at`).
 * @throws Error - When the hop store holds no tokens (the exchange did not
 *   complete); the hop store is wiped regardless.
 */
export async function finishLogin(
  hop: CredentialStore,
  memory: CredentialStore,
  region: Region,
): Promise<{ expiresAt: string }> {
  const key = CREDENTIAL_KEYS.tokens(region);
  try {
    const raw = await hop.get(key);
    if (raw === null) {
      throw new Error(`playground: no tokens for region ${region} to move`);
    }
    await memory.set(key, raw);
    return { expiresAt: parseOAuthTokens(JSON.parse(raw)).expires_at };
  } finally {
    for (const hopKey of CREDENTIAL_KEYS.all(region)) {
      await hop.delete(hopKey);
    }
  }
}

/**
 * Delete every credential key of every region from both stores. The
 * region argument is the one the session ran in; the other regions are
 * wiped too, so a region switched mid-way leaves nothing behind. There is
 * no server-side revocation in the library — the token stays valid until
 * `expires_at`.
 *
 * @param memory - The in-memory store.
 * @param hop - The storage-backed hop store.
 * @param region - The session's region (wiped first).
 */
export async function signOut(
  memory: CredentialStore,
  hop: CredentialStore,
  region: Region,
): Promise<void> {
  const ordered = [region, ...REGIONS.filter((r) => r !== region)];
  for (const store of [memory, hop]) {
    for (const r of ordered) {
      for (const key of CREDENTIAL_KEYS.all(r)) {
        await store.delete(key);
      }
    }
  }
}

/**
 * UTF-16 code-unit order, so ties sort like the login picker's
 * `sorted(...)` rather than by locale.
 *
 * @param a - Left string.
 * @param b - Right string.
 * @returns Negative, zero or positive.
 */
function compareText(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/**
 * The projects `/me` lists, grouped by organisation and sorted by
 * (organisation name, project name), both lower-cased — the order the
 * Node package's login picker uses. Each project carries its workspaces,
 * default first, then by name.
 *
 * @param me - The `/me` response.
 * @returns Groups in display order.
 */
export function groupProjects(me: Me): readonly PickerGroup[] {
  const projects: PickerProject[] = [...me.projects].map(([id, info]) => {
    const org = me.organizations.get(String(info.organization_id));
    const workspaces = [...me.workspaces.values()]
      .filter((w) => String(w.project_id) === id)
      .map((w) => ({
        id: w.id,
        name: w.name,
        isDefault: w.is_default === true,
      }))
      .sort(
        (a, b) =>
          Number(b.isDefault) - Number(a.isDefault) ||
          compareText(a.name.toLowerCase(), b.name.toLowerCase()),
      );
    return {
      id,
      name: info.name,
      organization:
        org === undefined
          ? `Organization ${String(info.organization_id)}`
          : org.name,
      workspaces,
    };
  });
  projects.sort(
    (a, b) =>
      compareText(a.organization.toLowerCase(), b.organization.toLowerCase()) ||
      compareText(a.name.toLowerCase(), b.name.toLowerCase()),
  );
  const groups: Array<{ organization: string; projects: PickerProject[] }> = [];
  for (const project of projects) {
    const last = groups.at(-1);
    if (last !== undefined && last.organization === project.organization) {
      last.projects.push(project);
    } else {
      groups.push({ organization: project.organization, projects: [project] });
    }
  }
  return groups;
}

/**
 * The workspace to preselect for a project: the default one, else the
 * first, else none (a project without workspaces is queried unpinned).
 *
 * @param workspaces - The project's workspaces, in picker order.
 * @returns The preselected workspace or `null`.
 */
export function defaultWorkspace(
  workspaces: readonly PickedWorkspace[],
): PickedWorkspace | null {
  return workspaces.find((w) => w.isDefault) ?? workspaces[0] ?? null;
}
