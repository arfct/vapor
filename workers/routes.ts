/**
 * Pure request handlers for the two browser-facing routes bolted onto the
 * worker outside of routeAgentRequest/React Router: raw markdown export and
 * the /mcp help page. Deliberately does not import the `agents` package (its
 * `cloudflare:` protocol imports don't exist in plain Vitest) — `getStub` is
 * injected from workers/app.ts instead, which does have that import, so this
 * module stays unit-testable.
 */
import { isValidDocumentId } from "../app/shared/constants";
import type { AgentError } from "../app/shared/agent-protocol";
import { mcpHelpHtml, mcpHelpMarkdown } from "../app/lib/mcp-help";
import { configuredOrigin, redirectHosts, siteForRequest, type SiteConfig, type SiteEnv } from "../app/shared/site";
import skillTemplate from "../plugin/skills/vapor/SKILL.md?raw";
import { absolutizeAttachmentUrls, isImageType } from "../app/shared/attachment-policy";
import { attachmentImages, buildEpub, epubFilename, type EpubImage } from "../app/shared/epub";
import { parseDocumentSegment, titleFromMarkdown } from "../app/shared/doc-url";
import {
  mintSessionToken,
  sessionFromRequest,
  sessionCookieHeader,
  clearSessionCookieHeader,
  sameOrigin,
  principalFromEmail,
  principalFor,
  type VerifiedIdentity,
} from "../app/lib/auth.server";

/** The subset of the DocumentAgent RPC surface handleRawMarkdown calls. */
export interface MarkdownStub {
  exportMarkdown(): Promise<{ markdown: string } | { error: AgentError }>;
}

/** What building an EPUB needs from a document and its attachments. */
export interface EpubDeps {
  getStub(id: string): Promise<MarkdownStub & { attachmentInfo(id: string): Promise<{ filename: string; contentType: string } | null> }>;
  /** The attachment's bytes from R2, or null. */
  getAttachment(docId: string, attachmentId: string): Promise<Uint8Array | null>;
}

/**
 * The document as an EPUB, ready for a Kindle or a reMarkable: the same
 * markdown as `/:id.md`, CriticMarkup resolved as accepted, attachments
 * embedded so the file stands alone (#100). Null unless the request is a
 * GET on `/<8-char-id>.epub`; 404 for a document that doesn't exist.
 */
export async function buildDocumentEpub(
  id: string,
  deps: EpubDeps,
  origin: string,
): Promise<{ bytes: Uint8Array; filename: string; title: string | null } | null> {
  const stub = await deps.getStub(id);
  const result = await stub.exportMarkdown();
  if ("error" in result) return null;
  const images: EpubImage[] = [];
  for (const ref of attachmentImages(result.markdown)) {
    if (ref.path.split("/")[1] !== id) continue; // another document's attachment: leave the link alone
    const [info, bytes] = await Promise.all([stub.attachmentInfo(ref.id), deps.getAttachment(id, ref.id)]);
    if (!info || !bytes || !isImageType(info.contentType)) continue;
    images.push({ path: ref.path, bytes, contentType: info.contentType, filename: info.filename });
  }
  return {
    bytes: buildEpub({ id, markdown: result.markdown, images, sourceUrl: `${origin}/${id}` }),
    filename: epubFilename(id, result.markdown),
    title: titleFromMarkdown(result.markdown),
  };
}

export async function handleEpub(request: Request, deps: EpubDeps): Promise<Response | null> {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  const match = /^\/([^/]+)\.epub$/.exec(url.pathname);
  if (!match) return null;
  // The bare id, or the slugged form the address bar shows (`/a-plan-abcd1234`).
  const id = parseDocumentSegment(match[1])?.id ?? null;
  if (!id || !isValidDocumentId(id)) return null;

  const built = await buildDocumentEpub(id, deps, url.origin);
  if (!built) return new Response("Not found", { status: 404 });
  return new Response(built.bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/epub+zip",
      "Content-Disposition": `attachment; filename="${built.filename.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * `GET /:id.md` — a document's full markdown as `text/markdown`, public by
 * URL like the rest of vapor (no token). Returns null (letting the worker
 * fall through to the next route) for anything that isn't a GET on a
 * `/<id>.md` or `/<slug>-<id>.md` path; 404 for a valid-format id whose
 * document doesn't exist.
 */
export async function handleRawMarkdown(
  request: Request,
  getStub: (id: string) => Promise<MarkdownStub>,
): Promise<Response | null> {
  if (request.method !== "GET") return null;

  const url = new URL(request.url);
  const match = /^\/([^/]+)\.md$/.exec(url.pathname);
  if (!match) return null;

  // `/26g5wsew.md` or `/agent-identity-plan-26g5wsew.md`; the slug is ignored.
  const parsed = parseDocumentSegment(match[1]);
  if (!parsed) return null;
  const { id } = parsed;

  const stub = await getStub(id);
  const result = await stub.exportMarkdown();
  if ("error" in result) {
    return new Response("Not found", { status: 404 });
  }

  // Attachment paths become absolute URLs on this request's origin, so the
  // file is complete wherever it is opened.
  return new Response(absolutizeAttachmentUrls(result.markdown, url.origin), {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      // Raw, user-authored content served at a public URL — don't let a
      // browser sniff it into something more dangerous than markdown.
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * `GET /mcp` — anyone landing on the MCP endpoint gets the how-to-connect
 * guide instead of a protocol error: HTML for a browser, markdown for curl
 * or an agent's fetch tool. The one GET a real MCP client makes is the
 * Streamable HTTP event stream, `Accept: text/event-stream`, which falls
 * through (null) to `VaporMcp.serve`; clients POST everything else. Must be
 * checked before that branch in workers/app.ts.
 */
export function handleMcpHelp(request: Request, env: SiteEnv = {}): Response | null {
  if (request.method !== "GET") return null;

  const url = new URL(request.url);
  if (url.pathname !== "/mcp" && url.pathname !== "/mcp/anonymous") return null;

  const accept = request.headers.get("Accept") ?? "";
  if (accept.includes("text/event-stream")) return null;

  const site = siteForRequest(env, url.origin);
  if (accept.includes("text/html")) {
    return new Response(mcpHelpHtml(site), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return markdownGuide(site);
}

/** `GET /llms.txt` — the guide as the plain-text file agents look for first. */
export function handleLlmsTxt(request: Request, env: SiteEnv = {}): Response | null {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (url.pathname !== "/llms.txt") return null;
  return markdownGuide(siteForRequest(env, url.origin));
}

function markdownGuide(site: SiteConfig): Response {
  return new Response(mcpHelpMarkdown(site), {
    status: 200,
    headers: { "Content-Type": "text/markdown; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  });
}

/** The origin the canonical skill text is written against. */
const SKILL_TEMPLATE_ORIGIN = "https://vapor.fyi";

/**
 * The skill file for this instance: the plugin's canonical SKILL.md with its
 * URLs rewritten to the serving origin, so `curl <your-instance>/skill.md`
 * teaches an agent to draft on your instance rather than on the reference one.
 */
export function skillMarkdown(origin: string): string {
  return skillTemplate.split(SKILL_TEMPLATE_ORIGIN).join(origin);
}

/** `GET /skill.md` — the Agent Skills file, addressed to this instance. */
export function handleSkill(request: Request, env: SiteEnv = {}): Response | null {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (url.pathname !== "/skill.md") return null;
  const site = siteForRequest(env, url.origin);
  return new Response(skillMarkdown(site.origin), {
    status: 200,
    headers: { "Content-Type": "text/markdown; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  });
}

/**
 * Redirects alias hostnames to the canonical origin. The aliases come from
 * the REDIRECT_HOSTS var (comma-separated) and the target from PUBLIC_ORIGIN;
 * with either unset nothing is redirected, so a fresh deploy on workers.dev,
 * a preview, or localhost is never bounced anywhere. Path and query string
 * are preserved; the redirect is a 301 because the aliases are permanent.
 */
export function redirectHost(request: Request, env: SiteEnv = {}): Response | null {
  const canonical = configuredOrigin(env);
  const aliases = redirectHosts(env);
  if (!canonical || aliases.length === 0) return null;

  const url = new URL(request.url);
  const hostname = url.hostname.toLowerCase();
  if (!aliases.includes(hostname)) return null;
  // Never redirect the canonical host to itself, however the vars are set.
  if (hostname === new URL(canonical).hostname.toLowerCase()) return null;

  const targetUrl = `${canonical}${url.pathname}${url.search}`;
  return new Response(null, {
    status: 301,
    headers: {
      Location: targetUrl,
    },
  });
}

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Dependencies handleAuth needs, injected from workers/app.ts. */
export interface AuthDeps {
  secret: string;
  /** Google OAuth client id; empty disables Google sign-in. */
  googleClientId: string;
  /** Sign in with Apple Services ID; empty (or absent) disables Apple sign-in. */
  appleClientId?: string;
  /** Injectable for tests; production passes verifyGoogleIdToken. */
  verifyGoogle: (credential: string, clientId: string) => Promise<VerifiedIdentity | null>;
  /** Injectable for tests; production passes verifyAppleIdToken. */
  verifyApple?: (credential: string, clientId: string) => Promise<VerifiedIdentity | null>;
  upsertProfile: (
    principal: string,
    info: { displayName: string; avatar?: string; email?: string; legacyPrincipal?: string },
  ) => Promise<{ profile: AuthProfile }>;
  getProfile: (principal: string) => Promise<{ profile: AuthProfile | null }>;
  /** A typed address to the person behind it; see Registry.resolveEmail. */
  resolveEmail?: (
    requester: string,
    email: string,
  ) => Promise<
    | { person: { uid: string; displayName: string; avatar: string | null } | null }
    | { error: { code: string; message: string } }
  >;
}

/** The profile fields the auth routes read. `uid` is the public id; nothing here is the principal. */
export interface AuthProfile {
  uid: string;
  displayName: string;
  avatar: string | null;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/**
 * Apple's authorization response carries the person's name exactly once, on
 * first consent, outside the ID token. The browser forwards it here; after
 * that the stored profile name is what we have.
 */
function appleUserName(user: unknown): string | null {
  if (typeof user !== "object" || user === null) return null;
  const name = (user as { name?: unknown }).name;
  if (typeof name !== "object" || name === null) return null;
  const { firstName, lastName } = name as { firstName?: unknown; lastName?: unknown };
  const full = [firstName, lastName]
    .filter((part): part is string => typeof part === "string")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
  return full.length > 0 && full.length <= 200 ? full : null;
}

/**
 * `/auth/*` — sign-in sessions (Google, Apple). Returns null for non-auth
 * paths so the worker falls through. Sign-in is optional everywhere; these
 * routes only mint and read the `vp_session` cookie.
 */
export async function handleAuth(request: Request, deps: AuthDeps): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/auth/")) return null;
  const secure = url.protocol === "https:";

  // Which providers this instance offers. The client renders a button per
  // non-empty id; an instance with neither is anonymous-only.
  if (request.method === "GET" && url.pathname === "/auth/config") {
    return json({ googleClientId: deps.googleClientId, appleClientId: deps.appleClientId ?? "" });
  }

  // The signed-in person's own view of themselves. `uid` is the public id
  // the client uses for presence and attribution; the principal never
  // leaves the server (docs/plans/2026-09-06-agent-identity-plan.md).
  if (request.method === "GET" && url.pathname === "/auth/me") {
    const session = await sessionFromRequest(request, deps.secret);
    if (!session) return json({ signedIn: false });
    const { profile } = await deps.getProfile(session.principal);
    return json({
      signedIn: true,
      uid: profile?.uid ?? null,
      email: session.email,
      displayName: profile?.displayName ?? session.email,
      avatar: profile?.avatar ?? null,
    });
  }

  // `@` completion typed an address: hand back the person's name and public
  // id so the token can be inserted, or nothing. Signed-in callers only —
  // the answer says whether an address has an account here.
  if (request.method === "GET" && url.pathname === "/auth/resolve") {
    const session = await sessionFromRequest(request, deps.secret);
    if (!session) return json({ error: "sign_in_required" }, 401);
    const email = url.searchParams.get("email")?.trim().toLowerCase() ?? "";
    if (!/^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(email) || email.length > 254) {
      return json({ error: "invalid_email" }, 400);
    }
    if (!deps.resolveEmail) return json({ person: null });
    const result = await deps.resolveEmail(session.principal, email);
    if ("error" in result) return json(result, result.error.code === "rate_limited" ? 429 : 400);
    return json(result);
  }

  if (request.method === "POST" && url.pathname === "/auth/logout") {
    return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookieHeader(secure) });
  }

  /** Mints the session for a verified identity and answers the sign-in POST. */
  async function completeSignIn(
    principal: string,
    verified: VerifiedIdentity,
    info: { displayName: string; avatar?: string; legacyPrincipal?: string },
  ): Promise<Response> {
    const email = verified.email.toLowerCase();
    const { profile } = await deps.upsertProfile(principal, { ...info, email });
    const token = await mintSessionToken({ principal, email }, deps.secret, SESSION_TTL_SECONDS);
    return json(
      { signedIn: true, uid: profile.uid, displayName: profile.displayName },
      200,
      { "Set-Cookie": sessionCookieHeader(token, SESSION_TTL_SECONDS, secure) },
    );
  }

  if (request.method === "POST" && url.pathname === "/auth/google") {
    if (!sameOrigin(request)) {
      return json({ error: "cross-origin sign-in rejected" }, 403);
    }
    let credential: string | undefined;
    try {
      const body = (await request.json()) as { credential?: string };
      credential = body.credential;
    } catch {
      return json({ error: "invalid body" }, 400);
    }
    if (!credential) return json({ error: "missing credential" }, 400);

    const verified = await deps.verifyGoogle(credential, deps.googleClientId);
    if (!verified) return json({ error: "invalid credential" }, 401);

    return completeSignIn(principalFor("google", verified.sub), verified, {
      displayName: verified.name || verified.email,
      avatar: verified.picture,
      // Profiles created before the principal was keyed on `sub`.
      legacyPrincipal: principalFromEmail(verified.email),
    });
  }

  // Sign in with Apple (JS popup flow). Body: the authorization response's
  // `id_token`, plus `user` (name) on the first authorization only.
  if (request.method === "POST" && url.pathname === "/auth/apple") {
    if (!sameOrigin(request)) {
      return json({ error: "cross-origin sign-in rejected" }, 403);
    }
    if (!deps.appleClientId || !deps.verifyApple) return json({ error: "apple sign-in not configured" }, 404);
    let idToken: string | undefined;
    let user: unknown;
    try {
      const body = (await request.json()) as { id_token?: string; user?: unknown };
      idToken = body.id_token;
      user = body.user;
    } catch {
      return json({ error: "invalid body" }, 400);
    }
    if (!idToken) return json({ error: "missing id_token" }, 400);

    const verified = await deps.verifyApple(idToken, deps.appleClientId);
    if (!verified) return json({ error: "invalid credential" }, 401);

    // Apple gives the name once; keep whatever the profile already has on
    // later sign-ins, and fall back to the address only for a brand-new one.
    const principal = principalFor("apple", verified.sub);
    const fromResponse = appleUserName(user);
    const existing = fromResponse ? null : (await deps.getProfile(principal)).profile;
    return completeSignIn(principal, verified, {
      displayName: fromResponse ?? existing?.displayName ?? verified.email.toLowerCase(),
    });
  }

  return null;
}

/**
 * `GET /docs/:id` and `GET /docs/:id.md` — permanent redirects to the current
 * root-level document URLs (`/:id`, `/:id.md`).
 *
 * Documents used to live under `/docs/`, and documents last 99 hours, so
 * links shared before the rename are still being opened. Without this they
 * 404. 301 (permanent) because the move is permanent, and the `Location` is
 * path-relative so the redirect stays on whichever host served it — the
 * canonical domain, a workers.dev preview, or localhost. The query string
 * is preserved verbatim.
 *
 * Returns null for anything else, including a `/docs/` path whose id isn't a
 * valid document id, so those keep falling through to the normal 404.
 */
export function redirectLegacyDocPath(request: Request): Response | null {
  if (request.method !== "GET") return null;

  const url = new URL(request.url);
  const match = /^\/docs\/([^/]+?)(\.md)?$/.exec(url.pathname);
  if (!match) return null;

  const id = match[1];
  if (!isValidDocumentId(id)) return null;

  const target = `/${id}${match[2] ?? ""}${url.search}`;
  return new Response(null, {
    status: 301,
    headers: { Location: target },
  });
}
