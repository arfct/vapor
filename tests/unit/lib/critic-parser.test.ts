import { describe, it, expect } from "vitest";
import {
  parseCriticMarkupToContent,
  tryParseCriticMarkup,
  UNSUPPORTED_SUBSTITUTION_MESSAGE,
} from "~/lib/critic-parser";

describe("parseCriticMarkupToContent", () => {
  it("parses addition", () => {
    const result = parseCriticMarkupToContent("hello {++world++}");
    expect(result.cleanText).toBe("hello world");
    expect(result.marks).toEqual([
      { from: 6, to: 11, type: "criticAddition" },
    ]);
  });

  it("parses deletion", () => {
    const result = parseCriticMarkupToContent("{--removed--} text");
    expect(result.cleanText).toBe("removed text");
    expect(result.marks).toEqual([
      { from: 0, to: 7, type: "criticDeletion" },
    ]);
  });

  it("parses comment", () => {
    const result = parseCriticMarkupToContent("{>>a note<<}");
    expect(result.cleanText).toBe("a note");
    expect(result.marks).toEqual([
      { from: 0, to: 6, type: "criticComment" },
    ]);
  });

  it("parses highlight", () => {
    const result = parseCriticMarkupToContent("{==important==}");
    expect(result.cleanText).toBe("important");
    expect(result.marks).toEqual([
      { from: 0, to: 9, type: "criticHighlight" },
    ]);
  });

  it("parses multiple ranges", () => {
    const result = parseCriticMarkupToContent("hello {++new++} and {--old--}");
    expect(result.cleanText).toBe("hello new and old");
    expect(result.marks).toHaveLength(2);
    expect(result.marks[0].type).toBe("criticAddition");
    expect(result.marks[1].type).toBe("criticDeletion");
  });

  it("handles plain text without CriticMarkup", () => {
    const result = parseCriticMarkupToContent("plain text");
    expect(result.cleanText).toBe("plain text");
    expect(result.marks).toEqual([]);
  });

  it("throws on substitution", () => {
    expect(() =>
      parseCriticMarkupToContent("{~~old~>new~~}"),
    ).toThrow("Unsupported CriticMarkup: substitution");
  });

  it("preserves positions correctly with adjacent marks", () => {
    const result = parseCriticMarkupToContent("{--old--}{++new++}");
    expect(result.cleanText).toBe("oldnew");
    expect(result.marks).toEqual([
      { from: 0, to: 3, type: "criticDeletion" },
      { from: 3, to: 6, type: "criticAddition" },
    ]);
  });

  it("parses paired highlight + comment", () => {
    const result = parseCriticMarkupToContent(
      "{==goodgood==}{>>Should we use a stronger word here?<<}",
    );
    expect(result.cleanText).toBe(
      "goodgoodShould we use a stronger word here?",
    );
    expect(result.marks).toEqual([
      { from: 0, to: 8, type: "criticHighlight" },
      { from: 8, to: 43, type: "criticComment" },
    ]);
  });

  it("parses paired highlight + comment with surrounding text", () => {
    const result = parseCriticMarkupToContent(
      "text {==goodgood==}{>>comment<<} more",
    );
    expect(result.cleanText).toBe("text goodgoodcomment more");
    expect(result.marks).toEqual([
      { from: 5, to: 13, type: "criticHighlight" },
      { from: 13, to: 20, type: "criticComment" },
    ]);
  });

  it("does not duplicate highlight when paired with comment", () => {
    const result = parseCriticMarkupToContent(
      "{==highlighted==}{>>note<<}",
    );
    // Should be exactly 2 marks (highlight + comment), not 3
    expect(result.marks).toHaveLength(2);
    expect(result.marks[0].type).toBe("criticHighlight");
    expect(result.marks[1].type).toBe("criticComment");
  });
});

describe("tryParseCriticMarkup", () => {
  it("returns the parse as a result value on success", () => {
    const result = tryParseCriticMarkup("hello {++world++}");
    expect(result).toEqual({
      ok: true,
      cleanText: "hello world",
      marks: [{ from: 6, to: 11, type: "criticAddition" }],
    });
  });

  it("returns an error result for substitution instead of throwing", () => {
    const result = tryParseCriticMarkup("{~~old~>new~~}");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toBe(UNSUPPORTED_SUBSTITUTION_MESSAGE);
    expect(UNSUPPORTED_SUBSTITUTION_MESSAGE).toContain("Unsupported CriticMarkup: substitution");
  });
});
