// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { screen, fireEvent, within } from "@testing-library/react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { renderWithDocument } from "../../helpers/document-context";
import FacePile from "~/components/FacePile";
import type { DocumentContextValue } from "~/lib/DocumentContext";

function liveYjs(user: DocumentContextValue["yjs"]["user"]): DocumentContextValue["yjs"] {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  return {
    doc,
    awareness,
    socket: null,
    synced: true,
    asleep: false,
    user,
    mode: "edit",
    setMode: vi.fn(),
    docState: doc.getMap<string>("docState"),
  } as DocumentContextValue["yjs"];
}

const me = { id: "anon-1", name: "Curious Ladybug", color: "#E57373", colorLight: "#FFCDD2", animal: "🐞" };

describe("FacePile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the viewer's own face even when nobody else is on the document", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
    renderWithDocument(createElement(FacePile), { context: { yjs: liveYjs(me) } });
    const trigger = screen.getByRole("button", { name: "Only you here" });
    const faces = trigger.querySelectorAll("[title]");
    expect(faces).toHaveLength(1);
    expect(faces[0].getAttribute("title")).toBe("Curious Ladybug");
    expect(trigger.querySelector("[data-self-face]")).not.toBeNull();
  });

  it("puts the viewer last, apart from the others, and lists them as You", () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
    const yjs = liveYjs(me);
    renderWithDocument(createElement(FacePile, { alsoOnline: [{ name: "Ada Lovelace", color: "#64B5F6" }] }), {
      context: { yjs },
    });
    const trigger = screen.getByRole("button", { name: /2 people, 2 here now/ });
    const titles = Array.from(trigger.querySelectorAll("[title]")).map((el) => el.getAttribute("title"));
    expect(titles).toEqual(["Ada Lovelace", "Curious Ladybug"]);
    const selfWrap = trigger.querySelector("[data-self-face]") as HTMLElement;
    expect(selfWrap.className).toContain("ml-1.5");

    fireEvent.click(trigger);
    const list = screen.getByText("You · here now").closest("div")!;
    expect(within(list).getByText("Curious Ladybug")).toBeTruthy();
  });
});
