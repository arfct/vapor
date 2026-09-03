import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { mergePeople, recordViewer, viewersMap, type ViewerRecord } from "~/lib/people";
import type { UserInfo, ThreadData } from "~/shared/types";

const user = (name: string, id?: string, extra: Partial<UserInfo> = {}): UserInfo => ({
  name,
  id,
  color: "#E57373",
  colorLight: "#FFCDD2",
  ...extra,
});

const thread = (author: UserInfo, createdAt: number, replies: ThreadData["replies"] = []): ThreadData => ({
  id: `t-${createdAt}`,
  commentText: "note",
  author,
  createdAt,
  resolved: false,
  replies,
});

const viewer = (name: string, lastSeen: number): ViewerRecord => ({
  name,
  color: "#64B5F6",
  colorLight: "#BBDEFB",
  lastSeen,
});

describe("mergePeople", () => {
  const self = user("Me", "me");

  it("orders everyone oldest activity first; connected people without any come last", () => {
    const people = mergePeople({
      online: [{ name: "Ada", color: "#000", id: "ada" }],
      viewers: new Map([
        ["old", viewer("Old Viewer", 100)],
        ["new", viewer("New Viewer", 200)],
      ]),
      threads: [thread(user("Bob", "bob"), 150), thread(user("Cy", "cy"), 300)],
      self,
    });
    expect(people.map((p) => `${p.user.name}:${p.status}`)).toEqual([
      "Old Viewer:viewed",
      "Bob:commented",
      "New Viewer:viewed",
      "Cy:commented",
      "Ada:online",
    ]);
  });

  it("gives each person their strongest status and leaves the local user out", () => {
    const people = mergePeople({
      online: [{ name: "Bob", color: "#000", id: "bob" }, { name: "Me", color: "#000", id: "me" }],
      viewers: new Map([["bob", viewer("Bob", 50)], ["me", viewer("Me", 60)]]),
      threads: [thread(user("Bob", "bob"), 10), thread(self, 20)],
      self,
    });
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ key: "bob", status: "online" });
  });

  it("counts reply authors as commenters and flags agents", () => {
    const agent = user("Agentic Lobster", "agent:lobster", { agentClient: "Claude", animal: "🦞" });
    const people = mergePeople({
      online: [],
      viewers: new Map(),
      threads: [thread(user("Bob", "bob"), 10, [{ id: "r1", author: agent, text: "hi", createdAt: 20 }])],
      self,
    });
    expect(people.map((p) => [p.user.name, p.status, p.isAgent])).toEqual([
      ["Bob", "commented", false],
      ["Agentic Lobster", "commented", true],
    ]);
  });

  it("falls back to the name as identity when there is no id", () => {
    const people = mergePeople({
      online: [{ name: "Anon Fox", color: "#000" }],
      viewers: new Map([["Anon Fox", viewer("Anon Fox", 5)]]),
      threads: [],
      self,
    });
    expect(people).toHaveLength(1);
    expect(people[0].status).toBe("online");
  });
});

describe("recordViewer", () => {
  it("stores the visit under the user's id with their look", () => {
    const doc = new Y.Doc();
    recordViewer(doc, user("Ada", "ada", { avatar: "https://x/a.png" }), 1234);
    expect(viewersMap(doc).get("ada")).toEqual({
      name: "Ada",
      color: "#E57373",
      colorLight: "#FFCDD2",
      avatar: "https://x/a.png",
      lastSeen: 1234,
    });
  });
});
