import { useRef, useState, type DragEvent } from "react";
import Dialog, { SnippetRow } from "~/components/ui/dialog";
import Icon from "~/components/Icon";
import { useSite } from "~/lib/site-context";

/**
 * Every way into a new document, in one place: blank, a markdown file
 * (dropped or picked), or the terminal. Opened by the Create button on the
 * tour, the menu's New document row, and `vapor://new` links.
 */
export default function NewDocumentDialog({
  open,
  onClose,
  onBlank,
  onFile,
}: {
  open: boolean;
  onClose: () => void;
  onBlank: () => void;
  onFile: (file: File) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const { origin } = useSite();

  const takeFile = (file: File | undefined) => {
    if (file && file.name.endsWith(".md")) onFile(file);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    takeFile(e.dataTransfer.files[0]);
  };

  return (
    <Dialog open={open} onClose={onClose} title="New document">
      <div className="space-y-5">
        <button
          onClick={onBlank}
          className="dialog-row flex w-full cursor-pointer items-center gap-3 border border-border px-4 py-3 text-left transition-colors hover:bg-accent"
        >
          <Icon name="note_add" />
          <span className="min-w-0">
            <span className="block text-sm font-medium">Blank</span>
            <span className="block text-sm text-muted">Start typing; the first line is the title.</span>
          </span>
        </button>

        <div
          role="button"
          tabIndex={0}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`dialog-row flex cursor-pointer items-center gap-3 border border-dashed px-4 py-3 transition-colors ${
            dragging ? "border-ink bg-accent" : "border-border hover:bg-accent"
          }`}
        >
          <Icon name="upload_file" />
          <span className="min-w-0">
            <span className="block text-sm font-medium">Upload a .md file</span>
            <span className="block text-sm text-muted">
              Drop it here, or anywhere on the page. Comments in its front matter come back as threads.
            </span>
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md"
            className="hidden"
            onChange={(e) => takeFile(e.target.files?.[0])}
          />
        </div>

        <SnippetRow label="From the terminal" text={`curl ${origin}/new -T file.md`} />
      </div>
    </Dialog>
  );
}
