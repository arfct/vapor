import { stringify, parse } from "yaml";
import type { ThreadData } from "~/shared/types";

const FRONTMATTER_RE = /^---\n([\s\S]*?\n)---\n\n?/;

export function parseFrontmatter(markdown: string): Record<string, unknown> {
  const match = FRONTMATTER_RE.exec(markdown);
  if (!match) return {};
  try {
    const result = parse(match[1]);
    return result && typeof result === "object" ? result : {};
  } catch {
    return {};
  }
}

export function stripFrontmatter(markdown: string): string {
  return markdown.replace(FRONTMATTER_RE, "");
}

interface SerializedAuthor {
  author: string;
  color: string;
  /** Anonymous-animal glyph, e.g. "🦦". */
  animal?: string;
  /** Agent authors: the connecting client's display name, e.g. "Claude". */
  client?: string;
}

interface SerializedThread extends SerializedAuthor {
  comment: string;
  highlight?: string;
  created: string;
  resolved: boolean;
  replies?: (SerializedAuthor & {
    text: string;
    created: string;
  })[];
}

function authorFrom(raw: SerializedAuthor): ThreadData["author"] {
  return {
    name: raw.author ?? "Unknown",
    color: raw.color ?? "#999",
    colorLight: raw.color ?? "#999",
    animal: raw.animal,
    agentClient: raw.client,
  };
}

function authorTo(a: ThreadData["author"]): SerializedAuthor {
  const out: SerializedAuthor = { author: a.name, color: a.color };
  if (a.animal) out.animal = a.animal;
  if (a.agentClient) out.client = a.agentClient;
  return out;
}

export function serializeThreads(
  markdown: string,
  threads: ThreadData[],
): string {
  if (threads.length === 0) return markdown;

  const existing = parseFrontmatter(markdown);
  const body = stripFrontmatter(markdown);

  const serialized: SerializedThread[] = threads.map((t) => {
    const entry: SerializedThread = {
      comment: t.commentText,
      ...authorTo(t.author),
      created: new Date(t.createdAt).toISOString(),
      resolved: t.resolved,
    };
    if (t.highlightText) {
      entry.highlight = t.highlightText;
    }
    if (t.replies.length > 0) {
      entry.replies = t.replies.map((r) => ({
        ...authorTo(r.author),
        text: r.text,
        created: new Date(r.createdAt).toISOString(),
      }));
    }
    return entry;
  });

  const fm: Record<string, unknown> = { ...existing };
  const existingVapor =
    fm.vapor && typeof fm.vapor === "object"
      ? (fm.vapor as Record<string, unknown>)
      : {};
  fm.vapor = { ...existingVapor, threads: serialized };

  const yamlStr = stringify(fm, { lineWidth: 0 });
  return `---\n${yamlStr}---\n\n${body}`;
}

export function deserializeThreads(markdown: string): {
  body: string;
  threads: ThreadData[];
} {
  const body = stripFrontmatter(markdown);
  const fm = parseFrontmatter(markdown);

  const vapor = fm.vapor as Record<string, unknown> | undefined;
  if (!vapor || !Array.isArray(vapor.threads)) {
    return { body, threads: [] };
  }

  const threads: ThreadData[] = vapor.threads.map(
    (raw: SerializedThread, i: number) => ({
      id: `imported-${i}`,
      commentText: raw.comment ?? "",
      highlightText: raw.highlight,
      author: authorFrom(raw),
      createdAt: raw.created ? new Date(raw.created).getTime() : Date.now(),
      resolved: raw.resolved ?? false,
      replies: (raw.replies ?? []).map((r, j) => ({
        id: `imported-${i}-r${j}`,
        author: authorFrom(r),
        text: r.text ?? "",
        createdAt: r.created ? new Date(r.created).getTime() : Date.now(),
      })),
    }),
  );

  return { body, threads };
}
