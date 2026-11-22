import { describe, it, expect, vi } from "vitest";
import type { Editor } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";
import { filterSlashItems, slashRows, slashAllowed, SLASH_ITEMS } from "~/lib/slash-commands";
import { inCode } from "~/lib/mention-suggestion";
import { parseMarkdown } from "~/shared/rich-markdown";

function stateFor(md: string): EditorState {
  const parsed = parseMarkdown(md);
  if (!parsed.ok) throw new Error(parsed.message);
  return EditorState.create({ doc: parsed.doc });
}

describe("slash items", () => {
  it("shows everything for an empty query, in menu order", () => {
    expect(filterSlashItems("")).toEqual(SLASH_ITEMS);
  });

  it("matches titles, title words, and aliases", () => {
    expect(filterSlashItems("head").map((i) => i.id)).toEqual(["h1", "h2", "h3"]);
    expect(filterSlashItems("h2").map((i) => i.id)).toEqual(["h2"]);
    expect(filterSlashItems("todo").map((i) => i.id)).toEqual(["task"]);
    expect(filterSlashItems("list").map((i) => i.id)).toEqual(["bullet", "numbered", "task"]);
    expect(filterSlashItems("zzz")).toEqual([]);
  });

  it("dims structural rows in suggest mode, as the toolbar refuses them", () => {
    const edit = slashRows("", false);
    expect(edit.every((r) => !r.disabled)).toBe(true);
    const suggest = slashRows("", true);
    expect(suggest.find((r) => r.id === "h1")?.disabled).toBe(true);
    expect(suggest.find((r) => r.id === "comment")?.disabled).toBe(false);
    expect(suggest.find((r) => r.id === "agent")?.disabled).toBe(false);
  });

  it("every icon is one the app subsets", () => {
    for (const item of SLASH_ITEMS) expect(item.icon).toMatch(/^[a-z0-9_]+$/);
  });
});

describe("where popups may open", () => {
  it("slash: paragraphs and headings, not code or table cells", () => {
    const para = stateFor("hello");
    expect(slashAllowed(para, 1)).toBe(true);
    const heading = stateFor("# Title");
    expect(slashAllowed(heading, 1)).toBe(true);
    const code = stateFor("```\nx\n```");
    expect(slashAllowed(code, 1)).toBe(false);
    const table = stateFor("| a | b |\n|---|---|\n| c | d |");
    // Position inside the first cell.
    let cellPos = -1;
    table.doc.descendants((node, pos) => {
      if (cellPos === -1 && (node.type.name === "tableHeader" || node.type.name === "tableCell")) cellPos = pos + 1;
    });
    expect(cellPos).toBeGreaterThan(0);
    expect(slashAllowed(table, cellPos)).toBe(false);
  });

  it("mentions: not inside code blocks or inline code", () => {
    expect(inCode(stateFor("plain text"), 3)).toBe(false);
    expect(inCode(stateFor("```\ncode\n```"), 2)).toBe(true);
    const inline = stateFor("see `x@y` here");
    // Offset of the `x` inside the code span: "see " is 4 chars, paragraph opens at 0.
    expect(inCode(inline, 6)).toBe(true);
    expect(inCode(inline, 2)).toBe(false);
  });
});

describe("slash item commands", () => {
  /** A stand-in editor whose chain() records each command and its args. */
  function recordingEditor() {
    const calls: unknown[][] = [];
    const chain: Record<string, (...args: unknown[]) => unknown> = new Proxy(
      {},
      {
        get: (_t, prop: string) => (...args: unknown[]) => {
          calls.push([prop, ...args]);
          return chain;
        },
      },
    );
    return { editor: { chain: () => chain } as unknown as Editor, calls };
  }

  const expected: Record<string, unknown[]> = {
    paragraph: ["setParagraph"],
    h1: ["setHeading", { level: 1 }],
    h2: ["setHeading", { level: 2 }],
    h3: ["setHeading", { level: 3 }],
    bullet: ["toggleBulletList"],
    numbered: ["toggleOrderedList"],
    task: ["toggleTaskList"],
    quote: ["toggleBlockquote"],
    divider: ["setHorizontalRule"],
    code: ["toggleCodeBlock"],
    table: ["insertTable", { rows: 3, cols: 3, withHeaderRow: true }],
    agent: ["toggleAgentInstructions"],
  };

  for (const [id, command] of Object.entries(expected)) {
    it(`${id} focuses and runs ${command[0]}`, () => {
      const item = SLASH_ITEMS.find((i) => i.id === id)!;
      const { editor, calls } = recordingEditor();
      item.run(editor, {});
      expect(calls).toEqual([["focus"], command, ["run"]]);
    });
  }

  it("comment defers to the layout's action, if any", () => {
    const item = SLASH_ITEMS.find((i) => i.id === "comment")!;
    const { editor, calls } = recordingEditor();
    const comment = vi.fn();
    item.run(editor, { comment });
    expect(comment).toHaveBeenCalledTimes(1);
    expect(() => item.run(editor, {})).not.toThrow();
    expect(calls).toEqual([]);
  });

  it("every item has a tested command", () => {
    expect(SLASH_ITEMS.map((i) => i.id).sort()).toEqual([...Object.keys(expected), "comment"].sort());
  });
});
