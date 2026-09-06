import * as Y from "yjs";

/**
 * Version history policy: when a markdown snapshot is worth keeping, which
 * ones go first when the trail gets long, and who gets the credit. Pure, so
 * the DocumentAgent's triggers and the dialog's labels share one source of
 * truth and the rules are testable without a Durable Object.
 */

export type VersionReason =
  | "idle"
  | "delta"
  | "manual"
  | "pre_replace"
  | "pre_accept_all"
  | "pre_restore"
  | "restore";

export interface VersionAuthor {
  kind: "human" | "agent" | "unknown";
  id: string;
  name: string;
  color: string;
  avatar?: string | null;
  animal?: string;
}

/** One version as the dialog lists it: everything but the markdown. */
export interface VersionSummary {
  id: number;
  createdAt: number;
  reason: VersionReason;
  author: VersionAuthor;
  contributors: VersionAuthor[];
  bytes: number;
  restoredFrom: number | null;
}

/** Snapshots above this are skipped: SQLite caps a value at 2 MB. */
export const MAX_VERSION_BYTES = 1_000_000;
/** Per document. At 99 hours this is a few megabytes at the very worst. */
export const MAX_VERSIONS = 200;
/** Typing has stopped for this long: take a version. */
export const IDLE_SNAPSHOT_MS = 60_000;
/** A size swing this large since the last version is worth a version now. */
export const DELTA_RATIO = 0.2;
/** Continuous editing never goes longer than this without a version. */
export const MAX_GAP_MS = 10 * 60_000;
/** One restore per document per this window. */
export const RESTORE_COOLDOWN_MS = 5_000;

const AUTOMATIC: ReadonlySet<VersionReason> = new Set(["idle", "delta"]);

/**
 * Checked on every persist (at most once a second): the document has grown
 * or shrunk by more than `DELTA_RATIO` since the last version, or the last
 * version is older than `MAX_GAP_MS`. A document with no versions yet is
 * due as soon as it has content.
 */
export function shouldSnapshotOnDelta(
  prevBytes: number | null,
  nextBytes: number,
  lastAt: number | null,
  now: number,
): boolean {
  if (prevBytes === null || lastAt === null) return nextBytes > 0;
  if (now - lastAt > MAX_GAP_MS) return true;
  if (prevBytes === 0) return nextBytes > 0;
  return Math.abs(nextBytes - prevBytes) / prevBytes > DELTA_RATIO;
}

/**
 * Ids to delete so at most `MAX_VERSIONS` remain: the oldest automatic
 * rows first, so deliberate checkpoints (`pre_*`, `manual`, `restore`)
 * survive longest; only when those are all that is left do the oldest
 * checkpoints go.
 */
export function pruneOrder(rows: { id: number; reason: VersionReason; created_at: number }[]): number[] {
  const excess = rows.length - MAX_VERSIONS;
  if (excess <= 0) return [];
  const byAge = [...rows].sort((a, b) => a.created_at - b.created_at || a.id - b.id);
  const automatic = byAge.filter((r) => AUTOMATIC.has(r.reason));
  const checkpoints = byAge.filter((r) => !AUTOMATIC.has(r.reason));
  return [...automatic, ...checkpoints].slice(0, excess).map((r) => r.id);
}

/** The most recent contributor gets the byline; nobody known reads "Someone". */
export function primaryAuthor(contributors: VersionAuthor[]): VersionAuthor {
  const last = contributors[contributors.length - 1];
  return last ?? { kind: "unknown", id: "", name: "Someone", color: "#999" };
}

export function reasonLabel(reason: VersionReason, actorName?: string): string {
  switch (reason) {
    case "pre_replace":
      return `Before ${actorName ?? "an agent"} replaced blocks`;
    case "pre_accept_all":
      return "Before Accept all";
    case "pre_restore":
      return "Before restore";
    case "restore":
      return "Restored";
    case "manual":
      return "Saved";
    case "delta":
    case "idle":
      return "Edited";
  }
}

/**
 * The distinct Yjs client ids whose structs an update carries. Every struct
 * a client creates is stamped with its `doc.clientID`, which is also the
 * key of that client's awareness state, so this is how an edit gets a name.
 * Only struct headers are read, so it is cheap next to serialising.
 */
export function clientIdsInUpdate(update: Uint8Array): number[] {
  const seen = new Set<number>();
  for (const struct of Y.decodeUpdate(update).structs) seen.add(struct.id.client);
  return [...seen];
}
