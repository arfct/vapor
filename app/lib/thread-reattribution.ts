import * as Y from "yjs";
import type { ThreadData, UserInfo } from "~/shared/types";

/**
 * Rewrites comment threads and replies this browser authored anonymously
 * (author.id === formerId) to a newly signed-in identity, so a user's own
 * earlier contributions stop showing an animal and carry their name/avatar.
 * Best-effort and per-document: only the threads in this Y.Doc are touched.
 */
export function reattributeThreads(doc: Y.Doc, formerId: string, user: UserInfo): void {
  const threadsMap = doc.getMap<string>("threads");
  const author: UserInfo = {
    name: user.name,
    color: user.color,
    colorLight: user.colorLight,
    id: user.id,
    ...(user.avatar ? { avatar: user.avatar } : {}),
  };

  doc.transact(() => {
    threadsMap.forEach((raw, key) => {
      let thread: ThreadData;
      try {
        thread = JSON.parse(raw) as ThreadData;
      } catch {
        return;
      }

      let changed = false;
      if (thread.author?.id === formerId) {
        thread.author = { ...author };
        changed = true;
      }
      if (Array.isArray(thread.replies)) {
        for (const reply of thread.replies) {
          if (reply.author?.id === formerId) {
            reply.author = { ...author };
            changed = true;
          }
        }
      }

      if (changed) threadsMap.set(key, JSON.stringify(thread));
    });
  });
}
