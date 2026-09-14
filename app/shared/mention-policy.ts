/**
 * When an `@agent` in a document notifies the agent (#116).
 *
 * A mention in a comment or a thread reply is conversational: each one is a
 * fresh request, and each one fires a `mention` event. A mention in the body
 * is a pointer, not a notification. It marks the passage the agent should
 * care about (`read_document` lists those blocks under `mentions`), and it
 * fires exactly once per document, as the invitation that brings an absent
 * agent in. After that the body can be edited, split, patched, and reloaded
 * without waking anyone: an agent that wants to be told about a passage is
 * told in a comment on it.
 *
 * The state behind this is durable (`roster.invited_at`), not a memory of
 * which live blocks were scanned, so a Durable Object restart or a block
 * gaining a new Yjs identity cannot re-fire it.
 */

export interface InviteState {
  /** The agent has joined the document and its presence has not gone idle. */
  present: boolean;
  /** When the document last invited this agent, or null if it never has. */
  invitedAt: number | null;
}

/**
 * Whether a body mention of an agent should fire its one invitation: only
 * when the agent is not already in the document and has never been invited
 * to it. An agent that is present sees the mention on its next read.
 */
export function shouldInvite(state: InviteState): boolean {
  return !state.present && state.invitedAt === null;
}

/** Inline comment runs, as the block serialiser writes them. */
const COMMENT_RUN_RE = /\{>>[\s\S]*?<<\}/g;

/**
 * A block's text with its inline comments removed. A comment's text lives in
 * the block as a `{>>…<<}` run, but its mentions are notified from the thread
 * entry (every time), so the body scan must not see them as body mentions.
 */
export function stripCommentRuns(text: string): string {
  return text.replace(COMMENT_RUN_RE, "");
}
