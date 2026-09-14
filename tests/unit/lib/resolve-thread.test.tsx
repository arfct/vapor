// @vitest-environment jsdom
/**
 * Resolving a thread defocuses it, so the card leaves the rail and the sheet
 * instead of sitting there until something else is clicked (#111).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import * as Y from "yjs";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { CriticAddition, CriticDeletion, CriticComment, CriticHighlight } from "~/lib/critic-marks";
import { useThreads } from "~/lib/useThreads";

const user = { id: "u-jon", name: "Jon Wiley", color: "#BA68C8", colorLight: "#E1BEE7" };

function setup(comments: string[]) {
  vi.useFakeTimers();
  const doc = new Y.Doc();
  const editor = new Editor({
    extensions: [StarterKit.configure({ undoRedo: false }), CriticAddition, CriticDeletion, CriticComment, CriticHighlight],
    content: "<p>Hello there</p>",
  });
  const hook = renderHook(() => useThreads({ doc, editor, user }));
  for (const text of comments) {
    act(() => {
      editor
        .chain()
        .command(({ tr }) => {
          tr.insertText(text, 6);
          tr.addMark(6, 6 + text.length, editor.schema.marks.criticComment.create());
          return true;
        })
        .run();
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
  }
  return { editor, ...hook };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveThread (#111)", () => {
  it("defocuses the thread it resolves", () => {
    const { result, editor } = setup(["needs work"]);
    const id = result.current.threads[0].id;
    act(() => result.current.setActiveThreadId(id));
    expect(result.current.activeThreadId).toBe(id);

    act(() => result.current.resolveThread(id));
    expect(result.current.threads[0].resolved).toBe(true);
    expect(result.current.activeThreadId).toBe(null);
    editor.destroy();
  });

  it("leaves the selection alone when a different thread is resolved", () => {
    const { result, editor } = setup(["second one", "first one"]);
    const [a, b] = result.current.threads.map((t) => t.id);
    act(() => result.current.setActiveThreadId(a));

    act(() => result.current.resolveThread(b));
    expect(result.current.activeThreadId).toBe(a);
    editor.destroy();
  });

  it("reopening does not change the selection: the card is already in view under Show resolved", () => {
    const { result, editor } = setup(["needs work"]);
    const id = result.current.threads[0].id;
    act(() => result.current.resolveThread(id));

    act(() => result.current.resolveThread(id));
    expect(result.current.threads[0].resolved).toBe(false);
    expect(result.current.activeThreadId).toBe(null);
    editor.destroy();
  });
});
