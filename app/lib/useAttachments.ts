import { useCallback, useEffect, useRef } from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { useSession } from "~/lib/useSession";
import { showSuggestNotice } from "~/lib/suggest-notice";
import { isImageType, type AttachmentError } from "~/shared/attachment-policy";
import type { DocMode } from "~/shared/types";

export interface UploadedAttachment {
  id: string;
  url: string;
  filename: string;
  contentType: string;
  bytes: number;
  markdown: string;
}

/** Plain words for each refusal the server can give. */
export function describeAttachmentError(error: AttachmentError | string): string {
  switch (error) {
    case "attachment_too_large":
      return "That file is over 20 MB.";
    case "attachment_budget":
      return "This document is out of attachment room.";
    case "principal_budget":
      return "You've uploaded a lot today; try again tomorrow.";
    case "attachment_type":
      return "That file type isn't allowed here.";
    case "sign_in_required":
      return "Sign in to attach files.";
    case "capability_denied":
      return "This account can't attach files here.";
    default:
      return "The upload didn't go through.";
  }
}

/** POST the file to the document; the browser sets Content-Length for a Blob body. */
export async function uploadAttachment(
  docId: string,
  file: File,
): Promise<{ ok: true; attachment: UploadedAttachment } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/${docId}/attachments`, {
      method: "POST",
      headers: { "X-Filename": encodeURIComponent(file.name), "Content-Type": "application/octet-stream" },
      body: file,
    });
    const body = (await res.json().catch(() => ({}))) as Partial<UploadedAttachment> & { error?: string };
    if (!res.ok) return { ok: false, error: body.error ?? "upload_failed" };
    return { ok: true, attachment: body as UploadedAttachment };
  } catch {
    return { ok: false, error: "upload_failed" };
  }
}

/** Ask the menu to show its sign-in; HeaderMenu listens for this. */
export const SIGN_IN_EVENT = "vapor:sign-in";

/**
 * Attaching files to the open document: refuses in Suggest mode (structure
 * changes have no tracked form) and on the tour (no document to hold the
 * file); holds the files across a sign-in when the visitor is anonymous,
 * then uploads each and inserts its block where it was dropped, or at the
 * caret. The node is inserted only after the server has the bytes, so no
 * other client or agent ever sees a half-uploaded placeholder.
 */
export function useAttachments({
  docId,
  enabled,
  editor,
  mode,
}: {
  docId: string;
  enabled: boolean;
  editor: TiptapEditor | null;
  mode: DocMode;
}): { attach: (files: File[], pos?: number) => void } {
  const session = useSession();
  const held = useRef<{ files: File[]; pos?: number } | null>(null);

  const run = useCallback(
    async (files: File[], pos?: number) => {
      if (!editor) return;
      let at = pos ?? editor.state.selection.to;
      for (const file of files) {
        showSuggestNotice(`Uploading ${file.name}…`);
        const result = await uploadAttachment(docId, file);
        if (!result.ok) {
          showSuggestNotice(describeAttachmentError(result.error));
          continue;
        }
        const { attachment } = result;
        const node = {
          type: "attachment",
          attrs: {
            kind: isImageType(attachment.contentType) ? "image" : "file",
            src: attachment.url,
            alt: attachment.filename,
            bytes: attachment.bytes,
          },
        };
        const before = editor.state.doc.content.size;
        editor.chain().focus().insertContentAt(Math.min(at, before), node).run();
        at = Math.min(at + (editor.state.doc.content.size - before), editor.state.doc.content.size);
        showSuggestNotice(`Attached ${attachment.filename}.`);
      }
    },
    [docId, editor],
  );

  const attach = useCallback(
    (files: File[], pos?: number) => {
      if (files.length === 0) return;
      if (!enabled) {
        showSuggestNotice("Attachments need a real document. Create one first.");
        return;
      }
      if (mode === "suggest") {
        showSuggestNotice();
        return;
      }
      if (!session?.signedIn) {
        held.current = { files, pos };
        showSuggestNotice("Sign in to attach files.");
        window.dispatchEvent(new Event(SIGN_IN_EVENT));
        return;
      }
      run(files, pos);
    },
    [enabled, mode, session?.signedIn, run],
  );

  // A drop that waited for sign-in proceeds once the session arrives.
  useEffect(() => {
    if (!session?.signedIn || !held.current) return;
    const pending = held.current;
    held.current = null;
    run(pending.files, pending.pos);
  }, [session?.signedIn, run]);

  return { attach };
}
