import { data } from "react-router";
import type { Route } from "./+types/doc.$id";
import { getAgentByName } from "agents";
import { isValidDocumentId } from "~/shared/constants";
import { isReservedSlug } from "~/shared/agent-protocol";
import { getCloudflare } from "~/lib/cloudflare.server";
import { useYjsEditor } from "~/lib/useYjsEditor";
import { DocumentProvider } from "~/lib/DocumentContext";
import DocumentLayout from "~/components/DocumentLayout";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "vapor" }];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const id = params.id;
  // Documents share the root namespace with a handful of reserved slugs
  // (/new, /mcp, /.well-known/…). Refuse them here explicitly rather than
  // relying on isValidDocumentId's shape check to exclude them by accident.
  if (isReservedSlug(id)) {
    throw data(null, { status: 404 });
  }
  if (!isValidDocumentId(id)) {
    throw data(null, { status: 404 });
  }

  const { env } = getCloudflare(context);
  const stub = await getAgentByName(env.DocumentAgent, id);
  const res = await stub.fetch(new Request("https://do/"));
  const { exists, createdAt } = (await res.json()) as {
    exists: boolean;
    createdAt: number | null;
  };

  if (!exists) {
    throw data(null, { status: 404 });
  }

  return { id, createdAt };
}

export default function DocumentPage({ loaderData }: Route.ComponentProps) {
  const { id, createdAt } = loaderData;
  const yjs = useYjsEditor(id);

  return (
    <DocumentProvider docId={id} createdAt={createdAt} yjs={yjs}>
      <DocumentLayout surface={{ kind: "doc", id, createdAt }} />
    </DocumentProvider>
  );
}
