import { describe, it, expect } from "vitest";
import {
  EMBED_MESSAGE_TYPE,
  LIMITS,
  documentContext,
  embedItems,
  embedMessage,
  embedTarget,
  isEmbeddedWebView,
  oneLine,
  plainText,
  type Placement,
} from "~/lib/embed-context";

const HOSTS = ["https://host.example", "https://*.preview.host.example", "http://localhost:*"];
const SELF = "https://vapor.example";

const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const IOS_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IOS_WEBVIEW = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const ANDROID_WEBVIEW = "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0 Mobile Safari/537.36";

const placed = (p: Partial<Placement>): Placement => ({
  framed: true,
  ancestor: null,
  referrer: "",
  remembered: null,
  self: SELF,
  userAgent: CHROME,
  hosts: HOSTS,
  ...p,
});

describe("oneLine", () => {
  it("flattens breaks, tabs and control characters and collapses runs", () => {
    expect(oneLine("  A\n\tplan\u0007  for\u2028 Q3  ")).toBe("A plan for Q3");
  });

  it("caps at the limit on a code point", () => {
    expect(oneLine("x".repeat(500))).toHaveLength(LIMITS.title);
    const emoji = "😀".repeat(201);
    expect(Array.from(oneLine(emoji))).toHaveLength(200);
    expect(oneLine(emoji).endsWith("\ud83d")).toBe(false);
  });

  it("is empty for non-strings", () => {
    expect(oneLine(undefined)).toBe("");
    expect(oneLine(42)).toBe("");
  });
});

describe("plainText", () => {
  it("keeps line breaks and tabs, drops other control characters, caps at 2,000", () => {
    expect(plainText("one\r\ntwo\tthree\u0000")).toBe("one\ntwo\tthree");
    expect(plainText("y".repeat(3000))).toHaveLength(LIMITS.selection);
  });

  it("is empty when blank", () => {
    expect(plainText("  \n ")).toBe("");
  });
});

describe("embedItems", () => {
  it("drops items with bad tokens rather than mangling them, and repeats", () => {
    expect(
      embedItems([
        { id: "abcd1234", type: "document", name: "A\nplan" },
        { id: "abcd1234", type: "document", name: "again" },
        { id: "has space", type: "document" },
        { id: "t-1a2b", type: "thread type" },
        { id: "x".repeat(101), type: "document" },
        { id: "t-1a2b", type: "thread", name: "" },
      ]),
    ).toEqual([
      { id: "abcd1234", type: "document", name: "A plan" },
      { id: "t-1a2b", type: "thread" },
    ]);
  });

  it("keeps at most 20", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `d${i}`, type: "document" }));
    expect(embedItems(many)).toHaveLength(LIMITS.items);
  });
});

describe("embedMessage", () => {
  it("carries the url and leaves out what is empty", () => {
    expect(embedMessage(`${SELF}/abcd1234`, null, "")).toEqual({ type: EMBED_MESSAGE_TYPE, url: `${SELF}/abcd1234` });
  });

  it("includes title, selection and items, sanitized", () => {
    const msg = embedMessage(`${SELF}/a-plan-abcd1234`, documentContext({ id: "abcd1234", title: "A plan" }), "the text");
    expect(msg).toEqual({
      type: "embed:context",
      url: `${SELF}/a-plan-abcd1234`,
      title: "A plan",
      selection: "the text",
      items: [{ id: "abcd1234", type: "document", name: "A plan" }],
    });
  });
});

describe("documentContext", () => {
  it("names the document by the id doc_id takes, then the open thread by the id thread_id takes", () => {
    expect(documentContext({ id: "abcd1234", title: "Plan" }, { id: "t-9f8e", commentText: "Is this\nright?" })).toEqual({
      title: "Plan",
      items: [
        { id: "abcd1234", type: "document", name: "Plan" },
        { id: "t-9f8e", type: "thread", name: "Is this\nright?" },
      ],
    });
  });

  it("calls an untitled document Untitled", () => {
    expect(documentContext({ id: "abcd1234", title: null }).title).toBe("Untitled");
  });
});

describe("isEmbeddedWebView", () => {
  it("knows app WebViews from browsers", () => {
    expect(isEmbeddedWebView(ANDROID_WEBVIEW)).toBe(true);
    expect(isEmbeddedWebView(IOS_WEBVIEW)).toBe(true);
    expect(isEmbeddedWebView(IOS_SAFARI)).toBe(false);
    expect(isEmbeddedWebView(CHROME)).toBe(false);
  });
});

describe("embedTarget", () => {
  it("posts to the framing host found by ancestorOrigins, then referrer, then the remembered one", () => {
    expect(embedTarget(placed({ ancestor: "https://host.example" }))).toBe("https://host.example");
    expect(embedTarget(placed({ referrer: "https://pr-3.preview.host.example/chat?x=1" }))).toBe("https://pr-3.preview.host.example");
    expect(embedTarget(placed({ referrer: `${SELF}/abcd1234`, remembered: "http://localhost:3000" }))).toBe("http://localhost:3000");
  });

  it("stays quiet in a frame that is not an embedding host", () => {
    expect(embedTarget(placed({ ancestor: "https://evil.example" }))).toBeNull();
    expect(embedTarget(placed({ referrer: "https://evil.example/" }))).toBeNull();
    expect(embedTarget(placed({}))).toBeNull();
  });

  it("does not trust the remembered host over a foreign ancestor", () => {
    expect(embedTarget(placed({ ancestor: "https://evil.example", remembered: "https://host.example" }))).toBeNull();
  });

  it("posts nothing from a normal browser tab, and to itself in an app's WebView", () => {
    expect(embedTarget(placed({ framed: false }))).toBeNull();
    expect(embedTarget(placed({ framed: false, userAgent: IOS_SAFARI }))).toBeNull();
    expect(embedTarget(placed({ framed: false, userAgent: ANDROID_WEBVIEW }))).toBe(SELF);
  });

  it("never posts on an instance with no hosts", () => {
    expect(embedTarget(placed({ hosts: [], ancestor: "https://host.example" }))).toBeNull();
    expect(embedTarget(placed({ hosts: [], framed: false, userAgent: ANDROID_WEBVIEW }))).toBeNull();
  });
});
