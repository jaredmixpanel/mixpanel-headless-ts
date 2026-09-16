#!/usr/bin/env node
// Probes the policy the docs playground's live mode depends on, without
// credentials: Mixpanel's query, app and OAuth endpoints must answer CORS
// preflights from the site's origin (the page sends a bearer token from
// JavaScript, exchanges the PKCE code and registers its OAuth client from
// the browser), the query API must answer an unauthenticated request with
// 401 (the endpoint is up, and it is a policy answer rather than a CORS
// failure), the Export API must still refuse CORS — the browser package
// refuses it before any fetch, and this keeps that refusal honest — and the
// sign-in pages must keep the popup login usable: no
// `Cross-Origin-Opener-Policy` (one would sever `window.opener`, the only
// channel from the popup back to an embedded page) while still forbidding
// framing (the reason the login runs in a popup at all).
//
// A real login cannot run unattended (interactive sign-in page, no
// client-credentials grant), so the canary checks headers, not a token.
//
// Usage:
//   npm run demo:canary                 # every read-only probe
//   npm run demo:canary -- --register   # also a DCR registration with the
//                                       # playground's redirect URI. Creates
//                                       # a client record per run: opt-in,
//                                       # never run by the workflow.
//
// `DOCS_ORIGIN` (default http://localhost:5173) is the `Origin` the probes
// send and, with `DOCS_BASE` (default /), the redirect URI `--register`
// submits — the same variables the docs build derives the playground's
// constants from. Exit 1 on any deviation, 2 on usage errors.
import process from "node:process";

const REGION_HOSTS = ["mixpanel.com", "eu.mixpanel.com", "in.mixpanel.com"];
const EXPORT_HOST = "data.mixpanel.com";
const REQUEST_TIMEOUT_MS = 15_000;
// The authorize endpoint sends a visitor without a session to the sign-in
// page; the popup traverses every hop, so each one is checked, but a chain
// longer than this is itself a change worth reporting.
const MAX_SIGN_IN_HOPS = 3;

// The same body core's `registerClient` sends (its `DEFAULT_SCOPE`), so a
// manual `--register` run exercises exactly the playground's registration.
const DCR_SCOPE =
  "projects analysis events insights segmentation retention " +
  "data:read funnels flows data_definitions dashboard_reports bookmarks";

const origin = process.env["DOCS_ORIGIN"] ?? "http://localhost:5173";
const base = process.env["DOCS_BASE"] ?? "/";
const redirectUri = `${origin}${base}demo/callback`;

/**
 * @typedef {object} Deviation
 * @property {string} probe - What was probed.
 * @property {string} reason - Why it failed.
 */

/**
 * Perform one request with a timeout; network failures become a deviation
 * rather than an exception, so every probe still runs.
 *
 * @param {string} url - Request URL.
 * @param {{ method: string; headers: Record<string, string>; body?: string }} init - Method, headers, body.
 * @returns {Promise<Response | Error>} The response or the failure.
 */
async function request(url, init) {
  try {
    return await fetch(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Whether a comma-separated header lists a token (case-insensitive) or `*`.
 *
 * @param {string | null} header - The header value.
 * @param {string} token - The token to look for.
 * @returns {boolean} `true` when the token is allowed.
 */
function allows(header, token) {
  if (header === null) {
    return false;
  }
  const tokens = new Set(
    header.split(",").map((part) => part.trim().toLowerCase()),
  );
  return tokens.has("*") || tokens.has(token.toLowerCase());
}

/**
 * Whether an `access-control-allow-origin` value admits the site's origin.
 *
 * @param {string | null} header - The header value.
 * @returns {boolean} `true` for `*` or the exact origin.
 */
function allowsOrigin(header) {
  return header === "*" || header === origin;
}

/**
 * A CORS preflight that must succeed.
 *
 * @param {string} url - Endpoint.
 * @param {string} method - The request method the page will use.
 * @param {string[]} headers - The request headers the page will send.
 * @returns {Promise<Deviation[]>} Deviations (empty when the policy holds).
 */
async function expectCorsOpen(url, method, headers) {
  const probe = `OPTIONS ${url} (${method}; ${headers.join(", ")})`;
  const response = await request(url, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": method,
      "Access-Control-Request-Headers": headers.join(", "),
    },
  });
  if (response instanceof Error) {
    return [{ probe, reason: `request failed: ${response.message}` }];
  }
  /** @type {Deviation[]} */
  const deviations = [];
  if (response.status < 200 || response.status >= 300) {
    deviations.push({ probe, reason: `HTTP ${response.status}` });
  }
  const allowOrigin = response.headers.get("access-control-allow-origin");
  if (!allowsOrigin(allowOrigin)) {
    deviations.push({
      probe,
      reason: `access-control-allow-origin is ${JSON.stringify(allowOrigin)}, wanted * or ${origin}`,
    });
  }
  const allowMethods = response.headers.get("access-control-allow-methods");
  if (allowMethods !== null && !allows(allowMethods, method)) {
    deviations.push({
      probe,
      reason: `access-control-allow-methods ${JSON.stringify(allowMethods)} lacks ${method}`,
    });
  }
  const allowHeaders = response.headers.get("access-control-allow-headers");
  for (const header of headers) {
    if (!allows(allowHeaders, header)) {
      deviations.push({
        probe,
        reason: `access-control-allow-headers ${JSON.stringify(allowHeaders)} lacks ${header}`,
      });
    }
  }
  return deviations;
}

/**
 * A CORS preflight that must not open the endpoint to the page.
 *
 * @param {string} url - Endpoint.
 * @returns {Promise<Deviation[]>} A deviation when the origin is admitted.
 */
async function expectCorsClosed(url) {
  const probe = `OPTIONS ${url} (expected closed)`;
  const response = await request(url, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization",
    },
  });
  if (response instanceof Error) {
    // Unreachable is as closed as it gets for a page; the library never
    // calls this host from a browser anyway.
    return [];
  }
  const allowOrigin = response.headers.get("access-control-allow-origin");
  return allowsOrigin(allowOrigin)
    ? [
        {
          probe,
          reason: `the Export API now admits ${origin} (access-control-allow-origin ${JSON.stringify(allowOrigin)}); revisit the browser package's export refusal and the guide`,
        },
      ]
    : [];
}

/**
 * The query API must answer an unauthenticated request with 401.
 *
 * @param {string} url - Endpoint.
 * @returns {Promise<Deviation[]>} A deviation on any other outcome.
 */
async function expectUnauthorized(url) {
  const probe = `GET ${url} (no credentials)`;
  const response = await request(url, {
    method: "GET",
    headers: { Origin: origin, Accept: "application/json" },
  });
  if (response instanceof Error) {
    return [{ probe, reason: `request failed: ${response.message}` }];
  }
  return response.status === 401
    ? []
    : [{ probe, reason: `HTTP ${response.status}, wanted 401` }];
}

/**
 * Whether a response forbids being framed: a `frame-ancestors 'none'`
 * directive or an `X-Frame-Options` of `DENY` or `SAMEORIGIN`.
 *
 * @param {Headers} headers - The response headers.
 * @returns {boolean} `true` when no other origin may frame the page.
 */
function forbidsFraming(headers) {
  const policy = headers.get("content-security-policy") ?? "";
  const frameAncestors = policy
    .split(";")
    .map((directive) => directive.trim().toLowerCase())
    .find((directive) => directive.startsWith("frame-ancestors"));
  if (
    frameAncestors !== undefined &&
    /^frame-ancestors\s+'none'$/.test(frameAncestors)
  ) {
    return true;
  }
  const frameOptions = headers.get("x-frame-options")?.trim().toUpperCase();
  return frameOptions === "DENY" || frameOptions === "SAMEORIGIN";
}

/**
 * The authorize endpoint, and every page it redirects a visitor without a
 * session to, must keep the popup login usable. Two headers decide that:
 * a `Cross-Origin-Opener-Policy` would sever `window.opener`, the only
 * channel from the popup back to an embedded page (the relay would fall
 * back to pasting the redirect); and framing must still be forbidden — that
 * restriction is why the login opens a popup, so if it ever lifts, the
 * redirect flow could run framed and the docs should say so.
 *
 * @param {string} host - Region host.
 * @returns {Promise<Deviation[]>} A deviation per header that changed.
 */
async function expectPopupUsable(host) {
  let url = `https://${host}/oauth/authorize/`;
  const probe = `GET ${url} (no credentials; no COOP, framing forbidden, across redirects)`;
  /** @type {Deviation[]} */
  const deviations = [];
  for (let hop = 0; hop < MAX_SIGN_IN_HOPS; hop += 1) {
    const response = await request(url, {
      method: "GET",
      headers: { Accept: "text/html" },
    });
    if (response instanceof Error) {
      deviations.push({
        probe,
        reason: `request failed at ${url}: ${response.message}`,
      });
      return deviations;
    }
    const opener = response.headers.get("cross-origin-opener-policy");
    if (opener !== null) {
      deviations.push({
        probe,
        reason: `${url} (HTTP ${response.status}) sends cross-origin-opener-policy ${JSON.stringify(opener)}; the popup loses window.opener and every embedded sign-in degrades to the paste fallback`,
      });
    }
    if (!forbidsFraming(response.headers)) {
      const frameOptions = response.headers.get("x-frame-options");
      deviations.push({
        probe,
        reason: `${url} (HTTP ${response.status}) no longer forbids framing (no frame-ancestors 'none'; x-frame-options ${JSON.stringify(frameOptions)}); revisit whether the login still needs a popup`,
      });
    }
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || location === null) {
      return deviations;
    }
    const next = new URL(location, url);
    if (next.host !== host) {
      // A hop to another host (a hosted identity provider, say) is outside
      // what the canary can vouch for without a session; stop here.
      return deviations;
    }
    url = next.href;
  }
  deviations.push({
    probe,
    reason: `still redirecting after ${MAX_SIGN_IN_HOPS} hops (last ${url})`,
  });
  return deviations;
}

/**
 * Dynamic client registration with the playground's redirect URI — what
 * `beginLogin` does on the first sign-in from a tab. Creates a client
 * record on Mixpanel's side, hence opt-in.
 *
 * @param {string} host - Region host.
 * @returns {Promise<Deviation[]>} A deviation unless a `client_id` comes back.
 */
async function expectRegistration(host) {
  const url = `https://${host}/oauth/mcp/register/`;
  const probe = `POST ${url} (redirect_uri ${redirectUri})`;
  const response = await request(url, {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: DCR_SCOPE,
    }),
  });
  if (response instanceof Error) {
    return [{ probe, reason: `request failed: ${response.message}` }];
  }
  if (response.status < 200 || response.status >= 300) {
    return [{ probe, reason: `HTTP ${response.status}` }];
  }
  /** @type {unknown} */
  let body;
  try {
    body = await response.json();
  } catch {
    return [{ probe, reason: "response is not JSON" }];
  }
  const clientId =
    typeof body === "object" && body !== null && "client_id" in body
      ? body.client_id
      : undefined;
  return typeof clientId === "string" && clientId !== ""
    ? []
    : [{ probe, reason: "response carries no client_id" }];
}

/**
 * Run every probe and report.
 *
 * @param {boolean} register - Whether to include the DCR registration.
 * @returns {Promise<number>} The process exit code.
 */
async function main(register) {
  /** @type {Array<Promise<Deviation[]>>} */
  const probes = [];
  for (const host of REGION_HOSTS) {
    const api = `https://${host}/api`;
    const oauth = `https://${host}/oauth`;
    probes.push(
      expectCorsOpen(`${api}/query/events/top`, "GET", ["authorization"]),
      expectCorsOpen(`${api}/query/insights`, "POST", [
        "content-type",
        "authorization",
      ]),
      expectCorsOpen(`${api}/app/me`, "GET", ["authorization"]),
      expectCorsOpen(`${oauth}/token/`, "POST", ["content-type"]),
      expectCorsOpen(`${oauth}/mcp/register/`, "POST", ["content-type"]),
      expectPopupUsable(host),
    );
  }
  probes.push(
    expectUnauthorized("https://mixpanel.com/api/query/events/top"),
    expectCorsClosed(`https://${EXPORT_HOST}/api/2.0/export`),
  );
  if (register) {
    probes.push(expectRegistration("mixpanel.com"));
  }

  const deviations = (await Promise.all(probes)).flat();
  const total = probes.length;
  if (deviations.length === 0) {
    console.log(
      `demo canary: ${total} probes OK (origin ${origin}${register ? ", DCR registration included" : ""})`,
    );
    return 0;
  }
  console.error(
    `demo canary: ${deviations.length} deviation(s) across ${total} probes (origin ${origin})`,
  );
  for (const { probe, reason } of deviations) {
    console.error(`  ${probe}\n    ${reason}`);
  }
  return 1;
}

const args = process.argv.slice(2);
const unknown = args.filter((arg) => arg !== "--register");
if (unknown.length > 0) {
  console.error(`demo canary: unknown argument(s) ${unknown.join(" ")}`);
  console.error("usage: node scripts/demo-canary.mjs [--register]");
  process.exit(2);
}
process.exit(await main(args.includes("--register")));
