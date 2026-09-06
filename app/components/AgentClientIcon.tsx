import claude from "~/assets/agents/claude.svg?raw";
import chatgpt from "~/assets/agents/chatgpt.svg?raw";
import cursor from "~/assets/agents/cursor.svg?raw";
import gemini from "~/assets/agents/gemini.svg?raw";
import vscode from "~/assets/agents/vscode.svg?raw";
import other from "~/assets/agents/other.svg?raw";
import type { AgentClientId } from "~/shared/agent-clients";

const MARKS: Record<AgentClientId, string> = { claude, chatgpt, cursor, gemini, vscode, other };

/**
 * A client's mark, inline so it takes the current text colour in either
 * theme. The SVG files are the source of truth (app/assets/agents); each is
 * 24×24 with `fill="currentColor"` and no title, so the label alongside does
 * the naming.
 */
export default function AgentClientIcon({ client, size = 20, className = "" }: { client: AgentClientId; size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 [&>svg]:h-full [&>svg]:w-full ${className}`}
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: MARKS[client] ?? other }}
    />
  );
}
