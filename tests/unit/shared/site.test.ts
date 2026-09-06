import { describe, it, expect } from "vitest";
import {
  UPSTREAM_SOURCE_URL,
  configuredOrigin,
  displayHost,
  githubSlug,
  redirectHosts,
  siteForRequest,
  siteWithoutRequest,
} from "~/shared/site";

describe("siteForRequest", () => {
  it("uses the request origin and defaults with no vars set", () => {
    expect(siteForRequest({}, "http://localhost:5173")).toEqual({
      origin: "http://localhost:5173",
      operatorName: null,
      sourceUrl: UPSTREAM_SOURCE_URL,
    });
  });

  it("prefers the request origin over PUBLIC_ORIGIN, so previews describe themselves", () => {
    const site = siteForRequest({ PUBLIC_ORIGIN: "https://vapor.example" }, "https://vapor.someone.workers.dev");
    expect(site.origin).toBe("https://vapor.someone.workers.dev");
  });

  it("rejects a hostile Host and falls back to PUBLIC_ORIGIN, then to a harmless placeholder", () => {
    const hostile = 'https://evil.example</pre><script>alert(1)</script>"';
    expect(siteForRequest({ PUBLIC_ORIGIN: "https://vapor.example" }, hostile).origin).toBe("https://vapor.example");
    expect(siteForRequest({}, hostile).origin).toBe("http://localhost");
    expect(siteForRequest({}, "javascript:alert(1)").origin).toBe("http://localhost");
  });

  it("trims and validates the vars", () => {
    const site = siteForRequest(
      { OPERATOR_NAME: "  Someone Inc  ", SOURCE_URL: "https://github.com/someone/vapor/ " },
      "https://vapor.example",
    );
    expect(site.operatorName).toBe("Someone Inc");
    expect(site.sourceUrl).toBe("https://github.com/someone/vapor");
    expect(siteForRequest({ OPERATOR_NAME: "   " }, "https://a.b").operatorName).toBeNull();
    expect(siteForRequest({ SOURCE_URL: 'javascript:alert("x")' }, "https://a.b").sourceUrl).toBe(UPSTREAM_SOURCE_URL);
  });

  it("accepts IPv6 and ports in origins", () => {
    expect(siteForRequest({}, "http://[::1]:8787").origin).toBe("http://[::1]:8787");
  });
});

describe("siteWithoutRequest / configuredOrigin", () => {
  it("falls back to PUBLIC_ORIGIN, stripping a trailing slash", () => {
    expect(configuredOrigin({ PUBLIC_ORIGIN: "https://vapor.example/" })).toBe("https://vapor.example");
    expect(siteWithoutRequest({ PUBLIC_ORIGIN: "https://vapor.example" }).origin).toBe("https://vapor.example");
    expect(configuredOrigin({})).toBeNull();
    expect(configuredOrigin({ PUBLIC_ORIGIN: "vapor.example" })).toBeNull();
  });
});

describe("redirectHosts", () => {
  it("splits, trims, lowercases, and drops empties", () => {
    expect(redirectHosts({ REDIRECT_HOSTS: " WWW.Vapor.example, vpr.example,, " })).toEqual([
      "www.vapor.example",
      "vpr.example",
    ]);
    expect(redirectHosts({})).toEqual([]);
  });
});

describe("githubSlug / displayHost", () => {
  it("extracts owner/repo from GitHub URLs only", () => {
    expect(githubSlug("https://github.com/someone/vapor")).toBe("someone/vapor");
    expect(githubSlug("https://github.com/someone/vapor.git")).toBe("someone/vapor");
    expect(githubSlug("https://www.github.com/someone/vapor/")).toBe("someone/vapor");
    expect(githubSlug("https://gitlab.com/someone/vapor")).toBeNull();
    expect(githubSlug("https://github.com/someone")).toBeNull();
  });

  it("shows the host of an origin", () => {
    expect(displayHost("https://vapor.example")).toBe("vapor.example");
    expect(displayHost("http://localhost:5173")).toBe("localhost:5173");
  });
});
