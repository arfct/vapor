/**
 * `/me/devices` and `POST /:id/send` — Send to Kindle / reMarkable (#100).
 * A signed-in person saves a Kindle address or pairs a reMarkable once,
 * then sends any document as an EPUB. Same-origin, cookie session. Pure:
 * the Registry, the EPUB builder, the mailer, and the reMarkable client are
 * behind `deps`, so this unit-tests without the network or `cloudflare:`.
 */
import { sameOrigin, sessionFromRequest } from "../app/lib/auth.server";
import { isValidDocumentId } from "../app/shared/constants";
import { validateKindleEmail, validateRemarkableCode, type DevicesView, type SendTarget } from "../app/shared/device-policy";
import type { KindleMailer } from "./kindle";

export interface DeviceRouteDeps {
  secret: string;
  getDevices(principal: string): Promise<{ devices: DevicesView }>;
  setKindleEmail(principal: string, email: string | null): Promise<{ devices: DevicesView }>;
  pairRemarkable(code: string): Promise<{ deviceToken: string } | { error: string }>;
  setRemarkableToken(principal: string, deviceToken: string): Promise<{ devices: DevicesView }>;
  clearRemarkable(principal: string): Promise<{ devices: DevicesView }>;
  openRemarkableToken(principal: string): Promise<{ deviceToken: string | null }>;
  allowSend(principal: string): Promise<{ allowed: boolean }>;
  /** The operator's mailer, or null when the instance cannot send email. */
  mailer: KindleMailer | null;
  buildEpub(docId: string, origin: string): Promise<{ bytes: Uint8Array; filename: string; title: string | null } | null>;
  sendKindle(
    mailer: KindleMailer,
    message: { to: string; title: string; filename: string; bytes: Uint8Array; sourceUrl: string },
  ): Promise<{ ok: true; id: string | null } | { error: string }>;
  remarkableUserToken(deviceToken: string): Promise<{ userToken: string } | { error: string }>;
  uploadRemarkable(
    userToken: string,
    file: { filename: string; bytes: Uint8Array; contentType: "application/epub+zip" },
  ): Promise<{ ok: true; id: string | null } | { error: string }>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** What the dialog needs to show: the person's settings and whether this instance can mail. */
function view(devices: DevicesView, deps: DeviceRouteDeps) {
  return { devices, kindleMail: deps.mailer ? { from: deps.mailer.from } : null };
}

export async function handleDeviceRoutes(request: Request, deps: DeviceRouteDeps): Promise<Response | null> {
  const url = new URL(request.url);
  const sendMatch = /^\/([a-z0-9]{8})\/send$/.exec(url.pathname);
  if (url.pathname !== "/me/devices" && !sendMatch) return null;

  const session = await sessionFromRequest(request, deps.secret);
  if (!session) return json({ error: "sign_in_required" }, 401);
  if (request.method !== "GET" && !sameOrigin(request)) {
    return json({ error: "cross-origin request rejected" }, 403);
  }
  const principal = session.principal;

  if (url.pathname === "/me/devices") {
    if (request.method === "GET") return json(view((await deps.getDevices(principal)).devices, deps));

    let body: unknown = null;
    if (request.method === "PUT" || request.method === "POST") {
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid JSON body" }, 400);
      }
    }
    const fields = (body ?? {}) as { kindle?: unknown; remarkable?: { code?: unknown } };

    if (request.method === "PUT") {
      const checked = validateKindleEmail(fields.kindle);
      if ("error" in checked) return json({ error: checked.error }, 400);
      return json(view((await deps.setKindleEmail(principal, checked.email)).devices, deps));
    }
    if (request.method === "POST") {
      const checked = validateRemarkableCode(fields.remarkable?.code);
      if ("error" in checked) return json({ error: checked.error }, 400);
      const paired = await deps.pairRemarkable(checked.code);
      if ("error" in paired) return json({ error: paired.error }, 502);
      return json(view((await deps.setRemarkableToken(principal, paired.deviceToken)).devices, deps));
    }
    if (request.method === "DELETE") {
      const target = url.searchParams.get("target");
      if (target === "kindle") return json(view((await deps.setKindleEmail(principal, null)).devices, deps));
      if (target === "remarkable") return json(view((await deps.clearRemarkable(principal)).devices, deps));
      return json({ error: "target must be kindle or remarkable" }, 400);
    }
    return json({ error: "method not allowed" }, 405);
  }

  // POST /:id/send
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  const docId = sendMatch![1];
  if (!isValidDocumentId(docId)) return json({ error: "doc_not_found" }, 404);
  let target: SendTarget | undefined;
  try {
    target = ((await request.json()) as { target?: SendTarget }).target;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  if (target !== "kindle" && target !== "remarkable") return json({ error: "target must be kindle or remarkable" }, 400);

  const { devices } = await deps.getDevices(principal);
  if (target === "kindle" && !deps.mailer) {
    return json({ error: "This vapor cannot send email. Download the EPUB and add it at amazon.com/sendtokindle." }, 409);
  }
  if (target === "kindle" && !devices.kindleEmail) return json({ error: "Save your Send to Kindle address first" }, 409);
  if (target === "remarkable" && !devices.remarkable) return json({ error: "Pair your reMarkable first" }, 409);

  if (!(await deps.allowSend(principal)).allowed) {
    return json({ error: "Too many sends in a minute — try again shortly" }, 429);
  }

  const built = await deps.buildEpub(docId, url.origin);
  if (!built) return json({ error: "doc_not_found" }, 404);
  const title = built.title ?? `vapor ${docId}`;

  if (target === "kindle") {
    const sent = await deps.sendKindle(deps.mailer!, {
      to: devices.kindleEmail!,
      title,
      filename: built.filename,
      bytes: built.bytes,
      sourceUrl: `${url.origin}/${docId}`,
    });
    if ("error" in sent) return json({ error: sent.error }, 502);
    return json({ ok: true, target, to: devices.kindleEmail, title });
  }

  const { deviceToken } = await deps.openRemarkableToken(principal);
  if (!deviceToken) return json({ error: "The reMarkable pairing could not be read; pair again" }, 409);
  const session2 = await deps.remarkableUserToken(deviceToken);
  if ("error" in session2) return json({ error: session2.error }, 502);
  const uploaded = await deps.uploadRemarkable(session2.userToken, { filename: built.filename, bytes: built.bytes, contentType: "application/epub+zip" });
  if ("error" in uploaded) return json({ error: uploaded.error }, 502);
  return json({ ok: true, target, title });
}
