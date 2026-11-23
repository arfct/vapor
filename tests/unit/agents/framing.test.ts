import { describe, it, expect } from "vitest";
import {
  NEVER_FRAMED,
  SESSION_UPGRADED,
  crossSiteWrite,
  framedResponse,
  guardCrossSiteWrite,
  sessionSameSite,
  sessionUpgrade,
  withoutSessionCookie,
} from "../../../workers/framing";
import { sessionCookieHeader, clearSessionCookieHeader } from "~/lib/auth.server";

const URL_ = "https://vapor.example/abcd1234";
const req = (method: string, headers: Record<string, string> = {}, url = URL_) =>
  new Request(url, { method, headers, body: method === "GET" || method === "HEAD" ? undefined : "x" });

describe("crossSiteWrite", () => {
  it("lets reads through whoever sends them", () => {
    for (const m of ["GET", "HEAD", "OPTIONS"]) expect(crossSiteWrite(req(m, { "sec-fetch-site": "cross-site" }))).toBe(false);
  });

  it("catches cross-site and same-site writes by Sec-Fetch-Site", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(crossSiteWrite(req(m, { "sec-fetch-site": "cross-site" }))).toBe(true);
      expect(crossSiteWrite(req(m, { "sec-fetch-site": "same-site" }))).toBe(true);
    }
  });

  it("passes same-origin writes, including a framed page's own, and user-initiated ones", () => {
    expect(crossSiteWrite(req("POST", { "sec-fetch-site": "same-origin", origin: "https://vapor.example" }))).toBe(false);
    expect(crossSiteWrite(req("POST", { "sec-fetch-site": "none" }))).toBe(false);
  });

  it("falls back to Origin without Sec-Fetch-Site", () => {
    expect(crossSiteWrite(req("POST", { origin: "https://evil.example" }))).toBe(true);
    expect(crossSiteWrite(req("POST", { origin: "null" }))).toBe(true);
    expect(crossSiteWrite(req("POST", { origin: "https://vapor.example" }))).toBe(false);
  });

  it("passes header-less writes (MCP clients, agents, servers)", () => {
    expect(crossSiteWrite(req("POST", { authorization: "Bearer x" }))).toBe(false);
  });
});

describe("withoutSessionCookie / guardCrossSiteWrite", () => {
  it("drops the session and its marker, keeps other cookies", () => {
    const out = withoutSessionCookie(req("POST", { cookie: `a=1; vp_session=tok; ${SESSION_UPGRADED}=1; b=2` }));
    expect(out.headers.get("cookie")).toBe("a=1; b=2");
  });

  it("removes the header when nothing is left, and returns the request as is when nothing matched", () => {
    expect(withoutSessionCookie(req("POST", { cookie: "vp_session=tok" })).headers.get("cookie")).toBeNull();
    const plain = req("POST", { cookie: "a=1" });
    expect(withoutSessionCookie(plain)).toBe(plain);
  });

  it("signs out a cross-site consent POST but not the same-origin form", async () => {
    const forged = guardCrossSiteWrite(req("POST", { "sec-fetch-site": "cross-site", cookie: "vp_session=tok" }, "https://vapor.example/oauth/authorize"));
    expect(forged.headers.get("cookie")).toBeNull();
    expect(await forged.text()).toBe("x");
    const own = req("POST", { "sec-fetch-site": "same-origin", cookie: "vp_session=tok" }, "https://vapor.example/oauth/authorize");
    expect(guardCrossSiteWrite(own)).toBe(own);
  });
});

describe("the session cookie's SameSite", () => {
  it("is None only over https on an instance with embedding hosts", () => {
    expect(sessionSameSite(true, true)).toBe("None");
    expect(sessionSameSite(true, false)).toBe("Lax");
    expect(sessionSameSite(false, true)).toBe("Lax");
  });

  it("never writes None without Secure", () => {
    expect(sessionCookieHeader("t", 60, true, "None")).toBe("vp_session=t; Max-Age=60; Path=/; HttpOnly; SameSite=None; Secure");
    expect(sessionCookieHeader("t", 60, false, "None")).toBe("vp_session=t; Max-Age=60; Path=/; HttpOnly; SameSite=Lax");
    expect(clearSessionCookieHeader(true, "None")).toContain("Max-Age=0");
  });
});

describe("sessionUpgrade", () => {
  const load = (headers: Record<string, string>, url = URL_) =>
    req("GET", { "sec-fetch-dest": "document", "sec-fetch-site": "none", ...headers }, url);

  it("re-sets an old session as None, with the marker, on a first-party page load", () => {
    const set = sessionUpgrade(load({ cookie: "vp_session=tok" }), 100, true);
    expect(set).toEqual([
      "vp_session=tok; Max-Age=100; Path=/; HttpOnly; SameSite=None; Secure",
      `${SESSION_UPGRADED}=1; Max-Age=100; Path=/; HttpOnly; SameSite=None; Secure`,
    ]);
    expect(sessionUpgrade(load({ cookie: "vp_session=tok", "sec-fetch-site": "same-origin" }), 100, true)).not.toBeNull();
  });

  it("runs once, and only where it applies", () => {
    expect(sessionUpgrade(load({ cookie: `vp_session=tok; ${SESSION_UPGRADED}=1` }), 100, true)).toBeNull();
    expect(sessionUpgrade(load({}), 100, true)).toBeNull();
    expect(sessionUpgrade(load({ cookie: "vp_session=tok" }), 100, false)).toBeNull();
    expect(sessionUpgrade(load({ cookie: "vp_session=tok" }, "http://localhost:5173/"), 100, true)).toBeNull();
    expect(sessionUpgrade(load({ cookie: "vp_session=tok", "sec-fetch-site": "cross-site" }), 100, true)).toBeNull();
    expect(sessionUpgrade(load({ cookie: "vp_session=tok", "sec-fetch-dest": "iframe" }), 100, true)).toBeNull();
    expect(sessionUpgrade(req("POST", { cookie: "vp_session=tok", "sec-fetch-dest": "document" }), 100, true)).toBeNull();
  });
});

describe("framedResponse", () => {
  const html = () => new Response("<p>hi</p>", { headers: { "Content-Type": "text/html; charset=utf-8" } });

  it("adds frame-ancestors to HTML when hosts are named, and no X-Frame-Options", () => {
    const out = framedResponse(html(), ["https://host.example"]);
    expect(out.headers.get("content-security-policy")).toBe("frame-ancestors 'self' https://host.example");
    expect(out.headers.get("x-frame-options")).toBeNull();
  });

  it("leaves everything as it was with no hosts", () => {
    const res = html();
    expect(framedResponse(res, [])).toBe(res);
  });

  it("leaves non-HTML and a response's own CSP alone", () => {
    const json = Response.json({ a: 1 });
    expect(framedResponse(json, ["https://host.example"])).toBe(json);
    const own = new Response("x", { headers: { "Content-Type": "text/html", "Content-Security-Policy": NEVER_FRAMED } });
    expect(framedResponse(own, ["https://host.example"]).headers.get("content-security-policy")).toBe(NEVER_FRAMED);
  });

  it("appends the upgrade cookies to the page", async () => {
    const out = framedResponse(html(), ["https://host.example"], ["a=1", "b=2"]);
    expect(out.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    expect(await out.text()).toBe("<p>hi</p>");
  });
});
