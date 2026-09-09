// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import * as Y from "yjs";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { CriticAddition, CriticDeletion, CriticComment, CriticHighlight } from "~/lib/critic-marks";
import { useThreads } from "~/lib/useThreads";

describe("useThreads fallback thread creation (#81)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a thread for a comment mark this client did not announce, once the fallback has written it", () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    const editor = new Editor({
      extensions: [StarterKit.configure({ undoRedo: false }), CriticAddition, CriticDeletion, CriticComment, CriticHighlight],
      content: "<p>Hello there</p>",
    });
    const user = { id: "u-jon", name: "Jon Wiley", color: "#BA68C8", colorLight: "#E1BEE7" };
    const { result } = renderHook(() => useThreads({ doc, editor, user }));

    // A comment mark lands without activateComment having been called —
    // the ordering CommentInput had before this fix, and what any other
    // client sees for a comment made elsewhere.
    act(() => {
      editor
        .chain()
        .command(({ tr }) => {
          tr.insertText("needs work", 6);
          tr.addMark(6, 16, editor.schema.marks.criticComment.create());
          return true;
        })
        .run();
    });
    expect(result.current.threads).toEqual([]);

    // Three seconds later the fallback writes the thread. It used to write
    // it behind the reconcile guard and never re-read, so the rail stayed
    // empty until the next edit or a reload.
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.threads.map((t) => t.commentText)).toEqual(["needs work"]);
    expect(result.current.threads[0].position).toBeDefined();
    expect(result.current.threads[0].author.name).toBe("Jon Wiley");
    editor.destroy();
  });
});
