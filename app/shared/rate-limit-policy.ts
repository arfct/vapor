/**
 * How fast one agent may write to one document. Two rolling windows: edits in
 * the last minute, and characters added in the last hour (a patch or replace
 * is charged for what it adds, not for what it leaves standing).
 *
 * A signed-in agent answers to a named person who can see and revoke it in
 * the Agents panel, and revising a long draft a few times an hour runs past
 * the anonymous budget, so signed-in agents get more room. The anonymous
 * endpoint needs no account, so its limits stay tight.
 */
import type { AgentIdentity } from "./agent-protocol";

export interface RateLimits {
  mutationsPerMinute: number;
  charsPerHour: number;
}

export const RATE_LIMITS: Record<AgentIdentity["kind"], RateLimits> = {
  anonymous: { mutationsPerMinute: 10, charsPerHour: 20_000 },
  principal: { mutationsPerMinute: 30, charsPerHour: 100_000 },
};

/** One recorded mutation. Refused attempts are not recorded. */
export interface MutationLogEntry {
  at: number;
  chars: number;
}

export type RateLimitVerdict =
  | { allowed: true; log: MutationLogEntry[] }
  | { allowed: false; log: MutationLogEntry[]; message: string };

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/**
 * Whether a mutation of `chars` characters fits the limits now. Either way
 * `log` comes back pruned to the last hour, with this mutation appended when
 * it is allowed; a refusal says which limit it hit and when the edit fits.
 */
export function checkMutation(
  log: MutationLogEntry[],
  chars: number,
  limits: RateLimits,
  now: number,
): RateLimitVerdict {
  const pruned = log.filter((entry) => entry.at > now - HOUR).sort((a, b) => a.at - b.at);

  if (chars > limits.charsPerHour) {
    return {
      allowed: false,
      log: pruned,
      message: `This edit adds ${count(chars)} characters; the limit is ${count(limits.charsPerHour)} an hour. Split it into smaller edits.`,
    };
  }

  const fitsAt = Math.max(minuteFitsAt(pruned, limits, now), hourFitsAt(pruned, chars, limits, now));
  if (fitsAt <= now) return { allowed: true, log: [...pruned, { at: now, chars }] };

  return {
    allowed: false,
    log: pruned,
    message:
      `Agent mutation rate limit exceeded (${limits.mutationsPerMinute} edits a minute, ` +
      `${count(limits.charsPerHour)} added characters an hour); this edit fits in ${Math.ceil((fitsAt - now) / 1000)} seconds.`,
  };
}

function minuteFitsAt(log: MutationLogEntry[], limits: RateLimits, now: number): number {
  const lastMinute = log.filter((entry) => entry.at > now - MINUTE);
  const excess = lastMinute.length - limits.mutationsPerMinute + 1;
  return excess > 0 ? lastMinute[excess - 1].at + MINUTE : now;
}

function hourFitsAt(log: MutationLogEntry[], chars: number, limits: RateLimits, now: number): number {
  let excess = log.reduce((sum, entry) => sum + entry.chars, chars) - limits.charsPerHour;
  let fitsAt = now;
  for (const entry of log) {
    if (excess <= 0) break;
    excess -= entry.chars;
    fitsAt = entry.at + HOUR;
  }
  return fitsAt;
}

function count(n: number): string {
  return n.toLocaleString("en-US");
}
