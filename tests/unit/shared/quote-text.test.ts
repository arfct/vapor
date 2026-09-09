import { describe, it, expect } from "vitest";
import { stripInlineMarkdown } from "~/shared/quote-text";

describe("stripInlineMarkdown", () => {
  it("removes the inline syntax a quote copied from block markdown carries", () => {
    expect(stripInlineMarkdown("a `list_documents` for the signed-in identity")).toBe("a list_documents for the signed-in identity");
    expect(stripInlineMarkdown("**Stale registration vs. ephemeral port.**")).toBe("Stale registration vs. ephemeral port.");
    expect(stripInlineMarkdown("bound a *new* ephemeral port")).toBe("bound a new ephemeral port");
    expect(stripInlineMarkdown("see [the plan](docs/plan.md) and ![alt](x.png)")).toBe("see the plan and alt");
    expect(stripInlineMarkdown("~~gone~~ and __also__ this")).toBe("gone and also this");
    expect(stripInlineMarkdown("\\[JW: take with a grain of salt\\]")).toBe("[JW: take with a grain of salt]");
  });

  it("leaves plain text, underscores inside words, and lone asterisks alone", () => {
    expect(stripInlineMarkdown("Hello there.")).toBe("Hello there.");
    expect(stripInlineMarkdown("snake_case_name stays")).toBe("snake_case_name stays");
    expect(stripInlineMarkdown("2 * 3 = 6")).toBe("2 * 3 = 6");
  });
});
