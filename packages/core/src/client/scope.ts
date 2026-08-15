/**
 * Optionally workspace-scoped App API path builder — TS port of
 * `MixpanelAPIClient.maybe_scoped_path`
 * (`mixpanel_headless/_internal/api_client.py:1637-1664`) — Phase-3
 * packet B0-2, R10.8.
 *
 * `require_scoped_path` and `resolve_workspace_id` are NOT here (they do
 * network discovery) — they port in B4 shard C1 and import this module
 * by name.
 *
 * R2.13: template concatenation only.
 */

/** The scope state the B4 client threads into path building. */
export interface PathScope {
  /** Bound project id (`session.project.id` — Mixpanel digit string). */
  readonly projectId: string;
  /**
   * Explicit workspace id (`set_workspace_id` state), or `null` when
   * unset. The Python guard is `is not None` — id `0` is a VALID
   * workspace scope (watchlist §8 item 6: never a truthiness check).
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
 *
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
