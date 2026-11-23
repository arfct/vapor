import { describe, it, expect } from "vitest";
import { frameAncestors, isEmbedHost, parseEmbedHosts, sourceMatches } from "~/shared/embed-hosts";

const HOSTS = parseEmbedHosts("https://host.example https://app.host.example https://*.preview.host.example http://localhost:*");

describe("parseEmbedHosts", () => {
  it("is empty when unset or blank", () => {
    expect(parseEmbedHosts(undefined)).toEqual([]);
    expect(parseEmbedHosts("   ")).toEqual([]);
  });

  it("keeps host sources, lowercased, without repeats or trailing slashes", () => {
    expect(parseEmbedHosts("HTTPS://Host.Example/ https://host.example\thttp://localhost:3000")).toEqual([
      "https://host.example",
      "http://localhost:3000",
    ]);
  });

  it("drops anything that is not a plain host source, so the directive can't be extended", () => {
    expect(
      parseEmbedHosts("* 'self' 'none' https://a.example;script-src https://b.example/path data: javascript:x https://*.example.com:99999x"),
    ).toEqual([]);
  });
});

describe("frameAncestors", () => {
  it("is null with no hosts, so framing stays as it was", () => {
    expect(frameAncestors([])).toBeNull();
  });

  it("names the page itself and every host", () => {
    expect(frameAncestors(HOSTS)).toBe(
      "frame-ancestors 'self' https://host.example https://app.host.example https://*.preview.host.example http://localhost:*",
    );
  });
});

describe("sourceMatches / isEmbedHost", () => {
  it("matches exact origins, with the scheme's default port", () => {
    expect(isEmbedHost("https://host.example", HOSTS)).toBe(true);
    expect(isEmbedHost("https://host.example:443", HOSTS)).toBe(true);
    expect(isEmbedHost("https://app.host.example", HOSTS)).toBe(true);
  });

  it("reads *. as any subdomain, never the bare domain", () => {
    expect(isEmbedHost("https://pr-12.preview.host.example", HOSTS)).toBe(true);
    expect(isEmbedHost("https://a.b.preview.host.example", HOSTS)).toBe(true);
    expect(isEmbedHost("https://preview.host.example", HOSTS)).toBe(false);
  });

  it("reads :* as any port", () => {
    expect(isEmbedHost("http://localhost:3000", HOSTS)).toBe(true);
    expect(isEmbedHost("http://localhost:3005", HOSTS)).toBe(true);
    expect(isEmbedHost("http://localhost", HOSTS)).toBe(true);
  });

  it("refuses other schemes, ports, look-alikes and junk", () => {
    expect(isEmbedHost("http://host.example", HOSTS)).toBe(false);
    expect(isEmbedHost("https://localhost:3000", HOSTS)).toBe(false);
    expect(isEmbedHost("https://host.example:8443", HOSTS)).toBe(false);
    expect(isEmbedHost("https://evilhost.example", HOSTS)).toBe(false);
    expect(isEmbedHost("https://host.example.evil.test", HOSTS)).toBe(false);
    expect(isEmbedHost("https://x.evilpreview.host.example", HOSTS)).toBe(false);
    expect(isEmbedHost("null", HOSTS)).toBe(false);
    expect(isEmbedHost(null, HOSTS)).toBe(false);
    expect(isEmbedHost("https://host.example", [])).toBe(false);
  });

  it("a fixed port matches only that port", () => {
    expect(sourceMatches("http://localhost:3000", "http://localhost:3000")).toBe(true);
    expect(sourceMatches("http://localhost:3000", "http://localhost:3001")).toBe(false);
  });
});
