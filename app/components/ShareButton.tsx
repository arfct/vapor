import { useState, useCallback } from "react";
import { serializeThreads } from "~/lib/thread-serialization";
import { useDocument } from "~/lib/DocumentContext";
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from "~/components/ui/menu";
import Icon from "~/components/Icon";

export default function ShareButton({ onOpenAgents }: { onOpenAgents: () => void }) {
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
      <MenuContent>
        <MenuItem className="gap-2" onClick={handleCopy}>
          <Icon name={copied ? "check" : "link"} />
          <span>{copied ? "Copied" : "Copy link"}</span>
        </MenuItem>
        <MenuItem className="gap-2" onClick={handleDownload}>
          <Icon name="download" />
          <span>Download</span>
        </MenuItem>
        <MenuSeparator />
        <MenuItem className="gap-2" onClick={onOpenAgents}>
          <Icon name="robot_2" />
          <span>Invite an agent</span>
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
