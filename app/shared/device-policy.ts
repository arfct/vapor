/**
 * Send to Kindle / reMarkable (#100): what a person saves once per account,
 * and the checks on it. Delivery itself lives in workers/kindle.ts and
 * workers/remarkable.ts.
 */

export type SendTarget = "kindle" | "remarkable";

export interface DevicesView {
  /** The reader's Send-to-Kindle address, or null. */
  kindleEmail: string | null;
  /** When a reMarkable was paired, or null. The token itself never leaves the server. */
  remarkable: { pairedAt: number } | null;
}

export const KINDLE_EMAIL_RE = /^[a-z0-9._%+-]+@(?:free\.)?kindle\.com$/i;
export const REMARKABLE_CODE_RE = /^[a-z0-9]{8}$/i;

export function validateKindleEmail(input: unknown): { email: string } | { error: string } {
  const email = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (!email) return { error: "Enter your Send to Kindle address" };
  if (!KINDLE_EMAIL_RE.test(email)) return { error: "That is not a @kindle.com address — find yours under Amazon → Content & Devices → Preferences" };
  return { email };
}

export function validateRemarkableCode(input: unknown): { code: string } | { error: string } {
  const code = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (!REMARKABLE_CODE_RE.test(code)) return { error: "The one-time code is eight letters and digits, from my.remarkable.com/device/desktop/connect" };
  return { code };
}

/** Sends allowed per principal per minute, across both targets. */
export const SENDS_PER_MINUTE = 5;
