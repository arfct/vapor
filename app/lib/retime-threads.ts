import type { ThreadData } from "~/shared/types";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long ago each seeded thread appears to have been written, in order; cycles if there are more. */
export const DEMO_AGES = [2 * DAY, 3 * HOUR, 4 * MINUTE];

/**
 * Re-dates seeded threads relative to `now` so a demo document's comments
 * read as a lively mix ("2d ago", "3h ago", "4m ago") instead of drifting
 * ever older. Replies keep their original distance from their thread.
 */
export function retimeThreads(threads: ThreadData[], now = Date.now()): ThreadData[] {
  return threads.map((thread, i) => {
    const createdAt = now - DEMO_AGES[i % DEMO_AGES.length];
    return {
      ...thread,
      createdAt,
      replies: thread.replies.map((reply) => ({
        ...reply,
        createdAt: Math.min(now, createdAt + Math.max(0, reply.createdAt - thread.createdAt)),
      })),
    };
  });
}
