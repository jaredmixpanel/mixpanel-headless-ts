/**
 * Activity labels for the rrweb action stream — TS port of
 * `mixpanel_headless/replay_labels.py` (145 lines, whole file) for
 * Phase-3 batch B5, shard S3 (`docs/history/phase3/design/b5-packets.md`
 * §5). Closes three of the phase2-audit A1 public-export deferrals
 * ({@link urlNormalizer}, {@link defaultLabelFn},
 * {@link selectorLabelFn}).
 *
 * A label is the grouping key for the path / click / transition
 * aggregations on `ReplayBundle`. Stable labels are the precondition
 * for any cross-session analysis: two `click on button "Sign in"`
 * events from different replays must produce the same label string, or
 * the downstream aggregations fragment.
 *
 * Port notes:
 *
 * - The `_NUMERIC_OR_HEX` pattern is anchored and ports verbatim.
 *   Python's `re.match` anchors at the START only; the pattern already
 *   carries a trailing `$`, so the JS `RegExp` is byte-identical and
 *   `.test()` is the `match(...) is not None` twin.
 * - `str.split(sep, 1)` (maxsplit) has no direct JS twin —
 *   `indexOf`-based splitting reproduces it exactly (R11.x: JS
 *   `String.split` with a limit DROPS the tail rather than keeping it).
 * - Python truthiness on the `url` guards (`if not url`, `if candidate`)
 *   ports through the explicit empty-string checks Python performs on
 *   these `str | None` domains.
 */

import { pythonStr, type PythonValue } from "../compat/python-str.js";
import { pyTruthy } from "../types/results/result-base.js";
import type { UserAction } from "./user-action.js";

/**
 * Numeric path segments — IDs, version numbers, year/month/day pieces —
 * are replaced with `:id` so URLs collapse across users / instances.
 * Hex IDs (UUIDs, short SHAs) also count as IDs; pure-text segments
 * survive. Verbatim twin of Python's `_NUMERIC_OR_HEX`
 * (`replay_labels.py:36`).
 */
const NUMERIC_OR_HEX = /^(?:[0-9]+|[0-9a-f]{8,}|[0-9a-fA-F-]{8,})$/;

/**
 * Normalize a URL into a path template suitable for label aggregation
 * (`url_normalizer`, `replay_labels.py:39-84`).
 *
 * Strips the query string and replaces numeric / hex path segments with
 * `:id`. The host portion is preserved when present (otherwise the
 * function treats the input as a bare path).
 *
 * @param url - A URL, absolute or relative.
 * @returns The normalized path template — e.g.
 *   `/users/12345/profile?ref=x` → `/users/:id/profile`.
 * @example
 * ```ts
 * urlNormalizer("/users/12345/profile?ref=x");
 * // '/users/:id/profile'
 * urlNormalizer("https://app.example.com/orders/abc12345-de00");
 * // 'https://app.example.com/orders/:id'
 * ```
 */
export function urlNormalizer(url: string): string {
  if (url === "") {
    return url;
  }
  // Split host from path. Naive splitter — anything before the first
  // single slash after a possible scheme is the host.
  let hostPrefix = "";
  let rest = url;
  const schemeAt = url.indexOf("://");
  if (schemeAt !== -1) {
    const scheme = url.slice(0, schemeAt);
    const after = url.slice(schemeAt + 3);
    const slashAt = after.indexOf("/");
    if (slashAt === -1) {
      return `${scheme}://${after}`;
    }
    const host = after.slice(0, slashAt);
    const path = after.slice(slashAt + 1);
    hostPrefix = `${scheme}://${host}`;
    rest = `/${path}`;
  }
  // Drop the query string.
  const queryAt = rest.indexOf("?");
  if (queryAt !== -1) {
    rest = rest.slice(0, queryAt);
  }
  // Walk path segments and replace numeric / hex ones.
  const normalized = rest
    .split("/")
    .map((part) => (part !== "" && NUMERIC_OR_HEX.test(part) ? ":id" : part));
  return hostPrefix + normalized.join("/");
}

/**
 * Canonical activity label: `"{action}:{tag}@{normalized_url}"`
 * (`default_label_fn`, `replay_labels.py:86-112`).
 *
 * `tag` comes from `action.target_desc` (the analyzer's best
 * description of the element — e.g. `'button "Sign in"'`). The URL is
 * normalized through {@link urlNormalizer} so analogous actions on
 * parameterized pages aggregate cleanly.
 *
 * @param action - A `UserAction` from a replay's analyzer output.
 * @returns The activity label string.
 * @example
 * ```ts
 * defaultLabelFn(action);
 * // 'click:button "Sign in"@/users/:id/profile'
 * ```
 */
export function defaultLabelFn(action: UserAction): string {
  // Python `action.target_desc or "(unknown)"` — the only falsy value
  // the `str` field can hold is the empty string.
  const tag = action.target_desc === "" ? "(unknown)" : action.target_desc;
  const url =
    action.url !== null && action.url !== ""
      ? urlNormalizer(action.url)
      : "(no-url)";
  return `${action.action}:${tag}@${url}`;
}

/**
 * Build a label-fn that prefers a stable selector attribute when
 * present (`selector_label_fn`, `replay_labels.py:114-145`).
 *
 * For instrumented apps, `data-testid` (or your project's equivalent)
 * is the most stable activity identifier — it survives DOM refactors,
 * locale changes, and CSS tweaks. The returned label-fn looks for the
 * requested attribute in `action.metadata` and uses it as the label
 * body when present; otherwise it falls back to {@link defaultLabelFn}.
 *
 * @param attr - The metadata key to consult. Default `"data-testid"`.
 * @returns A `(UserAction) => string` suitable as a `labelFn` override
 *   for `ReplayBundle.findPattern`.
 * @example
 * ```ts
 * const labelFn = selectorLabelFn("data-testid");
 * bundle.findPattern(["click:button@/"], { labelFn });
 * ```
 */
export function selectorLabelFn(
  attr = "data-testid",
): (action: UserAction) => string {
  /**
   * Use the configured selector attribute when present; fall back
   * otherwise.
   *
   * @param action - The action to label.
   * @returns The label string.
   */
  return function label(action: UserAction): string {
    // Python `action.metadata.get(attr) if action.metadata else None`
    // — an empty dict is falsy, so an empty metadata map short-circuits.
    const metadata = action.metadata;
    const candidate =
      Object.keys(metadata).length > 0 ? metadata[attr] : undefined;
    // Python `if candidate:` — falsy metadata values (None, "", 0,
    // False, empty containers) fall through to the default label.
    if (pyTruthy(candidate)) {
      const url =
        action.url !== null && action.url !== ""
          ? urlNormalizer(action.url)
          : "(no-url)";
      // The f-string interpolation is CPython `str(candidate)`, and
      // `metadata` is `dict[str, Any]` — a non-str value renders with
      // PYTHON spelling (`True`, not `true`; `None`, not `null`; a list
      // as `[1, 2]`). `String()` would silently fork the label
      // (found by the R10.9 differential harness, 23/520 cases).
      return `${action.action}:${pythonStr(candidate as PythonValue)}@${url}`;
    }
    return defaultLabelFn(action);
  };
}
