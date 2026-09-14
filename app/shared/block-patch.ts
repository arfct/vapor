/**
 * Block-level diff behind the `patch` tool (#59).
 *
 * An agent revising a document it drafted reached for one `replace` spanning
 * the whole thing. That overwrites any edit a person made in the middle since
 * the read, gives every block a new id so anchored comments lose their text,
 * and shows up in version history as one opaque rewrite. It is also charged
 * against the hourly budget for the whole document rather than for the change.
 *
 * `diffBlocks` turns "here is what the document should say" into the smallest
 * set of block operations that gets there. Blocks that did not change are not
 * touched at all, so their ids, comment anchors, and attribution survive.
 *
 * Pure: no Yjs, no ProseMirror. `DocumentAgent` applies the operations.
 */

export type PatchOp =
  | { kind: "replace"; index: number; markdown: string }
  | { kind: "insert"; index: number; markdown: string }
  | { kind: "delete"; index: number };

/**
 * The operations that turn `current` into `next`, at block granularity.
 *
 * Every index is against `current` as it was read. Operations come back in
 * ascending index order, so an applier must work from the end backwards, or
 * an early delete shifts everything after it.
 *
 * A run of blocks that changed is paired position by position, so a three
 * block run rewritten in place is three replaces that each keep their block's
 * id, not a delete of three and an insert of three. Leftovers on either side
 * become inserts or deletes.
 */
export function diffBlocks(current: string[], next: string[]): PatchOp[] {
  const keep = longestCommonSubsequence(current, next);

  const ops: PatchOp[] = [];
  let i = 0;
  let j = 0;
  const emitGap = (untilI: number, untilJ: number) => {
    const removed = untilI - i;
    const added = untilJ - j;
    const paired = Math.min(removed, added);
    for (let t = 0; t < paired; t++) {
      if (current[i + t] !== next[j + t]) ops.push({ kind: "replace", index: i + t, markdown: next[j + t] });
    }
    for (let t = paired; t < removed; t++) ops.push({ kind: "delete", index: i + t });
    for (let t = paired; t < added; t++) ops.push({ kind: "insert", index: untilI, markdown: next[j + t] });
    i = untilI;
    j = untilJ;
  };

  for (const [ki, kj] of keep) {
    emitGap(ki, kj);
    i = ki + 1;
    j = kj + 1;
  }
  emitGap(current.length, next.length);
  return ops;
}

/**
 * What a patch costs against the hourly character budget: the text it adds,
 * not the text it leaves standing. A whole-document `replace` is charged for
 * the whole document, which is what made in-place revision of a long draft
 * unaffordable.
 */
export function patchCharge(ops: PatchOp[]): number {
  return ops.reduce((sum, op) => (op.kind === "delete" ? sum : sum + op.markdown.length), 0);
}

/** Indices of a longest common subsequence, as [currentIndex, nextIndex] pairs. */
function longestCommonSubsequence(a: string[], b: string[]): [number, number][] {
  const lengths: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let x = a.length - 1; x >= 0; x--) {
    for (let y = b.length - 1; y >= 0; y--) {
      lengths[x][y] = a[x] === b[y] ? lengths[x + 1][y + 1] + 1 : Math.max(lengths[x + 1][y], lengths[x][y + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let x = 0;
  let y = 0;
  while (x < a.length && y < b.length) {
    if (a[x] === b[y]) {
      pairs.push([x, y]);
      x++;
      y++;
    } else if (lengths[x + 1][y] >= lengths[x][y + 1]) x++;
    else y++;
  }
  return pairs;
}
