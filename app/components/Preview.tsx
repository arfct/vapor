import { useDocument } from "~/lib/DocumentContext";

/**
 * The Markdown source view — the inverse of the old rendered preview: the
 * editor is now the rendered view, so this shows the document's canonical
 * markdown serialization, read-only.
 */
export default function Preview() {
  const { markdown } = useDocument();

  return (
    <pre className="max-w-[80ch] overflow-x-auto whitespace-pre-wrap p-6 font-mono text-sm leading-relaxed text-ink">
      {markdown}
    </pre>
  );
}
