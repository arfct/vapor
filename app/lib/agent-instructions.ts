import { Node, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    agentInstructions: {
      /** Turn the current block into an agent-instructions block. */
      setAgentInstructions: () => ReturnType;
      /** Toggle the current block between agent instructions and a paragraph. */
      toggleAgentInstructions: () => ReturnType;
    };
  }
}

/**
 * A block addressed to agents rather than readers: standing per-document
 * instructions ("keep suggestions short", "don't touch Pricing"). Humans
 * see a visually distinct, editable panel; `read_document` returns the
 * text as a separate `instructions` field. Serializes as a fenced block
 * with the `agent` info string (see rich-markdown.ts), so it survives
 * every markdown tool as an ordinary code fence.
 */
export const AgentInstructions = Node.create({
  name: "agentInstructions",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  isolating: true,

  addAttributes() {
    return { blockId: { default: null } };
  },

  parseHTML() {
    return [{ tag: "div[data-agent-instructions]", preserveWhitespace: "full" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-agent-instructions": "", class: "agent-instructions" }),
      0,
    ];
  },

  addCommands() {
    return {
      setAgentInstructions:
        () =>
        ({ commands }) =>
          commands.setNode(this.name),
      toggleAgentInstructions:
        () =>
        ({ commands }) =>
          commands.toggleNode(this.name, "paragraph"),
    };
  },

  addKeyboardShortcuts() {
    return {
      // Enter stays inside the block (it's plain text, like a code block);
      // an empty block backspaces back to a paragraph.
      Enter: ({ editor }) => {
        if (!editor.isActive(this.name)) return false;
        return editor.commands.insertContent("\n");
      },
      Backspace: ({ editor }) => {
        if (!editor.isActive(this.name)) return false;
        const { $from, empty } = editor.state.selection;
        if (!empty || $from.parent.textContent.length > 0) return false;
        return editor.commands.setNode("paragraph");
      },
    };
  },
});
