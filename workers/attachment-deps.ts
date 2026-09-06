import { getAgentByName } from "agents";
import type { AttachmentDeps, AttachmentDocStub, BudgetStub } from "./attachments";
import type Registry from "../agents/registry";

/**
 * The real dependencies behind the attachment handlers: R2 through a
 * fixed-length stream (R2 needs a known length), the document and Registry
 * stubs, the edge cache, and profile names for attribution. Shared by the
 * Worker routes and the MCP `attach` tool.
 */
export function buildAttachmentDeps(env: Env, registry: Registry): AttachmentDeps {
  return {
    bucket: {
      async put(key, body, length, contentType) {
        if (body instanceof Uint8Array) {
          await env.ATTACHMENTS.put(key, body, { httpMetadata: { contentType } });
          return;
        }
        const { readable, writable } = new FixedLengthStream(length);
        const piping = body.pipeTo(writable);
        await Promise.all([env.ATTACHMENTS.put(key, readable, { httpMetadata: { contentType } }), piping]);
      },
      async get(key) {
        const object = await env.ATTACHMENTS.get(key);
        return object ? { body: object.body, size: object.size } : null;
      },
      delete: (key) => env.ATTACHMENTS.delete(key),
    },
    getDocStub: (id) => getAgentByName(env.DocumentAgent, id) as unknown as Promise<AttachmentDocStub>,
    registry: registry as unknown as BudgetStub,
    secret: env.SESSION_SECRET ?? "",
    displayName: async (principal) => (await registry.getProfile(principal)).profile?.displayName ?? null,
    // Workers' global cache; the DOM lib's CacheStorage type lacks the property.
    cache: (caches as unknown as { default: Cache }).default,
  };
}
