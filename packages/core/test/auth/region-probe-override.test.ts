// Layer-3 translation — Python PR #235 (AIE-925):
// tests/unit/test_region_probe.py::TestRegionProbeUnderApiBaseUrlOverride
// (11 tests) + the `_probe_base_url` docstring examples.
//
// Mechanism substitutions (R10.2, header-cited):
// - `monkeypatch.setenv("MP_API_BASE_URL" | "MP_APP_BASE_URL" |
//   "MP_REGION", ...)` → the `getEnv` seam `probeRegionForCredential`
//   already takes (R9.4) — the probe reads the three variables through
//   it when no explicit `endpointOverrides` / `regionHint` is injected,
//   exactly where Python reads `os.environ`. The explicit-injection arm
//   is exercised alongside.
// - `monkeypatch.setattr(rp_mod, "probe_region", _spy_probe)` is not
//   expressible over ESM exports (see `region-probe.test.ts` header);
//   the order + factory base are observed through an injected recording
//   fetch: every probed region issues exactly one `GET {base}/api/app/me`,
//   so the URL list IS `[(base, region)]` in probe order. A 401 handler
//   forces the full walk so the ORDER (not just the first region) is
//   observable.

import { describe, expect, it } from "vitest";

import {
  overrideProbeNarration,
  overrideProbeOrder,
  probeBaseUrl,
  probeRegionForCredential,
} from "../../src/auth/region-probe.js";
import { RegionProbeError } from "../../src/errors.js";
import { Secret } from "../../src/secret.js";

/** An env bag the `getEnv` seam reads (the `monkeypatch.setenv` twin). */
type Env = Readonly<Record<string, string>>;

/** Run the probe over a recording fetch; return the URLs + outcome. */
async function runWithSpy(
  env: Env,
  options: {
    status?: number;
    narrate?: ((msg: string) => void) | undefined;
    explicit?: boolean;
  } = {},
): Promise<{ urls: string[]; region: string | null }> {
  const status = options.status ?? 200;
  const urls: string[] = [];
  const recordingFetch: typeof fetch = (input) => {
    urls.push(input instanceof Request ? input.url : String(input));
    return Promise.resolve(
      new Response(status === 200 ? '{"user_id": 1}' : "nope", { status }),
    );
  };
  const getEnv = (name: string): string | undefined => env[name];
  let region: string | null = null;
  try {
    region = await probeRegionForCredential({
      account_type: "service_account",
      username: "u",
      secret: new Secret("s"),
      token: null,
      token_env: null,
      narrate: options.narrate ?? null,
      getEnv,
      fetchImpl: recordingFetch,
      // The explicit-injection arm: the same values handed in as a bag
      // + hint (what a browser/config-only caller would do).
      ...(options.explicit === true
        ? {
            endpointOverrides: {
              apiBaseUrl: env["MP_API_BASE_URL"],
              appBaseUrl: env["MP_APP_BASE_URL"],
            },
            regionHint: env["MP_REGION"],
          }
        : {}),
    });
  } catch (error) {
    if (!(error instanceof RegionProbeError)) {
      throw error;
    }
  }
  return { urls, region };
}

/** Bases + regions the spy saw (`captured_base_urls` / `captured_orders`). */
function basesOf(urls: string[]): string[] {
  return urls.map((u) => u.replace(/\/api\/app\/me$/, ""));
}

describe("TestRegionProbeUnderApiBaseUrlOverride", () => {
  for (const explicit of [false, true]) {
    const arm = explicit ? "injected bag" : "getEnv seam";

    it(`test_override_binds_factory_to_base_and_probes_once [${arm}]`, async () => {
      const { urls, region } = await runWithSpy(
        { MP_API_BASE_URL: "http://127.0.0.1:8080/" },
        { explicit },
      );
      expect(basesOf(urls)).toEqual(["http://127.0.0.1:8080"]);
      expect(region).toBe("us");
      // A 401 walk still probes ONCE — the order is a single region.
      const failed = await runWithSpy(
        { MP_API_BASE_URL: "http://127.0.0.1:8080/" },
        { status: 401, explicit },
      );
      expect(failed.urls).toEqual(["http://127.0.0.1:8080/api/app/me"]);
    });

    it(`test_override_uses_mp_region_when_valid [${arm}]`, async () => {
      const { urls, region } = await runWithSpy(
        { MP_API_BASE_URL: "http://127.0.0.1:8080", MP_REGION: "eu" },
        { explicit },
      );
      expect(basesOf(urls)).toEqual(["http://127.0.0.1:8080"]);
      expect(region).toBe("eu");
    });

    it(`test_override_ignores_invalid_mp_region [${arm}]`, async () => {
      const { region } = await runWithSpy(
        { MP_API_BASE_URL: "http://127.0.0.1:8080", MP_REGION: "mars" },
        { explicit },
      );
      expect(region).toBe("us");
    });

    it(`test_override_with_path_prefix_keeps_prefix_in_base [${arm}]`, async () => {
      const { urls } = await runWithSpy(
        { MP_API_BASE_URL: "https://proxy.example/mp" },
        { explicit },
      );
      expect(urls).toEqual(["https://proxy.example/mp/api/app/me"]);
    });

    it(`test_app_base_alone_keeps_three_region_order [${arm}]`, async () => {
      const ok = await runWithSpy(
        { MP_APP_BASE_URL: "http://app.internal:9000/" },
        { explicit },
      );
      expect(basesOf(ok.urls)).toEqual(["http://app.internal:9000"]);
      // Full walk on 401: three probes, all at the App override base.
      const failed = await runWithSpy(
        { MP_APP_BASE_URL: "http://app.internal:9000/" },
        { status: 401, explicit },
      );
      expect(basesOf(failed.urls)).toEqual([
        "http://app.internal:9000",
        "http://app.internal:9000",
        "http://app.internal:9000",
      ]);
    });

    it(`test_app_base_alone_ignores_mp_region_for_order [${arm}]`, async () => {
      const failed = await runWithSpy(
        { MP_APP_BASE_URL: "http://app.internal:9000", MP_REGION: "eu" },
        { status: 401, explicit },
      );
      expect(failed.urls).toHaveLength(3);
      // First probe is still `us` (default order), not the hint.
      const ok = await runWithSpy(
        { MP_APP_BASE_URL: "http://app.internal:9000", MP_REGION: "eu" },
        { explicit },
      );
      expect(ok.region).toBe("us");
    });

    it(`test_unset_keeps_live_host_and_default_order [${arm}]`, async () => {
      const ok = await runWithSpy({}, { explicit });
      expect(basesOf(ok.urls)).toEqual(["https://mixpanel.com"]);
      const failed = await runWithSpy({}, { status: 401, explicit });
      expect(basesOf(failed.urls)).toEqual([
        "https://mixpanel.com",
        "https://eu.mixpanel.com",
        "https://in.mixpanel.com",
      ]);
    });
  }

  /** The `_narration_lines` twin: every string passed to `narrate`. */
  async function narrationLines(env: Env): Promise<string[]> {
    const lines: string[] = [];
    await runWithSpy(env, { narrate: (msg) => lines.push(msg) });
    expect(lines.length).toBeGreaterThan(0);
    return lines;
  }

  it("test_narration_names_api_base_url_only", async () => {
    const first = (
      await narrationLines({ MP_API_BASE_URL: "http://127.0.0.1:8080" })
    )[0]!;
    expect(first).toContain("http://127.0.0.1:8080");
    expect(first).toContain("MP_API_BASE_URL");
    expect(first).not.toContain("MP_APP_BASE_URL");
  });

  it("test_narration_names_app_base_url_only", async () => {
    const first = (
      await narrationLines({ MP_APP_BASE_URL: "http://app.internal:9000" })
    )[0]!;
    expect(first).toContain("http://app.internal:9000");
    expect(first).toContain("MP_APP_BASE_URL");
    expect(first).not.toContain("MP_API_BASE_URL");
  });

  it("test_narration_names_both_when_both_set", async () => {
    const first = (
      await narrationLines({
        MP_API_BASE_URL: "http://127.0.0.1:8080",
        MP_APP_BASE_URL: "http://app.internal:9000",
      })
    )[0]!;
    expect(first).toContain("http://app.internal:9000");
    expect(first).toContain("MP_API_BASE_URL");
    expect(first).toContain("MP_APP_BASE_URL");
  });

  it("test_narration_unchanged_without_override", async () => {
    expect((await narrationLines({}))[0]).toBe(
      "Probing regions for /me access ...",
    );
  });
});

describe("_override_probe_order / _override_probe_narration / _probe_base_url (docstring examples)", () => {
  it("overrideProbeOrder", () => {
    expect(
      overrideProbeOrder({ apiBaseUrl: "http://127.0.0.1:8080" }, "eu"),
    ).toEqual(["eu"]);
    expect(overrideProbeOrder({ apiBaseUrl: "http://x" }, undefined)).toEqual([
      "us",
    ]);
    expect(overrideProbeOrder({ apiBaseUrl: "http://x" }, "mars")).toEqual([
      "us",
    ]);
    expect(overrideProbeOrder({ appBaseUrl: "http://x" }, "eu")).toBeNull();
    expect(overrideProbeOrder({ apiBaseUrl: "//" }, "eu")).toBeNull();
    expect(overrideProbeOrder({}, "eu")).toBeNull();
  });

  it("overrideProbeNarration", () => {
    expect(
      overrideProbeNarration({ appBaseUrl: "http://app.internal:9000" }),
    ).toBe(
      "Probing regions at http://app.internal:9000 (MP_APP_BASE_URL override) for /me access ...",
    );
    expect(
      overrideProbeNarration({ apiBaseUrl: "http://127.0.0.1:8080/" }),
    ).toBe(
      "Probing http://127.0.0.1:8080 (MP_API_BASE_URL override) for /me ...",
    );
    expect(
      overrideProbeNarration({
        apiBaseUrl: "http://127.0.0.1:8080",
        appBaseUrl: "http://app.internal:9000",
      }),
    ).toBe(
      "Probing http://app.internal:9000 (MP_API_BASE_URL + MP_APP_BASE_URL override) for /me ...",
    );
    expect(overrideProbeNarration({})).toBeNull();
    expect(
      overrideProbeNarration({ apiBaseUrl: "", appBaseUrl: "/" }),
    ).toBeNull();
  });

  it("probeBaseUrl", () => {
    expect(probeBaseUrl("https://mixpanel.com/api/app")).toBe(
      "https://mixpanel.com",
    );
    expect(probeBaseUrl("https://mixpanel.com/api/app/")).toBe(
      "https://mixpanel.com",
    );
    expect(probeBaseUrl("https://proxy.example/mp/api/app/")).toBe(
      "https://proxy.example/mp",
    );
    // Not ending in /api/app → scheme + host only (pre-override rule).
    expect(probeBaseUrl("https://mixpanel.com/api/v2/app")).toBe(
      "https://mixpanel.com",
    );
  });
});
