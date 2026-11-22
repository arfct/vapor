// @vitest-environment jsdom
/**
 * useLocalDoc: the offline half of a document — Y.Doc, awareness, who the
 * local user is (anonymous animal or signed-in person), mode, and the
 * sign-in re-attribution of this browser's anonymous comments.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Session } from "~/lib/useSession";
import type { ThreadData } from "~/shared/types";

const session = vi.hoisted(() => ({ current: null as Session | null }));
vi.mock("~/lib/useSession", () => ({ useSession: () => session.current }));

const { useLocalDoc } = await import("~/lib/useLocalDoc");
const { getAnonIdentity, formerAnonId } = await import("~/lib/anon-identity");

beforeEach(() => {
  localStorage.clear();
  session.current = null;
});

describe("useLocalDoc", () => {
  it("presents an anonymous animal until signed in", () => {
    const { result } = renderHook(() => useLocalDoc());
    const anon = getAnonIdentity();
    expect(result.current.user).toMatchObject({
      id: anon.id,
      name: `${anon.adjective} ${anon.animal.name}`,
      animal: anon.animal.glyph,
    });
    expect(result.current.awareness.getLocalState()?.user).toEqual(result.current.user);
  });

  it("keeps the animal for a signed-out session or one without a name", () => {
    session.current = { signedIn: false };
    const { result, rerender } = renderHook(() => useLocalDoc());
    expect(result.current.user.animal).toBeTruthy();
    session.current = { signedIn: true };
    rerender();
    expect(result.current.user.animal).toBeTruthy();
  });

  it("presents a signed-in person under their uid, colour and avatar", () => {
    session.current = { signedIn: true, displayName: "Ada", uid: "abc12345", avatar: "https://img/a.png" };
    const { result } = renderHook(() => useLocalDoc());
    expect(result.current.user).toMatchObject({ name: "Ada", id: "abc12345", avatar: "https://img/a.png" });
    expect(result.current.user.animal).toBeUndefined();
    expect(result.current.awareness.getLocalState()?.user).toMatchObject({ name: "Ada" });
  });

  it("falls back to the anon id and colour when the session has no uid or avatar", () => {
    const anon = getAnonIdentity();
    session.current = { signedIn: true, displayName: "Ada", uid: null, avatar: null };
    const { result } = renderHook(() => useLocalDoc());
    expect(result.current.user.id).toBe(anon.id);
    expect(result.current.user.avatar).toBeUndefined();
    // Same id as the anon identity: nothing is retired.
    expect(formerAnonId()).toBeNull();
  });

  it("re-attributes this browser's anonymous comments on sign-in and retires the anon id", () => {
    const { result, rerender } = renderHook(() => useLocalDoc());
    const anonId = result.current.user.id!;
    const thread: ThreadData = {
      id: "t1",
      commentText: "hi",
      author: result.current.user,
      createdAt: 1,
      resolved: false,
      replies: [],
    };
    result.current.doc.getMap<string>("threads").set("t1", JSON.stringify(thread));

    session.current = { signedIn: true, displayName: "Ada", uid: "abc12345" };
    rerender();

    const stored = JSON.parse(result.current.doc.getMap<string>("threads").get("t1")!) as ThreadData;
    expect(stored.author).toMatchObject({ name: "Ada", id: "abc12345" });
    expect(formerAnonId()).toBe(anonId);
  });

  it("tracks mode from docState and ignores unknown values", () => {
    const { result } = renderHook(() => useLocalDoc());
    expect(result.current.mode).toBe("edit");
    act(() => result.current.setMode("suggest"));
    expect(result.current.mode).toBe("suggest");
    expect(result.current.docState.get("mode")).toBe("suggest");
    act(() => result.current.docState.set("mode", "bogus"));
    expect(result.current.mode).toBe("suggest");
    act(() => result.current.setMode("edit"));
    expect(result.current.mode).toBe("edit");
  });

  it("picks up a mode already in the doc and stops observing on unmount", () => {
    const { result, unmount } = renderHook(() => useLocalDoc());
    const { docState } = result.current;
    unmount();
    expect(() => docState.set("mode", "suggest")).not.toThrow();
  });
});
