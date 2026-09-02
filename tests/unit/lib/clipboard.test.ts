// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { copyText } from "~/lib/clipboard";

function mockClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

function removeClipboard() {
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
}

describe("copyText", () => {
  afterEach(() => {
    removeClipboard();
    vi.restoreAllMocks();
  });

  it("uses the clipboard API when available", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    mockClipboard(writeText);
    expect(await copyText("hello")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when the clipboard API is missing", async () => {
    removeClipboard();
    const execCommand = vi.fn(() => true);
    document.execCommand = execCommand;
    expect(await copyText("fallback")).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("falls back to execCommand when the clipboard API rejects", async () => {
    mockClipboard(() => Promise.reject(new Error("denied")));
    const execCommand = vi.fn(() => true);
    document.execCommand = execCommand;
    expect(await copyText("denied")).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("returns false when both paths fail", async () => {
    removeClipboard();
    document.execCommand = vi.fn(() => false);
    expect(await copyText("nope")).toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("returns false when execCommand throws", async () => {
    removeClipboard();
    document.execCommand = vi.fn(() => {
      throw new Error("unsupported");
    });
    expect(await copyText("nope")).toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });
});
