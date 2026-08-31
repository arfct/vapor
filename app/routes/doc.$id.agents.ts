import { getAgentByName } from "agents";
import type { Route } from "./+types/doc.$id.agents";
import { isValidDocumentId } from "~/shared/constants";
import { getCloudflare } from "~/lib/cloudflare.server";
import type {
  AgentError,
  AgentErrorCode,
  AgentRosterEntry,
} from "~/shared/agent-protocol";

/** The subset of the DocumentAgent RPC surface this route calls. */
interface AgentStub {
  getAgentRoster(): Promise<AgentRosterEntry[]>;
  revokeAgentEntry(name: string): Promise<{ ok: true } | { error: AgentError }>;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function notFound() {
  return jsonResponse(null, 404);
}

function badRequest(message: string) {
  return jsonResponse({ error: { message } }, 400);
}

/**
 * Maps a DocumentAgent `AgentError` onto an HTTP status. The mapping
 * covers the full `AgentErrorCode` union so a future RPC error doesn't
 * fall through unmapped.
 */
function statusForErrorCode(code: AgentErrorCode): number {
  switch (code) {
    case "doc_not_found":
    case "doc_expired":
    case "thread_not_found":
    case "find_not_matched":
      return 404;
    case "invalid_token":
      return 401;
    case "capability_denied":
      return 403;
    case "rate_limited":
      return 429;
    case "stale_anchor":
      return 409;
    case "invalid_name":
    default:
      return 400;
  }
}

async function getStub(context: Route.LoaderArgs["context"], id: string): Promise<AgentStub> {
  const { env } = getCloudflare(context);
  return (await getAgentByName(env.DocumentAgent, id)) as unknown as AgentStub;
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const id = params.id;
  if (!isValidDocumentId(id)) {
    return notFound();
  }

  const stub = await getStub(context, id);
  const roster = await stub.getAgentRoster();
  return jsonResponse(roster);
}

export async function action({ params, context, request }: Route.ActionArgs) {
  const id = params.id;
  if (!isValidDocumentId(id)) {
    return notFound();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  if (typeof body !== "object" || body === null) {
    return badRequest("Invalid body");
  }

  const stub = await getStub(context, id);
  const record = body as Record<string, unknown>;

  if (record.intent === "mint") {
    // Per-doc tokens retired with the identity phase: agents connect over
    // MCP (OAuth or the anonymous door) and enroll on first touch.
    return jsonResponse(
      { error: { message: "Token minting is gone. Connect via https://vapor.fyi/mcp instead." } },
      410,
    );
  }

  if (record.intent === "revoke") {
    const name = record.name;
    if (typeof name !== "string") {
      return badRequest("name is required");
    }

    const result = await stub.revokeAgentEntry(name);
    if ("error" in result) {
      return jsonResponse(result, statusForErrorCode(result.error.code));
    }
    return jsonResponse(result);
  }

  return badRequest("Unknown intent");
}
