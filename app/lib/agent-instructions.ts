import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin, type Transaction } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";

const STAMP_META = "agentInstructionsStamp";

/** Whether a transaction came in over Yjs (another client's edit) rather than from this editor. */
function isRemote(tr: Transaction): boolean {
  // The y-sync plugin tags its transactions under its own PluginKey; the
  // key's name is stable even when the module instance is not.
  const meta = (tr as unknown as { meta?: Record<string, unknown> }).meta ?? {};
  return Object.keys(meta).some((k) => k.startsWith("y-sync"));
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    agentInstructions: {
      /** Turn the current block into an agent-instructions block. */
      setAgentInstructions: () => ReturnType;
      /** Toggle the current block between agent instructions and a paragraph. */
      toggleAgentInstructions: () => ReturnType;
      /** Who local edits to instruction blocks are attributed to. */
      setInstructionsAuthor: (name: string | null) => ReturnType;
    };
  }
}

export interface AgentInstructionsStorage {
  /** Display name stamped onto an instructions block this client edits; read at edit time. */
  author: string | null;
  /** Injectable clock, for tests. */
  now: () => string;
}

/**
 * A block addressed to agents rather than readers: standing per-document
 * instructions ("keep suggestions short", "don't touch Pricing"). Humans
 * see a visually distinct, editable panel; `read_document` returns the
 * text as a separate `instructions` field. Serializes as a fenced block
 * with the `agent` info string (see rich-markdown.ts), so it survives
 * every markdown tool as an ordinary code fence.
 *
 * Because the block steers agents and anyone with the link can edit it,
 * every local edit stamps who made it and when (`editedBy`, `editedAt`),
 * which the fence info carries and `read_document` reports (#82).
 */
export const AgentInstructions = Node.create<{ author?: string | null }, AgentInstructionsStorage>({
  name: "agentInstructions",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  isolating: true,

  addOptions() {
    return { author: null };
  },

  addStorage() {
    return { author: this.options.author ?? null, now: () => new Date().toISOString() };
  },

  addAttributes() {
    return {
      blockId: { default: null },
      editedBy: { default: null, renderHTML: (attrs) => (attrs.editedBy ? { "data-edited-by": attrs.editedBy } : {}) },
      editedAt: { default: null, renderHTML: (attrs) => (attrs.editedAt ? { "data-edited-at": attrs.editedAt } : {}) },
    };
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

  addProseMirrorPlugins() {
    const storage = this.storage;
    const name = this.name;
    return [
      new Plugin({
        // After a local transaction, any instructions block whose text
        // differs from the block that stood at its position before gets the
        // current author and time. Remote (Yjs) transactions carry their
        // own authors' stamps, and the stamping transaction itself is
        // skipped, so this never loops.
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          if (transactions.some((tr) => tr.getMeta(STAMP_META) || isRemote(tr))) return null;
          const mapping = new Mapping();
          for (const tr of transactions) mapping.appendMapping(tr.mapping);
          const back = mapping.invert();
          const tr = newState.tr;
          let stamped = false;
          newState.doc.forEach((node, pos) => {
            if (node.type.name !== name) return;
            const oldPos = back.map(pos, 1);
            const previous = oldState.doc.nodeAt(oldPos);
            if (previous?.type.name === name && previous.textContent === node.textContent) return;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, editedBy: storage.author, editedAt: storage.now() });
            stamped = true;
          });
          // Not flagged addToHistory: false — see BlockId for why an appended
          // transaction must not carry that flag in this editor.
          return stamped ? tr.setMeta(STAMP_META, true) : null;
        },
      }),
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
      setInstructionsAuthor: (name) => () => {
        this.storage.author = name;
        return true;
      },
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
