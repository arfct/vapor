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
 * Share a document: its id, connection, and expiry; the system share
 * sheet where there is one; Copy link; Download; and inviting an agent.
 */
export default function ShareButton({ onInviteAgent }: { onInviteAgent?: () => void } = {}) {
  const { docId, createdAt, markdown, threads } = useDocument();
  const [copyState, setCopyState] = useState<CopyState>("idle");

  const handleCopy = useCallback(async () => {
    const copied = await copyText(window.location.href);
    setCopyState(copied ? "copied" : "failed");
    setTimeout(() => setCopyState("idle"), COPY_FEEDBACK_MS);
  }, []);

  // The menu only renders client-side once opened, so reading navigator
  // here can't mismatch the server render.
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const handleShare = useCallback(async () => {
    try {
      await navigator.share({ title: document.title, url: window.location.href });
    } catch {
      // Dismissed share sheet.
    }
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
          className="header-button"
          aria-label="Share options"
          title="Share"
        >
          <Icon name="ios_share" />
        </button>
      </MenuTrigger>
      <MenuContent align="end">
        {/* Connection, id, and expiry: the header has no room for them. */}
        <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted">
          <ConnectionStatus compact />
          <span className="font-mono font-bold text-ink">{docId}</span>
          {createdAt && <span>vaporized in {formatRemainingTime(createdAt)}</span>}
        </div>
        <MenuSeparator />
        {canShare && (
          <MenuItem className="gap-2" onClick={handleShare}>
            <Icon name="ios_share" />
            <span>Share link</span>
          </MenuItem>
        )}
        <MenuItem className="gap-2" onClick={handleCopy}>
          <Icon name={COPY_ICON[copyState]} />
          <span>{COPY_LABEL[copyState]}</span>
        </MenuItem>
        <MenuItem className="gap-2" onClick={handleDownload}>
          <Icon name="download" />
          <span>Download</span>
        </MenuItem>
        {onInviteAgent && (
          <>
            <MenuSeparator />
            <MenuItem className="gap-2" onClick={onInviteAgent}>
              <Icon name="robot_2" />
              <span>Invite an agent</span>
            </MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}
