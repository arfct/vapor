import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { formatBytes } from "~/shared/attachment-policy";
import Icon from "~/components/Icon";

/**
 * How an attachment block looks in the editor: an image with a caption of
 * its name and size, or a chip that downloads the file. Selection matches
 * the code-block chrome (see .attachment in app.css).
 */
export default function AttachmentView({ node, selected }: NodeViewProps) {
  const { kind, src, alt } = node.attrs as { kind: "image" | "file"; src: string; alt: string };
  const bytes = node.attrs.bytes === null || node.attrs.bytes === undefined ? null : Number(node.attrs.bytes);
  const size = bytes !== null && Number.isFinite(bytes) ? formatBytes(bytes) : null;

  return (
    <NodeViewWrapper className={`attachment ${selected ? "is-selected" : ""}`} data-kind={kind} data-drag-handle>
      {kind === "image" ? (
        <figure className="attachment-image">
          <img src={src} alt={alt} loading="lazy" />
          <figcaption>
            <span className="truncate">{alt}</span>
            {size && <span className="shrink-0 text-muted">{size}</span>}
          </figcaption>
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
