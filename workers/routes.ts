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
import { mcpHelpHtml } from "../app/lib/mcp-help";

/** The subset of the DocumentAgent RPC surface handleRawMarkdown calls. */
export interface MarkdownStub {
  exportMarkdown(): Promise<{ markdown: string } | { error: AgentError }>;
}

/**
 * `GET /:id.md` — a document's full markdown as `text/markdown`, public by
 * URL like the rest of vapor (no token). Returns null (letting the worker
 * fall through to the next route) for anything that isn't a GET on a
 * `/<8-char-id>.md` path; 404 for a valid-format id whose document doesn't
 * exist.
 */
export async function handleRawMarkdown(
  request: Request,
  getStub: (id: string) => Promise<MarkdownStub>,
): Promise<Response | null> {
  if (request.method !== "GET") return null;

  const url = new URL(request.url);
  const match = /^\/([^/]+)\.md$/.exec(url.pathname);
  if (!match) return null;

  const id = match[1];
  if (!isValidDocumentId(id)) return null;

  const stub = await getStub(id);
  const result = await stub.exportMarkdown();
  if ("error" in result) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(result.markdown, {
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
 * `GET /mcp` with `Accept: text/html` — a browser landing on the MCP
 * endpoint gets a how-to-connect page instead of a protocol error. MCP
 * clients POST with an `application/json`-flavoured Accept header, so they
 * never match this and fall through to `VaporMcp.serve`. Must be checked
 * before that branch in workers/app.ts.
 */
export function handleMcpHelp(request: Request): Response | null {
  if (request.method !== "GET") return null;

  const url = new URL(request.url);
  if (url.pathname !== "/mcp") return null;

  const accept = request.headers.get("Accept") ?? "";
  if (!accept.includes("text/html")) return null;

  return new Response(mcpHelpHtml(url.origin), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/**
 * Redirects secondary domains to the primary vapor.fyi domain. Hostnames
 * vpr.fyi, www.vpr.fyi, vaporware.fyi, www.vaporware.fyi, and www.vapor.fyi
 * are 301 redirected to https://vapor.fyi with the original path and query
 * string preserved. Returns null for the primary domain (vapor.fyi),
 * localhost, and *.workers.dev subdomains.
 */
export function redirectHost(request: Request): Response | null {
  const url = new URL(request.url);
  const hostname = url.hostname;

  // The www.* entries are not (yet) registered routes for this worker — they
  // only ever fire if DNS is later pointed at it, and are harmless until then.
  const redirectTargets = [
    "vpr.fyi",
    "www.vpr.fyi",
    "vaporware.fyi",
    "www.vaporware.fyi",
    "www.vapor.fyi",
  ];

  if (!redirectTargets.includes(hostname)) {
    return null;
  }

  const targetUrl = `https://vapor.fyi${url.pathname}${url.search}`;
  return new Response(null, {
    status: 301,
    headers: {
      Location: targetUrl,
    },
  });
}

/**
 * `GET /docs/:id` and `GET /docs/:id.md` — permanent redirects to the current
 * root-level document URLs (`/:id`, `/:id.md`).
 *
 * Documents used to live under `/docs/`; vapor.fyi is live and documents last
 * 99 hours, so links shared before the rename are still being opened. Without
 * this they 404. 301 (permanent) because the move is permanent, and the
 * `Location` is path-relative so the redirect stays on whichever host served
 * it — vapor.fyi, a workers.dev preview, or localhost. The query string is
 * preserved verbatim.
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
