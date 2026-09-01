import { useState, useCallback } from "react";
import { serializeThreads } from "~/lib/thread-serialization";
import { useDocument } from "~/lib/DocumentContext";
import { Menu, MenuTrigger, MenuContent, MenuItem } from "~/components/ui/menu";

export default function ShareButton() {
  const { docId, markdown, threads } = useDocument();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const handleDownload = useCallback(() => {
    const content = serializeThreads(markdown, threads);
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${docId}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [docId, markdown, threads]);

  return (
    <Menu>
      <MenuTrigger>
        <button
          className="flex h-full cursor-pointer items-center px-3 text-sm uppercase tracking-wider transition-colors hover:bg-border"
          aria-label="Share options"
        >
          Share
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuItem onClick={handleCopy}>{copied ? "✓ Copied" : "Copy link"}</MenuItem>
        <MenuItem onClick={handleDownload}>Download</MenuItem>
      </MenuContent>
    </Menu>
  );
}
