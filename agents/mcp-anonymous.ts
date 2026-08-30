/**
 * Anonymous-mode tool wrapping: when an MCP session presents no bearer
 * token, each document it touches gets an auto-enrolled anonymous agent
 * instead of an `invalid_token` error. This module holds the pure decision
 * logic (reuse a held token vs. enroll a new one) so it is unit-testable
 * without the `agents` package; `agents/mcp.ts` supplies the real session
 * state and DocumentAgent stub.
 */
import { isValidDocumentId } from "../app/shared/constants";
import type { ToolDef, DocStub } from "./mcp-tools";

/** One doc's anonymous identity, held in the MCP session's persisted state. */
export interface AnonymousAgentIdentity {
  token: string;
  name: string;
}

/** Keyed by doc_id — one entry per document this session has touched. */
export type AnonymousAgentState = Record<string, AnonymousAgentIdentity>;

export interface RunAnonymousToolParams {
  tool: ToolDef;
  args: Record<string, unknown>;
  /** Resolves a document id to its DocumentAgent stub. */
  getStub(docId: string): Promise<DocStub>;
  /** Slugified clientInfo.name (or "agent"), used only on first enrollment. */
  baseName: string;
  /** The session's currently held { docId: identity } map. */
  state: AnonymousAgentState;
  /** Persists a new state map after enrolling an agent for a new doc. */
  setState(next: AnonymousAgentState): void;
}

/**
 * Runs one tool call for a tokenless MCP session: reuses a held anonymous
 * token for (session, doc_id) if one already exists, otherwise auto-enrolls
 * a fresh one and persists it before running the tool. A malformed or
 * missing doc_id is left for the tool's own validation to reject — this
 * mirrors what an authenticated call does and avoids enrolling an agent for
 * a document id that isn't even well-formed.
 */
export async function runAnonymousTool(params: RunAnonymousToolParams): Promise<unknown> {
  const { tool, args, getStub, baseName, state, setState } = params;
  const docId = args.doc_id;

  if (typeof docId !== "string" || !isValidDocumentId(docId)) {
    return tool.run({ getStub, token: "" }, args);
  }

  const stub = await getStub(docId);
  const resolvedStub = async () => stub;

  const held = state[docId];
  if (held) {
    return tool.run({ getStub: resolvedStub, token: held.token }, args);
  }

  const enrolled = await stub.enrollAnonymousAgent(baseName);
  if ("error" in enrolled) {
    return { error: enrolled.error };
  }

  setState({ ...state, [docId]: { token: enrolled.token, name: enrolled.entry.name } });
  return tool.run({ getStub: resolvedStub, token: enrolled.token }, args);
}
