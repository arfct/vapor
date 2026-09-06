import { animalGlyphForLabel } from "~/shared/anon-animals";
import { agentClientFor } from "~/shared/agent-clients";
import AgentClientIcon from "~/components/AgentClientIcon";

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * People are circles, agents are hexagons. A circle shows the photo if
 * present, the anonymous animal glyph if present, otherwise the author's
 * initials. A hexagon is filled with the owner's colour and carries the
 * mark of the client the agent connected from, so the shape says "agent",
 * the mark says which kind, and the colour says whose
 * (docs/plans/2026-09-06-agent-identity-plan.md).
 */
export default function Avatar({
  name,
  avatar,
  animal,
  color,
  shape = "circle",
  client,
  className = "h-7 w-7",
}: {
  name: string;
  avatar?: string | null;
  animal?: string;
  color?: string;
  shape?: "circle" | "hexagon";
  /** The agent's client display name ("Claude", "Cursor"…); unknown or missing draws the generic mark. */
  client?: string | null;
  className?: string;
}) {
  if (shape === "hexagon") {
    return (
      <span
        className={`${className} avatar-hexagon flex shrink-0 select-none items-center justify-center text-white`}
        style={{ backgroundColor: color ?? "var(--color-muted)" }}
        title={name}
      >
        <AgentClientIcon client={agentClientFor(client)} size="60%" />
      </span>
    );
  }
  if (avatar) {
    return <img className={`${className} shrink-0 rounded-full object-cover`} src={avatar} alt="" />;
  }
  // Older agent-authored comments predate the stored animal field; the
  // label ("Agentic Lobster") still names the creature.
  const glyph = animal ?? animalGlyphForLabel(name);
  if (glyph) {
    return (
      <span
        className={`${className} anon-animal flex shrink-0 items-center justify-center rounded-full text-2xl`}
        style={{ color }}
      >
        {glyph}
      </span>
    );
  }
  return (
    <span
      className={`${className} flex shrink-0 select-none items-center justify-center rounded-full text-xs font-medium text-white`}
      style={{ backgroundColor: color ?? "var(--color-muted)" }}
    >
      {initials(name)}
    </span>
  );
}
