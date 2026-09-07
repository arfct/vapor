import { data } from "react-router";
import type { Route } from "./+types/doc.$id";
import { getAgentByName } from "agents";
import { isReservedSlug } from "~/shared/agent-protocol";
import { documentPath, parseDocumentSegment } from "~/shared/doc-url";
import { getCloudflare } from "~/lib/cloudflare.server";
import { useYjsEditor } from "~/lib/useYjsEditor";
import { DocumentProvider } from "~/lib/DocumentContext";
import DocumentLayout from "~/components/DocumentLayout";

const DEFAULT_DESCRIPTION = "A shared markdown document for people and agents";

/**
 * A shared link unfurls as the document, not as the app: its title, its
 * first paragraph, and its canonical slugged URL. The tags are rendered on
 * the server from the loader's snapshot, which is what link previewers see.
 *
 * iMessage shows a description only for pages that look like a social
 * post: `og:type=article` plus an ActivityPub alternate link (its presence
 * is the signal; it points back at the page). Other platforms ignore the link,
 * so it is served to everyone. The site logo is the small icon (root
 * `links`) and the large image; a per-document image can replace the
 * latter later. Guidance: arfct/link-previews, docs/imessage.md.
 */
export function meta({ data, matches }: Route.MetaArgs) {
  const root = matches.find((m) => m?.id === "root") as { data?: { site?: { origin: string } } } | undefined;
  const origin = root?.data?.site?.origin ?? "";
  const title = data?.title ?? null;
  const description = data?.description ?? DEFAULT_DESCRIPTION;
  const url = data ? `${origin}${data.path}` : undefined;
  return [
    { title: title ? `${title} · vapor` : "vapor" },
    { name: "description", content: description },
    { property: "og:type", content: "article" },
    { property: "og:site_name", content: "vapor" },
    { property: "og:title", content: title ?? "vapor" },
    { property: "og:description", content: description },
    ...(url ? [{ property: "og:url", content: url }] : []),
    { property: "og:image", content: `${origin}/logo-512.png` },
    { property: "og:image:width", content: "512" },
    { property: "og:image:height", content: "512" },
    { property: "og:image:alt", content: "vapor" },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title ?? "vapor" },
    { name: "twitter:description", content: description },
    { tagName: "link", rel: "alternate", type: "application/activity+json", href: url ?? "" },
  ];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const segment = params.id;
  // Documents share the root namespace with a handful of reserved slugs
  // (/new, /mcp, /.well-known/…). Refuse them here explicitly rather than
  // relying on the segment parser's shape check to exclude them by accident.
  if (isReservedSlug(segment)) {
    throw data(null, { status: 404 });
  }
  // `/26g5wsew` or `/agent-identity-plan-26g5wsew`: the id resolves, the
  // slug is decoration and may be stale.
  const parsed = parseDocumentSegment(segment);
  if (!parsed) {
    throw data(null, { status: 404 });
  }
  const { id } = parsed;

  const { env } = getCloudflare(context);
  const stub = await getAgentByName(env.DocumentAgent, id);
  const res = await stub.fetch(new Request("https://do/"));
  const { exists, createdAt, title, description } = (await res.json()) as {
    exists: boolean;
    createdAt: number | null;
    title?: string | null;
    description?: string | null;
  };

  if (!exists) {
    throw data(null, { status: 404 });
  }

  return { id, createdAt, title: title ?? null, description: description ?? null, path: documentPath(id, title) };
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
