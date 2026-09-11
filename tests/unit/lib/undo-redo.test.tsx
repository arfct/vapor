// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import { BlockId } from "~/lib/block-id";
import { KeyboardShortcuts } from "~/lib/keyboard-shortcuts";
import { AgentInstructions } from "~/lib/agent-instructions";
import { UndoRedo } from "~/lib/undo-redo";

const settle = () => new Promise((r) => setTimeout(r, 600)); // past the UndoManager's capture window

function makeEditor(ydoc = new Y.Doc()) {
  return new Editor({
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      BlockId,
      AgentInstructions.configure({ author: "Ada" }),
      Collaboration.configure({ document: ydoc }),
      UndoRedo,
      KeyboardShortcuts.configure({ docState: null }),
    ],
  });
}

describe("undo and redo through the collaboration history", () => {
  it("undoes and redoes an edit that created a block (the case BlockId's appended transaction used to exclude)", async () => {
    const editor = makeEditor();
    editor.commands.insertContent("<p>Hello</p>");
    await settle();
    editor.commands.insertContentAt(editor.state.doc.content.size, "<p>World</p>");
    expect(editor.getText()).toBe("Hello\n\nWorld");

    expect(editor.can().undo()).toBe(true);
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getText()).toBe("Hello");
    expect(editor.can().redo()).toBe(true);
    expect(editor.commands.redo()).toBe(true);
    expect(editor.getText()).toBe("Hello\n\nWorld");
    editor.destroy();
  });

  it("answers the hotkeys: ⌘Z undoes, ⇧⌘Z and ⌘Y redo", async () => {
    const editor = makeEditor();
    editor.commands.insertContent("<p>Hello</p>");
    await settle();
    editor.commands.insertContentAt(editor.state.doc.content.size, "<p>World</p>");
    const key = (init: KeyboardEventInit) =>
      editor.view.someProp("handleKeyDown", (f) => f(editor.view, new KeyboardEvent("keydown", { bubbles: true, ...init })));

    expect(key({ key: "z", ctrlKey: true })).toBe(true);
    expect(editor.getText()).toBe("Hello");
    expect(key({ key: "z", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(editor.getText()).toBe("Hello\n\nWorld");
    expect(key({ key: "z", ctrlKey: true })).toBe(true);
    expect(key({ key: "y", ctrlKey: true })).toBe(true);
    expect(editor.getText()).toBe("Hello\n\nWorld");
    editor.destroy();
  });

  it("undoes only this client's edits, never a collaborator's", async () => {
    const ydoc = new Y.Doc();
    const editor = makeEditor(ydoc);
    editor.commands.insertContent("<p>Mine</p>");
    await settle();

    // A collaborator's edit arrives as a Yjs update from another doc.
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(ydoc));
    const otherEditor = makeEditor(other);
    otherEditor.commands.insertContentAt(otherEditor.state.doc.content.size, "<p>Theirs</p>");
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(other), "remote");
    expect(editor.getText()).toBe("Mine\n\nTheirs");

    expect(editor.commands.undo()).toBe(true);
    expect(editor.getText()).toBe("Theirs");
    expect(editor.can().undo()).toBe(false);
    editor.destroy();
    otherEditor.destroy();
  });

  it("an edit to a standing-instructions block, which stamps attribution, is still undoable as one step", async () => {
    const editor = makeEditor();
    editor.commands.insertContent("<p>Hello</p>");
    await settle();
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: "agentInstructions",
      content: [{ type: "text", text: "Keep it short." }],
    });
    expect(editor.getText()).toContain("Keep it short.");
    expect(editor.commands.undo()).toBe(true);
    expect(editor.getText()).toBe("Hello");
    editor.destroy();
  });
});
