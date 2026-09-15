/**
 * `urllib.parse` parity slice — TS twins of CPython's `urlsplit`,
 * `urlunsplit`, `urljoin`, and `SplitResult.hostname` for the
 * 045-report-links port (Python PR #223).
 *
 * The WHATWG `URL` class is NOT a substitute here: it percent-encodes,
 * lowercases and re-serializes as it parses, drops default ports and
 * resolves dot segments differently, whereas `report_links.py` and
 * `api_client.resolve_short_link` observe the RAW CPython split (host
 * lowercased, everything else verbatim) and echo joined targets back to
 * the caller. Every rule below is copied from CPython 3.12
 * `Lib/urllib/parse.py`; deviations are called out at the code site.
 *
 * Pure per R9.1 — no Node built-ins, no `process`.
 */

/**
 * Characters `urlsplit` strips from the LEFT of the url
 * (`_WHATWG_C0_CONTROL_OR_SPACE`: every C0 control U+0000-U+001F plus
 * the space).
 */
const WHATWG_C0_CONTROL_OR_SPACE = Array.from({ length: 0x21 }, (_, i) =>
  String.fromCharCode(i),
).join("");

/** `_UNSAFE_URL_BYTES_TO_REMOVE` — removed EVERYWHERE before parsing. */
const UNSAFE_URL_CHARS = ["\t", "\r", "\n"] as const;

/** `scheme_chars` — the characters a scheme may contain. */
const SCHEME_CHARS =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+-.";

/** Python `uses_relative` ∩ `uses_netloc` members the port can meet. */
const USES_RELATIVE = new Set([
  "",
  "ftp",
  "http",
  "gopher",
  "nntp",
  "imap",
  "wais",
  "file",
  "https",
  "shttp",
  "mms",
  "prospero",
  "rtsp",
  "rtsps",
  "rtspu",
  "sftp",
  "svn",
  "svn+ssh",
  "ws",
  "wss",
]);

/** Python `uses_netloc`. */
const USES_NETLOC = new Set([
  "",
  "ftp",
  "http",
  "gopher",
  "nntp",
  "telnet",
  "imap",
  "wais",
  "file",
  "mms",
  "https",
  "shttp",
  "snews",
  "prospero",
  "rtsp",
  "rtsps",
  "rtspu",
  "rsync",
  "svn",
  "svn+ssh",
  "sftp",
  "nfs",
  "git",
  "git+ssh",
  "ws",
  "wss",
  "itms-services",
]);

/**
 * The `ValueError` CPython's `urlsplit` raises for a malformed netloc
 * (an unbalanced IPv6 bracket, an invalid bracketed host, or a netloc
 * whose NFKC normalization introduces a delimiter).
 */
export class UrlSplitError extends Error {
  /**
   * Create the error.
   *
   * @param message - CPython's message text (out of contract).
   */
  constructor(message: string) {
    super(message);
    this.name = "UrlSplitError";
  }
}

/** The 5-tuple `urlsplit` returns (`SplitResult`). */
export interface SplitResult {
  /** Lower-cased scheme, or `""`. */
  readonly scheme: string;
  /** Raw network location (userinfo, host, port), or `""`. */
  readonly netloc: string;
  /** Raw path. */
  readonly path: string;
  /** Raw query (after the first `?` that precedes the fragment), or `""`. */
  readonly query: string;
  /** Raw fragment (after the first `#`), or `""`. */
  readonly fragment: string;
  /**
   * `SplitResult.hostname` — the lower-cased host without userinfo,
   * port, or IPv6 brackets; `null` when the netloc carries no host.
   */
  readonly hostname: string | null;
}

/**
 * Whether a string is ASCII-only (`str.isascii`).
 *
 * @param text - The text.
 * @returns `true` when every code unit is below 0x80.
 */
function isAscii(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) > 0x7f) {
      return false;
    }
  }
  return true;
}

/**
 * `_splitnetloc(url, start)` — the netloc runs to the earliest of
 * `/`, `?`, `#` at or after `start`.
 *
 * @param url - The url beginning with `//`.
 * @param start - Index after the `//`.
 * @returns `[netloc, rest]`.
 */
function splitNetloc(url: string, start: number): [string, string] {
  let delim = url.length;
  for (const c of "/?#") {
    const found = url.indexOf(c, start);
    if (found !== -1) {
      delim = Math.min(delim, found);
    }
  }
  return [url.slice(start, delim), url.slice(delim)];
}

/**
 * `_check_bracketed_host` — the bracketed host must be an IPv6 literal
 * (or an IPvFuture `v...` literal). Only the acceptance decision is
 * ported (CPython delegates to `ipaddress.ip_address`).
 *
 * @param hostname - The text between `[` and `]`.
 * @throws UrlSplitError - Not a valid IPv6 / IPvFuture host.
 */
function checkBracketedHost(hostname: string): void {
  if (/^v[0-9a-fA-F]+\..+$/u.test(hostname)) {
    // IPvFuture (`v` + hex + `.` + tail): CPython's
    // `_check_bracketed_host` skips the `ipaddress` check for these.
    return;
  }
  const zoneless = hostname.split("%", 1)[0] as string;
  if (!isIpv6Literal(zoneless)) {
    throw new UrlSplitError(
      `'${hostname}' does not appear to be an IPv6 address`,
    );
  }
}

/**
 * Minimal IPv6 literal validator (RFC 4291 text forms, incl. one `::`
 * and an optional trailing dotted IPv4 quad).
 *
 * @param text - Candidate address text.
 * @returns Whether it is a valid IPv6 address.
 */
function isIpv6Literal(text: string): boolean {
  if (text === "" || !/^[0-9a-fA-F:.]+$/u.test(text)) {
    return false;
  }
  const doubleColon = text.indexOf("::");
  if (doubleColon !== -1 && text.includes("::", doubleColon + 1)) {
    return false;
  }
  const countGroups = (part: string): number | null => {
    if (part === "") {
      return 0;
    }
    const groups = part.split(":");
    let total = 0;
    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i] as string;
      if (i === groups.length - 1 && group.includes(".")) {
        if (!/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.test(group)) {
          return null;
        }
        if (group.split(".").some((octet) => Number(octet) > 255)) {
          return null;
        }
        total += 2;
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/u.test(group)) {
        return null;
      }
      total += 1;
    }
    return total;
  };
  if (doubleColon === -1) {
    return countGroups(text) === 8;
  }
  const head = countGroups(text.slice(0, doubleColon));
  const tail = countGroups(text.slice(doubleColon + 2));
  if (head === null || tail === null) {
    return false;
  }
  return head + tail <= 7;
}

/**
 * `_checknetloc` — reject a non-ASCII netloc whose NFKC normalization
 * introduces a delimiter (e.g. `℀` expanding to `a/c`).
 *
 * @param netloc - The raw netloc.
 * @throws UrlSplitError - Delimiter injected under NFKC.
 */
function checkNetloc(netloc: string): void {
  if (netloc === "" || isAscii(netloc)) {
    return;
  }
  const n = netloc.replaceAll(/[@:#?]/g, "");
  const netloc2 = n.normalize("NFKC");
  if (n === netloc2) {
    return;
  }
  for (const c of "/?#@:") {
    if (netloc2.includes(c)) {
      throw new UrlSplitError(
        `netloc '${netloc}' contains invalid characters under NFKC normalization`,
      );
    }
  }
}

/**
 * `SplitResult.hostname` over a raw netloc.
 *
 * @param netloc - The raw netloc.
 * @returns The lower-cased host, or `null`.
 */
function hostnameOf(netloc: string): string | null {
  const at = netloc.lastIndexOf("@");
  const hostinfo = at === -1 ? netloc : netloc.slice(at + 1);
  let hostname: string;
  const open = hostinfo.indexOf("[");
  if (open === -1) {
    const colon = hostinfo.indexOf(":");
    hostname = colon === -1 ? hostinfo : hostinfo.slice(0, colon);
  } else {
    const bracketed = hostinfo.slice(open + 1);
    const close = bracketed.indexOf("]");
    hostname = close === -1 ? bracketed : bracketed.slice(0, close);
  }
  if (hostname === "") {
    return null;
  }
  // A scoped IPv6 zone (`%zone`) is not lower-cased.
  const percent = hostname.indexOf("%");
  if (percent === -1) {
    return hostname.toLowerCase();
  }
  return hostname.slice(0, percent).toLowerCase() + hostname.slice(percent);
}

/**
 * `urllib.parse.urlsplit(url)` (allow_fragments=True, no default
 * scheme) — TS port of CPython 3.12.
 *
 * @param input - The url text.
 * @returns The split result plus the derived `hostname`.
 * @throws UrlSplitError - The `ValueError` cases (unbalanced `[`/`]`,
 *   invalid bracketed host, NFKC-injected delimiter).
 */
export function urlsplit(input: string): SplitResult {
  let url = input;
  // `url.lstrip(_WHATWG_C0_CONTROL_OR_SPACE)`.
  let start = 0;
  while (
    start < url.length &&
    WHATWG_C0_CONTROL_OR_SPACE.includes(url[start] as string)
  ) {
    start += 1;
  }
  url = url.slice(start);
  for (const unsafe of UNSAFE_URL_CHARS) {
    url = url.replaceAll(unsafe, "");
  }
  let scheme = "";
  let netloc = "";
  let query = "";
  let fragment = "";
  const i = url.indexOf(":");
  if (i > 0) {
    const first = url.charCodeAt(0);
    const isAlpha =
      (first >= 0x41 && first <= 0x5a) || (first >= 0x61 && first <= 0x7a);
    if (isAlpha) {
      let allSchemeChars = true;
      for (const c of url.slice(0, i)) {
        if (!SCHEME_CHARS.includes(c)) {
          allSchemeChars = false;
          break;
        }
      }
      if (allSchemeChars) {
        scheme = url.slice(0, i).toLowerCase();
        url = url.slice(i + 1);
      }
    }
  }
  if (url.startsWith("//")) {
    [netloc, url] = splitNetloc(url, 2);
    const hasOpen = netloc.includes("[");
    const hasClose = netloc.includes("]");
    if ((hasOpen && !hasClose) || (hasClose && !hasOpen)) {
      throw new UrlSplitError("Invalid IPv6 URL");
    }
    if (hasOpen && hasClose) {
      const afterOpen = netloc.slice(netloc.indexOf("[") + 1);
      const bracketed = afterOpen.slice(0, afterOpen.indexOf("]"));
      checkBracketedHost(bracketed);
    }
  }
  const hash = url.indexOf("#");
  if (hash !== -1) {
    fragment = url.slice(hash + 1);
    url = url.slice(0, hash);
  }
  const question = url.indexOf("?");
  if (question !== -1) {
    query = url.slice(question + 1);
    url = url.slice(0, question);
  }
  checkNetloc(netloc);
  return {
    scheme,
    netloc,
    path: url,
    query,
    fragment,
    hostname: hostnameOf(netloc),
  };
}

/**
 * `urllib.parse.urlunsplit` — reassemble the 5 components.
 *
 * @param parts - The components (`hostname` is ignored).
 * @returns The url text.
 */
export function urlunsplit(parts: {
  readonly scheme: string;
  readonly netloc: string;
  readonly path: string;
  readonly query: string;
  readonly fragment: string;
}): string {
  let url = parts.path;
  if (
    parts.netloc !== "" ||
    (parts.scheme !== "" &&
      USES_NETLOC.has(parts.scheme) &&
      !url.startsWith("//"))
  ) {
    if (url !== "" && !url.startsWith("/")) {
      url = `/${url}`;
    }
    url = `//${parts.netloc}${url}`;
  }
  if (parts.scheme !== "") {
    url = `${parts.scheme}:${url}`;
  }
  if (parts.query !== "") {
    url += `?${parts.query}`;
  }
  if (parts.fragment !== "") {
    url += `#${parts.fragment}`;
  }
  return url;
}

/**
 * `urllib.parse.urljoin(base, url)` — TS port of CPython 3.12's
 * RFC-3986-style join. The `;params` split `urlparse` performs on the
 * last path segment is NOT mirrored (the port never joins targets that
 * carry path parameters; a `;` stays part of the path here).
 *
 * @param base - The base url.
 * @param url - The possibly-relative url.
 * @returns The joined absolute url.
 * @throws UrlSplitError - Either input fails `urlsplit`.
 */
export function urljoin(base: string, url: string): string {
  if (base === "") {
    return url;
  }
  if (url === "") {
    return base;
  }
  const b = urlsplit(base);
  const u = urlsplit(url);
  // `urlparse(url, bscheme)`: a scheme-less url inherits the base scheme.
  const scheme = u.scheme === "" ? b.scheme : u.scheme;
  if (scheme !== b.scheme || !USES_RELATIVE.has(scheme)) {
    return url;
  }
  let netloc = u.netloc;
  let path = u.path;
  let query = u.query;
  const fragment = u.fragment;
  if (USES_NETLOC.has(scheme)) {
    if (netloc !== "") {
      return urlunsplit({ scheme, netloc, path, query, fragment });
    }
    netloc = b.netloc;
  }
  if (path === "") {
    path = b.path;
    if (query === "") {
      query = b.query;
    }
    return urlunsplit({ scheme, netloc, path, query, fragment });
  }

  const baseParts = b.path.split("/");
  if (baseParts[baseParts.length - 1] !== "") {
    baseParts.pop();
  }
  let segments: string[];
  if (path.startsWith("/")) {
    segments = path.split("/");
  } else {
    segments = [...baseParts, ...path.split("/")];
    // `segments[1:-1] = filter(None, segments[1:-1])`.
    const head = segments.slice(0, 1);
    const tail = segments.slice(-1);
    const middle = segments.slice(1, -1).filter((seg) => seg !== "");
    segments = segments.length > 1 ? [...head, ...middle, ...tail] : segments;
  }
  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === "..") {
      resolved.pop();
    } else if (seg !== ".") {
      resolved.push(seg);
    }
  }
  const last = segments[segments.length - 1];
  if (last === "." || last === "..") {
    resolved.push("");
  }
  const joinedPath = resolved.join("/");
  return urlunsplit({
    scheme,
    netloc,
    path: joinedPath === "" ? "/" : joinedPath,
    query,
    fragment,
  });
}
