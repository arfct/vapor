import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { formatBytes } from "~/shared/attachment-policy";
import { isFullWidth, type ImageAlign } from "~/shared/image-layout";
import Icon from "~/components/Icon";

/**
 * How an attachment block looks in the editor: an image on its own, or a chip
 * that downloads the file. The filename stays as the image's alt text and is
 * not drawn under it. Selection matches the code-block chrome (see .attachment
 * in app.css).
 */
export default function AttachmentView({ node, selected }: NodeViewProps) {
  const { kind, src, alt, width, align } = node.attrs as {
    kind: "image" | "file";
    src: string;
    alt: string;
    width: string | null;
    align: ImageAlign | null;
  };
  const bytes = node.attrs.bytes === null || node.attrs.bytes === undefined ? null : Number(node.attrs.bytes);
  const size = bytes !== null && Number.isFinite(bytes) ? formatBytes(bytes) : null;

  // A percent can be any value, so it cannot be a static rule and is set
  // inline; `full` is a stylesheet case because it escapes the column.
  const fullBleed = isFullWidth({ width });

  return (
    <NodeViewWrapper
      className={`attachment ${selected ? "is-selected" : ""}`}
      data-kind={kind}
      data-width={width ?? undefined}
      data-align={fullBleed ? undefined : (align ?? undefined)}
      style={width && width !== "full" ? { width } : undefined}
      data-drag-handle
    >
      {kind === "image" ? (
        <figure className="attachment-image">
          <img src={src} alt={alt} loading="lazy" />
        </figure>
      ) : (
        <a className="attachment-chip" href={src} download={alt} target="_blank" rel="noopener">
          <Icon name="attach_file" />
          <span className="min-w-0 truncate">{alt}</span>
          {size && <span className="shrink-0 text-muted">{size}</span>}
          <Icon name="download" />
        </a>
      )}
    </NodeViewWrapper>
  );
}
