import { Node } from "@tiptap/core";
import { formatMention, mentionKey, parseMentionToken, type MentionToken } from "~/shared/agent-protocol";
import type { MentionTargetsRef, MentionTargets } from "~/lib/mention-highlight";

export const MENTION_NODE_CLASS = "cm-mention";

function tokenOf(attrs: Record<string, unknown>): MentionToken {
  return {
    slug: String(attrs.slug ?? ""),
    tag: typeof attrs.tag === "string" && attrs.tag ? attrs.tag : null,
    sid: String(attrs.sid ?? ""),
  };
}

/**
 * Writes a mention's visible form into its element: the current name of
 * whoever the id resolves to (from presence or the roster), else the slug
 * the token carries, in their colour. The id itself never shows.
 */
export function paintMention(dom: HTMLElement, token: MentionToken, targets: MentionTargets): void {
  const target = targets.get(mentionKey(token)) ?? targets.get(formatMention(token));
  dom.textContent = `@${target?.label ?? token.slug}`;
  if (target?.color) dom.style.setProperty("--mention-color", target.color);
  else dom.style.removeProperty("--mention-color");
  dom.title = `@${formatMention(token)}`;
}

/** Repaints every mention node under `root` after the set of known people changed. */
export function paintMentionNodes(root: Element, targets: MentionTargets): void {
  for (const el of root.querySelectorAll<HTMLElement>(`.${MENTION_NODE_CLASS}[data-mention]`)) {
    const token = parseMentionToken(el.dataset.mention ?? "");
    if (token) paintMention(el, token, targets);
  }
}

/**
 * A mention as one inline atom: `@nicholas-jitkoff~k3f0a9x2` in markdown,
 * `@Nicholas Jitkoff` in the editor. Mirrors the `mention` node in
 * `richSchema`; the token is the canonical form everywhere else (raw
 * markdown, `read_document`, comment text), so the id that makes the
 * mention exact travels with the document and only the view hides it
 * (docs/plans/2026-09-06-agent-identity-plan.md).
 */
export const Mention = Node.create<{ targets: MentionTargetsRef | null }>({
  name: "mention",
  inline: true,
  group: "inline",
  atom: true,
  selectable: true,

  addOptions() {
    return { targets: null };
  },

  addAttributes() {
    return {
      slug: { default: "", rendered: false },
      tag: { default: null, rendered: false },
      sid: { default: "", rendered: false },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-mention]",
        getAttrs: (el) => parseMentionToken(el.getAttribute("data-mention") ?? "") ?? false,
      },
    ];
  },

  renderHTML({ node }) {
    const token = tokenOf(node.attrs);
    return ["span", { class: MENTION_NODE_CLASS, "data-mention": formatMention(token) }, `@${token.slug}`];
  },

  // Plain-text output (comment bodies, getText) keeps the full token so the
  // server can resolve it; surfaces that show that text strip the id.
  renderText({ node }) {
    return `@${formatMention(tokenOf(node.attrs))}`;
  },

  addNodeView() {
    const targetsRef = this.options.targets;
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.className = MENTION_NODE_CLASS;
      const paint = (n: typeof node) => {
        const token = tokenOf(n.attrs);
        dom.dataset.mention = formatMention(token);
        paintMention(dom, token, targetsRef?.current ?? new Map());
      };
      paint(node);
      return {
        dom,
        update: (updated) => {
          if (updated.type.name !== "mention") return false;
          paint(updated);
          return true;
        },
        ignoreMutation: () => true,
      };
    };
  },
});
