// @vitest-environment jsdom
/**
 * Tests for comment scanning, cursor lookup, and resolve/delete actions.
 *
 * Uses a real TipTap Editor in jsdom to test the full comment workflow
 * including paired comments (highlight + comment).
 */
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import {
  CriticAddition,
  CriticDeletion,
  CriticComment,
  CriticHighlight,
} from "~/lib/critic-marks";
import {
  scanDocumentComments,
} from "~/lib/comment-threads";

/* ---- Editor factory ---- */

const extensions = [
  Document,
  Paragraph,
  Text,
  CriticAddition,
  CriticDeletion,
  CriticComment,
  CriticHighlight,
];

function createEditor(html: string): Editor {
  return new Editor({
    extensions,
    content: html,
    immediatelyRender: false,
  });
}

/* ---- Helpers ---- */

function hl(text: string): string {
  return `<span class="cm-highlight">${text}</span>`;
}

function cm(text: string): string {
  return `<span class="cm-comment">${text}</span>`;
}

/* ---- Tests ---- */

describe("scanDocumentComments", () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it("finds a standalone comment", () => {
    editor = createEditor(`<p>text ${cm("my comment")} more</p>`);
    const comments = scanDocumentComments(editor);
    expect(comments).toHaveLength(1);
    expect(comments[0].commentText).toBe("my comment");
    expect(comments[0].highlightText).toBeUndefined();
  });

  it("finds a paired comment (highlight + comment)", () => {
    editor = createEditor(`<p>text ${hl("goodgood")}${cm("Use stronger word?")} more</p>`);
    const comments = scanDocumentComments(editor);
    expect(comments).toHaveLength(1);
    expect(comments[0].commentText).toBe("Use stronger word?");
    expect(comments[0].highlightText).toBe("goodgood");
  });

  it("returns correct positions for paired comment", () => {
    // "text " = 5 chars, highlight "goodgood" = 8 chars, then comment starts
    editor = createEditor(`<p>text ${hl("goodgood")}${cm("note")}</p>`);
    const comments = scanDocumentComments(editor);
    expect(comments).toHaveLength(1);
    // Comment text node starts after "text goodgood" (pos = 1 + 5 + 8 = 14)
    expect(comments[0].position).toBe(14);
    expect(comments[0].endPosition).toBe(18); // 14 + "note".length
  });

  it("finds multiple comments", () => {
    editor = createEditor(
      `<p>${cm("first")} middle ${cm("second")}</p>`,
    );
    const comments = scanDocumentComments(editor);
    expect(comments).toHaveLength(2);
    expect(comments[0].commentText).toBe("first");
    expect(comments[1].commentText).toBe("second");
  });
});

