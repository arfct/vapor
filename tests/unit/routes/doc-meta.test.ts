/**
 * The `/:id` route's head tags: what a link previewer sees when a document
 * URL is pasted into iMessage, Slack, or Twitter.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("agents", () => ({ getAgentByName: vi.fn() }));
vi.mock("~/lib/cloudflare.server", () => ({ getCloudflare: vi.fn() }));

import { meta } from "~/routes/doc.$id";

type Tag = Record<string, string | undefined>;

function tags(data: Record<string, unknown> | undefined): Tag[] {
  return meta({
    data,
    matches: [{ id: "root", data: { site: { origin: "https://vapor.example" } } }],
  } as unknown as Parameters<typeof meta>[0]) as Tag[];
}

const byProp = (list: Tag[], property: string) => list.find((t) => t.property === property)?.content;
const byName = (list: Tag[], name: string) => list.find((t) => t.name === name)?.content;

describe("doc.$id meta", () => {
  it("describes the document, not the app, with an absolute canonical url", () => {
    const list = tags({ id: "abcd1234", title: "Agent identity plan", description: "Hexagons & circles.", path: "/agent-identity-plan-abcd1234" });
    expect(list.find((t) => "title" in t)?.title).toBe("Agent identity plan · vapor");
    expect(byProp(list, "og:title")).toBe("Agent identity plan");
    expect(byProp(list, "og:description")).toBe("Hexagons & circles.");
    expect(byName(list, "description")).toBe("Hexagons & circles.");
    expect(byProp(list, "og:url")).toBe("https://vapor.example/agent-identity-plan-abcd1234");
    expect(byProp(list, "og:image")).toBe("https://vapor.example/logo-512.png");
    expect(byProp(list, "og:image:width")).toBe("512");
    expect(byName(list, "twitter:title")).toBe("Agent identity plan");
  });

  it("looks like a social post so iMessage shows the description", () => {
    const list = tags({ id: "abcd1234", title: "T", description: "D", path: "/t-abcd1234" });
    expect(byProp(list, "og:type")).toBe("article");
    expect(list).toContainEqual({
      tagName: "link",
      rel: "alternate",
      type: "application/activity+json",
      href: "https://vapor.example/t-abcd1234",
    });
  });

  it("falls back to the app's name and blurb for an untitled document or a 404", () => {
    const untitled = tags({ id: "abcd1234", title: null, description: null, path: "/abcd1234" });
    expect(untitled.find((t) => "title" in t)?.title).toBe("vapor");
    expect(byProp(untitled, "og:description")).toBe("A shared markdown document for people and agents");
    const missing = tags(undefined);
    expect(byProp(missing, "og:title")).toBe("vapor");
    expect(byProp(missing, "og:url")).toBeUndefined();
  });
});
