/**
 * Width and alignment for an image attachment, carried in the markdown as a
 * Pandoc-style attribute block after the image:
 * `![cat.png](/doc/attachments/id/cat.png){width=50% align=left}`.
 *
 * Pure and free of ProseMirror, so the editor's schema and the EPUB and print
 * exports can share it (docs/plans/2026-09-13-image-sizing-design.md).
 */

export type ImageAlign = "left" | "center" | "right";
export type ImageLayout = { width: string | null; align: ImageAlign | null };

const WIDTH_RE = /^(?:full|(?:100|[1-9]\d?)%)$/;
const ALIGNS = new Set<string>(["left", "center", "right"]);
const ATTR_BLOCK_RE = /^\{([^}]*)\}$/;

/**
 * Reads an attribute block. Only `width` and `align` are kept; an unknown key
 * or an out-of-range value is dropped rather than carried, so a node never
 * holds what it cannot serialise back. Returns null when the text is not
 * brace-shaped, which leaves the paragraph as it was.
 */
export function parseImageLayout(text: string): ImageLayout | null {
  const block = ATTR_BLOCK_RE.exec(text.trim());
  if (!block) return null;
  const layout: ImageLayout = { width: null, align: null };
  for (const [, key, value] of block[1].matchAll(/([a-z]+)=([^\s}]+)/g)) {
    if (key === "width" && WIDTH_RE.test(value)) layout.width = value;
    else if (key === "align" && ALIGNS.has(value)) layout.align = value as ImageAlign;
  }
  return layout;
}

/** The attribute block for a layout, or "" when it carries none. */
export function serializeImageLayout(layout: Partial<ImageLayout>): string {
  const parts: string[] = [];
  if (layout.width) parts.push(`width=${layout.width}`);
  if (layout.align) parts.push(`align=${layout.align}`);
  return parts.length ? `{${parts.join(" ")}}` : "";
}

/** A full-width image has no room to wrap beside it, so it ignores align. */
export function isFullWidth(layout: Partial<ImageLayout>): boolean {
  return layout.width === "full" || layout.width === "100%";
}

/**
 * The layout as inline CSS, for the EPUB and print exports where there is no
 * stylesheet hook per image. Returns "" when there is nothing to say.
 */
export function imageLayoutStyle(layout: Partial<ImageLayout>): string {
  const rules: string[] = [];
  if (layout.width) rules.push(`width: ${layout.width === "full" ? "100%" : layout.width}`);
  if (layout.align && !isFullWidth(layout)) {
    if (layout.align === "center") rules.push("display: block", "margin-left: auto", "margin-right: auto");
    else rules.push(`float: ${layout.align}`, `margin-${layout.align === "left" ? "right" : "left"}: 1em`, "margin-bottom: 0.5em");
  }
  return rules.length ? `${rules.join("; ")};` : "";
}
