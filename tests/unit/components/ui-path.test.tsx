// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import UiPath from "~/components/UiPath";

describe("UiPath", () => {
  it("is plain bold text when there is no screen to link to", () => {
    const { container } = render(createElement(UiPath, {}, "Settings → MCP"));
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("strong")!.textContent).toBe("Settings → MCP");
  });

  it("links out without an underline, and the pop-out takes the text's size and colour", () => {
    const { container } = render(createElement(UiPath, { href: "https://x.example" }, "Settings → Connectors"));
    const link = container.querySelector("a")!;
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
    expect(link.className).not.toContain("underline");
    const mark = container.querySelector(".material-symbols-outlined")!;
    expect(mark.textContent).toBe("open_in_new");
    // icon-inline is the 1em rule; text-muted would grey it against the sentence.
    expect(mark.className).toContain("icon-inline");
    expect(mark.className).not.toContain("text-muted");
    expect(mark.className).not.toMatch(/text-\[\d/);
  });
});
