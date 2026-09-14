import Icon from "~/components/Icon";

/**
 * A path through another product's interface — `Settings → Connectors → Add
 * custom connector` — linked straight to that screen when the product has a
 * URL for it.
 *
 * No underline: the path is already set in bold against body copy, and an
 * underline under three arrow-separated words reads as a rule rather than a
 * link. The pop-out mark takes the sentence's size and its colour, so it sits
 * in the line rather than hanging off it as grey furniture.
 */
export default function UiPath({ href, children }: { href?: string; children: React.ReactNode }) {
  const path = <strong className="font-semibold text-ink">{children}</strong>;
  if (!href) return path;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="text-ink transition-colors hover:text-muted">
      {path}
      <Icon name="open_in_new" className="icon-inline ml-0.5" />
    </a>
  );
}
