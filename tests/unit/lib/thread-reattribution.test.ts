import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { reattributeThreads } from "~/lib/thread-reattribution";
import type { ThreadData, UserInfo } from "~/shared/types";

const anon: UserInfo = { name: "Otter", color: "#111", colorLight: "#eee", id: "anon-1", animal: "otter" };
const other: UserInfo = { name: "Bea", color: "#222", colorLight: "#ddd", id: "bea" };
const signedIn: UserInfo = {
  name: "Ada",
  color: "#333",
  colorLight: "#ccc",
  id: "principal-ada",
  avatar: "https://img/ada.png",
  animal: "should-not-copy",
};

function thread(id: string, author: UserInfo, replyAuthors: UserInfo[] = []): ThreadData {
  return {
    id,
    commentText: "c",
    author,
    createdAt: 1,
    resolved: false,
    replies: replyAuthors.map((a, i) => ({ id: `${id}-r${i}`, text: "r", author: a, createdAt: 2 })) as ThreadData["replies"],
  };
}

function docWith(threads: Record<string, string>) {
  const doc = new Y.Doc();
  const map = doc.getMap<string>("threads");
  for (const [k, v] of Object.entries(threads)) map.set(k, v);
  return { doc, map };
}

describe("reattributeThreads", () => {
  it("rewrites threads and replies by the former anonymous id", () => {
    const { doc, map } = docWith({
      t1: JSON.stringify(thread("t1", anon, [other, anon])),
      t2: JSON.stringify(thread("t2", other, [anon])),
    });
    reattributeThreads(doc, "anon-1", signedIn);

    const t1 = JSON.parse(map.get("t1")!) as ThreadData;
    const expected = { name: "Ada", color: "#333", colorLight: "#ccc", id: "principal-ada", avatar: "https://img/ada.png" };
    expect(t1.author).toEqual(expected);
    expect(t1.replies[0].author).toEqual(other);
    expect(t1.replies[1].author).toEqual(expected);

    const t2 = JSON.parse(map.get("t2")!) as ThreadData;
    expect(t2.author).toEqual(other);
    expect(t2.replies[0].author).toEqual(expected);
  });

  it("omits avatar when the signed-in user has none", () => {
    const { doc, map } = docWith({ t1: JSON.stringify(thread("t1", anon)) });
    reattributeThreads(doc, "anon-1", { name: "Ada", color: "#333", colorLight: "#ccc", id: "p" });
    expect(JSON.parse(map.get("t1")!).author).toEqual({ name: "Ada", color: "#333", colorLight: "#ccc", id: "p" });
  });

  it("leaves untouched threads, malformed JSON and reply-less threads alone", () => {
    const untouched = JSON.stringify(thread("t2", other, [other]));
    const noReplies = JSON.stringify({ ...thread("t3", other), replies: undefined });
    const { doc, map } = docWith({ bad: "{not json", t2: untouched, t3: noReplies });
    const updates: Uint8Array[] = [];
    doc.on("update", (u: Uint8Array) => updates.push(u));

    reattributeThreads(doc, "anon-1", signedIn);

    expect(map.get("bad")).toBe("{not json");
    expect(map.get("t2")).toBe(untouched);
    expect(map.get("t3")).toBe(noReplies);
    expect(updates).toHaveLength(0);
  });
});
