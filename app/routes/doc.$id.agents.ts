import { getAgentByName } from "agents";
import type { Route } from "./+types/doc.$id.agents";
import { isValidDocumentId } from "~/shared/constants";
import { getCloudflare } from "~/lib/cloudflare.server";
import type {
  AgentCapability,
  AgentError,
  AgentErrorCode,
  AgentRosterEntry,
} from "~/shared/agent-protocol";

/** The subset of the DocumentAgent RPC surface this route calls. */
interface AgentStub {
  mintAgentToken(opts: {
    name: string;
    owner?: string;
    capabilities?: AgentCapability[];
  }): Promise<{ token: string; entry: AgentRosterEntry } | { error: AgentError }>;
  getAgentRoster(): Promise<AgentRosterEntry[]>;
  revokeAgentToken(name: string): Promise<{ ok: true } | { error: AgentError }>;
}

const KNOWN_CAPABILITIES: AgentCapability[] = ["comment", "suggest", "write"];

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
 * Maps a DocumentAgent `AgentError` onto an HTTP status. Only
 * `mintAgentToken`/`revokeAgentToken` errors reach this route today
 * (doc_not_found, invalid_name), but the mapping covers the full
 * `AgentErrorCode` union so a future RPC error doesn't fall through
 * unmapped.
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
    const name = record.name;
    if (typeof name !== "string") {
      return badRequest("name is required");
    }

    const ownerRaw = record.owner;
    const owner =
      typeof ownerRaw === "string" && ownerRaw.trim() ? ownerRaw : undefined;

    let capabilities: AgentCapability[] | undefined;
    if (record.capabilities !== undefined) {
      const capsRaw = record.capabilities;
      const isValid =
        Array.isArray(capsRaw) &&
        capsRaw.every(
          (c): c is AgentCapability =>
            typeof c === "string" &&
            KNOWN_CAPABILITIES.includes(c as AgentCapability),
        );
      if (!isValid) {
        return badRequest(
          `capabilities must be a subset of ${KNOWN_CAPABILITIES.join(", ")}`,
        );
      }
      capabilities = capsRaw as AgentCapability[];
    }

    const result = await stub.mintAgentToken({ name, owner, capabilities });
    if ("error" in result) {
      return jsonResponse(result, statusForErrorCode(result.error.code));
    }
    return jsonResponse(result, 201);
  }

  if (record.intent === "revoke") {
    const name = record.name;
    if (typeof name !== "string") {
      return badRequest("name is required");
    }

    const result = await stub.revokeAgentToken(name);
    if ("error" in result) {
      return jsonResponse(result, statusForErrorCode(result.error.code));
    }
    return jsonResponse(result);
  }

  return badRequest("Unknown intent");
}
