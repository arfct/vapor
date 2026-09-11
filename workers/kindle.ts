/**
 * Send to Kindle delivery (#100): Amazon takes documents by email to the
 * reader's @kindle.com address, from a sender the reader has approved. The
 * instance sends through Resend's HTTP API — one request, no SDK — when the
 * operator has set RESEND_API_KEY and SEND_FROM_EMAIL. `fetch` is injected
 * so the request shape unit-tests without the network.
 */

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface KindleMailer {
  apiKey: string;
  from: string;
}

/** The operator's mailer, or null when the instance cannot send email. */
export function kindleMailerFromEnv(env: { RESEND_API_KEY?: string; SEND_FROM_EMAIL?: string }): KindleMailer | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.SEND_FROM_EMAIL?.trim();
  return apiKey && from ? { apiKey, from } : null;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Mails the EPUB to a Kindle address. The subject is the document title; Kindle ignores the body. */
export async function sendToKindle(
  mailer: KindleMailer,
  message: { to: string; title: string; filename: string; bytes: Uint8Array; sourceUrl: string },
  fetchImpl: Fetch = fetch,
): Promise<{ ok: true; id: string | null } | { error: string }> {
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${mailer.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: mailer.from,
      to: [message.to],
      subject: message.title,
      text: `${message.title}\n\nSent from vapor: ${message.sourceUrl}`,
      attachments: [{ filename: message.filename, content: base64(message.bytes), content_type: "application/epub+zip" }],
    }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    return { error: `The mail service refused the message (${res.status})${detail ? `: ${detail}` : ""}` };
  }
  let id: string | null = null;
  try {
    id = ((await res.json()) as { id?: string }).id ?? null;
  } catch {
    // fine
  }
  return { ok: true, id };
}
