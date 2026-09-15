// The playground's state machine as one discriminated union. Offline and
// live share the query panel; only the `ws` differs (the browser factories
// return the core `Workspace` facade, not a wrapper). The transition
// functions and the token hand-off (`finishLogin`, `signOut`) are pure and
// unit-tested under Node (tests/demo-session.test.ts).

import type { Workspace } from "@mixpanel-headless/browser";

/** Mixpanel data-residency region (part of the login URL). */
export type Region = "us" | "eu" | "in";

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
