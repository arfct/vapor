// @vitest-environment jsdom
/**
 * Tests for suggestion-actions: accept/reject CriticMarkup marks.
 *
 * Uses a real TipTap Editor in jsdom so that editor.chain().focus().command()
 * works correctly.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
  hasSuggestionMarkup,
  isCursorInSuggestion,
  processRangeAtCursor,
  processAllRanges,
} from "~/lib/suggestion-actions";

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

/** Build HTML with critic marks using span classes */
function additionSpan(text: string): string {
  return `<span class="cm-addition">${text}</span>`;
}

function deletionSpan(text: string): string {
  return `<span class="cm-deletion">${text}</span>`;
}

function commentSpan(text: string): string {
  return `<span class="cm-comment">${text}</span>`;
}

/** Get plain text content from editor */
function getText(editor: Editor): string {
  return editor.state.doc.textContent;
}

/** Check if a mark exists at a given position */
function hasMarkAt(editor: Editor, pos: number, markName: string): boolean {
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return false;
  return node.marks.some((m) => m.type.name === markName);
}

/* ---- Tests ---- */

describe("suggestion-actions", () => {
  let editor: Editor;

  afterEach(() => {
    editor?.destroy();
  });

  /* ================================================================ */
  /*  hasSuggestionMarkup                                              */
  /* ================================================================ */

  describe("hasSuggestionMarkup", () => {
    it("returns false for plain text", () => {
      editor = createEditor("<p>hello world</p>");
      expect(hasSuggestionMarkup(editor)).toBe(false);
    });

    it("returns true when addition mark exists", () => {
      editor = createEditor(`<p>hello ${additionSpan("world")}</p>`);
      expect(hasSuggestionMarkup(editor)).toBe(true);
    });

    it("returns true when deletion mark exists", () => {
      editor = createEditor(`<p>hello ${deletionSpan("world")}</p>`);
      expect(hasSuggestionMarkup(editor)).toBe(true);
    });

    it("returns false for comment marks only", () => {
      editor = createEditor(`<p>hello ${commentSpan("comment")}</p>`);
      expect(hasSuggestionMarkup(editor)).toBe(false);
    });
  });

  /* ================================================================ */
  /*  isCursorInSuggestion                                             */
  /* ================================================================ */

  describe("isCursorInSuggestion", () => {
    it("returns false when cursor is in plain text", () => {
      editor = createEditor(`<p>hello ${additionSpan("world")}</p>`);
      // Position cursor at start of "hello" (pos 1)
      editor.commands.setTextSelection(1);
      expect(isCursorInSuggestion(editor)).toBe(false);
    });

    it("returns true when cursor is inside addition", () => {
      editor = createEditor(`<p>hello ${additionSpan("world")}</p>`);
      // "world" starts at pos 7 (after "hello " which is 6 chars + 1 for para start)
      editor.commands.setTextSelection(8);
      expect(isCursorInSuggestion(editor)).toBe(true);
    });

    it("returns true when cursor is inside deletion", () => {
      editor = createEditor(`<p>hello ${deletionSpan("world")}</p>`);
      editor.commands.setTextSelection(8);
      expect(isCursorInSuggestion(editor)).toBe(true);
    });

    it("returns false when cursor is inside comment", () => {
      editor = createEditor(`<p>hello ${commentSpan("note")}</p>`);
      editor.commands.setTextSelection(8);
      expect(isCursorInSuggestion(editor)).toBe(false);
    });
  });

  /* ================================================================ */
  /*  processRangeAtCursor                                             */
  /* ================================================================ */

  describe("processRangeAtCursor", () => {
    describe("addition marks", () => {
      beforeEach(() => {
        // "hello [world] end" where [world] has addition mark
        editor = createEditor(`<p>hello ${additionSpan("world")} end</p>`);
        // Place cursor inside "world"
        editor.commands.setTextSelection(8);
      });

      it("accept: removes mark, keeps text", () => {
        processRangeAtCursor(editor, true);

        expect(getText(editor)).toBe("hello world end");
        // "world" should no longer have the mark
        expect(hasMarkAt(editor, 7, "criticAddition")).toBe(false);
      });

      it("reject: deletes the text", () => {
        processRangeAtCursor(editor, false);

        expect(getText(editor)).toBe("hello  end");
      });
    });

    describe("deletion marks", () => {
      beforeEach(() => {
        // "hello [world] end" where [world] has deletion mark
        editor = createEditor(`<p>hello ${deletionSpan("world")} end</p>`);
        editor.commands.setTextSelection(8);
      });

      it("accept: deletes the text", () => {
        processRangeAtCursor(editor, true);

        expect(getText(editor)).toBe("hello  end");
      });

      it("reject: removes mark, keeps text", () => {
        processRangeAtCursor(editor, false);

        expect(getText(editor)).toBe("hello world end");
        expect(hasMarkAt(editor, 7, "criticDeletion")).toBe(false);
      });
    });

    it("does nothing when cursor is not in a suggestion", () => {
      editor = createEditor("<p>hello world</p>");
      editor.commands.setTextSelection(3);
      processRangeAtCursor(editor, true);
      expect(getText(editor)).toBe("hello world");
    });

    it("handles contiguous addition ranges as one", () => {
      // Two adjacent addition spans that ProseMirror may treat as separate text nodes
      editor = createEditor(
        `<p>start ${additionSpan("aa")}${additionSpan("bb")} end</p>`,
      );
      editor.commands.setTextSelection(8);
      processRangeAtCursor(editor, false);

      // Both "aa" and "bb" should be rejected as one range
      expect(getText(editor)).toBe("start  end");
    });

    describe("replacement pairs (deletion followed by addition)", () => {
      beforeEach(() => {
        // "make it [fast][quick] now": "fast" deleted, "quick" added
        editor = createEditor(`<p>make it ${deletionSpan("fast")}${additionSpan("quick")} now</p>`);
      });

      it("accepting from the deletion applies both halves", () => {
        editor.commands.setTextSelection(10); // inside "fast"
        processRangeAtCursor(editor, true);
        expect(getText(editor)).toBe("make it quick now");
        expect(hasSuggestionMarkup(editor)).toBe(false);
      });

      it("accepting from the addition applies both halves", () => {
        editor.commands.setTextSelection(15); // inside "quick"
        processRangeAtCursor(editor, true);
        expect(getText(editor)).toBe("make it quick now");
        expect(hasSuggestionMarkup(editor)).toBe(false);
      });

      it("rejecting restores the original text and drops the addition", () => {
        editor.commands.setTextSelection(15);
        processRangeAtCursor(editor, false);
        expect(getText(editor)).toBe("make it fast now");
        expect(hasSuggestionMarkup(editor)).toBe(false);
      });

      it("leaves an unconnected suggestion alone", () => {
        editor = createEditor(`<p>${deletionSpan("old")} gap ${additionSpan("new")}</p>`);
        editor.commands.setTextSelection(2);
        processRangeAtCursor(editor, true);
        expect(getText(editor)).toBe(" gap new");
        expect(hasSuggestionMarkup(editor)).toBe(true);
      });
    });
  });

  /* ================================================================ */
  /*  processAllRanges                                                 */
  /* ================================================================ */

  describe("processAllRanges", () => {
    it("accept all: keeps additions, removes deletions", () => {
      editor = createEditor(
        `<p>hello ${additionSpan("new")} ${deletionSpan("old")} end</p>`,
      );

      processAllRanges(editor, true);

      // "new" text kept (mark removed), "old" text deleted
      expect(getText(editor)).toBe("hello new  end");
      expect(hasMarkAt(editor, 7, "criticAddition")).toBe(false);
    });

    it("reject all: removes additions, keeps deletions unmarked", () => {
      editor = createEditor(
        `<p>hello ${additionSpan("new")} ${deletionSpan("old")} end</p>`,
      );

      processAllRanges(editor, false);

      // "new" deleted, "old" kept (mark removed)
      expect(getText(editor)).toBe("hello  old end");
      expect(hasMarkAt(editor, 7, "criticDeletion")).toBe(false);
    });

    it("does nothing when no suggestion marks exist", () => {
      editor = createEditor("<p>plain text</p>");
      processAllRanges(editor, true);
      expect(getText(editor)).toBe("plain text");
    });

    it("handles multiple additions across the document", () => {
      editor = createEditor(
        `<p>${additionSpan("aaa")} middle ${additionSpan("bbb")}</p>`,
      );

      processAllRanges(editor, true);

      expect(getText(editor)).toBe("aaa middle bbb");
      expect(hasMarkAt(editor, 1, "criticAddition")).toBe(false);
    });

    it("handles multiple deletions across the document", () => {
      editor = createEditor(
        `<p>${deletionSpan("aaa")} middle ${deletionSpan("bbb")}</p>`,
      );

      processAllRanges(editor, true);

      // Accept deletions = remove text
      expect(getText(editor)).toBe(" middle ");
    });
  });
});
