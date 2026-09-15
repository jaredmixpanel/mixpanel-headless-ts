// `compat/urllib` — the CPython `urlsplit` / `urlunsplit` / `urljoin` twins
// the report-link parser rides on: raw `urlsplit` observation (lower-cased
// scheme and hostname, port stripped, everything else verbatim), IPv6 and
// control-character handling, and the `urljoin` targets `resolve_short_link`
// echoes. No Python test file behind this suite; the expected values are CPython's.
import { describe, expect, it } from "vitest";

import {
  urljoin,
  urlsplit,
  UrlSplitError,
  urlunsplit,
} from "../../src/compat/urllib.js";

const SLUG = "EBrV5bW2u9Mw";

// --- compat/urllib ---

describe("compat/urllib (CPython urlsplit / urlunsplit / urljoin twins)", () => {
  describe("urlsplit", () => {
    it("lower-cases the scheme and hostname, keeps the netloc verbatim", () => {
      const parts = urlsplit(
        `HTTPS://MIXPANEL.COM/project/3/app/insights#${SLUG}`,
      );
      expect(parts.scheme).toBe("https");
      expect(parts.netloc).toBe("MIXPANEL.COM");
      expect(parts.hostname).toBe("mixpanel.com");
      expect(parts.path).toBe("/project/3/app/insights");
      expect(parts.query).toBe("");
      expect(parts.fragment).toBe(SLUG);
    });

    it("strips the port and userinfo from hostname only", () => {
      const parts = urlsplit(
        "https://user:pw@Eu.Mixpanel.com:8443/project/3/app/insights?utm=x#h",
      );
      expect(parts.netloc).toBe("user:pw@Eu.Mixpanel.com:8443");
      expect(parts.hostname).toBe("eu.mixpanel.com");
      expect(parts.path).toBe("/project/3/app/insights");
      expect(parts.query).toBe("utm=x");
      expect(parts.fragment).toBe("h");
    });

    it("strips a default :443 port from hostname", () => {
      expect(urlsplit("https://mixpanel.com:443/x").hostname).toBe(
        "mixpanel.com",
      );
    });

    it("splits the fragment before the query, so a ? inside the hash stays", () => {
      const parts = urlsplit("https://mixpanel.com/a?b=1#c?d=2");
      expect(parts.query).toBe("b=1");
      expect(parts.fragment).toBe("c?d=2");
    });

    it("does not percent-decode anything", () => {
      const parts = urlsplit(
        "https://mixpanel.com/project/3/app/insights%23report/123/my%2Ftitle",
      );
      expect(parts.path).toBe(
        "/project/3/app/insights%23report/123/my%2Ftitle",
      );
      expect(parts.fragment).toBe("");
    });

    it("treats a scheme-less host as a relative path (no netloc)", () => {
      const parts = urlsplit("mixpanel.com/s/abc");
      expect(parts.scheme).toBe("");
      expect(parts.netloc).toBe("");
      expect(parts.hostname).toBeNull();
      expect(parts.path).toBe("mixpanel.com/s/abc");
    });

    it("yields a null hostname for a scheme with no host", () => {
      const parts = urlsplit("https://");
      expect(parts.netloc).toBe("");
      expect(parts.hostname).toBeNull();
      expect(parts.path).toBe("");
    });

    it("keeps a non-http scheme (the parser rejects it upstream)", () => {
      expect(urlsplit("javascript://mixpanel.com/x").scheme).toBe("javascript");
      expect(urlsplit("FTP://mixpanel.com/x").scheme).toBe("ftp");
    });

    it("unbrackets an IPv6 host and keeps its port out of hostname", () => {
      const parts = urlsplit("https://[::1]:8080/x");
      expect(parts.netloc).toBe("[::1]:8080");
      expect(parts.hostname).toBe("::1");
    });

    it("raises UrlSplitError on an unbalanced IPv6 bracket", () => {
      expect(() => urlsplit("https://[::1/project/3/app/insights#x")).toThrow(
        UrlSplitError,
      );
      expect(() => urlsplit("https://::1]/x")).toThrow(UrlSplitError);
    });

    it("raises UrlSplitError on an invalid bracketed host", () => {
      expect(() => urlsplit("https://[not-ipv6]/x")).toThrow(UrlSplitError);
    });

    it("strips leading C0 controls/space and removes tab/CR/LF everywhere", () => {
      const parts = urlsplit("  \thttps://mix\npanel.com/pa\rth#f\tg");
      expect(parts.scheme).toBe("https");
      expect(parts.hostname).toBe("mixpanel.com");
      expect(parts.path).toBe("/path");
      expect(parts.fragment).toBe("fg");
    });

    it("does not lower-case a scoped IPv6 zone id", () => {
      expect(urlsplit("https://[FE80::1%ETH0]/x").hostname).toBe(
        "fe80::1%ETH0",
      );
    });
  });

  describe("urlunsplit", () => {
    it("round-trips a full report URL through urlsplit", () => {
      const url = `https://mixpanel.com/project/3/app/insights?utm=x#${SLUG}`;
      expect(urlunsplit(urlsplit(url))).toBe(url);
    });

    it("keeps the raw netloc case (only the scheme is normalized)", () => {
      expect(urlunsplit(urlsplit("HTTPS://MIXPANEL.COM/x"))).toBe(
        "https://MIXPANEL.COM/x",
      );
    });

    it("emits // for a netloc-using scheme even with an empty netloc", () => {
      expect(
        urlunsplit({
          scheme: "https",
          netloc: "",
          path: "/x",
          query: "",
          fragment: "",
        }),
      ).toBe("https:///x");
    });

    it("prefixes a relative path with / when a netloc is present", () => {
      expect(
        urlunsplit({
          scheme: "https",
          netloc: "mixpanel.com",
          path: "x",
          query: "q",
          fragment: "f",
        }),
      ).toBe("https://mixpanel.com/x?q#f");
    });
  });

  describe("urljoin", () => {
    const base = "https://mixpanel.com/s/AbC123";

    it("returns an absolute target unchanged", () => {
      const target = `https://eu.mixpanel.com/project/3/app/insights#${SLUG}`;
      expect(urljoin(base, target)).toBe(target);
    });

    it("resolves a root-relative target against the base host", () => {
      expect(urljoin(base, `/project/3/app/insights#${SLUG}`)).toBe(
        `https://mixpanel.com/project/3/app/insights#${SLUG}`,
      );
    });

    it("resolves a sibling-relative target against the base directory", () => {
      expect(urljoin(base, "XyZ789")).toBe("https://mixpanel.com/s/XyZ789");
      expect(urljoin("https://mixpanel.com/a/b/", "c")).toBe(
        "https://mixpanel.com/a/b/c",
      );
    });

    it("resolves . and .. dot segments", () => {
      const deep = "https://mixpanel.com/a/b/c";
      expect(urljoin(deep, "../d")).toBe("https://mixpanel.com/a/d");
      expect(urljoin(deep, "./d")).toBe("https://mixpanel.com/a/b/d");
      expect(urljoin(deep, "..")).toBe("https://mixpanel.com/a/");
      expect(urljoin(deep, ".")).toBe("https://mixpanel.com/a/b/");
      expect(urljoin(deep, "../../d")).toBe("https://mixpanel.com/d");
      expect(urljoin(deep, "../../../d")).toBe("https://mixpanel.com/d");
      expect(urljoin(deep, "d/./e/../f")).toBe("https://mixpanel.com/a/b/d/f");
    });

    it("keeps the base path for query-only and fragment-only targets", () => {
      expect(urljoin(`${base}?x=1`, "?y=2")).toBe(`${base}?y=2`);
      expect(urljoin(`${base}?x=1`, "#frag")).toBe(`${base}?x=1#frag`);
    });

    it("adopts the base scheme for a scheme-relative target", () => {
      expect(urljoin(base, "//eu.mixpanel.com/project/3/app/flows#x")).toBe(
        "https://eu.mixpanel.com/project/3/app/flows#x",
      );
    });

    it("returns a target with a different scheme unchanged", () => {
      expect(urljoin(base, "mailto:someone@example.com")).toBe(
        "mailto:someone@example.com",
      );
      expect(urljoin(base, "http://mixpanel.com/x")).toBe(
        "http://mixpanel.com/x",
      );
    });

    it("returns the other operand when one side is empty", () => {
      expect(urljoin("", base)).toBe(base);
      expect(urljoin(base, "")).toBe(base);
    });

    it("propagates UrlSplitError from a malformed operand", () => {
      expect(() => urljoin(base, "https://[::1/x")).toThrow(UrlSplitError);
    });
  });
});
