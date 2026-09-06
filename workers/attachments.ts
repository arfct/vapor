/**
 * Attachment upload and serving, as pure handlers with their dependencies
 * injected (the R2 bucket, the document and Registry stubs, the session
 * secret), in the `workers/routes.ts` style so they are unit-testable
 * without `cloudflare:` imports. Wired in workers/app.ts before
 * routeAgentRequest. Design: docs/plans/2026-09-05-attachments-plan.md.
 */
import { isValidDocumentId } from "../app/shared/constants";
import {
  ATTACHMENT_ID_RE,
  MAX_FILE_BYTES,
  attachmentPath,
  isImageType,
  sniffContentType,
  type AttachmentError,
} from "../app/shared/attachment-policy";
import { sessionFromRequest, verifySessionToken, sameOrigin } from "../app/lib/auth.server";

/** What the handlers need from a DocumentAgent. */
export interface AttachmentDocStub {
  reserveAttachment(args: {
    filename: string;
    bytes: number;
    uploader: string;
    uploaderName: string;
  }): Promise<{ id: string; filename: string } | { error: AttachmentError }>;
  commitAttachment(id: string, info: { contentType: string; bytes: number }): Promise<{ ok: true } | { error: AttachmentError }>;
  releaseAttachment(id: string): Promise<{ ok: true }>;
  attachmentInfo(id: string): Promise<{ filename: string; contentType: string; bytes: number } | null>;
  remainingLifetimeMs(): Promise<number>;
}

/** What the handlers need from the Registry. */
export interface BudgetStub {
  reserveUploadBudget(principal: string, bytes: number): Promise<{ ok: true; ledgerId: number } | { error: AttachmentError }>;
  releaseUploadBudget(ledgerId: number): Promise<{ ok: true }>;
}

/** The slice of R2 used, shaped so a test can fake it with a Map. */
export interface AttachmentBucket {
  put(key: string, body: ReadableStream<Uint8Array> | Uint8Array, length: number, contentType: string): Promise<void>;
  get(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number } | null>;
  delete(key: string): Promise<void>;
}

export interface AttachmentDeps {
  bucket: AttachmentBucket;
  getDocStub(docId: string): Promise<AttachmentDocStub>;
  registry: BudgetStub;
  secret: string;
  /** Display name for a principal (the profile's name), for attribution. */
  displayName?(principal: string): Promise<string | null>;
  /** The edge cache; optional so tests can skip it. */
  cache?: { match(req: Request): Promise<Response | undefined>; put(req: Request, res: Response): Promise<void> };
}

export interface Principal {
  principal: string;
  name: string;
  /** How the caller proved who they are. */
  via: "cookie" | "bearer";
}

const STATUS: Record<AttachmentError, number> = {
  attachment_too_large: 413,
  attachment_budget: 413,
  principal_budget: 429,
  attachment_type: 415,
  attachment_not_found: 404,
  doc_not_found: 404,
  length_required: 411,
  sign_in_required: 401,
  capability_denied: 403,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const refuse = (error: AttachmentError) => json({ error }, STATUS[error]);

/**
 * Who is uploading: a signed-in person (session cookie, same-origin only)
 * or an agent on the OAuth door holding `write` (Bearer token). Anonymous
 * visitors and the tokenless MCP door cannot upload; storage is the one
 * place a stranger can impose a durable, metered cost.
 */
export async function resolvePrincipal(request: Request, deps: AttachmentDeps): Promise<Principal | AttachmentError> {
  const bearer = request.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    const claims = await verifySessionToken(bearer, deps.secret);
    if (!claims) return "sign_in_required";
    if (!claims.caps?.includes("write")) return "capability_denied";
    const owner = (await deps.displayName?.(claims.principal)) ?? claims.email.split("@")[0] ?? "Someone";
    return { principal: claims.principal, name: `${owner.trim().split(/\s+/)[0] || "Someone"}'s Agent`, via: "bearer" };
  }
  if (!sameOrigin(request)) return "sign_in_required";
  const session = await sessionFromRequest(request, deps.secret);
  if (!session) return "sign_in_required";
  const name = (await deps.displayName?.(session.principal)) ?? session.email.split("@")[0] ?? "Someone";
  return { principal: session.principal, name, via: "cookie" };
}

/** Read the first `n` bytes of a stream, then hand back a stream that replays them. */
export async function peekStream(
  stream: ReadableStream<Uint8Array>,
  n: number,
): Promise<{ head: Uint8Array; stream: ReadableStream<Uint8Array> }> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let have = 0;
  while (have < n) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    have += value.byteLength;
  }
  const head = new Uint8Array(have);
  let offset = 0;
  for (const c of chunks) {
    head.set(c, offset);
    offset += c.byteLength;
  }
  const replay = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const c of chunks) controller.enqueue(c);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { head: head.slice(0, n), stream: replay };
}

/** Pass bytes through, failing the stream if more than `expected` arrive. */
export function boundedStream(expected: number): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0;
  return new TransformStream({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > expected) controller.error(new Error("body exceeds declared Content-Length"));
      else controller.enqueue(chunk);
    },
  });
}

const DOC_ATTACHMENTS_RE = /^\/([a-z0-9]{8})\/attachments\/?$/;
const ONE_ATTACHMENT_RE = /^\/([a-z0-9]{8})\/attachments\/([a-z2-7]{16})\/([^/]+)$/;

export interface StoredAttachment {
  id: string;
  url: string;
  filename: string;
  contentType: string;
  bytes: number;
  /** The canonical markdown for the block, for callers that insert it. */
  markdown: string;
}

/**
 * The reserve → sniff → stream → commit sequence, shared by the HTTP route
 * and the agent `attach` tool. Any failure past reservation releases both
 * budgets and deletes the object; R2 deletes are free.
 */
export async function storeAttachment(
  deps: AttachmentDeps,
  args: {
    docId: string;
    filename: string;
    bytes: number;
    head: Uint8Array;
    body: ReadableStream<Uint8Array> | Uint8Array;
    who: Principal;
  },
): Promise<StoredAttachment | { error: AttachmentError }> {
  if (args.bytes > MAX_FILE_BYTES) return { error: "attachment_too_large" };
  const budget = await deps.registry.reserveUploadBudget(args.who.principal, args.bytes);
  if ("error" in budget) return budget;

  const stub = await deps.getDocStub(args.docId);
  const reserved = await stub.reserveAttachment({
    filename: args.filename,
    bytes: args.bytes,
    uploader: args.who.principal,
    uploaderName: args.who.name,
  });
  if ("error" in reserved) {
    await deps.registry.releaseUploadBudget(budget.ledgerId);
    return reserved;
  }

  const release = async (error: AttachmentError) => {
    await Promise.all([deps.registry.releaseUploadBudget(budget.ledgerId), stub.releaseAttachment(reserved.id)]);
    return { error };
  };

  const contentType = sniffContentType(reserved.filename, args.head);
  if (!contentType) return release("attachment_type");

  const key = `${args.docId}/${reserved.id}`;
  try {
    await deps.bucket.put(key, args.body, args.bytes, contentType);
  } catch {
    await deps.bucket.delete(key).catch(() => {});
    return release("attachment_too_large");
  }
  const committed = await stub.commitAttachment(reserved.id, { contentType, bytes: args.bytes });
  if ("error" in committed) {
    await deps.bucket.delete(key).catch(() => {});
    return release(committed.error);
  }

  const url = attachmentPath(args.docId, reserved.id, reserved.filename);
  const markdown = isImageType(contentType) ? `![${reserved.filename}](${url})` : `[${reserved.filename}](${url})`;
  return { id: reserved.id, url, filename: reserved.filename, contentType, bytes: args.bytes, markdown };
}

/**
 * `POST /:docId/attachments` — the file is the body, its name in
 * `X-Filename` (or the `filename` query param). Content-Length is required:
 * R2 needs a known length and so does the budget. The body streams through
 * to R2 and is never buffered in the Worker.
 */
export async function handleAttachmentUpload(request: Request, deps: AttachmentDeps): Promise<Response | null> {
  if (request.method !== "POST") return null;
  const url = new URL(request.url);
  const match = DOC_ATTACHMENTS_RE.exec(url.pathname);
  if (!match) return null;
  const docId = match[1];
  if (!isValidDocumentId(docId)) return null;

  const who = await resolvePrincipal(request, deps);
  if (typeof who === "string") return refuse(who);

  const declared = Number(request.headers.get("Content-Length"));
  if (!Number.isFinite(declared) || declared <= 0) return refuse("length_required");
  if (declared > MAX_FILE_BYTES) return refuse("attachment_too_large");
  if (!request.body) return refuse("length_required");

  const filename = request.headers.get("X-Filename") ?? url.searchParams.get("filename") ?? "file";
  const { head, stream } = await peekStream(request.body, 8192);
  const body = stream.pipeThrough(boundedStream(declared));

  const stored = await storeAttachment(deps, { docId, filename: decodeURIComponent(filename), bytes: declared, head, body, who });
  if ("error" in stored) return refuse(stored.error);
  return json(stored, 201);
}

/**
 * `GET /:docId/attachments/:id/:filename` — streams the object with a type
 * the server chose, sandboxed so a mis-sniffed file can't script against
 * the origin, cached at the edge for the document's remaining life.
 */
export async function handleAttachmentServe(request: Request, deps: AttachmentDeps): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  const match = ONE_ATTACHMENT_RE.exec(url.pathname);
  if (!match) return null;
  const [, docId, id] = match;
  if (!isValidDocumentId(docId) || !ATTACHMENT_ID_RE.test(id)) return null;

  const cached = await deps.cache?.match(request);
  if (cached) return cached;

  const stub = await deps.getDocStub(docId);
  const info = await stub.attachmentInfo(id);
  if (!info) return new Response("Not found", { status: 404 });
  const object = await deps.bucket.get(`${docId}/${id}`);
  if (!object) return new Response("Not found", { status: 404 });

  const lifetime = Math.max(60, Math.floor((await stub.remainingLifetimeMs()) / 1000));
  const disposition = isImageType(info.contentType) ? "inline" : "attachment";
  const response = new Response(request.method === "HEAD" ? null : object.body, {
    status: 200,
    headers: {
      "Content-Type": info.contentType,
      "Content-Length": String(object.size),
      "Content-Disposition": `${disposition}; filename="${info.filename.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": `public, max-age=${lifetime}, immutable`,
    },
  });
  if (request.method === "GET" && deps.cache) await deps.cache.put(request, response.clone());
  return response;
}
