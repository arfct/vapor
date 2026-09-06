/**
 * The agent clients vapor knows how to connect. One entry per tab in the
 * Invite an agent dialog and per mark in app/assets/agents; the same table
 * tells an agent's client apart from its `clientInfo.name`, so a roster or a
 * comment can carry the client's mark.
 */

export type AgentClientId = "claude" | "chatgpt" | "codex" | "cursor" | "gemini" | "vscode" | "other";

export interface AgentClient {
  id: AgentClientId;
  label: string;
  /** Substrings of a slugified `clientInfo.name` that identify this client, most specific first. */
  matches: string[];
}

export const AGENT_CLIENTS: AgentClient[] = [
  { id: "claude", label: "Claude", matches: ["claude"] },
  { id: "chatgpt", label: "ChatGPT", matches: ["chatgpt"] },
  { id: "codex", label: "Codex", matches: ["codex"] },
  { id: "cursor", label: "Cursor", matches: ["cursor"] },
  { id: "gemini", label: "Gemini", matches: ["gemini"] },
  { id: "vscode", label: "VS Code", matches: ["vscode", "visual-studio-code", "copilot"] },
  { id: "other", label: "Other", matches: [] },
];

export function agentClient(id: string): AgentClient {
  return AGENT_CLIENTS.find((c) => c.id === id) ?? AGENT_CLIENTS[AGENT_CLIENTS.length - 1];
}

/**
 * Which client a connecting MCP client is, from the name it declares
 * (`clientInfo.name`, e.g. "claude-code", "Cursor", "codex-cli"). Unknown or
 * missing names are "other". OpenAI's generic name maps to ChatGPT.
 */
export function agentClientFor(clientName: string | null | undefined): AgentClientId {
  const slug = (clientName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  if (!slug) return "other";
  for (const client of AGENT_CLIENTS) {
    if (client.matches.some((m) => slug.includes(m))) return client.id;
  }
  if (slug.includes("openai")) return "chatgpt";
  return "other";
}
