import { useEffect, useMemo } from "react";
import type { Route } from "./+types/home";
import { useStandaloneDoc } from "~/lib/useYjsEditor";
import { DocumentProvider } from "~/lib/DocumentContext";
import { deserializeThreads } from "~/lib/thread-serialization";
import { retimeThreads } from "~/lib/retime-threads";
import { buildMarkdownBlocks } from "~/shared/rich-markdown";
import DocumentLayout from "~/components/DocumentLayout";
import homeDocument from "./home.md?raw";
import { useSite } from "~/lib/site-context";
import { UPSTREAM_SOURCE_URL } from "~/shared/site";

export function meta({ matches }: Route.MetaArgs) {
  const root = matches.find((m) => m?.id === "root") as { data?: { site?: { origin: string } } } | undefined;
  const origin = root?.data?.site?.origin ?? "";
  return [
    { title: "vapor" },
    { name: "description", content: "Shared markdown documents for people and agents" },
    { property: "og:description", content: "Shared markdown documents for people and agents" },
    { property: "og:image", content: `${origin}/logo-512.png` },
  ];
}

/**
 * The homepage is the tour, and the tour is a real vapor document: the
 * same editor and comment rail as /:id, seeded from home.md into a local
 * Y.Doc that never connects anywhere. Nothing persists; New document in
 * the header turns the visitor's version into a shareable doc.
 */
export default function Home() {
  const yjs = useStandaloneDoc();
  const { sourceUrl } = useSite();
  // Comment dates are re-based on the visit so the tour reads as recent, and
  // the tour's source link points at this instance's repository.
  const seed = useMemo(() => {
    const parsed = deserializeThreads(homeDocument.split(UPSTREAM_SOURCE_URL).join(sourceUrl));
    return { ...parsed, threads: retimeThreads(parsed.threads) };
  }, [sourceUrl]);

  useEffect(() => {
    const frag = yjs.doc.getXmlFragment("default");
    if (frag.length > 0) return;
    const built = buildMarkdownBlocks(seed.body);
    if (!built.ok) return;
    yjs.doc.transact(() => {
      frag.insert(0, built.nodes);
      const threadsMap = yjs.doc.getMap<string>("threads");
      for (const thread of seed.threads) {
        threadsMap.set(thread.id, JSON.stringify(thread));
      }
    }, "seed");
  }, [yjs.doc, seed]);

  return (
    <DocumentProvider docId="vapor" createdAt={null} yjs={yjs}>
      <DocumentLayout surface={{ kind: "home", fallbackMarkdown: seed.body }} />
    </DocumentProvider>
  );
}
