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

interface SerializedThread {
  comment: string;
  highlight?: string;
  author: string;
  color: string;
  created: string;
  resolved: boolean;
  replies?: {
    author: string;
    color: string;
    text: string;
    created: string;
  }[];
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
      author: t.author.name,
      color: t.author.color,
      created: new Date(t.createdAt).toISOString(),
      resolved: t.resolved,
    };
    if (t.highlightText) {
      entry.highlight = t.highlightText;
    }
    if (t.replies.length > 0) {
      entry.replies = t.replies.map((r) => ({
        author: r.author.name,
        color: r.author.color,
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
  onboarding: boolean;
} {
  const body = stripFrontmatter(markdown);
  const fm = parseFrontmatter(markdown);

  const vapor = fm.vapor as Record<string, unknown> | undefined;
  const onboarding = vapor?.onboarding === true;
  if (!vapor || !Array.isArray(vapor.threads)) {
    return { body, threads: [], onboarding };
  }

  const threads: ThreadData[] = vapor.threads.map(
    (raw: SerializedThread, i: number) => ({
      id: `imported-${i}`,
      commentText: raw.comment ?? "",
      highlightText: raw.highlight,
      author: {
        name: raw.author ?? "Unknown",
        color: raw.color ?? "#999",
        colorLight: raw.color ?? "#999",
      },
      createdAt: raw.created ? new Date(raw.created).getTime() : Date.now(),
      resolved: raw.resolved ?? false,
      replies: (raw.replies ?? []).map(
        (r: { author: string; color: string; text: string; created: string }, j: number) => ({
          id: `imported-${i}-r${j}`,
          author: {
            name: r.author ?? "Unknown",
            color: r.color ?? "#999",
            colorLight: r.color ?? "#999",
          },
          text: r.text ?? "",
          createdAt: r.created ? new Date(r.created).getTime() : Date.now(),
        }),
      ),
    }),
  );

  return { body, threads, onboarding };
}
