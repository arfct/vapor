import type * as Y from "yjs";
import type { UserInfo, ThreadData } from "~/shared/types";

export type PersonStatus = "online" | "commented" | "viewed";

export interface Person {
  /** Stable identity: the user's id when known, else their display name. */
  key: string;
  user: UserInfo;
  status: PersonStatus;
  /** Most recent activity for the status shown (comment or view time). */
  at?: number;
  isAgent: boolean;
}

/** What the `viewers` map stores per visitor. */
export interface ViewerRecord {
  name: string;
  color: string;
  colorLight: string;
  animal?: string;
  avatar?: string;
  lastSeen: number;
}

export const VIEWERS_MAP = "viewers";

export function viewersMap(doc: Y.Doc): Y.Map<ViewerRecord> {
  return doc.getMap<ViewerRecord>(VIEWERS_MAP);
}

export function personKey(user: Pick<UserInfo, "id" | "name">): string {
  return user.id ?? user.name;
}

/** Records (or refreshes) the local user's visit. */
export function recordViewer(doc: Y.Doc, user: UserInfo, now = Date.now()): void {
  const record: ViewerRecord = {
    name: user.name,
    color: user.color,
    colorLight: user.colorLight,
    lastSeen: now,
  };
  if (user.animal) record.animal = user.animal;
  if (user.avatar) record.avatar = user.avatar;
  viewersMap(doc).set(personKey(user), record);
}

/** A presence entry as read from an awareness state's `user` field. */
export interface PresenceUser extends Partial<UserInfo> {
  name: string;
  color: string;
  isAgent?: boolean;
}

export interface MergeInput {
  /** `user` fields of every awareness state except the local client's. */
  online: PresenceUser[];
  viewers: Map<string, ViewerRecord>;
  threads: Pick<ThreadData, "author" | "createdAt" | "replies">[];
  /** The local user, left out of the result. */
  self: Pick<UserInfo, "id" | "name">;
}

/**
 * Everyone who has touched the document, one entry per person under their
 * strongest status (connected > commented > viewed), ordered oldest
 * activity to newest. The local user is omitted; the pile is about who
 * else is here.
 */
export function mergePeople({ online, viewers, threads, self }: MergeInput): Person[] {
  const selfKey = personKey(self);
  const people = new Map<string, Person>();

  for (const [key, record] of viewers) {
    if (key === selfKey) continue;
    people.set(key, {
      key,
      user: { ...record },
      status: "viewed",
      at: record.lastSeen,
      isAgent: false,
    });
  }

  const commented = (author: UserInfo, at: number) => {
    const key = personKey(author);
    if (key === selfKey) return;
    const existing = people.get(key);
    if (existing && existing.status === "commented" && (existing.at ?? 0) >= at) return;
    people.set(key, {
      key,
      user: existing?.user.avatar && !author.avatar ? { ...author, avatar: existing.user.avatar } : author,
      status: "commented",
      at,
      isAgent: Boolean(author.agentClient),
    });
  };
  for (const thread of threads) {
    commented(thread.author, thread.createdAt);
    for (const reply of thread.replies) commented(reply.author, reply.createdAt);
  }

  for (const presence of online) {
    const key = personKey(presence);
    if (key === selfKey) continue;
    const existing = people.get(key);
    const user: UserInfo = {
      colorLight: presence.color,
      ...existing?.user,
      ...presence,
    };
    people.set(key, { key, user, status: "online", isAgent: Boolean(presence.isAgent), at: existing?.at });
  }

  // Oldest activity first, newest last; someone connected with no recorded
  // activity counts as newest of all.
  const when = (p: Person) => p.at ?? Number.POSITIVE_INFINITY;
  return [...people.values()].sort((a, b) => when(a) - when(b) || a.user.name.localeCompare(b.user.name));
}
