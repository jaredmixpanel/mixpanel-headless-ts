/**
 * Optionally workspace-scoped App API path builder: pure string
 * concatenation over the client's `{projectId, workspaceId}` state. The
 * network-backed siblings (`requireScopedPath`, `resolveWorkspaceId`) live
 * in `client.ts` and call this.
 *
 * @see mixpanel_headless._internal.api_client.MixpanelAPIClient.maybe_scoped_path
 */

/** The scope state the client threads into path building. */
export interface PathScope {
  /** Bound project id (`session.project.id` — Mixpanel digit string). */
  readonly projectId: string;
  /**
   * Explicit workspace id (`set_workspace_id` state), or `null` when
   * unset. The Python guard is `is not None`, so id `0` is a valid
   * workspace scope — never a truthiness check.
   */
  readonly workspaceId: number | null;
}

/**
 * Build an optionally workspace-scoped API path.
 *
 * If a workspace ID is set, returns a workspace-scoped path; otherwise a
 * project-scoped path.
 *
 * @param domainPath - Domain-relative path (e.g. `"dashboards"`).
 * @param scope - The client's `{projectId, workspaceId}` state.
 * @returns `/workspaces/{wid}/{domainPath}` when a workspace is set,
 *   otherwise `/projects/{pid}/{domainPath}`.
 * @example
 * ```typescript
 * maybeScopedPath("dashboards", { projectId: "12345", workspaceId: null });
 * // "/projects/12345/dashboards"
 * maybeScopedPath("dashboards", { projectId: "12345", workspaceId: 789 });
 * // "/workspaces/789/dashboards"
 * ```
 */
export function maybeScopedPath(domainPath: string, scope: PathScope): string {
  if (scope.workspaceId !== null) {
    return `/workspaces/${scope.workspaceId}/${domainPath}`;
  }
  return `/projects/${scope.projectId}/${domainPath}`;
}
