import { DEFAULT_CAPABILITIES, type AgentCapability } from "./agent-protocol";

/**
 * Personal access tokens (#85): a long-lived bearer a signed-in person mints
 * once and hands to every harness on every machine, for the fleets and
 * headless boxes where a browser OAuth round-trip per install is the wrong
 * shape. The token carries the same identity and counterpart agent the
 * OAuth path would, with a grant chosen at minting, and is revocable here.
 */

export const ACCESS_TOKEN_PREFIX = "vpt_";
export const MAX_ACCESS_TOKENS_PER_PRINCIPAL = 20;
export const MAX_TOKEN_LABEL = 64;

export type TokenGrant = "suggest" | "write";

export interface AccessTokenView {
  /** Stable id for revocation: a prefix of the token's hash, never the token. */
  id: string;
  label: string;
  caps: AgentCapability[];
  createdAt: number;
  lastUsedAt: number | null;
  /** The token's last four characters, to tell tokens apart. */
  hint: string;
}

export function capsForGrant(grant: TokenGrant): AgentCapability[] {
  return grant === "write" ? ["suggest", "comment", "write"] : [...DEFAULT_CAPABILITIES];
}

/** Checks a create request: a short label and a grant. */
export function validateTokenRequest(
  input: unknown,
): { label: string; caps: AgentCapability[] } | { error: string } {
  if (typeof input !== "object" || input === null) return { error: "Expected a JSON object" };
  const { label, grant } = input as { label?: unknown; grant?: unknown };
  const trimmed = typeof label === "string" ? label.trim() : "";
  if (!trimmed) return { error: "Give the token a label, like the machine or harness it is for" };
  if (trimmed.length > MAX_TOKEN_LABEL) return { error: `Label must be at most ${MAX_TOKEN_LABEL} characters` };
  if (grant !== "suggest" && grant !== "write") return { error: 'grant must be "suggest" or "write"' };
  return { label: trimmed, caps: capsForGrant(grant) };
}

export function isAccessToken(bearer: string): boolean {
  return bearer.startsWith(ACCESS_TOKEN_PREFIX);
}
