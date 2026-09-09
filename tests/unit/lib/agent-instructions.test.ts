// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { AgentInstructions } from "~/lib/agent-instructions";

function makeEditor(author: string | null) {
  const editor = new Editor({
    extensions: [StarterKit.configure({ undoRedo: false }), AgentInstructions.configure({ author })],
    content: "<p>Body</p>",
  });
  editor.storage.agentInstructions.now = () => "2026-09-09T20:01:00.000Z";
  return editor;
}

function instructionNodes(editor: Editor) {
  const out: { text: string; editedBy: string | null; editedAt: string | null }[] = [];
  editor.state.doc.forEach((node) => {
    if (node.type.name === "agentInstructions") {
      out.push({ text: node.textContent, editedBy: node.attrs.editedBy, editedAt: node.attrs.editedAt });
    }
  });
  return out;
}

describe("AgentInstructions attribution (#82)", () => {
  it("stamps a locally edited block with the author and time", () => {
    const editor = makeEditor("Ada Lovelace");
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: "agentInstructions",
      content: [{ type: "text", text: "Keep it short." }],
    });
    expect(instructionNodes(editor)).toEqual([
      { text: "Keep it short.", editedBy: "Ada Lovelace", editedAt: "2026-09-09T20:01:00.000Z" },
    ]);

    // A later edit by someone else renames the stamp; an untouched block keeps its own.
    editor.commands.setInstructionsAuthor("Grace Hopper");
    editor.storage.agentInstructions.now = () => "2026-09-10T08:00:00.000Z";
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: "agentInstructions",
      content: [{ type: "text", text: "Suggest, don't edit." }],
    });
    expect(instructionNodes(editor)).toEqual([
      { text: "Keep it short.", editedBy: "Ada Lovelace", editedAt: "2026-09-09T20:01:00.000Z" },
      { text: "Suggest, don't edit.", editedBy: "Grace Hopper", editedAt: "2026-09-10T08:00:00.000Z" },
    ]);
    editor.destroy();
  });

  it("leaves a remote (Yjs) transaction's blocks alone: they carry their own author's stamp", () => {
    const editor = makeEditor("Ada Lovelace");
    const node = editor.schema.nodes.agentInstructions.create(
      { editedBy: "Remote Rex", editedAt: "2026-09-01T00:00:00.000Z" },
      editor.schema.text("From elsewhere."),
    );
    const tr = editor.state.tr.insert(editor.state.doc.content.size, node).setMeta(ySyncPluginKey, { isChangeOrigin: true });
    editor.view.dispatch(tr);
    expect(instructionNodes(editor)).toEqual([
      { text: "From elsewhere.", editedBy: "Remote Rex", editedAt: "2026-09-01T00:00:00.000Z" },
    ]);
    editor.destroy();
  });

  it("renders the stamp as data attributes on the panel", () => {
    const editor = makeEditor("Ada Lovelace");
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: "agentInstructions",
      content: [{ type: "text", text: "Keep it short." }],
    });
    expect(editor.getHTML()).toContain('data-edited-by="Ada Lovelace"');
    editor.destroy();
  });
});
