import { useEffect, useMemo } from "react";
import type { Route } from "./+types/home";
import { useStandaloneDoc } from "~/lib/useYjsEditor";
import { DocumentProvider } from "~/lib/DocumentContext";
import { deserializeThreads } from "~/lib/thread-serialization";
import { retimeThreads } from "~/lib/retime-threads";
import { buildMarkdownBlocks } from "~/shared/rich-markdown";
import DocumentLayout from "~/components/DocumentLayout";
import homeDocument from "./home.md?raw";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "vapor" },
    { name: "description", content: "Shared markdown documents for people and agents" },
    { property: "og:description", content: "Shared markdown documents for people and agents" },
    { property: "og:image", content: "https://vapor.fyi/logo-512.png" },
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
  // Comment dates are re-based on the visit so the tour reads as recent.
  const seed = useMemo(() => {
    const parsed = deserializeThreads(homeDocument);
    return { ...parsed, threads: retimeThreads(parsed.threads) };
  }, []);

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
