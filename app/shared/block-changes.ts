import { formatAnchor, type DocBlock } from "./rich-markdown";

/**
 * Block-level change records behind `read_changes` (#87). `document.changed`
 * says only that a document moved, so a polling agent had to re-read the whole
 * markdown to find out what. These rows say which blocks moved, and a read
 * against a cursor answers for clients that never saw the event at all.
 *
 * Pure and free of Yjs and SQL: `DocumentAgent` owns the table and the
 * observer that appends to it, and calls this to turn rows plus the document's
 * current blocks into an answer.
 */

export type BlockChangeKind = "added" | "changed" | "removed";

export interface BlockChangeRow {
  seq: number;
  blockId: string;
  kind: BlockChangeKind;
}

export interface ChangedBlock {
  anchor: string;
  text: string;
  change: "added" | "changed";
}

export interface BlockChanges {
  blocks: ChangedBlock[];
  /** Block ids that left the document. A removed block has no hash, so it has no anchor. */
  removed: string[];
  cursor: number;
  /**
   * The window the caller asked for is not fully covered, so this answer is
   * not a complete account of what changed: read the document instead.
   */
  truncated: boolean;
}

export interface ChangesWindow {
  /** Where the caller left off; null when they have no baseline to diff against. */
  cursor: number | null;
  /** The lowest seq still in the table, or 0 when it is empty. */
  oldestRetainedSeq: number;
  /** The highest seq ever assigned, which is what the caller polls from next. */
  latestSeq: number;
}

/**
 * The blocks that changed after `cursor`, at their current state.
 *
 * Rows are collapsed per block and only the last one counts: a block touched
 * thirty times is one entry, and one deleted and re-added is `added`, not
 * `removed`. The text and the hash come from the document as it is now, not
 * from the row, so an answer is never a stale snapshot.
 */
export function changesSince(
  current: DocBlock[],
  rows: BlockChangeRow[],
  window: ChangesWindow,
): BlockChanges {
  const cursor = window.latestSeq;
  if (window.cursor === null || (window.oldestRetainedSeq > 0 && window.cursor < window.oldestRetainedSeq - 1)) {
    return { blocks: [], removed: [], cursor, truncated: true };
  }

  const last = new Map<string, BlockChangeKind>();
  for (const row of rows) {
    if (row.seq <= window.cursor) continue;
    last.set(row.blockId, row.kind);
  }

  const byId = new Map(current.filter((b) => b.id).map((b) => [b.id as string, b]));
  const changed: { block: DocBlock; change: "added" | "changed" }[] = [];
  const removed: string[] = [];
  for (const [blockId, kind] of last) {
    const block = byId.get(blockId);
    if (!block) removed.push(blockId);
    else changed.push({ block, change: kind === "added" ? "added" : "changed" });
  }
  changed.sort((a, b) => a.block.index - b.block.index);

  return {
    blocks: changed.map(({ block, change }) => ({ anchor: formatAnchor(block), text: block.text, change })),
    removed,
    cursor,
    truncated: false,
  };
}
