/**
 * reMarkable cloud delivery (#100). Pairing exchanges a one-time code for a
 * device token (kept sealed in the Registry); each send exchanges that for
 * a short-lived user token and uploads the file to the cloud's document
 * endpoint, the one the "Read on reMarkable" browser extension uses. The
 * document lands in the reader's root folder. `fetch` is injected so the
 * request shapes unit-test without the network.
 */

const TOKEN_HOST = "https://webapp-prod.cloud.remarkable.engineering";
const UPLOAD_URL = "https://internal.cloud.remarkable.com/doc/v2/files";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** One-time code → long-lived device token. */
export async function pairRemarkable(code: string, fetchImpl: Fetch = fetch): Promise<{ deviceToken: string } | { error: string }> {
  const res = await fetchImpl(`${TOKEN_HOST}/token/json/2/device/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " },
    body: JSON.stringify({ code, deviceDesc: "browser-chrome", deviceID: crypto.randomUUID() }),
  });
  if (!res.ok) {
    return { error: res.status === 401 || res.status === 400 ? "reMarkable did not accept that code — codes expire quickly; get a fresh one" : `reMarkable answered ${res.status}` };
  }
  const deviceToken = (await res.text()).trim();
  if (!deviceToken) return { error: "reMarkable returned no token" };
  return { deviceToken };
}

/** Device token → user token (valid for about a day). */
export async function remarkableUserToken(deviceToken: string, fetchImpl: Fetch = fetch): Promise<{ userToken: string } | { error: string }> {
  const res = await fetchImpl(`${TOKEN_HOST}/token/json/2/user/new`, {
    method: "POST",
    headers: { Authorization: `Bearer ${deviceToken}` },
  });
  if (!res.ok) return { error: res.status === 401 ? "reMarkable no longer recognises this pairing — pair again" : `reMarkable answered ${res.status}` };
  const userToken = (await res.text()).trim();
  if (!userToken) return { error: "reMarkable returned no session" };
  return { userToken };
}

/** Uploads one file to the reader's root folder. */
export async function uploadToRemarkable(
  userToken: string,
  file: { filename: string; bytes: Uint8Array; contentType: "application/epub+zip" | "application/pdf" },
  fetchImpl: Fetch = fetch,
): Promise<{ ok: true; id: string | null } | { error: string }> {
  const meta = btoa(JSON.stringify({ file_name: file.filename.replace(/\.(epub|pdf)$/i, ""), parent: "" }));
  const res = await fetchImpl(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": file.contentType,
      "rm-meta": meta,
      "rm-source": "RoR-Browser",
    },
    body: file.bytes as unknown as BodyInit,
  });
  if (!res.ok) return { error: `reMarkable refused the upload (${res.status})` };
  let id: string | null = null;
  try {
    const data = (await res.json()) as { docID?: string; hash?: string };
    id = data.docID ?? data.hash ?? null;
  } catch {
    // Some responses are empty; the upload still landed.
  }
  return { ok: true, id };
}
