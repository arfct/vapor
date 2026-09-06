import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import Icon from "~/components/Icon";

/**
 * A modal sheet in the app's voice: a 24px squircle on a Material shadow
 * over a light veil of the page, with a title and a round close cell that
 * matches the toolbar. Escape and a tap on the veil close it.
 */
export default function Dialog({
  open,
  onClose,
  title,
  accessory,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Sits right after the title: a small control that scopes the whole dialog. */
  accessory?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper/20 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="squircle-[24px] max-h-[85vh] w-full max-w-lg overflow-y-auto bg-paper p-6 shadow-[0_8px_10px_1px_rgba(0,0,0,0.14),0_3px_14px_2px_rgba(0,0,0,0.12),0_5px_5px_-3px_rgba(0,0,0,0.2)]"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <h2 id={titleId} className="text-lg font-medium">
              {title}
            </h2>
            {accessory}
          </div>
          {/* Same round 48px cell as the toolbar, tucked into the corner padding. */}
          <button onClick={onClose} aria-label="Close" className="header-button -my-3 -mr-3 text-ink">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * A labelled one-line snippet with a copy icon in the box's corner, the
 * same control code blocks carry (code-block-copy.ts): content_copy, then a
 * check for a moment once copied.
 */
export function SnippetRow({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  }, [text]);
  return (
    <div>
      <span className="mb-1 block text-sm text-muted">{label}</span>
      <div className="relative">
        <code className="block break-all border border-border bg-border/20 py-2 pl-3 pr-10 text-sm">{text}</code>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : `Copy ${label}`}
          title="Copy"
          className="absolute right-1.5 top-1.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded text-muted transition-colors hover:bg-ink/8 hover:text-ink"
        >
          <Icon name={copied ? "check" : "content_copy"} className="text-[18px]" />
        </button>
      </div>
    </div>
  );
}
