// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { parseDialog, parseThreadParam, readParam, replaceUrl, setParam, withParam } from "~/lib/view-url";
import { opensOutside, signInUrl } from "~/lib/framed";

afterEach(() => window.history.replaceState(null, "", "/"));

describe("view parameters", () => {
  it("parses the dialogs a URL can open; History and Send only on a document", () => {
    expect(parseDialog("history", true)).toBe("history");
    expect(parseDialog("history", false)).toBeNull();
    expect(parseDialog("send", false)).toBeNull();
    expect(parseDialog("invite", false)).toBe("invite");
    expect(parseDialog("nope", true)).toBeNull();
    expect(parseDialog(null, true)).toBeNull();
  });

  it("accepts thread ids as tokens only", () => {
    expect(parseThreadParam("t-1a2b3c")).toBe("t-1a2b3c");
    expect(parseThreadParam("<script>")).toBeNull();
    expect(parseThreadParam("")).toBeNull();
  });

  it("sets and drops one parameter, keeping the rest", () => {
    expect(withParam("", "dialog", "history")).toBe("?dialog=history");
    expect(withParam("?view=markdown&dialog=send", "dialog", null)).toBe("?view=markdown");
    expect(withParam("?dialog=send", "dialog", null)).toBe("");
  });

  it("rewrites the address in place, keeping history state and the path", () => {
    window.history.replaceState({ key: "k" }, "", "/a-plan-abcd1234#h");
    const length = window.history.length;
    setParam("thread", "t-1");
    expect(window.location.pathname + window.location.search + window.location.hash).toBe("/a-plan-abcd1234?thread=t-1#h");
    expect(window.history.state).toEqual({ key: "k" });
    expect(window.history.length).toBe(length);
    expect(readParam("thread")).toBe("t-1");
    replaceUrl("/b-abcd1234?thread=t-1#h");
    expect(window.location.pathname).toBe("/b-abcd1234");
  });
});

describe("inside a frame", () => {
  it("opens other sites in a new tab, not this one's pages", () => {
    const self = "https://vapor.example";
    expect(opensOutside(new URL("https://elsewhere.example/x"), self)).toBe(true);
    expect(opensOutside(new URL("https://vapor.example/abcd1234"), self)).toBe(false);
    expect(opensOutside(new URL("mailto:a@b.c"), self)).toBe(false);
  });

  it("sends sign-in to this page with the Sign in dialog open", () => {
    expect(signInUrl({ pathname: "/a-plan-abcd1234", search: "?thread=t-1&view=markdown" })).toBe(
      "/a-plan-abcd1234?view=markdown&dialog=signin",
    );
  });
});
