import { useState, useCallback } from "react";
import { serializeThreads } from "~/lib/thread-serialization";
import { useDocument } from "~/lib/DocumentContext";
import { copyText } from "~/lib/clipboard";
import { Menu, MenuTrigger, MenuContent, MenuItem, MenuSeparator } from "~/components/ui/menu";
import Icon from "~/components/Icon";
import ConnectionStatus from "~/components/ConnectionStatus";
import { formatRemainingTime } from "~/lib/format-remaining";

const COPY_FEEDBACK_MS = 2000;

type CopyState = "idle" | "copied" | "failed";

const COPY_LABEL: Record<CopyState, string> = {
  idle: "Copy link",
  copied: "Copied",
  failed: "Couldn't copy",
};

const COPY_ICON: Record<CopyState, string> = {
  idle: "link",
  copied: "check",
  failed: "link",
};

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
  const { docId, createdAt, markdown, threads } = useDocument();
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const handleCopy = useCallback(async () => {
    const copied = await copyText(window.location.href);
    setCopyState(copied ? "copied" : "failed");
    setTimeout(() => setCopyState("idle"), COPY_FEEDBACK_MS);
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
          className="flex h-full w-[48px] cursor-pointer items-center justify-center transition-colors hover:bg-border"
          aria-label="Share options"
          title="Share"
        >
          <Icon name="ios_share" />
        </button>
      </MenuTrigger>
      <MenuContent>
        {copyLink && (
          <>
            {/* On phones the header has no room for these; they live here instead. */}
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted lg:hidden">
              <ConnectionStatus compact />
              <span className="font-mono font-bold text-ink">{docId}</span>
              {createdAt && <span>vaporized in {formatRemainingTime(createdAt)}</span>}
            </div>
            <MenuSeparator className="lg:hidden" />
          </>
        )}
        {copyLink && (
          <MenuItem className="gap-2" onClick={handleCopy}>
            <Icon name={COPY_ICON[copyState]} />
            <span>{COPY_LABEL[copyState]}</span>
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
