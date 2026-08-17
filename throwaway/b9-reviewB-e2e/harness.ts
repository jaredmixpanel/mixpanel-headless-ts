// B9 pair-B (blind) lens-2 adversarial e2e harness — REVIEW ARTIFACT.
// Not part of the shipped package; run: npx vite-node throwaway/b9-reviewB-e2e/harness.ts
//
// Shared plumbing: a recording fetch double, canned IdP, scenario runner.

export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string | null;
}

export interface CannedResponse {
  readonly status: number;
  readonly body: string;
  readonly headers?: Record<string, string>;
}

export type Responder = (
  req: RecordedRequest,
) => CannedResponse | Promise<CannedResponse> | Error;

/** Build a recording fetch over a responder table. */
export function recordingFetch(responder: Responder): {
  fetch: typeof fetch;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const impl = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : String(input);
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders !== undefined) {
      new Headers(rawHeaders as HeadersInit).forEach((v, k) => {
        headers[k] = v;
      });
    }
    const body =
      init?.body === undefined || init.body === null
        ? null
        : typeof init.body === "string"
          ? init.body
          : String(init.body);
    const req: RecordedRequest = {
      method: init?.method ?? "GET",
      url,
      headers,
      body,
    };
    requests.push(req);
    const out = await responder(req);
    if (out instanceof Error) {
      throw out;
    }
    return new Response(out.body, {
      status: out.status,
      headers: out.headers ?? { "content-type": "application/json" },
    });
  };
  return { fetch: impl as typeof fetch, requests };
}

export interface ScenarioResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

const results: ScenarioResult[] = [];

export function record(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${name} :: ${detail}\n`);
}

export function summary(): void {
  const failed = results.filter((r) => !r.ok);
  process.stdout.write(
    `\n--- ${results.length} checks, ${failed.length} FAIL ---\n`,
  );
}

/** Capture an error's code + class for comparison. */
export async function capture(
  fn: () => Promise<unknown>,
): Promise<{ code: string | null; cls: string; message: string } | null> {
  try {
    await fn();
    return null;
  } catch (exc) {
    const e = exc as {
      code?: unknown;
      constructor: { name: string };
      message: string;
    };
    return {
      code: typeof e.code === "string" ? e.code : null,
      cls: e.constructor.name,
      message: e.message,
    };
  }
}
