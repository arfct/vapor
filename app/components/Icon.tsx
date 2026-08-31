/**
 * Material Symbols Outlined glyph. `name` must appear in the icon_names
 * subset in root.tsx or the ligature renders as raw text.
 */
export default function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden="true" className={`material-symbols-outlined ${className ?? ""}`}>
      {name}
    </span>
  );
}
