import { animalGlyphForLabel } from "~/shared/anon-animals";

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * Circular avatar: photo if present, anonymous animal glyph if present,
 * otherwise a placeholder circle with the author's initials.
 */
export default function Avatar({
  name,
  avatar,
  animal,
  color,
  className = "h-7 w-7",
}: {
  name: string;
  avatar?: string | null;
  animal?: string;
  color?: string;
  className?: string;
}) {
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
