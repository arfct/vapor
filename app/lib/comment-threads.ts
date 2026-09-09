import type { Editor as TiptapEditor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { ThreadData } from "~/shared/types";

export interface DocumentComment {
  commentText: string;
  highlightText?: string;
  position: number;
  endPosition: number;
}

/**
 * Scan the editor document for CriticMarkup comment and highlight marks.
 * Returns comment positions derived from marks rather than regex parsing.
 */
export function scanDocumentComments(editor: TiptapEditor): DocumentComment[] {
  const comments: DocumentComment[] = [];

  editor.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;

    const commentMark = node.marks.find(
      (m) => m.type.name === "criticComment",
    );
    if (commentMark) {
      // Check if there's a preceding highlight mark (for paired comments)
      // Look at the node just before this one
      let highlightText: string | undefined;
      if (pos > 0) {
        const nodeBefore = editor.state.doc.nodeAt(pos - 1);
        if (nodeBefore?.isText) {
          const hlMark = nodeBefore.marks.find(
            (m) => m.type.name === "criticHighlight",
          );
          if (hlMark) {
            highlightText = nodeBefore.text ?? undefined;
          }
        }
      }

      comments.push({
        commentText: node.text,
        highlightText,
        position: pos,
        endPosition: pos + node.nodeSize,
      });
    }
  });

  return comments;
}

export type MatchedThread = ThreadData & { position?: number; endPosition?: number };

export function matchThreadsToComments(
  threads: ThreadData[],
  comments: DocumentComment[],
): MatchedThread[] {
  const sorted = [...threads].sort((a, b) => a.createdAt - b.createdAt);
  const usedCommentIndices = new Set<number>();
  const result: MatchedThread[] = [];

  for (const thread of sorted) {
    let matchedIdx = -1;
    for (let i = 0; i < comments.length; i++) {
      if (usedCommentIndices.has(i)) continue;
      if (comments[i].commentText === thread.commentText) {
        matchedIdx = i;
        break;
      }
    }

    if (matchedIdx >= 0) {
      usedCommentIndices.add(matchedIdx);
      result.push({
        ...thread,
        position: comments[matchedIdx].position,
        endPosition: comments[matchedIdx].endPosition,
      });
    } else {
      result.push({ ...thread, position: undefined, endPosition: undefined });
    }
  }

  return result;
}

export function findOrphanedThreads(
  threads: ThreadData[],
  comments: DocumentComment[],
): ThreadData[] {
  const matched = matchThreadsToComments(threads, comments);
  return matched
    .filter((t) => t.position === undefined)
    .map(({ position: _, ...rest }) => rest);
}

/**
 * The document position where `text` first occurs inside a single text
 * block, or null. Offsets in a block's text are mapped back through its
 * inline children, so a mention chip or an image between words doesn't
 * skew the answer. Used to place a thread whose marks are gone (or never
 * existed — a comment imported with a highlight the body no longer has,
 * or an agent's comment from before comments anchored) level with the
 * passage it quotes rather than at the top of the rail.
 */
export function findTextPosition(doc: PMNode, text: string): number | null {
  if (!text) return null;
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (!node.isTextblock) return true;
    const index = node.textContent.indexOf(text);
    if (index === -1) return false;
    // Walk the inline children to turn a textContent offset into a position.
    let offset = 0;
    let childPos = pos + 1;
    node.forEach((child) => {
      if (found !== null) return;
      const len = child.isText ? (child.text?.length ?? 0) : child.textContent.length;
      if (index >= offset && index < offset + len) found = childPos + (index - offset);
      offset += len;
      childPos += child.nodeSize;
    });
    return false;
  });
  return found;
}
