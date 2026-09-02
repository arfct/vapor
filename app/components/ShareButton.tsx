import { useState, useCallback } from "react";
import { serializeThreads } from "~/lib/thread-serialization";
import { useDocument } from "~/lib/DocumentContext";
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from "~/components/ui/menu";
import Icon from "~/components/Icon";

/**
 * Copy link and Invite an agent only make sense for a document that lives
 * at a URL; the homepage's standalone doc omits both and keeps Download.
 */
export default function ShareButton({
  onOpenAgents,
  copyLink = true,
}: {
  onOpenAgents?: () => void;
  copyLink?: boolean;
}) {
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
          className="flex h-full w-[60px] cursor-pointer items-center justify-center transition-colors hover:bg-border"
          aria-label="Share options"
          title="Share"
        >
          <Icon name="share" />
        </button>
      </MenuTrigger>
      <MenuContent>
        {copyLink && (
          <MenuItem className="gap-2" onClick={handleCopy}>
            <Icon name={copied ? "check" : "link"} />
            <span>{copied ? "Copied" : "Copy link"}</span>
          </MenuItem>
        )}
        <MenuItem className="gap-2" onClick={handleDownload}>
          <Icon name="download" />
          <span>Download</span>
        </MenuItem>
        {onOpenAgents && (
          <>
            <MenuSeparator />
            <MenuItem className="gap-2" onClick={onOpenAgents}>
              <Icon name="robot_2" />
              <span>Invite an agent</span>
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}
