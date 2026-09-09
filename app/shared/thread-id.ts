import { blockHash } from "./agent-protocol";

/**
 * Deterministic thread id for a comment mark, so every client (and the
 * server, for an agent's comment) that decides to create a thread for the
 * same mark writes the SAME Y.Map key and the writes converge instead of
 * duplicating. Threads are matched to marks by comment text, so the id is
 * a hash of the text and the highlighted passage.
 */
export function threadIdForComment(comment: { commentText: string; highlightText?: string }): string {
  return `t-${blockHash(`${comment.commentText}|${comment.highlightText ?? ""}`)}`;
}
