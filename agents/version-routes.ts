import type { VersionAuthor, VersionSummary } from "../app/shared/version-policy";

/**
 * What the HTTP surface needs from a DocumentAgent. Kept as an interface so
 * the handler is a pure function and unit-testable without `cloudflare:`
 * imports, in the `workers/routes.ts` style.
 */
export interface VersionStub {
  listVersions(): VersionSummary[];
  getVersionMarkdown(id: number): string | null;
  saveVersion(reason: "manual", author: VersionAuthor): { id: number } | { error: string };
  restoreVersion(id: number, actor: VersionAuthor): { ok: true } | { error: string };
}

export type VersionErrorCode =
  | "version_not_found"
  | "unsupported_markup"
  | "rate_limited"
  | "too_large"
  | "unchanged"
  | "doc_not_found";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A browser-initiated write must come from this origin; scripts elsewhere can't restore documents. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return request.headers.get("Sec-Fetch-Site") !== "cross-site";
  return origin === new URL(request.url).origin;
}

function authorFromBody(body: unknown): VersionAuthor {
  const user = (body as { user?: Partial<VersionAuthor> } | null)?.user ?? {};
  return {
    kind: "human",
    id: typeof user.id === "string" ? user.id : "",
    name: typeof user.name === "string" && user.name ? user.name : "Someone",
    color: typeof user.color === "string" ? user.color : "#999",
    avatar: typeof user.avatar === "string" ? user.avatar : null,
    animal: typeof user.animal === "string" ? user.animal : undefined,
  };
}

const STATUS: Record<string, number> = {
  version_not_found: 404,
  unsupported_markup: 422,
  rate_limited: 429,
  too_large: 413,
  unchanged: 200,
  doc_not_found: 404,
};

/**
 * Routes under a document's `/agents/document-agent/:id` prefix:
 *
 *   GET  /versions               the trail, newest first, without markdown
 *   GET  /versions/:vid          one version's markdown, public by URL like /:id.md
 *   POST /versions               save a version now  ({ user })
 *   POST /versions/:vid/restore  restore one         ({ user })
 *
 * Returns null for any other path so the caller's existing root handling
 * (create / exists) keeps working.
 */
export async function handleVersionRequest(request: Request, stub: VersionStub): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!/\/versions(?:\/|$)/.test(path)) return null;
  // Anything under /versions that isn't one of the four shapes is a 404
  // here, not a fall-through: the caller's bare POST creates documents.
  const match = /\/versions(?:\/(\d+)(\/restore)?)?\/?$/.exec(path);
  if (!match) return json({ error: "not_found" }, 404);
  const [, idText, restore] = match;

  if (request.method === "GET" && !restore) {
    if (idText === undefined) return json(stub.listVersions());
    const markdown = stub.getVersionMarkdown(Number(idText));
    if (markdown === null) return json({ error: "version_not_found" }, 404);
    return new Response(markdown, {
      headers: { "Content-Type": "text/markdown; charset=utf-8", "X-Content-Type-Options": "nosniff" },
    });
  }

  if (request.method === "POST") {
    if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }
    const actor = authorFromBody(body);
    const result =
      idText === undefined && !restore
        ? stub.saveVersion("manual", actor)
        : restore
          ? stub.restoreVersion(Number(idText), actor)
          : null;
    if (result === null) return json({ error: "not_found" }, 404);
    if ("error" in result) return json(result, STATUS[result.error] ?? 400);
    return json(result);
  }

  return json({ error: "method_not_allowed" }, 405);
}
