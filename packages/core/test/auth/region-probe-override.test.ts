// Region probing under `MP_API_BASE_URL` / `MP_APP_BASE_URL` overrides,
// mirroring `TestRegionProbeUnderApiBaseUrlOverride` in
// `tests/unit/test_region_probe.py` plus the `_probe_base_url` docstring
// examples. `monkeypatch.setenv` becomes the `getEnv` seam (an explicit
// `endpointOverrides` arm runs alongside); a recording fetch observes order.

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

describe("Region probe under API base URL override", () => {
  // python: TestRegionProbeUnderApiBaseUrlOverride
  for (const explicit of [false, true]) {
    const arm = explicit ? "injected bag" : "getEnv seam";

    it(`override binds the factory to the base and probes once [${arm}]`, async () => {
      // python: test_override_binds_factory_to_base_and_probes_once
      const { urls, region } = await runWithSpy(
        { MP_API_BASE_URL: "http://127.0.0.1:8080/" },
        { explicit },
      );
      expect(basesOf(urls)).toStrictEqual(["http://127.0.0.1:8080"]);
      expect(region).toBe("us");
      // A 401 walk still probes ONCE — the order is a single region.
      const failed = await runWithSpy(
        { MP_API_BASE_URL: "http://127.0.0.1:8080/" },
        { status: 401, explicit },
      );
      expect(failed.urls).toStrictEqual(["http://127.0.0.1:8080/api/app/me"]);
    });

    it(`override uses MP_REGION when valid [${arm}]`, async () => {
      // python: test_override_uses_mp_region_when_valid
      const { urls, region } = await runWithSpy(
        { MP_API_BASE_URL: "http://127.0.0.1:8080", MP_REGION: "eu" },
        { explicit },
      );
      expect(basesOf(urls)).toStrictEqual(["http://127.0.0.1:8080"]);
      expect(region).toBe("eu");
    });

    it(`override ignores an invalid MP_REGION [${arm}]`, async () => {
      // python: test_override_ignores_invalid_mp_region
      const { region } = await runWithSpy(
        { MP_API_BASE_URL: "http://127.0.0.1:8080", MP_REGION: "mars" },
        { explicit },
      );
      expect(region).toBe("us");
    });

    it(`override with a path prefix keeps the prefix in the base [${arm}]`, async () => {
      // python: test_override_with_path_prefix_keeps_prefix_in_base
      const { urls } = await runWithSpy(
        { MP_API_BASE_URL: "https://proxy.example/mp" },
        { explicit },
      );
      expect(urls).toStrictEqual(["https://proxy.example/mp/api/app/me"]);
    });

    it(`app base alone keeps the three-region order [${arm}]`, async () => {
      // python: test_app_base_alone_keeps_three_region_order
      const ok = await runWithSpy(
        { MP_APP_BASE_URL: "http://app.internal:9000/" },
        { explicit },
      );
      expect(basesOf(ok.urls)).toStrictEqual(["http://app.internal:9000"]);
      // Full walk on 401: three probes, all at the App override base.
      const failed = await runWithSpy(
        { MP_APP_BASE_URL: "http://app.internal:9000/" },
        { status: 401, explicit },
      );
      expect(basesOf(failed.urls)).toStrictEqual([
        "http://app.internal:9000",
        "http://app.internal:9000",
        "http://app.internal:9000",
      ]);
    });

    it(`app base alone ignores MP_REGION for the order [${arm}]`, async () => {
      // python: test_app_base_alone_ignores_mp_region_for_order
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

    it(`unset keeps the live host and default order [${arm}]`, async () => {
      // python: test_unset_keeps_live_host_and_default_order
      const ok = await runWithSpy({}, { explicit });
      expect(basesOf(ok.urls)).toStrictEqual(["https://mixpanel.com"]);
      const failed = await runWithSpy({}, { status: 401, explicit });
      expect(basesOf(failed.urls)).toStrictEqual([
        "https://mixpanel.com",
        "https://eu.mixpanel.com",
        "https://in.mixpanel.com",
      ]);
    });
  }

  /** The `_narration_lines` twin: every string passed to `narrate`. */
  async function narrationLines(env: Env): Promise<string[]> {
    const lines: string[] = [];
    await runWithSpy(env, {
      narrate: (msg) => {
        lines.push(msg);
      },
    });
    expect(lines.length).toBeGreaterThan(0);
    return lines;
  }

  it("narration names API base URL only", async () => {
    // python: test_narration_names_api_base_url_only
    const first = (
      await narrationLines({ MP_API_BASE_URL: "http://127.0.0.1:8080" })
    )[0]!;
    expect(first).toContain("http://127.0.0.1:8080");
    expect(first).toContain("MP_API_BASE_URL");
    expect(first).not.toContain("MP_APP_BASE_URL");
  });

  it("narration names app base URL only", async () => {
    // python: test_narration_names_app_base_url_only
    const first = (
      await narrationLines({ MP_APP_BASE_URL: "http://app.internal:9000" })
    )[0]!;
    expect(first).toContain("http://app.internal:9000");
    expect(first).toContain("MP_APP_BASE_URL");
    expect(first).not.toContain("MP_API_BASE_URL");
  });

  it("narration names both when both set", async () => {
    // python: test_narration_names_both_when_both_set
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

  it("narration unchanged without override", async () => {
    // python: test_narration_unchanged_without_override
    expect((await narrationLines({}))[0]).toBe(
      "Probing regions for /me access ...",
    );
  });
});

describe("overrideProbeOrder / overrideProbeNarration / probeBaseUrl docstring examples", () => {
  it("overrideProbeOrder", () => {
    expect(
      overrideProbeOrder({ apiBaseUrl: "http://127.0.0.1:8080" }, "eu"),
    ).toStrictEqual(["eu"]);
    expect(
      overrideProbeOrder({ apiBaseUrl: "http://x" }, undefined),
    ).toStrictEqual(["us"]);
    expect(
      overrideProbeOrder({ apiBaseUrl: "http://x" }, "mars"),
    ).toStrictEqual(["us"]);
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
